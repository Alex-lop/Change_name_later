"""Property-based tests for the six correctness requirements.

P1. Removing or loosening any criterion never decreases the eligible count.
P2. The eligible count with all criteria applied never exceeds the count for
    any single criterion.
P3. The same lab value in different units always gets the same verdict.
P4. Serializing a structured rule and reading it back gives an identical rule.
P5. Loosening a criterion never increases estimated enrollment time.
P6. A patient with missing data for a rule is never counted as meeting it.
"""

from __future__ import annotations

import math

from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st

from dryrun import units
from dryrun.analysis import VerdictMatrix, confirmed_eligible, possibly_eligible
from dryrun.cost import Assumptions, enrollment_months
from dryrun.engine import evaluate
from dryrun.model import Kind, Operator, Patient, Rule, Verdict

from .strategies import numeric_rules, patients

slow = settings(
    max_examples=200,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)


# --- P1: removing/loosening a criterion never decreases eligible count --------


@slow
@given(
    rule_list=st.lists(numeric_rules(), min_size=1, max_size=5),
    pts=st.lists(patients(), min_size=1, max_size=30),
)
def test_p1_removing_criterion_never_decreases_eligible(rule_list, pts):
    # give unique ids
    for i, r in enumerate(rule_list):
        r.id = f"r{i}"
    for i, p in enumerate(pts):
        p.id = f"p{i}"
    m = VerdictMatrix.build(rule_list, pts)
    all_ids = [r.id for r in rule_list]
    full = len(confirmed_eligible(m, all_ids))
    for i in range(len(all_ids)):
        subset = all_ids[:i] + all_ids[i + 1 :]  # remove one criterion
        assert len(confirmed_eligible(m, subset)) >= full


@slow
@given(
    base=numeric_rules(),
    pts=st.lists(patients(), min_size=1, max_size=40),
    delta=st.floats(min_value=0.01, max_value=100, allow_nan=False),
)
def test_p1_loosening_threshold_never_decreases_eligible(base, pts, delta):
    # Loosen an inclusion >=/> threshold by lowering it, or <=/< by raising it.
    assume(base.kind is Kind.INCLUSION)
    assume(base.operator in {Operator.GTE, Operator.GT, Operator.LTE, Operator.LT})
    for i, p in enumerate(pts):
        p.id = f"p{i}"
    base.id = "r0"
    if base.operator in {Operator.GTE, Operator.GT}:
        loose = base.model_copy(update={"value": base.value - delta})
    else:
        loose = base.model_copy(update={"value": base.value + delta})
    m1 = VerdictMatrix.build([base], pts)
    m2 = VerdictMatrix.build([loose], pts)
    assert len(confirmed_eligible(m2, ["r0"])) >= len(
        confirmed_eligible(m1, ["r0"])
    )


# --- P2: all-criteria count <= any single criterion count ---------------------


@slow
@given(
    rule_list=st.lists(numeric_rules(), min_size=1, max_size=5),
    pts=st.lists(patients(), min_size=1, max_size=30),
)
def test_p2_all_criteria_bounded_by_each_single(rule_list, pts):
    for i, r in enumerate(rule_list):
        r.id = f"r{i}"
    for i, p in enumerate(pts):
        p.id = f"p{i}"
    m = VerdictMatrix.build(rule_list, pts)
    all_ids = [r.id for r in rule_list]
    full = len(confirmed_eligible(m, all_ids))
    for rid in all_ids:
        assert full <= len(confirmed_eligible(m, [rid]))


# --- P3: same value in different units -> same verdict ------------------------

# (field, unit_a, value_a, unit_b, value_b) that are clinically equivalent.
EQUIV = [
    ("hba1c", "percent", 7.0, "mmol/mol", (7.0 - 2.15) * 10.929),
    ("fasting_glucose", "mg/dl", 126.0, "mmol/l", 126.0 / 18.0182),
    ("weight", "kg", 80.0, "lb", 80.0 / 0.45359237),
    ("creatinine", "mg/dl", 1.2, "umol/l", 1.2 * 88.42),
    ("age", "years", 5.0, "months", 60.0),
]


@slow
@given(
    which=st.sampled_from(EQUIV),
    threshold=st.floats(min_value=0.1, max_value=300, allow_nan=False),
    op=st.sampled_from([Operator.GTE, Operator.GT, Operator.LTE, Operator.LT]),
)
def test_p3_unit_invariance(which, threshold, op):
    field, ua, va, ub, vb = which
    # Sanity: the two patient values are truly equivalent in canonical units.
    ca = units.to_canonical(field, va, ua)
    cb = units.to_canonical(field, vb, ub)
    assert math.isclose(ca, cb, rel_tol=1e-6, abs_tol=1e-6)

    rule = Rule(id="r", field=field, operator=op, value=threshold,
                unit=units.canonical_unit(field))
    pa = Patient(id="a", fields={field: va}, units_={field: ua})
    pb = Patient(id="b", fields={field: vb}, units_={field: ub})
    assert evaluate(rule, pa) == evaluate(rule, pb)


@slow
@given(which=st.sampled_from(EQUIV),
       threshold=st.floats(min_value=0.1, max_value=300, allow_nan=False))
def test_p3_rule_unit_invariance(which, threshold):
    # Same threshold expressed in two units -> same verdict for a fixed patient.
    field, ua, va, ub, vb = which
    patient_val = units.to_canonical(field, va, ua)
    p = Patient(id="p", fields={field: patient_val},
                units_={field: units.canonical_unit(field)})
    r_a = Rule(id="r", field=field, operator=Operator.GTE, value=va, unit=ua)
    r_b = Rule(id="r", field=field, operator=Operator.GTE, value=vb, unit=ub)
    assert evaluate(r_a, p) == evaluate(r_b, p)


# --- P4: serialization round-trip ---------------------------------------------


@slow
@given(rule=numeric_rules())
def test_p4_roundtrip_numeric(rule):
    again = Rule(**rule.model_dump())
    assert again == rule
    assert Rule.model_validate_json(rule.model_dump_json()) == rule


def test_p4_roundtrip_categorical():
    r = Rule(id="r", field="conditions", operator=Operator.HAS,
             value=["t2d", "ckd"], kind=Kind.EXCLUSION,
             source_sentence="x", label="y")
    assert Rule(**r.model_dump()) == r
    assert Rule.model_validate_json(r.model_dump_json()) == r


# --- P5: loosening a criterion never increases enrollment time ----------------


@slow
@given(
    rule_list=st.lists(numeric_rules(), min_size=1, max_size=4),
    pts=st.lists(patients(), min_size=5, max_size=40),
    a=st.builds(
        Assumptions,
        target_enrollment=st.integers(min_value=1, max_value=5000),
        sites=st.integers(min_value=1, max_value=200),
        screened_per_site_per_month=st.floats(min_value=1, max_value=100,
                                               allow_nan=False),
        consent_rate=st.floats(min_value=0.01, max_value=1.0, allow_nan=False),
        cost_per_day=st.floats(min_value=0, max_value=1e6, allow_nan=False),
    ),
)
def test_p5_loosening_never_increases_enrollment_time(rule_list, pts, a):
    for i, r in enumerate(rule_list):
        r.id = f"r{i}"
    for i, p in enumerate(pts):
        p.id = f"p{i}"
    m = VerdictMatrix.build(rule_list, pts)
    all_ids = [r.id for r in rule_list]
    total = len(pts)
    frac_full = len(confirmed_eligible(m, all_ids)) / total
    months_full = enrollment_months(frac_full, a)
    for i in range(len(all_ids)):
        subset = all_ids[:i] + all_ids[i + 1 :]  # looser
        frac_loose = len(confirmed_eligible(m, subset)) / total
        months_loose = enrollment_months(frac_loose, a)
        # Looser -> fraction >= -> months <= (or feasible when full was not).
        if months_full is None:
            continue  # full was infeasible (frac 0); any looser is <= inf
        if months_loose is None:
            # looser infeasible only if frac_loose==0, but frac_loose>=frac_full
            assert frac_full == 0
            continue
        assert months_loose <= months_full + 1e-9


# --- P6: missing data is never counted as meeting -----------------------------


@slow
@given(rule=numeric_rules())
def test_p6_missing_data_never_meets(rule):
    # Patient has no data for the rule's field at all.
    p = Patient(id="p", fields={}, units_={})
    assert evaluate(rule, p) == Verdict.UNKNOWN
    assert evaluate(rule, p) != Verdict.MEETS


@slow
@given(
    rule_list=st.lists(numeric_rules(), min_size=1, max_size=4),
    pts=st.lists(patients(), min_size=1, max_size=40),
)
def test_p6_confirmed_eligible_excludes_missing(rule_list, pts):
    for i, r in enumerate(rule_list):
        r.id = f"r{i}"
    for i, p in enumerate(pts):
        p.id = f"p{i}"
    m = VerdictMatrix.build(rule_list, pts)
    all_ids = [r.id for r in rule_list]
    conf = confirmed_eligible(m, all_ids)
    poss = possibly_eligible(m, all_ids)
    # Anyone confirmed must be MEETS (not UNKNOWN) on every active rule.
    for pid in conf:
        for rid in all_ids:
            assert pid in m.meets[rid]
    # Confirmed is always a subset of possibly.
    assert conf <= poss


# =============================================================================
# v2 correctness properties
# =============================================================================

from dryrun import units as units_mod  # noqa: E402


def _loosen(rule: Rule, step: float) -> Rule:
    """Return a copy of a numeric inclusion rule loosened by one step."""
    if rule.operator in {Operator.GTE, Operator.GT}:
        return rule.model_copy(update={"value": rule.value - step})
    if rule.operator in {Operator.LTE, Operator.LT}:
        return rule.model_copy(update={"value": rule.value + step})
    # between: widen both ends
    lo, hi = rule.value
    return rule.model_copy(update={"value": [lo - step, hi + step]})


# --- v2 Task 3: moving a slider toward loosening never lowers confirmed -------


BOUNDED_FIELDS = sorted(units_mod.FIELD_BOUNDS)


@st.composite
def bounded_numeric_rule(draw):
    field = draw(st.sampled_from(BOUNDED_FIELDS))
    b = units_mod.FIELD_BOUNDS[field]
    op = draw(st.sampled_from([Operator.GTE, Operator.GT, Operator.LTE, Operator.LT]))
    value = draw(
        st.floats(min_value=b["min"], max_value=b["max"], allow_nan=False)
    )
    return Rule(id="r0", field=field, operator=op, value=value,
                unit=units_mod.canonical_unit(field), source_sentence="s")


@slow
@given(
    rule=bounded_numeric_rule(),
    pts=st.lists(patients(), min_size=1, max_size=40),
)
def test_v2_slider_loosening_never_decreases_confirmed(rule, pts):
    for i, p in enumerate(pts):
        p.id = f"p{i}"
    b = units_mod.FIELD_BOUNDS[rule.field]
    loose = _loosen(rule, b["step"])
    m_before = VerdictMatrix.build([rule], pts)
    m_after = VerdictMatrix.build([loose], pts)
    assert len(confirmed_eligible(m_after, ["r0"])) >= len(
        confirmed_eligible(m_before, ["r0"])
    )


# --- v2 Task 4: restoring original thresholds reproduces original counts ------


@slow
@given(
    rule_list=st.lists(bounded_numeric_rule(), min_size=1, max_size=4),
    pts=st.lists(patients(), min_size=1, max_size=40),
)
def test_v2_reset_reproduces_original_counts(rule_list, pts):
    for i, r in enumerate(rule_list):
        r.id = f"r{i}"
    for i, p in enumerate(pts):
        p.id = f"p{i}"
    original = [r.model_copy(deep=True) for r in rule_list]
    ids = [r.id for r in rule_list]

    m0 = VerdictMatrix.build(rule_list, pts)
    baseline = len(confirmed_eligible(m0, ids))

    # Edit every threshold (loosen), then restore the originals exactly.
    edited = [_loosen(r, units_mod.FIELD_BOUNDS[r.field]["step"] * 3) for r in rule_list]
    VerdictMatrix.build(edited, pts)  # simulate an interim analysis
    restored = [r.model_copy(deep=True) for r in original]
    m2 = VerdictMatrix.build(restored, pts)
    assert len(confirmed_eligible(m2, ids)) == baseline


# --- v2 Task 8: Kleene any_of / all_of monotonicity + all-unknown -------------

from dryrun.model import Logic  # noqa: E402
from dryrun.engine import evaluate as _evaluate  # noqa: E402


def _meets_set(rule, pts):
    return {p.id for p in pts if _evaluate(rule, p) is Verdict.MEETS}


@slow
@given(
    children=st.lists(numeric_rules(), min_size=1, max_size=4),
    extra=numeric_rules(),
    pts=st.lists(patients(), min_size=1, max_size=30),
)
def test_v2_any_of_adding_child_never_shrinks_meets(children, extra, pts):
    for i, c in enumerate(children):
        c.id = f"c{i}"
        c.kind = Kind.INCLUSION
    extra.id = "extra"
    extra.kind = Kind.INCLUSION
    for i, p in enumerate(pts):
        p.id = f"p{i}"
    before = Rule(id="any", logic=Logic.ANY_OF, children=children)
    after = Rule(id="any", logic=Logic.ANY_OF, children=children + [extra])
    assert _meets_set(before, pts) <= _meets_set(after, pts)


@slow
@given(
    children=st.lists(numeric_rules(), min_size=1, max_size=4),
    extra=numeric_rules(),
    pts=st.lists(patients(), min_size=1, max_size=30),
)
def test_v2_all_of_adding_child_never_grows_meets(children, extra, pts):
    for i, c in enumerate(children):
        c.id = f"c{i}"
        c.kind = Kind.INCLUSION
    extra.id = "extra"
    extra.kind = Kind.INCLUSION
    for i, p in enumerate(pts):
        p.id = f"p{i}"
    before = Rule(id="all", logic=Logic.ALL_OF, children=children)
    after = Rule(id="all", logic=Logic.ALL_OF, children=children + [extra])
    assert _meets_set(after, pts) <= _meets_set(before, pts)


@slow
@given(
    logic=st.sampled_from([Logic.ANY_OF, Logic.ALL_OF]),
    n=st.integers(min_value=1, max_value=4),
)
def test_v2_all_unknown_children_is_unknown(logic, n):
    # Children all reference a field the patient lacks -> all UNKNOWN.
    children = [
        Rule(id=f"c{i}", field="hba1c", operator=Operator.GTE, value=7.0,
             unit="percent")
        for i in range(n)
    ]
    rule = Rule(id="cmp", logic=logic, children=children)
    p = Patient(id="p", fields={}, units_={})  # no data at all
    assert _evaluate(rule, p) == Verdict.UNKNOWN


# --- v2 Task 9: not-evaluable criteria never change a count -------------------


@slow
@given(
    rule_list=st.lists(numeric_rules(), min_size=1, max_size=4),
    extra=numeric_rules(),
    pts=st.lists(patients(), min_size=1, max_size=30),
)
def test_v2_not_evaluable_never_changes_counts(rule_list, extra, pts):
    for i, r in enumerate(rule_list):
        r.id = f"r{i}"
    for i, p in enumerate(pts):
        p.id = f"p{i}"
    # A not-evaluable rule with any field/operator must not affect counts.
    extra.id = "uneval"
    extra.evaluable = False
    extra.unevaluable_reason = "test"

    ids = [r.id for r in rule_list]
    with_uneval = rule_list + [extra]
    # The matrix must omit the not-evaluable rule from active ids entirely.
    active = [r.id for r in with_uneval if r.evaluable]
    m1 = VerdictMatrix.build(rule_list, pts)
    m2 = VerdictMatrix.build(with_uneval, pts)
    assert len(confirmed_eligible(m1, ids)) == len(confirmed_eligible(m2, active))
    assert len(possibly_eligible(m1, ids)) == len(possibly_eligible(m2, active))
