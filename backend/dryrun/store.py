"""DuckDB-backed patient store.

Loads the generated CSV into DuckDB (for fast demographic aggregation) and
materializes engine `Patient` objects. The CSV stores every numeric field in
its canonical unit, so patient `units_` are set to the canonical unit per
field. Empty cells become missing data (absent from the Patient.fields dict).
"""

from __future__ import annotations

import threading
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
        # DuckDB connections are not safe to use concurrently. A single
        # connection is shared across FastAPI's threadpool, so every call that
        # touches it must hold this lock to avoid "connection is busy" errors
        # and cross-request row bleed.
        self._lock = threading.Lock()
        self._con = duckdb.connect(database=":memory:")
        self._con.execute(
            "CREATE TABLE patients AS SELECT * FROM read_csv_auto(?, header=true, "
            "all_varchar=true)",
            [str(self.csv_path)],
        )
        self._patients: list[Patient] | None = None
        # id -> (age, sex) index, built once from the materialized patients and
        # used to compute subset demographics in Python (no per-request query).
        self._demo_index: dict[str, tuple[float | None, str | None]] | None = None
        self._areas: dict[str, str] | None = None

    def count(self) -> int:
        with self._lock:
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
            with self._lock:
                if self._patients is None:  # double-checked under the lock
                    cols = self._con.execute("SELECT * FROM patients").fetchall()
                    names = [d[0] for d in self._con.description]
                    self._patients = [
                        self._row_to_patient(dict(zip(names, r))) for r in cols
                    ]
        return self._patients

    def areas(self) -> dict[str, str]:
        """id -> modeled home area (the CSV's `area` column, see geo.py).

        Never part of a Patient, so no rule can read it. A CSV without the
        column gets the same deterministic assignment computed in memory.
        """
        if self._areas is None:
            with self._lock:
                cols = [r[0] for r in self._con.execute("DESCRIBE patients").fetchall()]
                rows = (
                    self._con.execute("SELECT id, area FROM patients").fetchall()
                    if "area" in cols
                    else None
                )
            if rows is None:
                from . import geo

                self._areas = geo.patient_areas(self.patients())
            else:
                self._areas = dict(rows)
        return self._areas

    def _demo_lookup(self) -> dict[str, tuple[float | None, str | None]]:
        """Return (and lazily build) the id -> (age, sex) index.

        Built once from the materialized patients so subset demographics are
        computed in pure Python, with no per-request DuckDB query.
        """
        if self._demo_index is None:
            index: dict[str, tuple[float | None, str | None]] = {}
            for p in self.patients():
                age = p.fields.get("age")
                sex = p.fields.get("sex")
                index[p.id] = (age, sex)
            self._demo_index = index
        return self._demo_index

    def demographics(self, patient_ids: list[str] | None = None) -> dict:
        """Aggregate demographics for the whole population or a subset.

        Returns n, mean age (rounded to 1 decimal), and the sex breakdown.
        Race is intentionally not returned (no race deltas on generated data).

        For a subset (``patient_ids`` not None) this is computed in pure Python
        from an id -> (age, sex) index, so it issues no DuckDB query and is safe
        under concurrency. The whole-population path still uses DuckDB but holds
        the connection lock.
        """
        if patient_ids is None:
            with self._lock:
                n = self._con.execute(
                    "SELECT COUNT(*) FROM patients"
                ).fetchone()[0]
                mean_age = self._con.execute(
                    "SELECT AVG(TRY_CAST(age AS DOUBLE)) FROM patients"
                ).fetchone()[0]
                sex_rows = self._con.execute(
                    "SELECT sex, COUNT(*) FROM patients GROUP BY sex"
                ).fetchall()
            return {
                "n": n,
                "mean_age": round(mean_age, 1) if mean_age is not None else None,
                "sex": {k: v for k, v in sex_rows},
            }

        if not patient_ids:
            return {"n": 0, "mean_age": None, "sex": {}}

        # Subset: compute from the Python index (no DuckDB query).
        index = self._demo_lookup()
        n = 0
        age_sum = 0.0
        age_count = 0
        sex_counts: dict[str, int] = {}
        for pid in patient_ids:
            entry = index.get(pid)
            if entry is None:
                continue
            n += 1
            age, sex = entry
            if age is not None:
                age_sum += float(age)
                age_count += 1
            if sex:
                sex_counts[sex] = sex_counts.get(sex, 0) + 1
        mean_age = round(age_sum / age_count, 1) if age_count else None
        return {"n": n, "mean_age": mean_age, "sex": sex_counts}


@lru_cache(maxsize=1)
def get_store() -> PatientStore:
    return PatientStore()
