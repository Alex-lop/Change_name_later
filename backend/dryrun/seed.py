"""Seed data: three real Phase 3 type-2-diabetes cardiovascular outcome trials.

For each trial we store the representative eligibility criterion sentences and
the structured translation of each (what a translate-only LLM would produce).
These seed both the parse cache (keyed by sentence) and a small offline trials
registry so the demo never needs a live LLM or network call.

Trials:
- NCT01179048  LEADER     (liraglutide)
- NCT01720446  SUSTAIN-6  (semaglutide)
- NCT01131676  EMPA-REG OUTCOME (empagliflozin)

The criterion sentences are paraphrased representations of each trial's public
eligibility criteria, chosen to exercise numeric, categorical, unit, and
exclusion rules. Each parse captures field/operator/value/unit/kind only; the
engine alone decides verdicts.
"""

from __future__ import annotations

import json
from pathlib import Path

from .parser import ParseCache, _key

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TRIALS_PATH = DATA_DIR / "trials.json"

# Each criterion: (sentence, rule_kwargs). rule_kwargs feed Rule(**kwargs).
LEADER = {
    "nct_id": "NCT01179048",
    "title": "LEADER: Liraglutide Effect and Action in Diabetes (CV outcomes)",
    "condition": "type 2 diabetes",
    "criteria": [
        ("Type 2 diabetes mellitus.",
         dict(field="conditions", operator="has", value=["t2d"],
              kind="inclusion", label="Has type 2 diabetes")),
        ("HbA1c of at least 7.0 %.",
         dict(field="hba1c", operator=">=", value=7.0, unit="percent",
              kind="inclusion", label="HbA1c >= 7.0%")),
        ("Age 50 years or older.",
         dict(field="age", operator=">=", value=50, unit="years",
              kind="inclusion", label="Age >= 50y")),
        ("Type 1 diabetes mellitus.",
         dict(field="conditions", operator="has", value=["t1d"],
              kind="exclusion", label="Exclude type 1 diabetes")),
        ("Estimated GFR below 30 mL/min/1.73m2.",
         dict(field="egfr", operator="<", value=30, unit="ml/min/1.73m2",
              kind="exclusion", label="Exclude eGFR < 30")),
    ],
}

SUSTAIN6 = {
    "nct_id": "NCT01720446",
    "title": "SUSTAIN-6: Semaglutide CV outcomes in type 2 diabetes",
    "condition": "type 2 diabetes",
    "criteria": [
        ("Type 2 diabetes mellitus.",
         dict(field="conditions", operator="has", value=["t2d"],
              kind="inclusion", label="Has type 2 diabetes")),
        ("HbA1c of at least 7.0 %.",
         dict(field="hba1c", operator=">=", value=7.0, unit="percent",
              kind="inclusion", label="HbA1c >= 7.0%")),
        ("Age 50 years or older.",
         dict(field="age", operator=">=", value=50, unit="years",
              kind="inclusion", label="Age >= 50y")),
        ("Body mass index of at least 20 kg/m2.",
         dict(field="bmi", operator=">=", value=20, unit="kg/m2",
              kind="inclusion", label="BMI >= 20")),
        ("Type 1 diabetes mellitus.",
         dict(field="conditions", operator="has", value=["t1d"],
              kind="exclusion", label="Exclude type 1 diabetes")),
    ],
}

EMPAREG = {
    "nct_id": "NCT01131676",
    "title": "EMPA-REG OUTCOME: Empagliflozin CV outcomes in type 2 diabetes",
    "condition": "type 2 diabetes",
    "criteria": [
        ("Type 2 diabetes mellitus.",
         dict(field="conditions", operator="has", value=["t2d"],
              kind="inclusion", label="Has type 2 diabetes")),
        ("HbA1c between 7.0 % and 10.0 %.",
         dict(field="hba1c", operator="between", value=[7.0, 10.0],
              unit="percent", kind="inclusion", label="HbA1c 7-10%")),
        ("Age 18 years or older.",
         dict(field="age", operator=">=", value=18, unit="years",
              kind="inclusion", label="Age >= 18y")),
        ("Body mass index of 45 kg/m2 or lower.",
         dict(field="bmi", operator="<=", value=45, unit="kg/m2",
              kind="inclusion", label="BMI <= 45")),
        ("Estimated GFR below 30 mL/min/1.73m2.",
         dict(field="egfr", operator="<", value=30, unit="ml/min/1.73m2",
              kind="exclusion", label="Exclude eGFR < 30")),
    ],
}

PIONEER6 = {
    "nct_id": "NCT02692716",
    "title": "PIONEER 6: Cardiovascular Safety of Oral Semaglutide in Type 2 Diabetes",
    "condition": "type 2 diabetes",
    # source_sentence values are VERBATIM from ClinicalTrials.gov (API v2),
    # saved in backend/data/trials_raw/NCT02692716.txt. The structured rules
    # map onto canonical engine fields only (no SNOMED/LOINC/RxNorm matching).
    # Date-windowed criteria are marked not-evaluable because the synthetic
    # data has no dates; so are rules whose fields the generator lacks.
    "criteria": [
        # P6-I1
        ("Male or female diagnosed with type 2 diabetes",
         dict(field="conditions", operator="has", value=["t2d"],
              kind="inclusion", label="Has type 2 diabetes")),
        # P6-I2: any_of of all_of groups. CVD approximated as MI or stroke;
        # CV risk factor approximated as hypertension.
        ("Age at least 50 years at screening and presence of cardiovascular "
         "disease, or age at least 60 years at screening and presence of at "
         "least one cardiovascular risk factor",
         dict(kind="inclusion", logic="any_of",
              label="Age 50+ with CV disease, or 60+ with a CV risk factor",
              children=[
                  dict(logic="all_of", children=[
                      dict(field="age", operator=">=", value=50, unit="years"),
                      dict(field="conditions", operator="has",
                           value=["mi", "stroke"]),
                  ]),
                  dict(logic="all_of", children=[
                      dict(field="age", operator=">=", value=60, unit="years"),
                      dict(field="conditions", operator="has",
                           value=["hypertension"]),
                  ]),
              ])),
        # P6-E1: medication washout within 90 days -> needs a date -> NOT evaluable.
        ("Current or previous (within 90 days prior to screening) treatment "
         "with any GLP-1 (glucagon-like peptide-1) receptor agonist, DPP-4 "
         "(dipeptidyl peptidase-4) inhibitor or pramlintide",
         dict(field="medications", operator="not_has",
              value=["glp1 agonist", "dpp4 inhibitor"], kind="exclusion",
              evaluable=False,
              unevaluable_reason="90-day medication washout needs dates; "
              "the synthetic data has no dates",
              label="Exclude recent GLP-1/DPP-4/pramlintide (washout)")),
        # P6-E2: family history -> NOT evaluable.
        ("Family or personal history of multiple endocrine neoplasia type 2 "
         "(MEN 2) or medullary thyroid carcinoma (MTC)",
         dict(kind="exclusion", evaluable=False,
              unevaluable_reason="Family history is not in the synthetic records",
              label="Exclude MEN 2 / MTC history")),
        # P6-E3: pancreatitis history -> evaluable.
        ("History of pancreatitis (acute or chronic)",
         dict(field="conditions", operator="has", value=["pancreatitis"],
              kind="exclusion", label="Exclude pancreatitis history")),
        # P6-E4: gastric surgery -> NOT evaluable.
        ("History of major surgical procedures involving the stomach "
         "potentially affecting absorption of trial product (e.g. subtotal and "
         "total gastrectomy, sleeve gastrectomy, gastric bypass surgery)",
         dict(kind="exclusion", evaluable=False,
              unevaluable_reason="Procedures table not in the synthetic data",
              label="Exclude major gastric surgery")),
        # P6-E5: NYHA class -> NOT evaluable.
        ("Subjects presently classified as being in New York Heart Association "
         "(NYHA) Class IV heart failure",
         dict(kind="exclusion", evaluable=False,
              unevaluable_reason="NYHA class is not recorded",
              label="Exclude NYHA Class IV heart failure")),
        # P6-E6: planned revascularisation -> NOT evaluable.
        ("Planned coronary, carotid or peripheral artery revascularisation "
         "known on the day of screening",
         dict(kind="exclusion", evaluable=False,
              unevaluable_reason="Future plans are not in the records",
              label="Exclude planned revascularisation")),
        # P6-E7: MI/stroke within 60 days -> needs a date -> NOT evaluable.
        ("Any of the following: myocardial infarction, stroke or "
         "hospitalisation for unstable angina or transient ischaemic attack "
         "within the past 60 days prior to screening",
         dict(field="conditions", operator="not_has", value=["mi", "stroke"],
              kind="exclusion", evaluable=False,
              unevaluable_reason="60-day event window needs dates; the "
              "synthetic data has no dates",
              label="Exclude recent MI/stroke (60-day window)")),
        # P6-E8: exclusion any_of (dialysis OR eGFR < 30). Dialysis child has no
        # date-free field decision here, so it is not evaluable; the eGFR child
        # decides its own branch. Kleene logic keeps unknown out of meets.
        ("Chronic or intermittent hemodialysis or peritoneal dialysis or "
         "severe renal impairment (corresponding to eGFR (glomerular "
         "filtration rate, estimated) below 30 mL/min/1.73 m^2)",
         dict(kind="exclusion", logic="any_of",
              label="Exclude dialysis or eGFR < 30",
              children=[
                  dict(field="conditions", operator="has", value=["dialysis"]),
                  dict(field="egfr", operator="<", value=30,
                       unit="ml/min/1.73m2"),
              ])),
        # P6-E9: malignancy within 5 years -> needs a date -> NOT evaluable.
        ("History or presence of malignant neoplasms within the last 5 years "
         "(except basal and squamous cell skin cancer and carcinoma in situ)",
         dict(field="conditions", operator="not_has", value=["cancer"],
              kind="exclusion", evaluable=False,
              unevaluable_reason="5-year neoplasm window needs dates; the "
              "synthetic data has no dates",
              label="Exclude malignancy in last 5 years")),
    ],
}

TRIALS = [PIONEER6, LEADER, SUSTAIN6, EMPAREG]

def seed() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cache = ParseCache()
    registry = {}
    for trial in TRIALS:
        criteria = []
        for sentence, kwargs in trial["criteria"]:
            kind = kwargs.get("kind", "inclusion")
            cache.put(sentence, kwargs, kind)
            criteria.append({"sentence": sentence, "kind": kind})
        registry[trial["nct_id"]] = {
            "nct_id": trial["nct_id"],
            "title": trial["title"],
            "condition": trial["condition"],
            "criteria": criteria,
        }
    TRIALS_PATH.write_text(json.dumps(registry, indent=2))
    print(f"Seeded {len(cache)} parses, {len(registry)} trials -> {TRIALS_PATH}")


def load_registry() -> dict:
    if TRIALS_PATH.exists():
        return json.loads(TRIALS_PATH.read_text())
    return {}


if __name__ == "__main__":
    seed()
