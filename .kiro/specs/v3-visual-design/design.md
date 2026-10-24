# v3 Visual Design — Dry Run

A design pass. It changes how Dry Run looks and moves, not what it computes.
`engine.py`, `analysis.py`, `cost.py` and every existing property test keep
their behavior. One backend addition is allowed (per-patient codes), and one
new property test is added for it.

Dry Run is a wind tunnel for clinical trials. It should feel like a precise
instrument printed on lab paper: calm, exact, trustworthy, with one living
element — the patient field.

## Tokens (CSS custom properties on `:root`)

| token       | hex       | job |
| ----------- | --------- | --- |
| `--paper`   | `#f2f4f3` | page ground: cool lab paper |
| `--paper-2` | `#e6eae8` | the few solid areas: assumptions drawer, add-a-criterion row |
| `--ink`     | `#12161a` | text, eligible marks, rules |
| `--ink-2`   | `#4e5a60` | secondary text, captions, units |
| `--rule`    | `#cfd6d4` | hairlines and slider tracks |
| `--accent`  | `#1a5fff` | whatever the user is touching: slider thumbs/fills, focus rings, the eligible odometer, patients a hovered criterion keeps out. Marks and large numbers only |
| `--redline` | `#c8102e` | amendment marks only: struck originals, underlined new values, "added in Dry Run" |

- `color-scheme: light`. No gradients. No shadows except a 3px paper halo on slider thumbs. 2px radius everywhere.

## Type

- **IBM Plex Sans** (400/500/600) for the interface and every number, `font-variant-numeric: tabular-nums`.
- **IBM Plex Serif** (400 + italic) for exactly two things: verbatim criteria sentences and the result sentence.
- Both loaded from Google Fonts in `index.html`.

| role              | size and setting |
| ----------------- | ---------------- |
| body              | 16px / 1.55 |
| small             | 14px |
| criteria          | 17px serif / 1.6 |
| result sentence   | clamp(22px, 2.2vw, 28px) serif italic / 1.35 |
| headline numbers  | weight 500, clamp(32px, 3.6vw, 44px) |
| section headings  | weight 600, 18px |

Sentence case everywhere. No all-caps labels, no monospace, no eyebrow labels.

## Layout

Desktop (>=1000px): two columns inside max width ~1360px, 24px gutters.
Protocol column left (~44%) scrolls; result column right is sticky.
Below 900px: single column. A slim sticky mini-bar keeps the eligible count and
its change in view; the result sentence and the field come first, protocol
after. Works at 360px wide.

```
+---------------------------------------------------------------+
| Dry Run   [ PIONEER 6 v ]        Reset to protocol   Export   |
+-----------------------------+---------------------------------+
| protocol (scrolls)          | result (sticky)                 |
| PIONEER 6                    | As written, N of 10,000 ... are |
| Dry Run can evaluate 6 of 11 | eligible.                       |
|                              | N        M months    $X        |
| Inclusion criteria           | up to N if missing data checks  |
| | verbatim serif sentence    |  r-                        -,   |
| |   sans gloss               |   | | | / | | - | | | / | |     |
| |   age ----|--o--- 50       |  L-                        -j   |
| Exclusion criteria           |  Each mark is one patient.      |
| : Not evaluable ...          |  (CONSORT flow)                 |
| + Add a criterion            |  (what each criterion costs)    |
| > Enrollment assumptions     |                                 |
+-----------------------------+---------------------------------+
| Synthetic patients only. Figures are planning estimates ...   |
+---------------------------------------------------------------+
```

## The patient field (signature)

- 10,000 short vertical marks, one per synthetic patient, on a grid filling the
  column up to ~640px. Ordered by age (youngest left), never reshuffled.
- States by shape, not only color:
  - eligible: upright, full length, full ink
  - possibly eligible (missing data): upright, half length, 45% ink
  - excluded: fallen to ~80° from vertical, 15% ink
- Hover/focus a criterion (protocol or cost table) -> the patients it alone
  keeps out turn accent blue, 1px thicker. Those are exactly its price-tag count.
- Four corner crop marks around the field. Caption under it.
- Motion: on a slider/toggle change, only marks whose state changed move; they
  settle on a damped spring (~600ms, slight overshoot).
- Implementation: Canvas 2D, devicePixelRatio aware, strokes batched by state,
  an `aria-label` summarizing counts. The cost table is the accessible equivalent.

## Patient codes (the one backend addition)

`/api/analyze` returns `patient_codes`: one small integer per patient, in a
stable order sorted by age ascending (ties broken by patient id). This is what
lets the field render each mark without shipping the full verdict matrix.

The field's mark order is exactly `patient_codes` order: index i on the grid is
the i-th youngest patient. `active_rule_ids` (already returned) gives the
criterion index `k` -> rule id mapping for hover highlight.

Code meaning (relative to the active, evaluable criteria):

| code | meaning |
| ---- | ------- |
| `-2` | eligible: MEETS every active criterion |
| `-1` | possibly eligible: no active criterion FAILS, but at least one UNKNOWN |
| `-3` | excluded by two or more active criteria (FAILS >= 2) |
| `k` (0..n-1) | excluded by active criterion `k` alone (the only criterion it FAILS) |

Invariant (new property test): for each `k`, the number of patients with code
`k` equals price tag `k`'s `excluded` count — because a price tag counts
patients who pass every *other* active criterion and FAIL this one, which is
exactly "FAILS this one alone".

## Protocol column

- Reads like a protocol: sections "Inclusion criteria", "Exclusion criteria",
  "Not evaluable on this data". Under the title, one coverage line:
  "Dry Run can evaluate 6 of 11 criteria on this data."
- Each criterion: verbatim serif sentence, a plain-sans gloss beneath, then controls.
- On/off: the 2px left-edge rule is solid ink when on, dashed `--rule` when off.
  A real checkbox drives it.
- Sliders: native range restyled — 3px `--rule` track with `--accent` fill,
  12px `--accent` thumb with a 3px paper halo, a small ink tick at the original
  value labeled "as written: 7.0", arrow-key steps (0.1 HbA1c, 1 age/eGFR, 0.5 BMI).
- Redlines: changed values become redlines inside the sentence — original struck,
  new value underlined, both `--redline`. Added criteria underlined + "added in
  Dry Run". Export uses the same language.
- Not evaluable: `--ink-2`, dashed left rule, reason in one plain line.
- "Add a criterion": one inline row on `--paper-2`, four controls (field,
  comparison, value+unit, inclusion/exclusion).
- "Enrollment assumptions": collapsed drawer at the bottom, labeled once as estimates.

## Result column (sticky)

1. Result sentence, generated from the numbers, plain words, "about" on every
   estimate. As written vs after edits.
2. Three numbers: eligible (accent odometer, rolls ~600ms), est. enrollment
   months, est. delay cost. Each shows its change vs the protocol as written in
   `--ink-2`. One line: "up to N if missing data checks out". No cards.
3. The patient field.
4. CONSORT-style flow: counts down the left, each criterion's exclusions branch
   right on a hairline elbow. Hairlines, small type, no fills.
5. "What each criterion costs" table, sorted by months added. Columns:
   criterion, patients kept out, months added, delay cost, thin ink month bar.
   Re-sort on slider release, not during drag. A demographic note only when the
   excluded group has >= 30 patients.

## Top bar and footer

- Top bar. Left: "Dry Run" wordmark (Plex Sans 600), then the trial picker.
  Right: "Reset to protocol", "Export changes". Buttons: 1px ink outline, 2px
  radius, 40px height; primary filled ink; hover -> accent. No pills, no shadows,
  no arrows in labels.
- Footer, one line: "Synthetic patients only. Figures are planning estimates,
  not medical advice."

## Motion

- One orchestrated moment: on first load the field stands up, sweeping youngest
  -> oldest in ~900ms, then holds.
- Everything else answers the user: marks spring on state change, digits roll,
  the hovered criterion's patients light up (120ms).
- Never: fade-up sections, hover lifts, parallax, idle animation.
- `prefers-reduced-motion`: every element shows its final state immediately.

## Quality floor

- Text only `--ink`/`--ink-2`. Accent + redline only on marks, large numbers,
  short emphasized values.
- Visible focus on every control: 2px accent outline, 3px offset.
- Touch targets >= 44px. Keyboard drives every slider and toggle.
- Errors say what happened and how to fix it.

## Removed decorative element

Per the brief's "remove one decorative element before done": the old horizontal
gradient funnel bars are dropped entirely in favor of the hairline CONSORT flow
— no fills, no gradient. (The gradient was also on the avoid-list.)
