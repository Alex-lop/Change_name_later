# Design Document

## Overview

Keep the current split. The LLM, when one exists, only translates. `engine.py` decides every verdict. `analysis.py` and `cost.py` count. The React app displays and sends the current rules back to `POST /api/analyze`.

v1 already does the marginal price tag correctly: `price_tags` builds `base` as patients who pass every other active rule. The bug is the comparator. `_demo_deltas` is called with `store.demographics(None)`, which is the whole file. Pass the demographics of `base` instead. Hide the delta object when `len(excluded) < 30`. Drop `race` from the delta payload on this generated file. Age and sex stay.

## Population

`generate_population` currently defaults to `diabetic_fraction=0.35`. Generate the shipped CSV as adults who all carry `t2d`. Keep the seed stable. The health and analysis payloads should name the cohort, and the delay-cost label in the UI is "vs. enrolling any adult with type 2 diabetes."

Regenerate `backend/data/patients.csv` as part of the population task. LEADER's confirmed count will change. That is expected. The three seeded trials must still parse from the cache and return an analysis.

## Sliders and baseline

Numeric operators already live on `Rule`. The client holds the loaded rules as `originalRules` and the edited copy as `rules`. A slider writes `value` inside the field bounds and re-posts `/api/analyze` after 150 ms. Bounds: age 18–90, hba1c 5–12, bmi 15–60, egfr 10–120, systolic_bp 90–200. The original value is a tick, not a second source of truth.

Reset copies `originalRules` back. Loosening is the direction that admits more patients for that operator (`>=` and `>` decrease the threshold, `<=` and `<` increase it, `between` widens). The property test should move a threshold one step that way and assert confirmed-eligible does not fall.

The sticky header reads confirmed-eligible, `cost.enrollment_months`, and delay cost from the current analysis and subtracts the same fields from an analysis of `originalRules` captured at load.

## Layout

Left column: trial picker, criterion rows, sliders, toggles, add-criterion form. Right column, sticky: compare header, funnel, price tags sorted by months added descending. Months added is the current enrollment months minus the months with that criterion removed. `per_rule_cost` already returns `enrollment_months_without`.

## Hand-added rules

The form builds a `Rule` in the client: canonical field, operator, value or `[low, high]`, unit, kind. `source_sentence` is the user's summary of what they entered. `label` is "added in Dry Run." No parser call. `engine.evaluate` must accept it unchanged.

## Compound rules and not evaluable

Extend `Rule` with optional `logic` (`any_of` or `all_of`), `children`, and `evaluable` plus `unevaluable_reason`. A leaf rule stays what it is today.

`evaluate` applies Kleene logic to children, then the existing exclusion flip. A rule with `evaluable` false is omitted from the verdict matrix and from active ids used for counts. The UI still lists it with the reason. Coverage is evaluable criteria / total criteria on the trial.

Cache key today is a hash of the sentence in `parser._key`. Include the kind in that hash when Requirement 9 lands. `split_criteria` should return the sentence and the section it came from instead of dropping the Inclusion and Exclusion headers.

## PIONEER 6

Fetch `https://clinicaltrials.gov/api/v2/studies/NCT02692716` with the fetch MCP and take `eligibilityCriteria` as the verbatim text. The zip file is the structured starting point, not the sentence source when the two differ.

Map zip fields onto canonical names (`condition` becomes `conditions`, medication rules become `medications`). Ignore SNOMED codes such as `44054006`. Add generator tokens for the evaluable approximations the zip already names, including myocardial infarction, stroke, hypertension, and pancreatitis, plus the medications an evaluable medication rule needs.

Criteria that need a date stay `evaluable: false` even if the zip says `mapped`. That includes the 90-day medication washout, the 60-day cardiovascular-event window, and the 5-year neoplasm window. Also leave the zip's `not_evaluable` rules not evaluable (MEN 2 / MTC, gastric surgery, NYHA class IV, planned revascularisation).

P6-I2 is `any_of` of `all_of` groups. P6-E8 is an exclusion `any_of` (dialysis or eGFR below 30). Dialysis has no date-free field today; keep that child not evaluable or unknown, and let the eGFR child decide only its own branch. Do not treat unknown as meets.

Seed the parse cache and `trials.json` the same way `seed.py` seeds the other three trials, with verbatim sentences. Those three trials stay in the registry.

## Testing

Property tests go in `backend/tests/test_properties.py` and use Hypothesis where they already do. One commit per task, message starting with the task number. Run `cd backend && uv run pytest -q` before each commit. After 6:30 PM ET, do not open the next task.

## Out of scope

Live LLM parsing (only the `LLMBackend` protocol seam exists: no Bedrock or other
model backend ships, so a sentence missing from the parse cache is reported as unparsed),
renaming the repo, LOINC / SNOMED / RxNorm, real Synthea, and any feature not
listed in `tasks.md` or its "Also shipped" note.
