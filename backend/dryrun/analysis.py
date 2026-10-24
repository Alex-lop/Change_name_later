"""Funnel + cohort analysis.

Eligibility semantics (these directly realize the correctness properties):

- confirmed_eligible: patients whose verdict is MEETS for EVERY active
  criterion. Equivalent to the intersection of each criterion's MEETS set.
  Because it is an intersection, removing a criterion can only ADD patients,
  and the all-criteria count can never exceed any single criterion's MEETS
  count. (Monotonicity + subset-bound properties.)

- possibly_eligible: patients whose verdict is never FAILS for any active
  criterion (every active criterion is MEETS or UNKNOWN). A patient missing
  data is thus possibly- but not confirmed-eligible, and is never counted as
  meeting a rule they lack data for. (Missing-data property.)

A criterion's "price tag" is its MARGINAL effect: among patients who are
confirmed-eligible on all OTHER active criteria, how many does THIS criterion
exclude, and how does that excluded group differ demographically.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .engine import evaluate
from .model import Patient, Rule, Verdict
from .store import PatientStore


@dataclass
class VerdictMatrix:
    """Dense verdict lookup: rule_id -> {MEETS ids, FAILS ids, UNKNOWN ids}."""

    meets: dict[str, set[str]] = field(default_factory=dict)
    fails: dict[str, set[str]] = field(default_factory=dict)
    unknown: dict[str, set[str]] = field(default_factory=dict)
    all_ids: set[str] = field(default_factory=set)

    @classmethod
    def build(cls, rules: list[Rule], patients: list[Patient]) -> "VerdictMatrix":
        m = cls()
        m.all_ids = {p.id for p in patients}
        for r in rules:
            meets, fails, unknown = set(), set(), set()
            for p in patients:
                v = evaluate(r, p)
                if v is Verdict.MEETS:
                    meets.add(p.id)
                elif v is Verdict.FAILS:
                    fails.add(p.id)
                else:
                    unknown.add(p.id)
            m.meets[r.id] = meets
            m.fails[r.id] = fails
            m.unknown[r.id] = unknown
        return m

    def not_fails(self, rule_id: str) -> set[str]:
        """Ids that are MEETS or UNKNOWN for this rule."""
        return self.all_ids - self.fails[rule_id]


def confirmed_eligible(matrix: VerdictMatrix, active_ids: list[str]) -> set[str]:
    if not active_ids:
        return set(matrix.all_ids)
    result = set(matrix.all_ids)
    for rid in active_ids:
        result &= matrix.meets[rid]
    return result


def possibly_eligible(matrix: VerdictMatrix, active_ids: list[str]) -> set[str]:
    if not active_ids:
        return set(matrix.all_ids)
    result = set(matrix.all_ids)
    for rid in active_ids:
        result &= matrix.not_fails(rid)
    return result


def funnel(matrix: VerdictMatrix, active_ids: list[str]) -> list[dict]:
    """Step-by-step confirmed-eligible counts as each criterion is applied.

    Returns an ordered list of {rule_id, remaining} showing the funnel.
    """
    steps = []
    running = set(matrix.all_ids)
    steps.append({"rule_id": None, "label": "All patients", "remaining": len(running)})
    for rid in active_ids:
        running &= matrix.meets[rid]
        steps.append({"rule_id": rid, "remaining": len(running)})
    return steps


def _demo_deltas(reference: dict, subset: dict) -> dict:
    """Demographic deltas of an excluded subset vs its reference cohort.

    The reference is the cohort the criterion acts on (patients passing every
    other active criterion), NOT the whole population, so a small excluded
    group cannot masquerade as a population-level disparity.

    Age and sex only. Race deltas are intentionally omitted on generated data.
    """
    out: dict = {}
    if reference.get("mean_age") is not None and subset.get("mean_age") is not None:
        out["mean_age_delta"] = round(subset["mean_age"] - reference["mean_age"], 1)
    # Sex only. (No race deltas on generated data.)
    wtot = sum(reference.get("sex", {}).values()) or 1
    stot = sum(subset.get("sex", {}).values()) or 1
    deltas = {}
    keys = set(reference.get("sex", {})) | set(subset.get("sex", {}))
    for k in keys:
        wpct = reference.get("sex", {}).get(k, 0) / wtot
        spct = subset.get("sex", {}).get(k, 0) / stot
        deltas[k] = round((spct - wpct) * 100, 1)  # percentage points
    out["sex"] = deltas
    return out


def price_tags(
    rules: list[Rule],
    matrix: VerdictMatrix,
    active_ids: list[str],
    store: PatientStore,
) -> list[dict]:
    """Per-criterion marginal price tag.

    For each active criterion, compute the cohort that is confirmed-eligible on
    all OTHER active criteria, then measure how many this criterion excludes
    (verdict FAILS) and how that excluded group differs demographically.
    """
    rules_by_id = {r.id: r for r in rules}
    tags = []
    MIN_GROUP = 30  # hide demographic deltas for excluded groups smaller than this
    for rid in active_ids:
        others = [x for x in active_ids if x != rid]
        base = confirmed_eligible(matrix, others)  # passes everything else
        excluded = base & matrix.fails[rid]
        unknown_here = base & matrix.unknown[rid]
        kept = base & matrix.meets[rid]
        excl_demo = store.demographics(sorted(excluded)) if excluded else {
            "n": 0, "mean_age": None, "sex": {}, "race": {}
        }
        # Compare the excluded group against the cohort the criterion acts on
        # (the base cohort), not the whole population. Hide deltas for small
        # excluded groups so noise cannot look like a disparity finding.
        if len(excluded) >= MIN_GROUP:
            base_demo = store.demographics(sorted(base)) if base else {
                "n": 0, "mean_age": None, "sex": {}, "race": {}
            }
            demographic_deltas = _demo_deltas(base_demo, excl_demo)
        else:
            demographic_deltas = None
        r = rules_by_id[rid]
        tags.append(
            {
                "rule_id": rid,
                "label": r.label or r.source_sentence,
                "source_sentence": r.source_sentence,
                "field": r.field,
                "kind": r.kind.value,
                "base_cohort": len(base),
                "excluded": len(excluded),
                "unknown": len(unknown_here),
                "kept": len(kept),
                "excluded_fraction": round(len(excluded) / len(base), 4)
                if base
                else 0.0,
                "demographic_deltas": demographic_deltas,
            }
        )
    return tags


def patient_codes(
    matrix: VerdictMatrix,
    active_ids: list[str],
    patients: list[Patient],
) -> list[int]:
    """One small integer per patient, in a stable age-sorted order.

    The order is: age ascending (youngest first), patients with missing age
    last, ties broken by patient id. The visual field renders marks in exactly
    this order, so an age threshold sweeps visibly across the field.

    Code meaning, relative to the ACTIVE criteria (`active_ids`, already the
    evaluable ones in the API):

      -2  eligible            MEETS every active criterion
      -1  possibly eligible   no active criterion FAILS, but >= 1 UNKNOWN
      -3  excluded, but not cleanly by a single criterion: either FAILS two or
          more active criteria, or FAILS exactly one while being UNKNOWN on
          another (so it is not in that criterion's price-tag set)
       k  excluded only by active criterion k: MEETS every OTHER active
          criterion and FAILS criterion k, where k is that criterion's index
          into `active_ids`

    Invariant tied to price tags: the number of patients with code k equals
    price tag k's `excluded` count. A price tag counts patients who pass every
    OTHER active criterion (MEETS them) and FAIL this one, which is exactly
    code k.
    """

    def sort_key(p: Patient) -> tuple:
        datum = p.get("age")
        if datum is None or datum[0] is None:
            return (1, 0.0, p.id)  # missing age sorts last, stable by id
        return (0, float(datum[0]), p.id)

    codes: list[int] = []
    for p in sorted(patients, key=sort_key):
        pid = p.id
        # Indices of active criteria this patient FAILS.
        failed = [k for k, rid in enumerate(active_ids) if pid in matrix.fails[rid]]
        if not failed:
            # No fails: eligible if MEETS all active, else possibly (some unknown).
            if all(pid in matrix.meets[rid] for rid in active_ids):
                codes.append(-2)
            else:
                codes.append(-1)
        elif len(failed) == 1:
            k = failed[0]
            # Cleanly attributable only if the patient MEETS every OTHER active
            # criterion (matches price tag k's base cohort). Otherwise -3.
            others = [rid for j, rid in enumerate(active_ids) if j != k]
            if all(pid in matrix.meets[rid] for rid in others):
                codes.append(k)
            else:
                codes.append(-3)
        else:
            codes.append(-3)
    return codes


def analyze(
    rules: list[Rule],
    matrix: VerdictMatrix,
    active_ids: list[str],
    store: PatientStore,
    patients: list[Patient] | None = None,
) -> dict:
    conf = confirmed_eligible(matrix, active_ids)
    poss = possibly_eligible(matrix, active_ids)
    total = len(matrix.all_ids)
    result = {
        "total_patients": total,
        "confirmed_eligible": len(conf),
        "possibly_eligible": len(poss),
        "confirmed_fraction": round(len(conf) / total, 4) if total else 0.0,
        "possibly_fraction": round(len(poss) / total, 4) if total else 0.0,
        "funnel": funnel(matrix, active_ids),
        "price_tags": price_tags(rules, matrix, active_ids, store),
    }
    if patients is not None:
        result["patient_codes"] = patient_codes(matrix, active_ids, patients)
    return result
