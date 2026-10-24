"""Unit normalization.

Every comparable field has ONE canonical unit. A rule value and a patient
value are both converted to the canonical unit before any comparison is made.
This is what guarantees the "same value in different units -> same verdict"
correctness property: both sides route through the same conversion.

Conversions are expressed as affine transforms to canonical: canonical = a*x + b.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Affine:
    """canonical_value = scale * value + offset."""

    scale: float
    offset: float = 0.0

    def to_canonical(self, value: float) -> float:
        return self.scale * value + self.offset


# Canonical unit per field. The canonical unit is the key's value.
CANONICAL_UNIT: dict[str, str] = {
    "age": "years",
    "hba1c": "percent",          # NGSP %
    "bmi": "kg/m2",
    "egfr": "ml/min/1.73m2",
    "weight": "kg",
    "systolic_bp": "mmhg",
    "fasting_glucose": "mg/dl",
    "creatinine": "mg/dl",
}

# Conversions keyed by (field, from_unit) -> Affine to canonical unit.
# A unit mapping to Affine(1.0, 0.0) is already canonical (identity).
_CONVERSIONS: dict[tuple[str, str], Affine] = {
    # age
    ("age", "years"): Affine(1.0),
    ("age", "year"): Affine(1.0),
    ("age", "yr"): Affine(1.0),
    ("age", "months"): Affine(1.0 / 12.0),
    # HbA1c: IFCC mmol/mol -> NGSP %  via  % = (mmol/mol / 10.929) + 2.15
    ("hba1c", "percent"): Affine(1.0),
    ("hba1c", "%"): Affine(1.0),
    ("hba1c", "mmol/mol"): Affine(1.0 / 10.929, 2.15),
    # BMI
    ("bmi", "kg/m2"): Affine(1.0),
    ("bmi", "kg/m^2"): Affine(1.0),
    # eGFR
    ("egfr", "ml/min/1.73m2"): Affine(1.0),
    ("egfr", "ml/min"): Affine(1.0),
    # weight
    ("weight", "kg"): Affine(1.0),
    ("weight", "g"): Affine(0.001),
    ("weight", "lb"): Affine(0.45359237),
    ("weight", "lbs"): Affine(0.45359237),
    # systolic BP
    ("systolic_bp", "mmhg"): Affine(1.0),
    # fasting glucose: mmol/L -> mg/dL  via  mg/dL = mmol/L * 18.0182
    ("fasting_glucose", "mg/dl"): Affine(1.0),
    ("fasting_glucose", "mmol/l"): Affine(18.0182),
    # creatinine: umol/L -> mg/dL via mg/dL = umol/L / 88.42
    ("creatinine", "mg/dl"): Affine(1.0),
    ("creatinine", "umol/l"): Affine(1.0 / 88.42),
}


class UnitError(ValueError):
    """Raised when a (field, unit) pair has no known conversion."""


def normalize_unit(unit: str | None) -> str | None:
    if unit is None:
        return None
    return unit.strip().lower()


def canonical_unit(field: str) -> str | None:
    return CANONICAL_UNIT.get(field)


def to_canonical(field: str, value: float, unit: str | None) -> float:
    """Convert value (in unit) for field into the field's canonical unit.

    If the field has no canonical unit (e.g. categorical), value is returned
    unchanged. If a unit is given but unknown for the field, raises UnitError.
    """
    canon = CANONICAL_UNIT.get(field)
    if canon is None:
        return value
    u = normalize_unit(unit)
    if u is None:
        # No unit supplied: assume the value is already in canonical unit.
        return value
    conv = _CONVERSIONS.get((field, u))
    if conv is None:
        raise UnitError(f"No conversion for field={field!r} unit={unit!r}")
    return conv.to_canonical(value)


def known_units(field: str) -> list[str]:
    return [u for (f, u) in _CONVERSIONS if f == field]


# Clinical slider bounds per numeric field, in the field's canonical unit.
# Single source of truth shared with the frontend via GET /api/field-bounds.
FIELD_BOUNDS: dict[str, dict[str, float]] = {
    "age": {"min": 18, "max": 90, "step": 1},
    "hba1c": {"min": 5, "max": 12, "step": 0.1},
    "bmi": {"min": 15, "max": 60, "step": 0.5},
    "egfr": {"min": 10, "max": 120, "step": 1},
    "systolic_bp": {"min": 90, "max": 200, "step": 1},
}


def field_bounds(field: str) -> dict[str, float] | None:
    return FIELD_BOUNDS.get(field)
