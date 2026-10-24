"""Core domain model: structured rules, verdicts, patients.

Serialization note: Rule is a pydantic model, so `Rule(**rule.model_dump())`
is an exact round-trip. The round-trip property test exercises this.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator

from . import units


class Verdict(str, Enum):
    MEETS = "meets"
    FAILS = "fails"
    UNKNOWN = "unknown"


class Operator(str, Enum):
    # numeric comparisons
    GTE = ">="
    GT = ">"
    LTE = "<="
    LT = "<"
    EQ = "=="
    NEQ = "!="
    BETWEEN = "between"  # value is [low, high] inclusive
    # categorical / presence
    IN = "in"          # value is a list of allowed strings
    NOT_IN = "not_in"  # value is a list of disallowed strings
    HAS = "has"        # field is a set/list membership; value is a string/list
    NOT_HAS = "not_has"


NUMERIC_OPERATORS = {
    Operator.GTE,
    Operator.GT,
    Operator.LTE,
    Operator.LT,
    Operator.EQ,
    Operator.NEQ,
    Operator.BETWEEN,
}


class Kind(str, Enum):
    INCLUSION = "inclusion"
    EXCLUSION = "exclusion"


class Logic(str, Enum):
    ANY_OF = "any_of"  # Kleene OR
    ALL_OF = "all_of"  # Kleene AND


class Rule(BaseModel):
    """A single structured eligibility criterion.

    A rule is either a LEAF (has `field`/`operator`/`value`) or a COMPOUND rule
    (has `logic` and `children`). Compound rules combine child verdicts with
    Kleene logic in the engine.

    - `field` is a canonical patient field name (e.g. "hba1c", "age",
      "conditions", "sex").
    - `operator` is how the field relates to `value`.
    - `value` may be a number, a [low, high] pair, or a list of strings.
    - `unit` is the unit `value` is expressed in (for numeric fields).
    - `source_sentence` is the exact text the LLM translated. Never inferred.
    - `kind` marks inclusion vs exclusion; the engine flips exclusion verdicts
      so that "meets" always means "this criterion is satisfied / patient kept".
    - `logic` + `children` make a compound rule (any_of / all_of).
    - `evaluable` false means the data cannot decide this criterion; it is
      omitted from counts and shown with `unevaluable_reason`.
    """

    id: str
    field: str = ""
    operator: Operator | None = None
    value: Any = None
    unit: str | None = None
    kind: Kind = Kind.INCLUSION
    source_sentence: str = ""
    label: str = ""
    added: bool = False  # True for criteria added by hand in the UI
    logic: Logic | None = None
    children: list["Rule"] = Field(default_factory=list)
    evaluable: bool = True
    unevaluable_reason: str = ""

    @field_validator("field")
    @classmethod
    def _norm_field(cls, v: str) -> str:
        return v.strip().lower()

    @property
    def is_compound(self) -> bool:
        return self.logic is not None

    def canonical_value(self) -> Any:
        """Return `value` converted to the field's canonical unit.

        Only applies to numeric operators. Categorical values pass through.
        """
        if self.operator not in NUMERIC_OPERATORS:
            return self.value
        if self.operator is Operator.BETWEEN:
            low, high = self.value
            return [
                units.to_canonical(self.field, float(low), self.unit),
                units.to_canonical(self.field, float(high), self.unit),
            ]
        return units.to_canonical(self.field, float(self.value), self.unit)


class Patient(BaseModel):
    """A patient record. `fields` maps canonical field name -> (value, unit).

    A missing key means the datum is absent -> any rule on it is UNKNOWN.
    Numeric values carry their source unit so the engine can normalize.
    Categorical fields (sex, conditions, medications) carry unit=None.
    """

    id: str
    fields: dict[str, Any] = Field(default_factory=dict)
    units_: dict[str, str | None] = Field(default_factory=dict)

    def get(self, field: str) -> tuple[Any, str | None] | None:
        if field not in self.fields:
            return None
        return self.fields[field], self.units_.get(field)
