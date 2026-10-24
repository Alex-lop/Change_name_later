"""LLM rule parser (translate-only) with a cache.

Design contract:
- The LLM ONLY translates a free-text criterion sentence into a structured
  Rule (field, operator, value, unit, kind). It NEVER decides eligibility and
  never sees patient data.
- Every parse is cached keyed by a hash of the exact sentence, so the demo
  runs fully offline. A seed cache ships with three real Phase 3 T2D trials.
- If no LLM backend is configured and a sentence is not cached, parsing raises
  so we never silently fabricate a rule.

The structured output always preserves the exact `source_sentence`.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Callable, Protocol

import httpx

from .model import Rule

CACHE_PATH = Path(__file__).resolve().parent.parent / "data" / "parse_cache.json"


def _key(sentence: str) -> str:
    return hashlib.sha256(sentence.strip().encode("utf-8")).hexdigest()[:16]


class LLMBackend(Protocol):
    def translate(self, sentence: str) -> dict:
        """Return a dict of Rule kwargs (without source_sentence)."""
        ...


class ParseCache:
    def __init__(self, path: str | Path = CACHE_PATH):
        self.path = Path(path)
        self._data: dict[str, dict] = {}
        if self.path.exists():
            self._data = json.loads(self.path.read_text())

    def get(self, sentence: str) -> dict | None:
        return self._data.get(_key(sentence))

    def put(self, sentence: str, rule_kwargs: dict) -> None:
        self._data[_key(sentence)] = rule_kwargs
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self._data, indent=2, sort_keys=True))

    def __len__(self) -> int:
        return len(self._data)


class RuleParser:
    """Translate criterion sentences into Rules, cache-first."""

    def __init__(
        self,
        cache: ParseCache | None = None,
        backend: LLMBackend | None = None,
    ):
        self.cache = cache or ParseCache()
        self.backend = backend

    def parse_sentence(self, sentence: str, rule_id: str) -> Rule:
        sentence = sentence.strip()
        cached = self.cache.get(sentence)
        if cached is not None:
            return Rule(id=rule_id, source_sentence=sentence, **cached)
        if self.backend is None:
            raise LookupError(
                f"Sentence not in cache and no LLM backend configured: {sentence!r}"
            )
        kwargs = self.backend.translate(sentence)
        self.cache.put(sentence, kwargs)
        return Rule(id=rule_id, source_sentence=sentence, **kwargs)

    def parse_criteria(self, sentences: list[str], prefix: str = "r") -> list[Rule]:
        rules = []
        for i, s in enumerate(sentences):
            if not s.strip():
                continue
            rules.append(self.parse_sentence(s, rule_id=f"{prefix}{i}"))
        return rules


# --- ClinicalTrials.gov API v2 -------------------------------------------------

CTGOV_V2 = "https://clinicaltrials.gov/api/v2/studies/{nct}"


def fetch_ctgov_eligibility(nct_id: str, client: httpx.Client | None = None) -> str:
    """Fetch the raw eligibility criteria text for an NCT ID (API v2)."""
    url = CTGOV_V2.format(nct=nct_id.strip().upper())
    owns = client is None
    client = client or httpx.Client(timeout=20.0)
    try:
        resp = client.get(url, params={"format": "json"})
        resp.raise_for_status()
        data = resp.json()
    finally:
        if owns:
            client.close()
    elig = (
        data.get("protocolSection", {})
        .get("eligibilityModule", {})
        .get("eligibilityCriteria", "")
    )
    return elig


def split_criteria(text: str) -> list[str]:
    """Split a raw eligibility block into individual criterion sentences.

    Splits on newlines and leading bullet markers. Keeps non-empty lines that
    look like actual criteria (drops section headers like 'Inclusion Criteria:').
    """
    lines = []
    for raw in text.replace("\r", "\n").split("\n"):
        s = raw.strip().lstrip("-*•").strip()
        if not s:
            continue
        low = s.lower().rstrip(":")
        if low in {"inclusion criteria", "exclusion criteria", "key inclusion criteria", "key exclusion criteria"}:
            continue
        lines.append(s)
    return lines
