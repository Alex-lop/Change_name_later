# Sieve

Test a clinical trial's eligibility criteria on a synthetic patient population
**before launch**, and see what each criterion costs.

Trial designers at biotechs, CROs, and academic research groups paste a trial's
eligibility criteria (or a ClinicalTrials.gov NCT ID), and Dry Run shows:

- an **eligibility funnel** over ~10,000 synthetic (Synthea-like) patients,
- **confirmed-eligible** (meets every criterion) vs **possibly-eligible**
  (meets or unknown) counts,
- a **price tag** per criterion: patients excluded, months added to enrollment,
  estimated delay cost, and how the excluded group differs demographically,
- an editable **enrollment + delay cost** model.

## How it works

1. **Load** a trial by NCT ID (ClinicalTrials.gov API v2) or pasted text.
2. **Translate** each criterion sentence into a structured rule
   (`field`, `operator`, `value`, `unit`, `kind`) with the exact source
   sentence preserved. The LLM **only translates** — it never decides
   eligibility and never sees patient data. Parses are **cached** keyed by the
   sentence, and the three demo trials are pre-seeded so the demo runs offline.
3. **Evaluate** every rule against every patient with a deterministic engine
   that returns `meets`, `fails`, or `unknown` (data missing).
4. **Toggle** criteria on/off and watch the funnel, counts, and cost update.

```
criteria text / NCT id
        │
        ▼
  LLM parser (translate-only, cached)   ──▶  structured Rules
        │
        ▼
  deterministic engine  ◀── 10k synthetic patients (DuckDB)
        │
        ▼
  funnel · price tags · enrollment cost
```

## Demo

Condition: **type 2 diabetes**. Three real Phase 3 cardiovascular-outcome
trials are pre-seeded:

| NCT ID       | Trial                      | Drug          |
|--------------|----------------------------|---------------|
| NCT01179048  | LEADER                     | liraglutide   |
| NCT01720446  | SUSTAIN-6                  | semaglutide   |
| NCT01131676  | EMPA-REG OUTCOME           | empagliflozin |

## Correctness properties

These are enforced by the engine/analysis design and verified with
Hypothesis property-based tests (`backend/tests/test_properties.py`):

1. Removing or loosening any criterion never decreases the eligible count.
2. The all-criteria eligible count never exceeds any single criterion's count.
3. The same lab value in different units always gets the same verdict
   (e.g. HbA1c in % vs mmol/mol).
4. Serializing a structured rule and reading it back gives an identical rule.
5. Loosening a criterion never increases estimated enrollment time.
6. A patient with missing data for a rule is never counted as meeting it.

## Enrollment model

```
months = target_enrollment
         / (sites * screened_per_site_per_month
            * eligible_fraction * consent_rate)

delay_cost = days_added * cost_per_day
```

All assumptions are editable in the UI and labeled as **estimates**.

## Running it

### Backend (Python 3.11+, uv)

```bash
cd backend
uv venv
uv pip install -e ".[dev]"

# generate the synthetic population + seed the demo cache (first run only)
uv run python -m dryrun.synthea 10000
uv run python -m dryrun.seed

# run the API
uv run uvicorn dryrun.api:app --reload --port 8000

# run the tests
uv run pytest -q
```

### Frontend (Node 18+)

```bash
cd frontend
npm install
npm run dev     # dev server on :5173, proxies /api to :8000
npm run build   # production build to dist/
```

Open http://localhost:5173, click a demo trial, and toggle criteria.

## Deployment

In production the FastAPI app serves the built frontend itself, so a single
process handles both the API and the UI.

1. **Build the frontend** (produces `frontend/dist`):
   ```bash
   cd frontend && npm install && npm run build
   ```
2. **Run the API** — it serves `/api/*` and the SPA from `frontend/dist`, and
   generates `backend/data/patients.csv` on startup if it is missing:
   ```bash
   cd backend && uv run uvicorn dryrun.api:app --host 0.0.0.0 --port 8000
   ```
   Then open http://localhost:8000.

### Docker

A multi-stage `Dockerfile` builds the frontend with Node and runs the API with
Python, serving everything on port 8000:

```bash
docker build -t dryrun .
docker run -p 8000:8000 dryrun
# open http://localhost:8000
```

The synthetic population is generated from a fixed seed at container startup,
so no separate data-prep step or volume is required. The seeded parse cache and
trials registry ship in the image, so the demo trials load offline. Cost
figures remain labeled estimates.

## Layout

```
backend/
  dryrun/
    model.py      structured Rule, Verdict, Patient, serialization
    units.py      canonical-unit conversions (unit-invariance guarantee)
    engine.py     deterministic rule evaluation (meets/fails/unknown)
    synthea.py    synthetic ~10k patient generator -> CSV
    store.py      DuckDB-backed patient store + demographics
    parser.py     translate-only LLM parser + cache + ctgov v2 fetch
    seed.py       3 real Phase 3 T2D trials -> cache + registry
    analysis.py   funnel, confirmed/possibly eligible, price tags
    cost.py       enrollment + delay cost model
    api.py        FastAPI endpoints
  tests/          property-based + unit tests
frontend/
  src/            React + Vite app
```

## Notes & limitations

- Patient data is **synthetic**. No real patient data is used.
- Cost figures are **estimates** for planning intuition, not financial advice.
- The parse cache ships seeded; an un-cached sentence with no configured LLM
  backend is reported as `unparsed` rather than guessed.
