# Claude Code is the reviewer, not the builder

Kiro owns this repo. Steering, the save hook, and the reviewer agent live in `.kiro/` and are what Kiro loads. Claude Code does not load that folder on its own, so this file is the bridge.

Before reviewing, read:

- `.kiro/steering/domain-rules.md`
- `.kiro/steering/product.md`
- `.kiro/steering/tech.md`
- `.kiro/steering/structure.md`
- `README.md`

## Rules

- Do not create, edit, or delete files. Stay in plan mode.
- Do not implement fixes. Report them so they can be applied in Kiro.
- The LLM translates criteria. `backend/dryrun/engine.py` decides verdicts.
- Missing data is `unknown`, never `meets`.
- Normalize units before comparing.
- Do not phrase output as medical advice.
- Do not add features outside `.kiro/specs/v2-trial-workbench/`. Submissions are due 8 PM ET today. README features must stay working. Don't start a new spec task after 6:30 PM ET.

## What to report

Rank by impact, maximum 10 items: wrong verdicts, property tests that do not test their claim, README or steering behavior the code misses, and anything that can break the demo. For each: file and line, the problem, and a one- or two-sentence fix.
