"""Shared Hypothesis strategies for rules and patients."""

from __future__ import annotations

from hypothesis import strategies as st

from dryrun.model import Kind, Operator, Patient, Rule

NUMERIC_FIELDS = ["age", "hba1c", "bmi", "egfr", "weight", "systolic_bp"]
NUMERIC_OPS = [
    Operator.GTE,
    Operator.GT,
    Operator.LTE,
    Operator.LT,
    Operator.BETWEEN,
]

finite = st.floats(
    min_value=-1000, max_value=1000, allow_nan=False, allow_infinity=False
)


@st.composite
def numeric_rules(draw, rule_id: str = "r"):
    field = draw(st.sampled_from(NUMERIC_FIELDS))
    op = draw(st.sampled_from(NUMERIC_OPS))
    kind = draw(st.sampled_from([Kind.INCLUSION, Kind.EXCLUSION]))
    if op is Operator.BETWEEN:
        lo = draw(finite)
        hi = draw(st.floats(min_value=lo, max_value=1000, allow_nan=False))
        value = [lo, hi]
    else:
        value = draw(finite)
    return Rule(
        id=rule_id,
        field=field,
        operator=op,
        value=value,
        unit=None,  # canonical unit assumed; unit-invariance tested separately
        kind=kind,
        source_sentence="generated",
        label="generated",
    )


@st.composite
def patients(draw, pid: str = "p"):
    fields: dict = {}
    units_: dict = {}
    for f in NUMERIC_FIELDS:
        # Each numeric field is present ~70% of the time (exercise missing data).
        if draw(st.booleans()) or draw(st.booleans()):
            fields[f] = draw(finite)
            units_[f] = None  # already canonical
    return Patient(id=pid, fields=fields, units_=units_)
