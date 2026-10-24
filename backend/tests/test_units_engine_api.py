"""Unit tests for engine, units, parser cache, seed, and API."""

from __future__ import annotations

import math

from fastapi.testclient import TestClient

from dryrun import units
from dryrun.api import app
from dryrun.engine import evaluate
from dryrun.model import Kind, Operator, Patient, Rule, Verdict
from dryrun.parser import ParseCache, RuleParser


def test_unit_conversion_hba1c():
    # 53 mmol/mol ~ 7.0% NGSP
    assert math.isclose(units.to_canonical("hba1c", 53, "mmol/mol"), 7.0, abs_tol=0.02)


def test_engine_between():
    r = Rule(id="r", field="hba1c", operator=Operator.BETWEEN, value=[7.0, 10.0],
             unit="percent")
    assert evaluate(r, Patient(id="a", fields={"hba1c": 8.0},
                               units_={"hba1c": "percent"})) == Verdict.MEETS
    assert evaluate(r, Patient(id="b", fields={"hba1c": 6.0},
                               units_={"hba1c": "percent"})) == Verdict.FAILS


def test_engine_exclusion_flip():
    r = Rule(id="r", field="conditions", operator=Operator.HAS, value=["t1d"],
             kind=Kind.EXCLUSION)
    has = Patient(id="a", fields={"conditions": ["t1d", "t2d"]})
    hasnt = Patient(id="b", fields={"conditions": ["t2d"]})
    assert evaluate(r, has) == Verdict.FAILS   # matches exclusion -> fails
    assert evaluate(r, hasnt) == Verdict.MEETS


def test_engine_exclusion_missing_stays_unknown():
    r = Rule(id="r", field="egfr", operator=Operator.LT, value=30,
             unit="ml/min/1.73m2", kind=Kind.EXCLUSION)
    assert evaluate(r, Patient(id="a", fields={})) == Verdict.UNKNOWN


def test_cache_put_get(tmp_path):
    cache = ParseCache(tmp_path / "c.json")
    cache.put("Age 50 years or older.",
              dict(field="age", operator=">=", value=50, unit="years"))
    p = RuleParser(cache=cache)
    r = p.parse_sentence("Age 50 years or older.", "r0")
    assert r.field == "age" and r.operator == Operator.GTE and r.value == 50


def test_parser_no_backend_raises_on_miss(tmp_path):
    p = RuleParser(cache=ParseCache(tmp_path / "empty.json"))
    try:
        p.parse_sentence("Something totally novel.", "r0")
        assert False, "should raise"
    except LookupError:
        pass


def test_api_full_flow():
    c = TestClient(app)
    assert c.get("/api/health").json()["population"] == 10000
    trials = c.get("/api/trials").json()["trials"]
    assert any(t["nct_id"] == "NCT01179048" for t in trials)

    pr = c.post("/api/parse", json={"nct_id": "NCT01179048"}).json()
    assert len(pr["rules"]) == 4 and pr["unparsed"] == []

    an = c.post("/api/analyze", json={"rules": pr["rules"]}).json()
    assert an["total_patients"] == 10000
    assert 0 < an["confirmed_eligible"] <= an["possibly_eligible"]
    assert an["cost"]["enrollment_months"] is not None

    # toggling off a criterion never decreases confirmed-eligible
    active = [r["id"] for r in pr["rules"]][:-1]
    an2 = c.post("/api/analyze",
                 json={"rules": pr["rules"], "active_rule_ids": active}).json()
    assert an2["confirmed_eligible"] >= an["confirmed_eligible"]


def test_api_returns_patient_codes_matching_price_tags():
    # v3 Task 2: /api/analyze returns one code per patient, age-sorted, and
    # the count of code k equals active price tag k's excluded count.
    c = TestClient(app)
    pr = c.post("/api/parse", json={"nct_id": "NCT02692716"}).json()
    an = c.post("/api/analyze", json={"rules": pr["rules"]}).json()
    codes = an["patient_codes"]
    assert len(codes) == an["total_patients"] == 10000

    active_ids = an["active_rule_ids"]
    tags = an["price_tags"]
    assert len(tags) == len(active_ids)
    # tags are returned in active_ids order, so tag index k <-> code k.
    for k, tag in enumerate(tags):
        assert codes.count(k) == tag["excluded"]
    assert codes.count(-2) == an["confirmed_eligible"]
    assert codes.count(-1) == an["possibly_eligible"] - an["confirmed_eligible"]

    c = TestClient(app)
    assert c.post("/api/parse", json={}).status_code == 400


def test_split_criteria_is_section_aware():
    # Task 11: split_criteria returns (sentence, kind), tracking the section.
    from dryrun.parser import split_criteria

    text = (
        "Inclusion Criteria:\n- Age at least 50 years\n"
        "Exclusion Criteria:\n- History of pancreatitis\n- Severe renal impairment"
    )
    out = split_criteria(text)
    assert out == [
        ("Age at least 50 years", "inclusion"),
        ("History of pancreatitis", "exclusion"),
        ("Severe renal impairment", "exclusion"),
    ]


def test_cache_key_includes_kind():
    # The same sentence under different sections is cached separately.
    from dryrun.parser import ParseCache
    import tempfile, pathlib

    with tempfile.TemporaryDirectory() as d:
        cache = ParseCache(pathlib.Path(d) / "c.json")
        s = "Active malignancy"
        cache.put(s, {"field": "conditions", "operator": "has",
                      "value": ["cancer"], "kind": "inclusion"}, "inclusion")
        cache.put(s, {"field": "conditions", "operator": "has",
                      "value": ["cancer"], "kind": "exclusion"}, "exclusion")
        inc = cache.get(s, "inclusion")
        exc = cache.get(s, "exclusion")
        assert inc["kind"] == "inclusion"
        assert exc["kind"] == "exclusion"


def test_added_rule_evaluated_by_engine():
    # Task 7: a hand-added rule (added=true, no parser) is evaluated like any
    # other rule and tightens the confirmed-eligible count.
    c = TestClient(app)
    pr = c.post("/api/parse", json={"nct_id": "NCT01179048"}).json()
    rules = pr["rules"]
    an_before = c.post("/api/analyze", json={"rules": rules}).json()
    added = {
        "id": "added_1",
        "field": "bmi",
        "operator": "<=",
        "value": 30,
        "unit": "kg/m2",
        "kind": "inclusion",
        "source_sentence": "Added: bmi <= 30 kg/m2",
        "label": "added in Dry Run",
        "added": True,
    }
    an_after = c.post("/api/analyze", json={"rules": rules + [added]}).json()
    # Strict: adding bmi <= 30 to LEADER must LOWER confirmed-eligible.
    assert an_after["confirmed_eligible"] < an_before["confirmed_eligible"]
    # The added rule appears in its own price tag, marked and evaluated, and it
    # actually excludes patients.
    added_tag = next(
        (t for t in an_after["price_tags"] if t["rule_id"] == "added_1"), None
    )
    assert added_tag is not None
    assert added_tag["excluded"] > 0
    # Task 2: deltas compare vs the acted-on cohort, are age+sex only (no race),
    # and are hidden when the excluded group is under 30 patients.
    c = TestClient(app)
    pr = c.post("/api/parse", json={"nct_id": "NCT01179048"}).json()
    an = c.post("/api/analyze", json={"rules": pr["rules"]}).json()
    for t in an["price_tags"]:
        assert "excluded_demographics" not in t
        dd = t["demographic_deltas"]
        if t["excluded"] < 30:
            assert dd is None  # hidden for small groups
        else:
            assert dd is not None
            assert "race" not in dd  # no race deltas on generated data
            assert set(dd.keys()) <= {"mean_age_delta", "sex"}


# --- concurrency + performance regression tests ------------------------------


def test_subset_demographics_match_duckdb():
    # 1. Python-computed subset demographics equal a direct DuckDB query for a
    #    fixed list of 500 ids.
    import duckdb

    from dryrun.store import get_store

    store = get_store()
    ids = [p.id for p in store.patients()[:500]]

    got = store.demographics(ids)

    con = duckdb.connect(database=":memory:")
    con.execute(
        "CREATE TABLE patients AS SELECT * FROM read_csv_auto(?, header=true, "
        "all_varchar=true)",
        [str(store.csv_path)],
    )
    placeholders = ",".join("?" for _ in ids)
    n = con.execute(
        f"SELECT COUNT(*) FROM patients WHERE id IN ({placeholders})", ids
    ).fetchone()[0]
    mean_age = con.execute(
        f"SELECT AVG(TRY_CAST(age AS DOUBLE)) FROM patients WHERE id IN "
        f"({placeholders})",
        ids,
    ).fetchone()[0]
    sex_rows = con.execute(
        f"SELECT sex, COUNT(*) FROM patients WHERE id IN ({placeholders}) "
        f"GROUP BY sex",
        ids,
    ).fetchall()
    con.close()

    assert got["n"] == n
    assert got["mean_age"] == (round(mean_age, 1) if mean_age is not None else None)
    assert got["sex"] == {k: v for k, v in sex_rows}
    assert "race" not in got


def test_demographics_concurrent_consistency():
    # 2. Four threads call store.demographics(ids) five times each with 6,000
    #    ids: no exception, and all results are equal.
    import threading

    from dryrun.store import get_store

    store = get_store()
    ids = [p.id for p in store.patients()[:6000]]
    assert len(ids) == 6000

    results: list[dict] = []
    errors: list[Exception] = []
    lock = threading.Lock()

    def worker():
        try:
            for _ in range(5):
                r = store.demographics(ids)
                with lock:
                    results.append(r)
        except Exception as e:  # pragma: no cover - failure path
            with lock:
                errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    assert len(results) == 4 * 5
    first = results[0]
    for r in results[1:]:
        assert r == first


def test_analyze_endpoint_under_200ms():
    # 3. /api/analyze for NCT01179048 takes under 200 ms.
    import time

    c = TestClient(app)
    pr = c.post("/api/parse", json={"nct_id": "NCT01179048"}).json()
    body = {"rules": pr["rules"]}
    # Warm the store/materialization so we time the analyze path, not CSV load.
    c.post("/api/analyze", json=body)

    start = time.perf_counter()
    resp = c.post("/api/analyze", json=body)
    elapsed = time.perf_counter() - start
    assert resp.status_code == 200
    assert elapsed < 0.2, f"/api/analyze took {elapsed * 1000:.0f} ms"


def test_frontend_mount_contains_path_traversal(tmp_path):
    # Static serving must contain every request inside the dist dir and serve
    # index.html at /, without leaking source via path traversal.
    from pathlib import Path

    from fastapi import FastAPI

    from dryrun.api import mount_frontend

    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><div id=\"root\"></div>")

    fresh = FastAPI()

    @fresh.get("/api/health")
    def _health() -> dict:  # a representative API route
        return {"status": "ok"}

    mount_frontend(fresh, Path(dist))
    client = TestClient(fresh)

    # / serves index.html
    root = client.get("/")
    assert root.status_code == 200
    assert 'id="root"' in root.text

    # Path traversal must NOT return 200 (and must not leak source).
    traversal = client.get(
        "/%2e%2e/%2e%2e/backend/dryrun/api.py", follow_redirects=False
    )
    assert traversal.status_code != 200
    assert "mount_frontend" not in traversal.text

    # A missing API route returns 404 (not shadowed by the static mount).
    assert client.get("/api/nope").status_code == 404


def test_verbatim_trials_match_raw_eligibility_text():
    # Every source sentence of a trial flagged paraphrased=false must appear
    # verbatim in backend/data/trials_raw/<NCT>.txt, once backslash escapes are
    # removed (ClinicalTrials.gov escapes e.g. "m\^2").
    from pathlib import Path

    from dryrun.seed import load_registry

    raw_dir = Path(__file__).resolve().parent.parent / "data" / "trials_raw"
    registry = load_registry()
    checked = 0
    for nct, trial in registry.items():
        if trial.get("paraphrased") is not False:
            continue
        raw_path = raw_dir / f"{nct}.txt"
        assert raw_path.exists(), f"missing raw text for {nct}"
        raw = raw_path.read_text().replace("\\", "")
        for crit in trial["criteria"]:
            sentence = crit["sentence"]
            assert sentence in raw, (
                f"{nct}: source sentence not verbatim in raw text:\n{sentence!r}"
            )
            checked += 1
    assert checked > 0  # at least PIONEER 6 was verified


def test_geo_endpoint_contract():
    # v4 map: 12 areas, one area index and age per patient in patient_codes
    # order, and a source for every bundled dataset.
    c = TestClient(app)
    g = c.get("/api/geo").json()
    assert g["level"] == "county" and len(g["areas"]) == 12
    assert sum(a["patients"] for a in g["areas"]) == 10000
    pts = g["patients"]
    assert len(pts["area"]) == len(pts["age"]) == 10000
    assert all(0 <= i < 12 for i in pts["area"])
    assert pts["age"] == sorted(pts["age"])  # age-ascending, like patient_codes
    keys = {"what", "dataset", "data_year", "url", "retrieved"}
    assert g["sources"] and all(set(s) == keys for s in g["sources"])
    for a in g["areas"]:
        assert a["paths"] and len(a["label_xy"]) == 2
        assert None not in a["context"].values()


def test_analyze_areas_reconcile_with_counts_and_price_tags():
    c = TestClient(app)
    ids = [a["id"] for a in c.get("/api/geo").json()["areas"]]
    pr = c.post("/api/parse", json={"nct_id": "NCT02692716"}).json()
    an = c.post("/api/analyze", json={"rules": pr["rules"]}).json()
    assert an["confirmed_eligible"] == 1807
    areas = an["areas"]
    assert [r["id"] for r in areas["rows"]] == ids
    shown = [r for r in areas["rows"] if not r["suppressed"]]
    for key, total in (("patients", 10000),
                       ("confirmed", an["confirmed_eligible"]),
                       ("possibly", an["possibly_eligible"])):
        assert sum(r[key] for r in shown) + areas["suppressed"][key] == total
    for tag in an["price_tags"]:
        rid = tag["rule_id"]
        got = sum(r["excluded_by"][rid] for r in shown)
        assert got + areas["suppressed"]["excluded_by"][rid] == tag["excluded"]


def test_csv_area_column_is_the_home_model():
    # The shipped column is exactly what geo.assign_areas produces.
    import csv

    from dryrun.geo import assign_areas
    from dryrun.store import DEFAULT_CSV

    with open(DEFAULT_CSV, newline="") as f:
        rows = list(csv.DictReader(f))
    areas, _ = assign_areas(rows)
    assert [r["area"] for r in rows] == areas
