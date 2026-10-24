---
inclusion: always
---

# Dry Run

Dry Run lets a clinical trial designer test eligibility criteria on a synthetic
patient population before launch, and see what each criterion costs.

Users are trial designers at biotechs, CROs, and academic research groups.
This is a planning tool. It is not medical advice and it does not recommend
treatment for any person.

## Demo

Type 2 diabetes. Four real Phase 3 trials are pre-seeded and must keep
working offline: NCT01179048 (LEADER), NCT01720446 (SUSTAIN-6),
NCT01131676 (EMPA-REG OUTCOME), and NCT02692716 (PIONEER 6, the hero trial,
with verbatim ClinicalTrials.gov criteria).

## What "done" means today

The README features stay: an eligibility funnel, per-criterion on/off toggles, a price tag per criterion, and an editable enrollment-cost model.

Submissions are due 8 PM ET today. The README features must stay working and demoable after every commit.

Allowed beyond the README: the tasks in `.kiro/specs/v2-trial-workbench/`. That covers the population and demographics fixes, threshold sliders, compare-to-original, the two-column layout, the add-criterion form, OR/Kleene logic, and PIONEER 6, plus section-aware splitting, export, deployment prep, and the v3 visual pass.

Do v2 tasks in spec order. Don't start a new task after 6:30 PM ET. Use the rest of the time for polish and the demo.
