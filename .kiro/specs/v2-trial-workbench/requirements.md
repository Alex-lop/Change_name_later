# Requirements Document

## Introduction

Dry Run already loads three seeded type 2 diabetes trials, evaluates structured rules in `engine.py`, and shows a funnel, price tags, and an enrollment-cost estimate. v1 is demoable: the property tests pass, and LEADER analyzes the 10,000-patient file end to end.

This spec is the only work allowed beyond the README. It makes the numbers on screen relative to adults with type 2 diabetes, lets a designer nudge thresholds and compare the result to the loaded protocol, and adds PIONEER 6 (NCT02692716) once the engine can express OR.

Task order is demo value, with one dependency. Population and demographics come first because the current headline is measured against a file that is only about 35% diabetic, and the race deltas are noise. Sliders, the compare header, and the two-column layout are the visual demo and do not need new verdict logic. The add-criterion form is how a judge tries a rule without an AI parser. Kleene `any_of` / `all_of` comes immediately before PIONEER 6, because PIONEER's cardiovascular criterion is an OR and the engine cannot express it today. `parser.py` does not translate new trials; the three demo trials are hand-seeded paraphrases. PIONEER is therefore not the first task.

ClinicalTrials.gov API v2 answered for NCT02692716 from this machine. Use the fetch MCP to copy that eligibility text. The structured rules in `dryrun-mock-data.zip` (`dryrun-mock-data/trials/NCT02692716.json`) are the translation to start from. Map them onto the canonical fields the engine already uses. Do not switch matching to SNOMED, LOINC, or RxNorm.

## Glossary

- **Confirmed-eligible**: verdict is `meets` for every active, evaluable criterion.
- **Original protocol**: the rules as loaded, before any slider move, toggle, or added criterion.
- **Cohort a criterion acts on**: patients who `meets` every other active, evaluable criterion.
- **Not evaluable**: the patient rows cannot decide the criterion, including any criterion that needs a date. It is shown with a reason and changes no count.
- **Kleene logic**: `unknown` never becomes `meets`. `any_of` meets if any child meets, fails if every child fails, otherwise unknown. `all_of` fails if any child fails, meets if every child meets, otherwise unknown.

## Requirements

### Requirement 1: Population base

**User Story:** As a trial designer, I want the funnel measured on adults with type 2 diabetes, so that enrollment months describe that cohort.

#### Acceptance Criteria

1. WHEN the synthetic population is generated, THE SYSTEM SHALL write adults who all have type 2 diabetes, and the UI SHALL label the population that way.
2. WHEN confirmed-eligible fraction, enrollment months, or a price tag is shown, THE SYSTEM SHALL compute it relative to that population.
3. WHEN delay cost is shown, THE SYSTEM SHALL label it "vs. enrolling any adult with type 2 diabetes."
4. THE SYSTEM SHALL keep cost figures labeled as estimates.

### Requirement 2: Fair demographics

**User Story:** As a reviewer, I want an excluded-group comparison against the patients that criterion actually filters, so that a 16-person group cannot look like a disparity finding.

#### Acceptance Criteria

1. WHEN a price tag shows a demographic delta, THE SYSTEM SHALL compare the excluded group with the cohort that criterion acts on.
2. WHEN the excluded group has fewer than 30 patients, THE SYSTEM SHALL hide demographic deltas.
3. THE SYSTEM SHALL show age and sex only. THE SYSTEM SHALL NOT show race deltas on generated data.

### Requirement 3: Threshold sliders

**User Story:** As a trial designer, I want to nudge a numeric threshold and see the analysis update, so that I can test a looser or tighter cutoff.

#### Acceptance Criteria

1. WHEN a rule has a numeric threshold, THE SYSTEM SHALL show a slider bounded by field: age 18–90, hba1c 5–12, bmi 15–60, egfr 10–120, systolic_bp 90–200.
2. WHEN a slider is shown, THE SYSTEM SHALL mark the original protocol value.
3. WHEN the user moves a slider, THE SYSTEM SHALL re-analyze after a 150 ms debounce.
4. WHEN a slider moves in the loosening direction, THE SYSTEM SHALL NOT decrease confirmed-eligible.

### Requirement 4: Compare to the original protocol

**User Story:** As a trial designer, I want the headline to be the change from the protocol I loaded, so that I can see patients, months, and dollars move together.

#### Acceptance Criteria

1. WHEN rules are loaded, THE SYSTEM SHALL keep that set as the baseline.
2. WHILE results are visible, THE SYSTEM SHALL show confirmed-eligible, enrollment months, and delay cost, each with its change versus the original protocol.
3. WHEN the user resets, THE SYSTEM SHALL restore the original thresholds and toggles and reproduce the original counts.

### Requirement 5: Two-column layout

**User Story:** As a trial designer, I want controls and results on screen together, so that a slider move and its effect are visible at once.

#### Acceptance Criteria

1. THE SYSTEM SHALL put criteria controls in the left column and the results in a sticky right column.
2. THE SYSTEM SHALL show the results header, the funnel, and the price tags in the right column.
3. THE SYSTEM SHALL sort price tags by months added, largest first.

### Requirement 6: Add a criterion without the parser

**User Story:** As a judge, I want to add a restriction by hand, so that I can try the product when a sentence is not in the parse cache.

#### Acceptance Criteria

1. WHEN the user adds a criterion, THE SYSTEM SHALL accept field, operator, value or range, and inclusion or exclusion.
2. WHEN a criterion is added this way, THE SYSTEM SHALL label it "added in Dry Run."
3. THE SYSTEM SHALL evaluate the added rule with the same engine as seeded rules.

### Requirement 7: Compound criteria

**User Story:** As a trial designer, I want an OR of ANDs, so that a rule like "age 50 with cardiovascular disease, or age 60 with a risk factor" can be evaluated.

#### Acceptance Criteria

1. WHEN a rule is `any_of`, THE SYSTEM SHALL return `meets` if any child meets, `fails` if every child fails, and `unknown` otherwise.
2. WHEN a rule is `all_of`, THE SYSTEM SHALL return `fails` if any child fails, `meets` if every child meets, and `unknown` otherwise.
3. WHEN every child is `unknown`, THE SYSTEM SHALL return `unknown`.
4. WHEN an exclusion wraps a compound rule, THE SYSTEM SHALL flip `meets` and `fails` and leave `unknown` as `unknown`.
5. WHEN a child is added to an `any_of`, THE SYSTEM SHALL NOT shrink that rule's meets set. WHEN a child is added to an `all_of`, THE SYSTEM SHALL NOT grow that rule's meets set.

### Requirement 8: PIONEER 6

**User Story:** As a viewer of the demo, I want one trial whose criteria text matches ClinicalTrials.gov, including the criteria this data cannot decide.

#### Acceptance Criteria

1. WHEN the user opens NCT02692716, THE SYSTEM SHALL load PIONEER 6 with `source_sentence` copied from the ClinicalTrials.gov eligibility text, checked against `dryrun-mock-data/trials/NCT02692716.json`.
2. THE SYSTEM SHALL translate those rules onto canonical fields (`age`, `hba1c`, `bmi`, `egfr`, `conditions`, `medications`, and the other names `engine.py` already matches). THE SYSTEM SHALL NOT match on SNOMED, LOINC, or RxNorm codes.
3. THE SYSTEM SHALL express PIONEER's age-and-cardiovascular criterion as `any_of` groups, using the zip's child structure and its stated approximation (cardiovascular disease as history of myocardial infarction or stroke; cardiovascular risk factor as hypertension).
4. WHEN a criterion needs a date, or the generator has no field for it, THE SYSTEM SHALL show it as not evaluable with a reason. Time windows are not evaluable, including when the zip marks the rule mapped.
5. WHEN not-evaluable criteria are present, THE SYSTEM SHALL NOT change confirmed-eligible, the funnel, or any price tag.
6. THE SYSTEM SHALL show a coverage score: evaluable criteria divided by total criteria.
7. THE SYSTEM SHALL add the condition and medication tokens the evaluable PIONEER rules need to the generator. LEADER, SUSTAIN-6, and EMPA-REG OUTCOME SHALL keep loading offline.
8. THE SYSTEM SHALL keep the existing seeded trials working. Their current sentences are paraphrases; this task does not rewrite them.

### Requirement 9: Section-aware splitting

**User Story:** As a developer, I want a fetched protocol to remember which lines were inclusions, so that a new parse is not stored as the wrong kind.

#### Acceptance Criteria

1. WHEN `split_criteria` reads an eligibility block, THE SYSTEM SHALL keep the inclusion or exclusion section of each sentence and pass that section as the rule kind.
2. WHEN a parse is cached, THE SYSTEM SHALL include the kind in the cache key.

### Requirement 10: Export

**User Story:** As a trial designer, I want the modified criteria as text, so that I can take the nudged protocol to the team.

#### Acceptance Criteria

1. WHEN the user exports, THE SYSTEM SHALL download the active criteria as text with each changed threshold's before and after value.
2. THE SYSTEM SHALL mark criteria added in Dry Run, and list not-evaluable criteria with their reasons.

## Correctness properties

Add these to `backend/tests/test_properties.py`. The six properties already listed in `.kiro/steering/domain-rules.md` stay in force.

1. Moving a slider in the loosening direction never decreases confirmed-eligible.
2. Restoring the original thresholds reproduces the original counts.
3. Adding a child to an `any_of` never shrinks its meets set. Adding a child to an `all_of` never grows it.
4. A compound rule whose children are all unknown is unknown.
5. Not-evaluable criteria never change a count.
