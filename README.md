<p align="center">
  <img src="docs/images/sieve.png" alt="Sieve" width="480">
</p>

<p align="center">
  Test a clinical trial's eligibility criteria on a synthetic population before the first patient is screened, and see what each criterion costs.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-1B3A4B" alt="Apache 2.0"></a>
  <img src="https://img.shields.io/badge/python-3.11%2B-1B3A4B" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/track-Healthcare%20%26%20Biotech-0F766E" alt="Healthcare and Biotech">
</p>

Sieve is a planning workbench for trial designers at biotechs, CROs, and academic research groups. Load a protocol, run it against 10,000 synthetic adults with type 2 diabetes, and read the enrollment consequence of each criterion: patients kept out, months added, and estimated delay cost. Change a threshold and the same numbers update against the protocol you loaded.

It is a planning tool. It does not give medical advice and it does not recommend treatment for any person. Every time and cost figure is an estimate.

The Python package is `dryrun`.

## Workbench

The screen is two columns. Criteria stay on the left. Results stay on the right, so a change and its effect are visible together.

- **Protocol.** Pick a seeded trial, or load another NCT ID from ClinicalTrials.gov API v2. Each criterion can be switched off. Numeric thresholds have a slider marked at the original value.
- **Coverage.** Criteria the synthetic record cannot decide stay on screen with a reason. They do not change the funnel or the cost.
- **Eligibility.** Confirmed-eligible means every active, evaluable criterion returns `meets`. Possibly-eligible includes patients whose missing lab or vital would still have to check out. A patient with missing data is never counted as meeting that rule.
- **Cost.** A table, sorted by months added, gives patients kept out, months added, and estimated delay cost for each criterion, holding the others fixed. A demographic note appears only when the excluded group has at least 30 patients.
- **Compare.** Confirmed-eligible, enrollment months, and delay cost each show their change versus the original protocol. Reset restores the loaded thresholds and toggles.
- **Add a criterion.** Field, operator, value, and inclusion or exclusion, evaluated by the same engine. Use this when a sentence is not in the translation cache.
- **Compound rules.** `any_of` and `all_of` use Kleene logic: `unknown` never becomes `meets`.
- **Export.** Download the active criteria as text, with each changed threshold's before and after value.

## How it works

```
criteria text or NCT ID
        │
        ▼
translation cache (keyed by sentence and section)
        │
        ▼
structured rules ──▶ deterministic engine ◀── 10,000 synthetic patients
        │                                        (DuckDB)
        ▼
funnel · cost table · enrollment estimate
```

A criterion sentence is translated into a structured rule: `field`, `operator`, `value`, `unit`, and `kind`. The source sentence is kept. The translator never sees patient rows and never returns a verdict.

The four demo protocols ship as hand-checked translations in `backend/data/parse_cache.json`, so the walkthrough runs offline. `LLMBackend` in `backend/dryrun/parser.py` is the plug-in for a live translator. This build does not configure one. A sentence missing from the cache is reported as unparsed and left out. Add it by hand from the workbench instead.

The engine in `backend/dryrun/engine.py` returns `meets`, `fails`, or `unknown`. Units are converted to a canonical unit before any comparison, so HbA1c in % and mmol/mol receive the same verdict. An exclusion flips `meets` and `fails` and leaves `unknown` as `unknown`.

The cohort is produced by `python -m dryrun.synthea` from a fixed seed. Distributions are illustrative. Labs and vitals can be missing, which is the `unknown` path. Condition and medication lists are complete: no record means the code is not present, so `has` and `not_has` are decided rather than unknown.

## Demo protocols

Condition: type 2 diabetes. Open the app and PIONEER 6 loads first.

| NCT ID | Protocol | What is seeded |
| --- | --- | --- |
| [NCT02692716](https://clinicaltrials.gov/study/NCT02692716) | PIONEER 6 · oral semaglutide | Eligibility text from the ClinicalTrials.gov record |
| [NCT01179048](https://clinicaltrials.gov/study/NCT01179048) | LEADER · liraglutide | Abridged paraphrase, for the offline demo |
| [NCT01720446](https://clinicaltrials.gov/study/NCT01720446) | SUSTAIN-6 · semaglutide | Abridged paraphrase, for the offline demo |
| [NCT01131676](https://clinicaltrials.gov/study/NCT01131676) | EMPA-REG OUTCOME · empagliflozin | Abridged paraphrase, for the offline demo |

PIONEER 6 is the protocol to judge the product on. It has 11 criteria. Four can be evaluated on this population:

- type 2 diabetes
- age at least 50 with cardiovascular disease, or age at least 60 with a cardiovascular risk factor
- history of pancreatitis
- dialysis or eGFR below 30 mL/min/1.73 m²

Cardiovascular disease is approximated as a history of myocardial infarction or stroke. A cardiovascular risk factor is approximated as hypertension. The other seven criteria need a date or a field this generator does not have (medication washout, family history, gastric surgery, NYHA class, planned revascularisation, a 60-day event window, a 5-year malignancy window). Each is shown with that reason and drops out of the counts. Coverage on the protocol column is 4 of 11.

LEADER, SUSTAIN-6, and EMPA-REG OUTCOME are shortened working examples. Their sentences are not a full copy of the registry text.

## Enrollment model

```
months = target_enrollment
         / (sites × screened_per_site_per_month
            × eligible_fraction × consent_rate)

delay_cost = days_added × cost_per_day
```

`eligible_fraction` is confirmed-eligible divided by the 10,000-patient population. Delay is measured against enrolling any adult with type 2 diabetes. The defaults are 1,000 patients enrolled, 50 sites, 20 patients screened per site per month, a 60% consent rate, and $40,000 per day. All five are editable and labeled as estimates. If the eligible fraction is zero, enrollment is reported as never completing.

## Invariants

These are checked with Hypothesis in `backend/tests/test_properties.py`. A change that breaks one of them is wrong even if the screen looks fine.

1. Removing or loosening any criterion never decreases the eligible count.
2. The eligible count with all criteria applied never exceeds the count for any single criterion.
3. The same lab value in different units always receives the same verdict.
4. Serializing a structured rule and reading it back gives an identical rule.
5. Loosening a criterion never increases estimated enrollment time.
6. A patient with missing data for a rule is never counted as meeting it.

## Run it

Python 3.11+ and [uv](https://docs.astral.sh/uv/). Node 18+ for the frontend.

```bash
cd backend
uv venv
uv pip install -e ".[dev]"

# first run: write the population and seed the demo cache
uv run python -m dryrun.synthea 10000
uv run python -m dryrun.seed

uv run uvicorn dryrun.api:app --reload --port 8000
uv run pytest -q
```

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173  (proxies /api to :8000)
npm run build    # frontend/dist
```

`backend/data/patients.csv` is committed, along with the seeded cache and trial registry, so a fresh clone runs without the first-run step. Regenerating it from the fixed seed gives the same file.

In one process, the API serves the built frontend:

```bash
cd frontend && npm install && npm run build
cd backend && uv run uvicorn dryrun.api:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000.

### Docker

The image builds the frontend with Node and runs the API with Python on port 8000. The committed population ships in the image; it is regenerated from the fixed seed at startup only if missing. The seeded cache ships in the image, so the four demo protocols load with no network call.

```bash
docker build -t sieve .
docker run -p 8000:8000 sieve
```

## Layout

```
backend/dryrun/
  model.py       Rule, Verdict, Patient
  units.py       canonical units
  engine.py      meets / fails / unknown
  synthea.py     fixed-seed population → CSV
  store.py       DuckDB patient store
  parser.py      cache, ClinicalTrials.gov v2 fetch, LLMBackend plug-in
  seed.py        four demo protocols
  analysis.py    funnel, coverage, price tags
  cost.py        enrollment and delay cost
  api.py         FastAPI
backend/tests/   Hypothesis properties and unit tests
frontend/src/    React 18 + Vite
docs/images/     Sieve logo and other README figures
.kiro/           steering, spec, hook, reviewer
```

## Built with Kiro

v1 was built in [Kiro](https://kiro.dev) CLI from a single brief. v2 was specified in Kiro before its code landed. These files are the constraints the implementation is held to.

| Path | What it does |
| --- | --- |
| `.kiro/steering/` | Product, stack, domain rules, and repository layout. Loaded with every task. |
| `.kiro/specs/v2-trial-workbench/` | Requirements, design, and task list: population, sliders, compare, layout, add-a-criterion, Kleene logic, PIONEER 6, section-aware splitting, export. |
| `.kiro/hooks/property-tests.json` | Re-runs the full test suite when the engine, units, model, analysis, cost, or API code, or the property tests, are saved. |
| `.kiro/agents/reviewer.md` | Read-only reviewer for verdict bugs and claims the code does not meet. |
| `.kiro/settings/mcp.json` | Fetch MCP server for ClinicalTrials.gov. It was added mid-session, so the PIONEER 6 text was pulled with Kiro's built-in web fetch. |

## Limitations

- Patient rows are synthetic. No real patient data is used.
- Time and cost figures are planning estimates under the assumptions on screen.
- PIONEER 6 keeps its registry wording. The cardiovascular inclusion uses the approximations named above. The other three protocols are abridged paraphrases.
- Criteria that need a date, a family history, a procedure, or a class the generator does not store are shown and then ignored by the counts.
- This build does not call a model. Uncached sentences are reported, never guessed.

## License

[Apache License 2.0](LICENSE).
