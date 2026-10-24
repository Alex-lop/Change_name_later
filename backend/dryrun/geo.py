"""Modeled home areas for the synthetic patients: Massachusetts counties.

Patients are synthetic and so are their homes: each one is modeled from public
data, never observed. Every patient gets exactly one of 12 areas (the 14
counties, with Barnstable, Dukes and Nantucket grouped as "Cape and Islands"),
stored as the `area` column of patients.csv. Clinical attributes are never
touched, so every count elsewhere in the app stays identical.

Model, for patient i and county c:

    w(i, c) = adults(c, band(i)) x D_aa(c) x prod_k LR_k(i, c)

- adults(c, band): ACS 5-year adults in county c in the patient's age band,
  i.e. adults(c) x P(band | c). Missing age uses all adults 18+.
- D_aa(c): CDC PLACES age-adjusted diagnosed-diabetes prevalence. Age-adjusted,
  because age is already in adults(c, band).
- LR_k: one likelihood ratio per condition the generator models, with PLACES
  age-adjusted rates: hypertension -> BPHIGH, mi -> CHD, stroke -> STROKE,
  ckd -> KIDNEY, BMI >= 30 -> OBESITY. p_c / p_state if the patient has it,
  (1 - p_c) / (1 - p_state) if not; a missing BMI contributes 1. p_state is
  the adult-weighted mean of the 14 county rates (PLACES has no state row).

Raking (iterative proportional fitting) then rescales w so each patient's row
sums to 1 and each county's expected patient total equals its share of adults
with diabetes (ACS adults x PLACES crude prevalence). Each patient takes one
draw from its row, using a uniform seeded by (SEED, patient id): deterministic,
and independent of row order.

Assumptions: within a county every patient shares the county's rates apart
from the five conditions above; the conditions act independently (a naive
Bayes product); PLACES values are model-based small-area estimates and carry
that model's error; the synthetic patients' conditions are generated without
geography, so the map shows how the modeled mix of patients meets the
criteria, not observed local eligibility.
"""

from __future__ import annotations

import csv
import json
import os
import random
from collections import Counter
from functools import lru_cache
from pathlib import Path

GEO_DIR = Path(__file__).resolve().parent.parent / "data" / "geo"
SEED = 20261024
# Generator condition token -> PLACES measure id. BMI >= 30 maps to OBESITY.
CONDITION_MEASURES = {
    "hypertension": "BPHIGH",
    "mi": "CHD",
    "stroke": "STROKE",
    "ckd": "KIDNEY",
}
OBESITY_BMI = 30.0
CLOSED_SITE = {"COMPLETED", "ACTIVE_NOT_RECRUITING", "TERMINATED", "WITHDRAWN", "SUSPENDED"}
NOTE = (
    "Patients are synthetic. Homes are modeled from public data. "
    "The map scores places, never people."
)


@lru_cache(maxsize=None)
def load(name: str) -> dict:
    """A bundled file from data/geo/ (built once by scripts/build_geo.py)."""
    return json.loads((GEO_DIR / name).read_text())


def area_ids() -> list[str]:
    """Area ids in display order; a patient's area index is its position here."""
    return [a["id"] for a in load("areas.json")["areas"]]


def _num(x) -> float | None:
    return None if x is None or x == "" else float(x)


def _conditions(x) -> set[str]:
    if not x:
        return set()
    if isinstance(x, str):
        x = x.split(";")
    return {str(v).strip().lower() for v in x if str(v).strip()}


def assign_areas(
    records: list[dict], seed: int = SEED, inputs: dict | None = None
) -> tuple[list[str], dict]:
    """One area id per record, plus a short raking report.

    A record needs `id`, `age`, `conditions` (a list or ';'-joined string) and
    `bmi`; CSV strings are fine and empty means missing.
    """
    if not records:
        return [], {"iterations": 0, "max_rel_error": 0.0}
    inp = inputs or load("county_inputs.json")
    fips = sorted(inp["counties"])
    cs = [inp["counties"][f] for f in fips]
    lows = [lo for lo, _ in inp["age_bands"]]
    adults = [c["adults_18plus"] for c in cs]

    def rate(c: dict, measure: str, kind: str = "age_adjusted") -> float:
        return c["places"][measure][kind] / 100

    measures = [*CONDITION_MEASURES.values(), "OBESITY"]
    state = {
        m: sum(a * rate(c, m) for a, c in zip(adults, cs)) / sum(adults)
        for m in measures
    }
    lr = {
        m: (
            [rate(c, m) / state[m] for c in cs],
            [(1 - rate(c, m)) / (1 - state[m]) for c in cs],
        )
        for m in measures
    }
    by_band = [
        [c["adults_by_band"][b] * rate(c, "DIABETES") for c in cs]
        for b in range(len(lows))
    ]
    any_band = [a * rate(c, "DIABETES") for a, c in zip(adults, cs)]

    W: list[list[float]] = []
    for r in records:
        age = _num(r.get("age"))
        if age is None:
            w = list(any_band)
        else:
            band = max([k for k, lo in enumerate(lows) if age >= lo] or [0])
            w = list(by_band[band])
        conds = _conditions(r.get("conditions"))
        has = {m: tok in conds for tok, m in CONDITION_MEASURES.items()}
        bmi = _num(r.get("bmi"))
        if bmi is not None:
            has["OBESITY"] = bmi >= OBESITY_BMI
        for m, yes in has.items():
            w = [x * f for x, f in zip(w, lr[m][0 if yes else 1])]
        W.append(w)

    crude = [a * rate(c, "DIABETES", "crude") for a, c in zip(adults, cs)]
    target = [len(records) * t / sum(crude) for t in crude]
    for it in range(1, 501):
        for w in W:
            s = sum(w)
            w[:] = [x / s for x in w]
        col = [sum(v) for v in zip(*W)]
        err = max(abs(got / want - 1) for got, want in zip(col, target))
        if err < 1e-6:
            break
        scale = [want / got for want, got in zip(target, col)]
        for w in W:
            w[:] = [x * f for x, f in zip(w, scale)]
    else:  # no convergence: still leave every row a probability distribution
        for w in W:
            s = sum(w)
            w[:] = [x / s for x in w]

    county_area = [c["area_id"] for c in cs]
    out = []
    for r, w in zip(records, W):
        u = random.Random(f"{seed}:{r['id']}").random()
        acc, pick = 0.0, len(w) - 1
        for j, x in enumerate(w):
            acc += x
            if u < acc:
                pick = j
                break
        out.append(county_area[pick])
    return out, {
        "iterations": it,
        "max_rel_error": err,
        "state_reference_pct": {m: round(v * 100, 3) for m, v in state.items()},
    }


def patient_areas(patients) -> dict[str, str]:
    """id -> area for engine Patients (used when a CSV has no area column)."""
    recs = [
        {
            "id": p.id,
            "age": p.fields.get("age"),
            "conditions": p.fields.get("conditions"),
            "bmi": p.fields.get("bmi"),
        }
        for p in patients
    ]
    areas, _ = assign_areas(recs)
    return {r["id"]: a for r, a in zip(recs, areas)}


def add_area_column(csv_path: str | Path) -> dict:
    """(Re)write the `area` column of a population CSV; other cells are kept as-is."""
    path = Path(csv_path)
    with path.open(newline="") as f:
        rows = list(csv.reader(f))
    header, body = rows[0], rows[1:]
    if "area" in header:
        i = header.index("area")
        header = header[:i] + header[i + 1 :]
        body = [r[:i] + r[i + 1 :] for r in body]
    areas, report = assign_areas([dict(zip(header, r)) for r in body])
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header + ["area"])
        w.writerows(r + [a] for r, a in zip(body, areas))
    os.replace(tmp, path)  # atomic: a reader never sees half a file
    report["areas"] = dict(sorted(Counter(areas).items()))
    return report


def geo_payload(store) -> dict:
    """GET /api/geo: the map, each patient's area index and age, sites, sources."""
    from .analysis import patient_order

    meta = load("areas.json")
    ids = [a["id"] for a in meta["areas"]]
    index = {a: i for i, a in enumerate(ids)}
    area_of = store.areas()
    counts = Counter(area_of.values())
    ordered = patient_order(store.patients())
    sites = load("sites.json")
    recruiting = sites["recruiting_sites"]
    # The snapshot keeps every MA location of a RECRUITING study; drop the
    # locations whose own status says they are closed.
    open_sites = [s for s in recruiting["sites"] if s.get("status") not in CLOSED_SITE]
    keys = ("id", "name", "label", "fips", "paths", "label_xy")
    return {
        "level": "county",
        "viewBox": meta["viewBox"],
        "areas": [
            {**{k: a[k] for k in keys}, "patients": counts[a["id"]], "context": a["context"]}
            for a in meta["areas"]
        ],
        "patients": {
            "order": "same sort as analysis.patient_codes",
            "area": [index.get(area_of.get(p.id)) for p in ordered],
            "age": [
                None if p.fields.get("age") is None else int(p.fields["age"])
                for p in ordered
            ],
        },
        "sites": {
            nct: [{k: s[k] for k in ("facility", "city", "xy", "area_id")} for s in lst]
            for nct, lst in sites["trial_sites"].items()
        },
        "recruiting_sites": {
            "as_of": recruiting["as_of"],
            "trials": len({s["nct_id"] for s in open_sites}),
            "sites": [
                {k: s[k] for k in ("nct_id", "title", "city", "xy", "area_id")}
                for s in open_sites
            ],
        },
        "sources": load("sources.json")["sources"],
        "note": NOTE,
    }


if __name__ == "__main__":
    from .store import DEFAULT_CSV

    print(json.dumps(add_area_column(DEFAULT_CSV), indent=2))
