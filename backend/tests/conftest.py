"""Shared pytest fixtures.

The synthetic population CSV is generated from a fixed seed and is normally
created by the FastAPI startup event. Some tests exercise the store directly
(without going through the app), and on a fresh checkout the CSV does not exist
yet. This session-scoped, autouse fixture guarantees it exists once before any
test runs, so the suite is order-independent.
"""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture(scope="session", autouse=True)
def _ensure_population() -> None:
    from dryrun import synthea
    from dryrun.store import DEFAULT_CSV

    if not Path(DEFAULT_CSV).exists():
        synthea.write_csv(synthea.generate_population(), DEFAULT_CSV)
