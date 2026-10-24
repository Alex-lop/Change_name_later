"""Synthetic Synthea-like patient population generator.

Produces ~10k patients with realistic, correlated clinical values and a
type-2-diabetes-enriched cohort. Some values are intentionally missing so the
UNKNOWN verdict path is exercised end to end.

Output is a flat CSV (one row per patient) with canonical units, plus
multi-valued `conditions` and `medications` columns (semicolon-delimited).
This is deterministic given a seed, so the demo is reproducible.
"""

from __future__ import annotations

import csv
import random
from dataclasses import dataclass, field
from pathlib import Path

# Human-readable description of the shipped population base.
POPULATION_LABEL = "adults with type 2 diabetes"

# Canonical units used in the CSV (match dryrun.units.CANONICAL_UNIT).
CSV_FIELDS = [
    "id",
    "age",            # years
    "sex",            # categorical: male/female
    "race",           # categorical
    "hba1c",          # percent
    "bmi",            # kg/m2
    "egfr",           # ml/min/1.73m2
    "weight",         # kg
    "systolic_bp",    # mmhg
    "fasting_glucose",  # mg/dl
    "creatinine",     # mg/dl
    "conditions",     # ;-delimited
    "medications",    # ;-delimited
]

CONDITION_CODES = {
    "t2d": "type 2 diabetes",
    "t1d": "type 1 diabetes",
    "hypertension": "hypertension",
    "ckd": "chronic kidney disease",
    "dialysis": "dependence on renal dialysis",
    "chf": "congestive heart failure",
    "mi": "myocardial infarction",
    "stroke": "cerebrovascular accident",
    "pancreatitis": "pancreatitis",
    "cancer": "malignant neoplasm",
}


@dataclass
class Patient:
    id: str
    age: float | None
    sex: str
    race: str
    hba1c: float | None
    bmi: float | None
    egfr: float | None
    weight: float | None
    systolic_bp: float | None
    fasting_glucose: float | None
    creatinine: float | None
    conditions: list[str] = field(default_factory=list)
    medications: list[str] = field(default_factory=list)


def _maybe(rng: random.Random, value: float, missing_prob: float) -> float | None:
    """Drop a value with probability missing_prob to simulate missing data."""
    return None if rng.random() < missing_prob else round(value, 2)


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def generate_patient(rng: random.Random, i: int, diabetic: bool) -> Patient:
    sex = rng.choice(["male", "female"])
    race = rng.choices(
        ["white", "black", "asian", "hispanic", "other"],
        weights=[0.6, 0.13, 0.08, 0.15, 0.04],
    )[0]
    age = _clamp(rng.gauss(58 if diabetic else 45, 15), 18, 90)

    conditions: list[str] = []
    medications: list[str] = []

    if diabetic:
        conditions.append("t2d")
        hba1c = _clamp(rng.gauss(8.0, 1.3), 5.5, 14.0)
        fglucose = _clamp(rng.gauss(150, 40), 80, 400)
        bmi = _clamp(rng.gauss(32, 5), 18, 55)
        if rng.random() < 0.6:
            medications.append("metformin")
        if rng.random() < 0.25:
            medications.append("insulin")
        if rng.random() < 0.2:
            medications.append("glp1 agonist")
    else:
        hba1c = _clamp(rng.gauss(5.4, 0.4), 4.5, 7.0)
        fglucose = _clamp(rng.gauss(95, 12), 70, 160)
        bmi = _clamp(rng.gauss(27, 5), 16, 50)

    # Comorbidities correlated with age / diabetes.
    if rng.random() < (0.4 if diabetic else 0.2):
        conditions.append("hypertension")
        medications.append("lisinopril")
    egfr = _clamp(rng.gauss(90 - (age - 40) * 0.8, 15), 10, 120)
    if egfr < 60 and rng.random() < 0.7:
        conditions.append("ckd")
    # Dialysis: a small subset of severe CKD (PIONEER 6 E8 token).
    if egfr < 20 and rng.random() < 0.4:
        conditions.append("dialysis")
    if rng.random() < 0.03:
        conditions.append("t1d")
    if rng.random() < 0.05:
        conditions.append("chf")
    if rng.random() < 0.04:
        conditions.append("mi")
    if rng.random() < 0.03:
        conditions.append("stroke")        # PIONEER 6 cardiovascular-disease token
    if rng.random() < 0.02:
        conditions.append("pancreatitis")  # PIONEER 6 E3 token
    if rng.random() < 0.05:
        conditions.append("cancer")

    # Glucose-lowering drug classes PIONEER 6 excludes (E1 washout token).
    if diabetic and rng.random() < 0.08:
        medications.append("dpp4 inhibitor")

    weight = _clamp(bmi * (1.7 ** 2) + rng.gauss(0, 5), 40, 180)
    systolic = _clamp(
        rng.gauss(135 if "hypertension" in conditions else 122, 12), 90, 200
    )
    creatinine = _clamp(rng.gauss(0.9 + max(0, (60 - egfr)) * 0.02, 0.2), 0.4, 6.0)

    return Patient(
        id=f"P{i:06d}",
        age=_maybe(rng, age, 0.0),
        sex=sex,
        race=race,
        hba1c=_maybe(rng, hba1c, 0.08),         # labs sometimes missing
        bmi=_maybe(rng, bmi, 0.05),
        egfr=_maybe(rng, egfr, 0.10),
        weight=_maybe(rng, weight, 0.03),
        systolic_bp=_maybe(rng, systolic, 0.05),
        fasting_glucose=_maybe(rng, fglucose, 0.15),
        creatinine=_maybe(rng, creatinine, 0.10),
        conditions=conditions,
        medications=medications,
    )


def generate_population(
    n: int = 10_000, diabetic_fraction: float = 1.0, seed: int = 42
) -> list[Patient]:
    """Generate the trial-base population.

    The shipped population is adults with type 2 diabetes (``diabetic_fraction``
    defaults to 1.0): every patient carries ``t2d``. All eligible fractions,
    enrollment months, and price tags are therefore relative to adults with
    type 2 diabetes, not the general public.
    """
    rng = random.Random(seed)
    out = []
    for i in range(n):
        diabetic = rng.random() < diabetic_fraction
        out.append(generate_patient(rng, i, diabetic))
    return out


def write_csv(patients: list[Patient], path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(CSV_FIELDS)
        for p in patients:
            w.writerow(
                [
                    p.id,
                    "" if p.age is None else p.age,
                    p.sex,
                    p.race,
                    "" if p.hba1c is None else p.hba1c,
                    "" if p.bmi is None else p.bmi,
                    "" if p.egfr is None else p.egfr,
                    "" if p.weight is None else p.weight,
                    "" if p.systolic_bp is None else p.systolic_bp,
                    "" if p.fasting_glucose is None else p.fasting_glucose,
                    "" if p.creatinine is None else p.creatinine,
                    ";".join(p.conditions),
                    ";".join(p.medications),
                ]
            )
    return path


if __name__ == "__main__":
    import sys

    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10_000
    out = Path(__file__).resolve().parent.parent / "data" / "patients.csv"
    pop = generate_population(n)
    write_csv(pop, out)
    print(f"Wrote {len(pop)} patients to {out}")
