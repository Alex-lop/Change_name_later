---
inclusion: always
---

# Domain rules

## Who decides

- The LLM only translates eligibility text into a structured rule: field, operator, value, unit, kind.
- Deterministic code decides every verdict.
- Every rule keeps the exact source sentence it was translated from. Do not paraphrase it and do not invent a sentence.

## Verdicts

- Exactly three verdicts: `meets`, `fails`, `unknown`.
- Missing patient data for a rule's field is always `unknown`, never `meets`.
- An exclusion rule flips `meets` and `fails`. `unknown` stays `unknown`.
- "Meets" means the patient is kept by that criterion.

## Fields and units

- Match on canonical field names already used by the engine: `age`, `hba1c`, `bmi`, `egfr`, `weight`, `systolic_bp`, `fasting_glucose`, `creatinine`, `sex`, `conditions`, `medications`. Do not match labs, conditions, or drugs by display name.
- Do not switch the engine to LOINC, SNOMED, or RxNorm today. That is a rewrite, and the deadline is tonight.
- Convert both the rule value and the patient value to the field's canonical unit in `units.py` before comparing. HbA1c `%` and `mmol/mol`, glucose `mg/dL` and `mmol/L`, and creatinine `mg/dL` and `umol/L` must produce the same verdict.

## Language

- Never phrase output as medical advice or as a recommendation for an individual patient.
- Label every enrollment-time and cost number as an estimate, and keep the assumptions visible and editable.

## Properties that must stay true

Verified in `backend/tests/test_properties.py`. A change that breaks one of these is wrong even if the UI looks fine.

1. Removing or loosening any criterion never decreases the eligible count.
2. The eligible count with all criteria applied never exceeds the count for any single criterion.
3. The same lab value in different units always gets the same verdict.
4. Serializing a structured rule and reading it back gives an identical rule.
5. Loosening a criterion never increases estimated enrollment time.
6. A patient with missing data for a rule is never counted as meeting it.

Prefer a new property test over a one-off example when you change the engine.

## Population and fairness

- The population is adults with the trial's condition. Fractions, enrollment months and price tags are relative to it.
- Demographic deltas compare an excluded group with the cohort that criterion acts on. Hide them below 30 patients. No race deltas on generated data.

## Criteria fidelity

- source_sentence is verbatim from ClinicalTrials.gov. A shortened or paraphrased sentence is a bug.
- A criterion the data cannot evaluate is shown as not evaluable with a reason and never changes a count.
- Compound criteria use Kleene logic. Unknown never becomes meets.

## Commits

- One commit per completed spec task. Start the message with the task number.

## Scope

Submissions are due 8 PM ET today. The README features must stay working and demoable after every commit.

Allowed beyond the README: only the tasks in `.kiro/specs/v2-trial-workbench/`. That covers the population and demographics fixes, threshold sliders, compare-to-original, the two-column layout, the add-criterion form, OR/Kleene logic, and PIONEER 6. Nothing else.

Do v2 tasks in spec order. Don't start a new task after 6:30 PM ET. Use the rest of the time for polish and the demo.
