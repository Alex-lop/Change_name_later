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

TRIALS = [LEADER, SUSTAIN6, EMPAREG]


def seed() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cache = ParseCache()
    registry = {}
    for trial in TRIALS:
        sentences = []
        for sentence, kwargs in trial["criteria"]:
            cache.put(sentence, kwargs)
            sentences.append(sentence)
        registry[trial["nct_id"]] = {
            "nct_id": trial["nct_id"],
            "title": trial["title"],
            "condition": trial["condition"],
            "criteria": sentences,
        }
    TRIALS_PATH.write_text(json.dumps(registry, indent=2))
    print(f"Seeded {len(cache)} parses, {len(registry)} trials -> {TRIALS_PATH}")


def load_registry() -> dict:
    if TRIALS_PATH.exists():
        return json.loads(TRIALS_PATH.read_text())
    return {}


if __name__ == "__main__":
    seed()
