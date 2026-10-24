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


def _demo_deltas(whole: dict, subset: dict) -> dict:
    """Demographic deltas of an excluded subset vs the whole cohort."""
    out: dict = {}
    if whole.get("mean_age") is not None and subset.get("mean_age") is not None:
        out["mean_age_delta"] = round(subset["mean_age"] - whole["mean_age"], 1)
    for dim in ("sex", "race"):
        wtot = sum(whole.get(dim, {}).values()) or 1
        stot = sum(subset.get(dim, {}).values()) or 1
        deltas = {}
        keys = set(whole.get(dim, {})) | set(subset.get(dim, {}))
        for k in keys:
            wpct = whole.get(dim, {}).get(k, 0) / wtot
            spct = subset.get(dim, {}).get(k, 0) / stot
            deltas[k] = round((spct - wpct) * 100, 1)  # percentage points
        out[dim] = deltas
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
    whole_demo = store.demographics(None)
    tags = []
    for rid in active_ids:
        others = [x for x in active_ids if x != rid]
        base = confirmed_eligible(matrix, others)  # passes everything else
        excluded = base & matrix.fails[rid]
        unknown_here = base & matrix.unknown[rid]
        kept = base & matrix.meets[rid]
        excl_demo = store.demographics(sorted(excluded)) if excluded else {
            "n": 0, "mean_age": None, "sex": {}, "race": {}
        }
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
                "excluded_demographics": excl_demo,
                "demographic_deltas": _demo_deltas(whole_demo, excl_demo),
            }
        )
    return tags


def analyze(
    rules: list[Rule],
    matrix: VerdictMatrix,
    active_ids: list[str],
    store: PatientStore,
) -> dict:
    conf = confirmed_eligible(matrix, active_ids)
    poss = possibly_eligible(matrix, active_ids)
    total = len(matrix.all_ids)
    return {
        "total_patients": total,
        "confirmed_eligible": len(conf),
        "possibly_eligible": len(poss),
        "confirmed_fraction": round(len(conf) / total, 4) if total else 0.0,
        "possibly_fraction": round(len(poss) / total, 4) if total else 0.0,
        "funnel": funnel(matrix, active_ids),
        "price_tags": price_tags(rules, matrix, active_ids, store),
    }
