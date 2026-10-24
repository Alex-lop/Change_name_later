"""Enrollment + delay cost model. All numbers are ESTIMATES.

Model:
    eligible_fraction = confirmed_eligible / total_patients   (from analysis)
    months = target_enrollment
             / (sites * screened_per_site_per_month
                * eligible_fraction * consent_rate)

    delay cost is measured against a baseline enrollment time (e.g. the time
    with no criteria, or a user-provided target). days_added = (months - base)
    * 30.44; delay_cost = days_added * cost_per_day.

Monotonicity (verified by property test): months is strictly decreasing in
eligible_fraction (holding other assumptions fixed and positive). So loosening
a criterion, which never decreases eligible_fraction, never increases months.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

DAYS_PER_MONTH = 30.4375


@dataclass
class Assumptions:
    target_enrollment: int = 1000
    sites: int = 50
    screened_per_site_per_month: float = 20.0
    consent_rate: float = 0.6
    cost_per_day: float = 40_000.0  # typical late-phase trial burn rate estimate

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict | None) -> "Assumptions":
        if not d:
            return cls()
        allowed = {f for f in cls().to_dict()}
        return cls(**{k: v for k, v in d.items() if k in allowed})


def enrollment_months(eligible_fraction: float, a: Assumptions) -> float | None:
    """Estimated months to reach target enrollment.

    Returns None if enrollment is impossible (fraction or throughput is zero).
    """
    denom = (
        a.sites
        * a.screened_per_site_per_month
        * eligible_fraction
        * a.consent_rate
    )
    if denom <= 0:
        return None
    return a.target_enrollment / denom


def cost_model(
    eligible_fraction: float,
    a: Assumptions,
    baseline_fraction: float | None = None,
) -> dict:
    """Compute enrollment time and delay cost vs a baseline eligible fraction.

    baseline_fraction defaults to 1.0 (everyone eligible = fastest possible),
    so delay reflects the cost of the eligibility criteria as a whole.
    """
    if baseline_fraction is None:
        baseline_fraction = 1.0
    months = enrollment_months(eligible_fraction, a)
    base_months = enrollment_months(baseline_fraction, a)

    if months is None:
        return {
            "eligible_fraction": eligible_fraction,
            "enrollment_months": None,
            "feasible": False,
            "days_added_vs_baseline": None,
            "delay_cost": None,
            "delay_cost_label": "vs. enrolling any adult with type 2 diabetes",
            "assumptions": a.to_dict(),
            "note": "Eligible fraction is zero: enrollment never completes.",
        }

    days_added = None
    delay_cost = None
    if base_months is not None:
        days_added = max(0.0, (months - base_months) * DAYS_PER_MONTH)
        delay_cost = days_added * a.cost_per_day

    return {
        "eligible_fraction": round(eligible_fraction, 4),
        "enrollment_months": round(months, 2),
        "feasible": True,
        "baseline_months": round(base_months, 2) if base_months is not None else None,
        "days_added_vs_baseline": round(days_added, 1) if days_added is not None else None,
        "delay_cost": round(delay_cost, 2) if delay_cost is not None else None,
        "delay_cost_label": "vs. enrolling any adult with type 2 diabetes",
        "assumptions": a.to_dict(),
        "note": "All values are estimates.",
    }
