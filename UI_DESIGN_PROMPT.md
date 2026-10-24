# Dry Run: visual design brief

Paste this into Kiro as a new spec (for example "v3-visual-design"). It is a design pass: it changes
how Dry Run looks and moves, not what it computes.

## Scope and constraints

- Keep `engine.py`, `analysis.py`, `cost.py` and every existing property test as they are. Every
  current feature stays reachable.
- One backend addition is allowed, because the main visual needs it. `/api/analyze` also returns one
  small integer per patient, in a stable order sorted by age: `-2` eligible, `-1` possibly eligible
  (missing data, no fails), `-3` excluded by two or more active criteria, and `k` (0 or more)
  excluded only by active criterion `k`. Add a property test: the number of patients with code `k`
  equals price tag `k`'s excluded count.
- Load the hero demo trial (PIONEER 6 if present, otherwise the first demo trial) on first visit, so
  nobody lands on an empty screen.
- Stay in the stack: React 18, Vite, plain JSX, plain CSS. No component or chart libraries, no
  TypeScript. The patient field is a 2D canvas.
- Before writing code, put a short design plan in the spec's design doc (tokens, type scale, a
  wireframe), check it against this brief, and change anything that reads like a generic dashboard.
  Then build, one commit per task.

## Direction

Dry Run is a wind tunnel for clinical trials. Its users are trial designers at biotechs, CROs and
research groups, and its one job is to show what each eligibility criterion costs. It should feel like
a precise instrument printed on lab paper: calm, exact and trustworthy, with one living element.

It takes its cues from Alex's site (https://alex-lop.github.io/Alex_Lopez_Website/) and turns them to
this subject.

**Borrowed from the site:**
- the field of short ink ticks
- the rolling odometer digits
- the IBM Plex Sans and Serif pairing
- the one blue, `#1a5fff`
- 2px corners
- structure from spacing and a single left edge rather than boxes
- corner crop marks around a visual
- the motion discipline: one orchestrated moment, everything else answers the user, reduced motion
  respected

**New for Dry Run:**
- the ticks are patients
- a cool lab-paper ground instead of warm
- amendment redlines for changed criteria
- the protocol's own words set in serif and the computed numbers in sans
- a CONSORT-style flow, the diagram every trialist knows

## Tokens

| token       | hex       | job |
| ----------- | --------- | --- |
| `--paper`   | `#f2f4f3` | page ground: cool lab paper, the clinical cousin of the site's warm `#f5f5f0` |
| `--paper-2` | `#e6eae8` | the few solid areas: assumptions drawer, add-a-criterion row |
| `--ink`     | `#12161a` | text, eligible patient marks, rules |
| `--ink-2`   | `#4e5a60` | secondary text, captions, units (about 6.4:1 on paper) |
| `--rule`    | `#cfd6d4` | hairlines and slider tracks |
| `--accent`  | `#1a5fff` | whatever the user is touching: slider thumbs and fills, focus rings, the eligible-count odometer, patients highlighted by a hovered criterion. Marks and large numbers only (about 4.6:1) |
| `--redline` | `#c8102e` | amendment marks only: struck original values, underlined new values, "added in Dry Run" |

- `color-scheme: light`.
- No gradients. No shadows, except a 3px paper halo around slider thumbs.
- 2px radius everywhere.

## Type

- **IBM Plex Sans** (400, 500, 600) for the interface and every number, with `font-variant-numeric:
  tabular-nums`.
- **IBM Plex Serif** (400 and italic) for exactly two things: the trial's verbatim criteria sentences
  and the result sentence. Serif means the protocol speaks; sans means Dry Run computed this.
- Load both from Google Fonts in `index.html`.

| role              | size and setting |
| ----------------- | ---------------- |
| body              | 16px / 1.55 |
| small             | 14px |
| criteria          | 17px serif / 1.6 |
| result sentence   | clamp(22px, 2.2vw, 28px) serif italic / 1.35 |
| headline numbers  | weight 500, clamp(32px, 3.6vw, 44px) |
| section headings  | weight 600, 18px |

- Sentence case everywhere.
- No all-caps labels, no monospace, no eyebrow labels above headings.

## Layout

On desktop (1000px and wider): two columns inside a max width of about 1360px with 24px gutters. The
protocol column on the left, about 44%, scrolls. The result column on the right is sticky.

```
+------------------------------------------------------------------------------+
| Dry Run   [ PIONEER 6 (NCT02692716) v ]          Reset to protocol   Export    |
+-----------------------------------+------------------------------------------+
| (protocol column, scrolls)        | (result column, sticky)                  |
|                                   |                                          |
| PIONEER 6                         | As written, 1,529 of 10,000 synthetic    |
| Dry Run can evaluate 6 of 11      | adults with type 2 diabetes are eligible.|
| criteria on this data.            |                                          |
|                                   | 1,529         14.2 months     $9.8M      |
| Inclusion criteria                | up to 1,876 if missing data checks out   |
| | Male or female diagnosed with   |                                          |
| | type 2 diabetes                 |  r-                                  -,  |
| | Age at least 50 years and ...   |   | | | / | | - | | | | / | | | | | |   |
| |   age  -------|-----o-----  50  |   | | - | | | | / | | | | | | - | | |   |
| Exclusion criteria                |  L-                                  -j  |
| | ... eGFR below 30 mL/min ...    |  Each mark is one synthetic patient.     |
| |   egfr  ----o----|-------  30   |                                          |
| : Family or personal history ...  |  (CONSORT-style flow)                    |
| :   Not in the synthetic records. |  (what each criterion costs: table)      |
| + Add a criterion                 |                                          |
| > Enrollment assumptions          |                                          |
+-----------------------------------+------------------------------------------+
| Synthetic patients only. Figures are planning estimates, not medical advice.  |
+------------------------------------------------------------------------------+
```

The numbers in the wireframe are placeholders. Below 900px, use one column. A slim sticky bar keeps
the eligible count and its change in view, the result sentence and the field come first, and the
protocol comes after.

## The signature: the patient field

- **Layout.** One short vertical mark per synthetic patient (10,000), on a grid that fills the column
  up to about 640px. Patients are ordered by age, youngest on the left, and never reshuffled between
  updates, so an age threshold visibly sweeps across the field.
- **States are shown by shape, not only color:**
  - eligible: upright, full ink
  - possibly eligible (missing data): upright, half length, 45% ink
  - excluded: fallen to about 80 degrees from vertical, 15% ink
- **Hover highlight.** Hovering or focusing a criterion, in the protocol or in the cost table, turns
  the patients kept out by that criterion alone accent blue and 1px thicker. Those are exactly the
  people its price tag counts.
- **Frame and caption.** Frame the field with four corner crop marks, like the corners around the
  route on Alex's site. Put a plain caption under it: "Each mark is one synthetic patient. Standing:
  eligible. Short: missing data. Fallen: excluded."
- **Motion.** When a slider or toggle changes, only the marks whose state changed move. They settle
  on a damped spring (about 600ms, slight overshoot), the way the ticks on Alex's site settle.
- **Implementation.**
  - Canvas 2D, devicePixelRatio aware.
  - Strokes batched by state (one path per state).
  - An `aria-label` that summarizes the counts.
  - The cost table is the accessible equivalent.

## The protocol column

- **Structure.** It reads like a protocol, with sections titled "Inclusion criteria", "Exclusion
  criteria" and "Not evaluable on this data". Under the trial title, one coverage line: "Dry Run can
  evaluate 6 of 11 criteria on this data."
- **Each criterion** shows the verbatim serif sentence, then a plain-sans gloss of the rule beneath it
  (for example "age at least 50 with cardiovascular disease, or at least 60 with a risk factor"),
  then its controls.
- **On and off.** The 2px rule on the row's left edge shows the state: solid ink when on, dashed
  `--rule` when off. A real checkbox drives it, for keyboard and screen readers.
- **Sliders.** Native range inputs, restyled:
  - a 3px `--rule` track with `--accent` fill
  - a 12px `--accent` thumb with a 3px paper halo
  - a small ink tick at the original value, labeled "as written: 7.0"
  - arrow keys step 0.1 for HbA1c, 1 for age and eGFR, 0.5 for BMI
- **Redlines.** Changed values become redlines inside the sentence: the original struck through and
  the new value underlined, both in `--redline`. For example: "HbA1c of at least ~~7.0%~~ 6.5%".
  User-added criteria are underlined in `--redline` and tagged "added in Dry Run". The export uses
  the same redline language.
- **Not-evaluable criteria** are set in `--ink-2` with a dashed left rule and the reason in one plain
  line.
- **"Add a criterion"** opens one inline row on `--paper-2` with four controls: field, comparison,
  value with unit, inclusion or exclusion.
- **Enrollment assumptions** sit in a collapsed drawer at the bottom, labeled once as estimates.

## The result column (sticky)

1. **The result sentence**, generated from the numbers, in plain words, with "about" on every
   estimate. As written: "As written, 1,529 of 10,000 synthetic adults with type 2 diabetes are
   eligible." After edits: "Your changes admit 412 more patients and shorten enrollment by about 4.1
   months."
2. **Three numbers:** eligible patients, estimated enrollment months and estimated delay cost.
   - The eligible count is an accent odometer whose digits roll like the mileage on Alex's site
     (about 600ms).
   - Each number shows its change against the protocol as written beneath it, in `--ink-2`.
   - One small line: "up to N if missing data checks out".
   - No cards around any of it.
3. **The patient field.**
4. **A CONSORT-style flow.** Counts run down the left, and each criterion's exclusions branch right
   on a hairline elbow. Hairlines and small type, no fills.
5. **"What each criterion costs"** as a real table, sorted by months added.
   - Columns: criterion, patients kept out, months added, delay cost, with a thin ink bar for
     months.
   - Re-sort when a slider is released, not while it's being dragged.
   - A demographic note appears only when the group has at least 30 patients, as one plain line
     ("on average 9 years older than the rest of the cohort").

## Top bar and footer

- **Top bar.**
  - Left: the "Dry Run" wordmark in Plex Sans 600, then the trial picker.
  - Right: "Reset to protocol" and "Export changes".
  - Buttons have a 1px ink outline, 2px radius and 40px height; the primary one is filled with
    ink; hover turns them accent.
  - No pills, no shadows, no arrows in labels.
- **Footer**, one line: "Synthetic patients only. Figures are planning estimates, not medical
  advice."

## Motion

- **One orchestrated moment:** on first load the field stands up, sweeping from youngest to oldest in
  about 900ms, then holds still.
- **Everything else answers the user:**
  - marks spring when their state changes
  - digits roll
  - the hovered criterion's patients light up (120ms)
- **Never:** fade-up sections, hover lifts, parallax or idle animation.
- **Reduced motion:** under `prefers-reduced-motion`, every element shows its final state
  immediately.

## Quality floor

- Text uses `--ink` and `--ink-2`. Accent and redline appear only on marks, large numbers and short
  emphasized values.
- Visible focus on every control: 2px accent outline, 3px offset.
- Touch targets of at least 44px.
- The layout works at 360px wide.
- The keyboard can drive every slider and toggle.
- Errors say what happened and how to fix it. For example: "Couldn't load NCT01234567 from
  ClinicalTrials.gov. Check the ID, or try a demo trial."
- **Avoid:**
  - a cream background with a terracotta accent
  - a dark dashboard with a neon accent
  - identical rounded cards with soft shadows
  - all-caps eyebrow labels
  - monospace data labels
  - middle-dot meta strings
  - arrows appended to buttons
  - gradient washes

## Done when

- A first-time viewer gets it in five seconds: each mark is a patient, the protocol keeps most of
  them out, and dragging a threshold brings people back.
- You have screenshots at 1440px and 390px wide, checked against this brief, and you have removed one
  decorative element before calling it finished.
- All existing tests and the new property test pass.
