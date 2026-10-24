Most clinical trials don’t stall because the drug doesn’t work. They stall because they can’t find enough patients. Sieve shows which eligibility criteria are to blame, before you launch.

<p align="center">
  <img src="docs/images/sieve.png" alt="Sieve" width="480">
</p>

A protocol can look careful and still be unfillable. One age cutoff, one lab threshold, one exclusion for a history almost nobody in the cohort has, and the eligible pool collapses. Sieve runs the criteria against 10,000 synthetic adults with type 2 diabetes and prices each rule: patients kept out, months added, and estimated delay cost. Move a threshold and those numbers update against the protocol you loaded, so you can see the trade before the first patient is screened.

It is a planning workbench for trial designers at biotechs, CROs, and academic research groups. It does not give medical advice and it does not recommend treatment for any person. Every time and cost figure is an estimate. The Python package is `dryrun`.

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-1B3A4B" alt="Apache 2.0"></a>
  <img src="https://img.shields.io/badge/python-3.11%2B-1B3A4B" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/track-Healthcare%20%26%20Biotech-0F766E" alt="Healthcare and Biotech">
</p>

## What you see

Criteria stay on the left. Results stay on the right, so a change and its effect are on screen together.

- **Funnel.** Confirmed-eligible means every active, evaluable criterion returns `meets`. Possibly-eligible still includes patients whose missing lab or vital would have to check out. Missing data never counts as meeting a rule.
- **Toggles and sliders.** Switch a criterion off, or nudge a numeric threshold. The original value stays marked.
- **Price tag.** For each criterion, holding the others fixed: patients kept out, months added, and estimated delay cost, sorted by months added. A demographic note appears only when the excluded group has at least 30 patients.
- **Compare.** Confirmed-eligible, enrollment months, and delay cost each show their change versus the protocol you loaded. Reset restores it.
- **Coverage.** A criterion the synthetic record cannot decide stays on screen with a reason. It does not change the funnel or the cost.
- **Add and export.** Add a criterion by hand when a sentence is not in the translation cache. Download the active criteria, with each changed threshold’s before and after.

Enrollment months assume 1,000 patients, 50 sites, 20 screened per site per month, and a 60% consent rate. Delay cost assumes $40,000 a day, measured against enrolling any adult with type 2 diabetes. All five are editable and labeled as estimates. If nobody is eligible, enrollment is reported as never completing.

## The demo

Open the app and PIONEER 6 loads first. Condition: type 2 diabetes.

| Protocol | What is seeded |
| --- | --- |
| [PIONEER 6](https://clinicaltrials.gov/study/NCT02692716) · oral semaglutide | Eligibility text from the ClinicalTrials.gov record. The protocol to judge. |
| [LEADER](https://clinicaltrials.gov/study/NCT01179048), [SUSTAIN-6](https://clinicaltrials.gov/study/NCT01720446), [EMPA-REG OUTCOME](https://clinicaltrials.gov/study/NCT01131676) | Abridged paraphrases, so the offline demo has working examples. |
| [DECLARE-TIMI 58](https://clinicaltrials.gov/study/NCT01730534), [CREDENCE](https://clinicaltrials.gov/study/NCT02065791), [DAPA-HF](https://clinicaltrials.gov/study/NCT03036124), [Dapa-CKD](https://clinicaltrials.gov/study/NCT03036150), [FLOW](https://clinicaltrials.gov/study/NCT03819153), [SOUL](https://clinicaltrials.gov/study/NCT03914326), [SURPASS-CVOT](https://clinicaltrials.gov/study/NCT04255433) | Verbatim ClinicalTrials.gov text. |

PIONEER 6 has 11 criteria. Four can be evaluated here: type 2 diabetes; age at least 50 with cardiovascular disease, or age at least 60 with a cardiovascular risk factor; history of pancreatitis; dialysis or eGFR below 30. Cardiovascular disease is approximated as myocardial infarction or stroke. A cardiovascular risk factor is approximated as hypertension. The other seven need a date or a field this generator does not have. Each is shown with that reason and drops out of the counts. Coverage is 4 of 11.

Every count uses the same 10,000 synthetic adults with type 2 diabetes. DAPA-HF and Dapa-CKD enroll a broader group, and the screen says so. You can also load an NCT ID that is not in this list.

## How a number is decided

A sentence becomes a structured rule: field, operator, value, unit, and kind. The source sentence is kept. The translator never sees a patient and never returns a verdict. `backend/dryrun/engine.py` returns `meets`, `fails`, or `unknown`. Units are converted before any comparison. An exclusion flips meets and fails and leaves unknown as unknown. Compound rules use Kleene logic: unknown never becomes meets.

The eleven demo protocols ship as hand-checked translations, so the walkthrough runs with no network call and no model. A sentence missing from the cache is reported, not guessed. Add it from the workbench instead.

Property tests in `backend/tests/test_properties.py` lock the claims that matter: loosening a criterion never shrinks the eligible count or adds enrollment time, the full set of criteria is never looser than any single one, the same lab in different units gets the same verdict, and missing data never counts as a meet.

## Run it

Python 3.11+, [uv](https://docs.astral.sh/uv/), and Node 18+. The population and the seeded cache are already in the repo.

```bash
cd frontend && npm install && npm run build
cd ../backend && uv venv && uv pip install -e ".[dev]"
uv run uvicorn dryrun.api:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000. The API serves the built frontend.

```bash
cd backend && uv run pytest -q
cd frontend && npm run dev    # http://localhost:5173, proxies /api to :8000
```

```bash
docker build -t sieve .
docker run -p 8000:8000 sieve
```

Patient rows are synthetic. No real patient data is used. This build does not call a model.

Specified and built in [Kiro](https://kiro.dev). Product rules, the v2 spec, and the reviewer live in `.kiro/`.

## License

[Apache License 2.0](LICENSE).
