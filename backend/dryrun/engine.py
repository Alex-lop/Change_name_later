"""Deterministic eligibility engine.

Given a Rule and a Patient, return exactly one Verdict: MEETS, FAILS, UNKNOWN.

Hard invariants (enforced here, verified by property tests):
- If the patient is missing data for the rule's field -> UNKNOWN. Never MEETS.
- Both the rule value and patient value are normalized to canonical units
  before comparison, so equivalent values in different units agree.
- For exclusion rules, the raw predicate is evaluated, then the verdict is
  flipped: a patient who matches an exclusion predicate FAILS the criterion.
  UNKNOWN stays UNKNOWN under flipping.
"""

from __future__ import annotations

from typing import Any

from . import units
from .model import (
    Kind,
    Logic,
    NUMERIC_OPERATORS,
    Operator,
    Patient,
    Rule,
    Verdict,
)


def _as_float(x: Any) -> float | None:
    try:
        if x is None:
            return None
        return float(x)
    except (TypeError, ValueError):
        return None


def _as_str_set(x: Any) -> set[str]:
    if x is None:
        return set()
    if isinstance(x, (list, tuple, set)):
        return {str(v).strip().lower() for v in x}
    return {str(x).strip().lower()}


def _flip(v: Verdict) -> Verdict:
    if v is Verdict.MEETS:
        return Verdict.FAILS
    if v is Verdict.FAILS:
        return Verdict.MEETS
    return Verdict.UNKNOWN


def _eval_numeric(op: Operator, patient_val: float, rule_val: Any) -> Verdict:
    if op is Operator.BETWEEN:
        low, high = rule_val
        return Verdict.MEETS if (low <= patient_val <= high) else Verdict.FAILS
    cmp = {
        Operator.GTE: patient_val >= rule_val,
        Operator.GT: patient_val > rule_val,
        Operator.LTE: patient_val <= rule_val,
        Operator.LT: patient_val < rule_val,
        Operator.EQ: patient_val == rule_val,
        Operator.NEQ: patient_val != rule_val,
    }[op]
    return Verdict.MEETS if cmp else Verdict.FAILS


def _eval_categorical(op: Operator, patient_val: Any, rule_val: Any) -> Verdict:
    pset = _as_str_set(patient_val)
    rset = _as_str_set(rule_val)
    if op is Operator.IN:
        return Verdict.MEETS if (pset & rset) else Verdict.FAILS
    if op is Operator.NOT_IN:
        return Verdict.MEETS if not (pset & rset) else Verdict.FAILS
    if op is Operator.HAS:
        # "has any of" the listed tokens (non-empty intersection). A multi-token
        # value like ["mi", "stroke"] means the patient has MI OR stroke.
        return Verdict.MEETS if (rset & pset) else Verdict.FAILS
    if op is Operator.NOT_HAS:
        return Verdict.MEETS if not (rset & pset) else Verdict.FAILS
    raise ValueError(f"Not a categorical operator: {op}")


def _kleene_any(verdicts: list[Verdict]) -> Verdict:
    """any_of: MEETS if any child meets, FAILS if all fail, else UNKNOWN."""
    if any(v is Verdict.MEETS for v in verdicts):
        return Verdict.MEETS
    if verdicts and all(v is Verdict.FAILS for v in verdicts):
        return Verdict.FAILS
    return Verdict.UNKNOWN


def _kleene_all(verdicts: list[Verdict]) -> Verdict:
    """all_of: FAILS if any child fails, MEETS if all meet, else UNKNOWN."""
    if any(v is Verdict.FAILS for v in verdicts):
        return Verdict.FAILS
    if verdicts and all(v is Verdict.MEETS for v in verdicts):
        return Verdict.MEETS
    return Verdict.UNKNOWN


def _eval_leaf(rule: Rule, patient: Patient) -> Verdict:
    """Evaluate a leaf rule WITHOUT the exclusion flip."""
    datum = patient.get(rule.field)
    if datum is None:
        return Verdict.UNKNOWN
    raw_value, raw_unit = datum
    if rule.operator in NUMERIC_OPERATORS:
        pv = _as_float(raw_value)
        if pv is None:
            return Verdict.UNKNOWN
        patient_canon = units.to_canonical(rule.field, pv, raw_unit)
        rule_canon = rule.canonical_value()
        return _eval_numeric(rule.operator, patient_canon, rule_canon)
    return _eval_categorical(rule.operator, raw_value, rule.value)


def _eval_base(rule: Rule, patient: Patient) -> Verdict:
    """Base verdict (before exclusion flip) for leaf OR compound rules.

    Compound rules combine child verdicts with Kleene logic. A child that is
    marked not-evaluable contributes nothing (it is dropped), so e.g. an
    any_of where one branch cannot be decided still lets the other branch
    decide. Kleene logic guarantees UNKNOWN never silently becomes MEETS.
    """
    if rule.is_compound:
        child_verdicts = [
            _eval_base(child, patient)
            for child in rule.children
            if child.evaluable
        ]
        if rule.logic is Logic.ANY_OF:
            return _kleene_any(child_verdicts)
        return _kleene_all(child_verdicts)
    return _eval_leaf(rule, patient)


def evaluate(rule: Rule, patient: Patient) -> Verdict:
    """Evaluate a single rule (leaf or compound) against a single patient.

    Not-evaluable rules return UNKNOWN; callers (analysis) exclude them from
    counts entirely. The exclusion flip is applied once at the top and leaves
    UNKNOWN unchanged.
    """
    if not rule.evaluable:
        return Verdict.UNKNOWN
    base = _eval_base(rule, patient)
    if rule.kind is Kind.EXCLUSION:
        return _flip(base)
    return base


def evaluate_all(rules: list[Rule], patient: Patient) -> dict[str, Verdict]:
    """Return {rule.id: Verdict} for one patient across all rules."""
    return {r.id: evaluate(r, patient) for r in rules}
