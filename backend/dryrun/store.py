"""DuckDB-backed patient store.

Loads the generated CSV into DuckDB (for fast demographic aggregation) and
materializes engine `Patient` objects. The CSV stores every numeric field in
its canonical unit, so patient `units_` are set to the canonical unit per
field. Empty cells become missing data (absent from the Patient.fields dict).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import duckdb

from . import units
from .model import Patient

NUMERIC_FIELDS = [
    "age",
    "hba1c",
    "bmi",
    "egfr",
    "weight",
    "systolic_bp",
    "fasting_glucose",
    "creatinine",
]
CATEGORICAL_SINGLE = ["sex", "race"]
MULTI_FIELDS = ["conditions", "medications"]

DEFAULT_CSV = Path(__file__).resolve().parent.parent / "data" / "patients.csv"


class PatientStore:
    def __init__(self, csv_path: str | Path = DEFAULT_CSV):
        self.csv_path = Path(csv_path)
        self._con = duckdb.connect(database=":memory:")
        self._con.execute(
            "CREATE TABLE patients AS SELECT * FROM read_csv_auto(?, header=true, "
            "all_varchar=true)",
            [str(self.csv_path)],
        )
        self._patients: list[Patient] | None = None

    def count(self) -> int:
        return self._con.execute("SELECT COUNT(*) FROM patients").fetchone()[0]

    def _row_to_patient(self, row: dict) -> Patient:
        fields: dict = {}
        units_: dict = {}
        for f in NUMERIC_FIELDS:
            raw = row.get(f)
            if raw is None or raw == "":
                continue  # missing -> absent -> UNKNOWN downstream
            fields[f] = float(raw)
            units_[f] = units.canonical_unit(f)
        for f in CATEGORICAL_SINGLE:
            raw = row.get(f)
            if raw:
                fields[f] = str(raw).strip().lower()
                units_[f] = None
        for f in MULTI_FIELDS:
            raw = row.get(f)
            vals = [v.strip().lower() for v in str(raw).split(";") if v.strip()] if raw else []
            fields[f] = vals
            units_[f] = None
        return Patient(id=row["id"], fields=fields, units_=units_)

    def patients(self) -> list[Patient]:
        if self._patients is None:
            cols = self._con.execute("SELECT * FROM patients").fetchall()
            names = [d[0] for d in self._con.description]
            self._patients = [
                self._row_to_patient(dict(zip(names, r))) for r in cols
            ]
        return self._patients

    def demographics(self, patient_ids: list[str] | None = None) -> dict:
        """Aggregate demographics for the whole population or a subset.

        Returns mean age, sex breakdown, and race breakdown.
        """
        if patient_ids is None:
            where = ""
            params: list = []
        elif not patient_ids:
            return {"n": 0, "mean_age": None, "sex": {}, "race": {}}
        else:
            placeholders = ",".join("?" for _ in patient_ids)
            where = f"WHERE id IN ({placeholders})"
            params = patient_ids

        n = self._con.execute(
            f"SELECT COUNT(*) FROM patients {where}", params
        ).fetchone()[0]
        mean_age = self._con.execute(
            f"SELECT AVG(TRY_CAST(age AS DOUBLE)) FROM patients {where}", params
        ).fetchone()[0]
        sex_rows = self._con.execute(
            f"SELECT sex, COUNT(*) FROM patients {where} GROUP BY sex", params
        ).fetchall()
        race_rows = self._con.execute(
            f"SELECT race, COUNT(*) FROM patients {where} GROUP BY race", params
        ).fetchall()
        return {
            "n": n,
            "mean_age": round(mean_age, 1) if mean_age is not None else None,
            "sex": {k: v for k, v in sex_rows},
            "race": {k: v for k, v in race_rows},
        }


@lru_cache(maxsize=1)
def get_store() -> PatientStore:
    return PatientStore()
