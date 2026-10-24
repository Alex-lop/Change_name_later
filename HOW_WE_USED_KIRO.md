# How We Used Kiro — Sieve

Oct 24, 2026 · @Alex

## Overview

Sieve lets trial designers test eligibility criteria on 10,000 synthetic adults with type 2 diabetes before launch. For every criterion you see how many patients it kicks out, how many months it adds to enrollment, and roughly what that delay costs.

The rule we cared about most: the translation step turns a criterion into a structured rule and never sees patient data, and `engine.py` makes every call. There's no live model in this build. The four demo trials (PIONEER 6, LEADER, SUSTAIN-6, EMPA-REG OUTCOME) ship with pre-checked translations, so the demo runs offline. PIONEER 6 uses the exact ClinicalTrials.gov wording.

Biggest thing Kiro changed for us: once the steering files were in, we stopped re-explaining the project. Every task already knew missing data is unknown and that verdicts only live in the engine, so we spent our time checking numbers instead.

Heads up: it was called Dry Run during the build, so that's the name you'll see in `.kiro/` and the `dryrun` package.

## Kiro tools we used

The core build was all Kiro CLI, across two sessions. One built v1, the v2 spec and every fix after it. The other did the visual redesign from a design brief ([UI_DESIGN_PROMPT.md](UI_DESIGN_PROMPT.md)).

| Tool | Used? | For |
| --- | --- | --- |
| Kiro CLI | Yes | v1, the v2 spec and its 10 tasks, bug fixes, the visual pass |
| Kiro IDE | No | |
| Kiro Web | No | |
| Kiro Crew | No | Installed it, didn't end up using it on this project |

Team split: Alex ran Kiro. Jaskeerat put together the mock data pack the PIONEER 6 rules started from, made the title card, and did the rename to Sieve.

Other tools, so nothing's a surprise when you open the repo: Claude Code was our read-only second reviewer (that's what [CLAUDE.md](CLAUDE.md) is for). We turned its findings into Kiro prompts and Kiro made the fixes. Late in the day we also used Claude Code agents for the Massachusetts map, the landing screen and loading extra trials. That part isn't in the Kiro spec.

## Spec-driven development

v1 was one big prompt. v2 was a real Kiro spec. Doing both in the same day made the difference pretty obvious.

**v1.** One ~2,100-character brief to Kiro CLI: the flow, the three verdicts (meets / fails / unknown), the enrollment formula, six correctness properties and the stack. Kiro built the backend, the tests and the React app from that. It worked, but we never saved it as a spec.

**v2.** We had Kiro create [`.kiro/specs/v2-trial-workbench/`](.kiro/specs/v2-trial-workbench/):

- [requirements.md](.kiro/specs/v2-trial-workbench/requirements.md): 10 requirements, 37 EARS acceptance criteria, a glossary and 5 new correctness properties
- [design.md](.kiro/specs/v2-trial-workbench/design.md): the calls we made up front, like which direction each operator "loosens", what compare uses as its baseline, the new Rule fields for AND/OR logic, and which PIONEER 6 criteria stay not-evaluable because they need dates
- [tasks.md](.kiro/specs/v2-trial-workbench/tasks.md): 10 tasks, all checked off, each linked to its requirements

Kiro worked through them in order, one commit per task: 12 commits in about 20 minutes (12:11 to 12:31). There's also a smaller design-only spec for the visual pass in [v3-visual-design/](.kiro/specs/v3-visual-design/).

A few requirements, copied straight from the spec:

- WHEN an exclusion wraps a compound rule, THE SYSTEM SHALL flip meets and fails and leave unknown as unknown.
- WHEN a criterion needs a date, or the generator has no field for it, THE SYSTEM SHALL show it as not evaluable with a reason.
- WHEN not-evaluable criteria are present, THE SYSTEM SHALL NOT change confirmed-eligible, the funnel, or any price tag.

### vs. vibe coding

- The v1 prompt got us a working app fast, but it had problems a spec would have caught. Demographic deltas compared against the whole population instead of the patients a criterion actually filters. And v1 seeded two criteria for LEADER and SUSTAIN-6 that aren't in the real registry records, so we had to go back and delete them.
- With the spec, the tricky stuff got decided once. The AND/OR truth tables and "time windows are never evaluable" were written down, so Kiro didn't have to guess.
- Task order mattered. PIONEER 6 needs an OR, so the spec put AND/OR logic right before it.
- Specs drift. By mid-afternoon `tasks.md` still said 0 of 10 done, so we gave Kiro one prompt to sync `.kiro/` with what we'd actually shipped.
- The spec took maybe 15 minutes. For the visual pass, one big design prompt was still faster.

## Property-based testing

Every guarantee on screen has a Hypothesis property behind it in [backend/tests/test_properties.py](backend/tests/test_properties.py): 20 property tests, 36 tests total, all green. We wrote the properties in plain English and Kiro wrote the tests.

| Property | Test |
| --- | --- |
| Removing or loosening a criterion never lowers the eligible count | `test_p1_*` |
| All criteria together never beat any single criterion | `test_p2_*` |
| Same lab value in different units gets the same verdict (HbA1c, glucose, creatinine, weight, age) | `test_p3_*` |
| A rule survives a save/load round trip unchanged | `test_p4_*` |
| Loosening never makes enrollment slower | `test_p5_*` |
| Missing data never counts as meeting a rule | `test_p6_*` |
| Loosening a slider never lowers confirmed-eligible | `test_v2_slider_*` |
| Reset gets you the original counts back | `test_v2_reset_*` |
| Adding an OR branch never shrinks matches; adding an AND branch never grows them | `test_v2_any_of_*`, `test_v2_all_of_*` |
| All-unknown children stay unknown | `test_v2_all_unknown_*` |
| Not-evaluable criteria never move a count | `test_v2_not_evaluable_*` |
| A bad parser response never turns into a rule | `test_v2_invalid_backend_*` |
| `evaluate()` matches plain Python for every operator | `test_oracle_*` |

### What it caught

The best catch was in our own tests. A mutation check (swap `>=` and `>` in the engine) still passed the whole suite. Most of the properties used the engine to check the engine, so a wrong operator stayed consistent with itself.

So we had Kiro add oracle properties that check `evaluate()` against plain Python, with values sitting right on the threshold. Kiro put the bug back in and `test_oracle_numeric` failed. Took it out again: 36 passed (commit `fde3cb6`). The engine was fine the whole time; we just couldn't prove it before.

Hypothesis also found a divide-by-zero in the map code: an empty county when the minimum group size is 0. Empty areas now always count as suppressed.

## Steering docs

Four files, all `inclusion: always`, so every task started from the same rules.

| File | What it says |
| --- | --- |
| [product.md](.kiro/steering/product.md) | What the tool is and who it's for. It's a planning tool, not medical advice, and the four demo trials have to keep working offline |
| [tech.md](.kiro/steering/tech.md) | Stay in the stack: FastAPI, DuckDB, Pydantic, uv, Hypothesis, React + Vite, plain JSX. Synthetic patients only. The demo can't depend on a live LLM call |
| [domain-rules.md](.kiro/steering/domain-rules.md) | The engine rules: three verdicts, missing data is unknown never meets, exclusions only flip meets/fails, units get converted before comparing, criteria text stays verbatim. Plus the six properties |
| [structure.md](.kiro/steering/structure.md) | Where everything lives. Verdicts only in `engine.py`, never in the parser, the API or React |

What worked best was rules short enough to check. "Missing patient data is always unknown, never meets" beats a paragraph of background every time. After reviewing v1 we had Kiro add five more rules to `domain-rules.md`, so the steering got stricter as we learned. The time rules ("don't start a new task after 6:30 PM") kept it from wandering off too.

## Agent hooks

One hook, [`.kiro/hooks/property-tests.json`](.kiro/hooks/property-tests.json). On `PostFileSave` for the engine, units, model, analysis, cost or API code (or the property tests themselves), it runs `cd backend && uv run pytest -q`.

At first it only ran `test_properties.py` and skipped `api.py`. Review showed that missed a bug the unit tests would catch, so Kiro widened it to the full suite.

We never actually saw it fire in our CLI logs. In practice Kiro ran `uv run pytest -q` itself before every task commit, because the design doc tells it to. Next time we'd get the hook firing first and confirm it works before writing any code.

## Custom agent

[`.kiro/agents/reviewer.md`](.kiro/agents/reviewer.md) is a read-only reviewer. It only gets the read tool, file writes and shell are denied, and it loads the steering files and README so it reviews against the same rules that built the thing. It hunts for wrong verdicts, tests that don't test what they claim, and anything that would break the demo, with 10 findings max.

We ended up running that same brief through Claude Code ([CLAUDE.md](CLAUDE.md)) instead, and fed the findings back to Kiro as tasks.

## MCP

We set up the fetch MCP server ([`.kiro/settings/mcp.json`](.kiro/settings/mcp.json)) to pull PIONEER 6's eligibility text from the ClinicalTrials.gov API. Kiro created that config partway through a session, so the server wasn't loaded yet. It grabbed the text with its built-in web fetch instead and saved it to [backend/data/trials_raw/NCT02692716.txt](backend/data/trials_raw/NCT02692716.txt).

Getting the exact registry wording mattered. Anyone can check PIONEER 6 against ClinicalTrials.gov, and the 7 of 11 criteria our data can't evaluate stay on screen with a reason. Next step would be a proper ClinicalTrials.gov MCP server, so Kiro can pull any trial on request.

## Kiro powers

Didn't use any, and no third-party integrations through Kiro either. Our project-specific knowledge lived in steering.

## Lessons learned

- Put the guarantees in the very first prompt. The six properties were there from minute one and they shaped the whole engine.
- Keep the AI's job small and write it down. "It only translates, it never decides" kept everything clean, and it meant we could ship without a model at all.
- A test that checks the engine against itself proves nothing. Add an oracle, break something on purpose, and make sure the suite fails.
- Keep the spec in sync. Ours was out of date within two hours.
- What didn't work: skipping a spec for v1. That's where the made-up criteria and the wrong demographic comparison came from.
- Next time: a spec from the start, and the test hook firing before any code gets written.

## Project description (for the submission form)

Track: Healthcare & Biotech.

Trials stall when they can't find enough eligible patients. Sieve shows you which criteria are to blame before launch. Load a protocol, run it against 10,000 synthetic adults with type 2 diabetes, and see what each criterion costs: patients kept out, enrollment months added, and an estimated delay cost.

You can switch criteria off, drag thresholds, compare against the original protocol, add your own criterion and export the edited version. Anything the data can't decide stays on screen with a reason and never changes a count.

A deterministic engine (meets / fails / unknown) makes every call, converts units before comparing, and never counts missing data as eligible. Four real Phase 3 trials ship offline, including PIONEER 6 with its exact ClinicalTrials.gov text.

It's a planning tool, not medical advice, and every time and cost number is an estimate.

## Evidence

- [ ] [tasks.md](.kiro/specs/v2-trial-workbench/tasks.md) on GitHub with all 10 tasks checked
- [ ] The Kiro CLI session with the v2 spec prompt and a task commit
- [ ] `uv run pytest -q` showing 36 passed
- [ ] The mutation check: swap `>=` and `>`, watch `test_oracle_numeric` fail, swap back
- [ ] The steering files, hook, `mcp.json` and reviewer agent
- [ ] Link: https://github.com/Alex-lop/Sieve/tree/main/.kiro

## Sources

- Kiro docs: hooks
- Kiro docs: steering
- Kiro docs: custom agents
- Kiro docs: correctness properties
