---
inclusion: always
---

# Layout

```
backend/dryrun/
  model.py      Rule, Verdict, Patient
  units.py      canonical-unit conversions
  engine.py     one rule, one patient -> meets | fails | unknown
  synthea.py    synthetic population -> CSV
  store.py      DuckDB patient store
  parser.py     translate-only parser + cache + NCT fetch
  seed.py       three demo trials
  analysis.py   funnel, eligible counts, price tags
  cost.py       enrollment months and delay cost
  api.py        FastAPI
backend/tests/  property tests in test_properties.py
frontend/src/   React UI
.kiro/          steering, hooks, agents — commit this, never gitignore it
```

Put eligibility decisions in `engine.py`. Put unit math in `units.py`.
Put counts, funnels, and price tags in `analysis.py` and `cost.py`.
Do not move a verdict into the parser, the API, or the React app.
