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
    assert len(pr["rules"]) == 5 and pr["unparsed"] == []

    an = c.post("/api/analyze", json={"rules": pr["rules"]}).json()
    assert an["total_patients"] == 10000
    assert 0 < an["confirmed_eligible"] <= an["possibly_eligible"]
    assert an["cost"]["enrollment_months"] is not None

    # toggling off a criterion never decreases confirmed-eligible
    active = [r["id"] for r in pr["rules"]][:-1]
    an2 = c.post("/api/analyze",
                 json={"rules": pr["rules"], "active_rule_ids": active}).json()
    assert an2["confirmed_eligible"] >= an["confirmed_eligible"]


def test_api_parse_requires_input():
    c = TestClient(app)
    assert c.post("/api/parse", json={}).status_code == 400


def test_price_tag_demographics_are_fair():
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
