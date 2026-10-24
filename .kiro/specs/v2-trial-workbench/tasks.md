# Implementation Plan

Do these in order. One commit per task. Start the message with the task number, for example `3. Add threshold sliders`. After 6:30 PM ET, do not start another task. Finish or revert the open one, then polish and record.

PIONEER 6 is task 8, not task 1. The parser does not translate a new trial, and PIONEER's cardiovascular criterion is an `any_of` the engine does not have yet. Sliders are earlier because they are the visual demo and the numeric engine already works.

- [x] 1. Make the population adults with type 2 diabetes
  - Generate the shipped cohort so every adult has `t2d`, keep a stable seed, and regenerate `backend/data/patients.csv`.
  - Label that cohort in the UI. Compute fractions, months, and price tags against it.
  - Label delay cost "vs. enrolling any adult with type 2 diabetes."
  - Confirm LEADER, SUSTAIN-6, and EMPA-REG still parse and analyze. The confirmed count will change.
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Compare demographic deltas to the filtered cohort
  - In `price_tags`, pass the demographics of `base` into `_demo_deltas`, not `store.demographics(None)`.
  - Hide deltas when the excluded group has fewer than 30 patients.
  - Return age and sex only. Remove race deltas from the API payload and the UI.
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 3. Add threshold sliders
  - Slider on every numeric rule, bounds age 18–90, hba1c 5–12, bmi 15–60, egfr 10–120, systolic_bp 90–200, tick at the loaded value.
  - Debounce re-analysis to 150 ms.
  - Property: a loosening step never decreases confirmed-eligible.
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Compare results to the original protocol
  - Keep the loaded rules as the baseline.
  - Sticky header: confirmed-eligible, enrollment months, and delay cost, each with its change versus that baseline.
  - Reset restores the original thresholds and the original counts.
  - Property: restoring the original thresholds reproduces the original counts.
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 5. Put controls and results in two columns
  - Left: criteria controls. Right, sticky: header, funnel, price tags.
  - Sort price tags by months added, largest first.
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 6. Add a criterion without the parser
  - Form fields: field, operator, value or range, inclusion or exclusion.
  - Label the rule "added in Dry Run" and evaluate it in `engine.py`.
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 7. Add Kleene any_of and all_of
  - Extend `Rule` and `evaluate`. Exclusion still flips only `meets` and `fails`.
  - Properties: adding an `any_of` child never shrinks its meets set; adding an `all_of` child never grows it; all-unknown children stay unknown.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 8. Seed PIONEER 6 from ClinicalTrials.gov and the zip
  - Fetch NCT02692716 eligibility text with the fetch MCP. Use it as `source_sentence`.
  - Start from `dryrun-mock-data/trials/NCT02692716.json`. Map onto canonical fields. Do not match on code systems.
  - Implement the age/cardiovascular `any_of` with the zip's approximation. Mark date-dependent and zip `not_evaluable` criteria not evaluable, with a reason, and show coverage.
  - Add the condition and medication tokens the evaluable rules need. Not-evaluable criteria change no count.
  - Property: not-evaluable criteria never change a count.
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [x] 9. Keep inclusion and exclusion in split_criteria
  - Return the section with each sentence, pass it as `kind`, and include `kind` in the parse cache key.
  - _Requirements: 9.1, 9.2_

- [x] 10. Export the modified criteria
  - Text download with before and after values, "added in Dry Run" marks, and not-evaluable reasons.
  - _Requirements: 10.1, 10.2_

## Also shipped

Work that was not a numbered task but has landed:

- **Deployment prep.** FastAPI serves the built frontend from `frontend/dist`, the population CSV is generated at startup if missing, and a Dockerfile builds and runs the one-process image. Not deployed.
- **v3 visual workbench.** A visual pass over the two-column layout (topbar trial picker, result sentence, animated numbers, CONSORT-style flow, and the cost table).
- **Python subset demographics.** `store.demographics(ids)` computes `n`, `mean_age`, and sex counts in Python from an id → (age, sex) index instead of a per-request DuckDB `IN` query, and the remaining DuckDB calls are guarded by a lock. This fixed concurrent `/api/analyze` "connection is busy" failures.
- **StaticFiles frontend serving.** The frontend is mounted with `StaticFiles(html=True)`, which contains every request inside `frontend/dist` (the earlier hand-rolled path join allowed path traversal).
- **Removed invented criteria.** Deleted the LEADER eGFR < 30 exclusion and the SUSTAIN-6 BMI ≥ 20 inclusion; neither sentence is in that trial's ClinicalTrials.gov record. Trials now carry a `paraphrased` flag.
