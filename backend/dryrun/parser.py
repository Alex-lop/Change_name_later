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


def _key(sentence: str, kind: str = "inclusion") -> str:
    """Cache key for a parsed sentence, scoped by its section (kind).

    Including the kind means the same sentence appearing under an Inclusion vs
    an Exclusion header is cached (and re-parsed) separately, so a fetched
    protocol never stores a sentence as the wrong kind.
    """
    raw = f"{kind}\n{sentence.strip()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


class LLMBackend(Protocol):
    def translate(self, sentence: str, kind: str = "inclusion") -> dict:
        """Return a dict of Rule kwargs (without source_sentence)."""
        ...


class ParseCache:
    def __init__(self, path: str | Path = CACHE_PATH):
        self.path = Path(path)
        self._data: dict[str, dict] = {}
        if self.path.exists():
            self._data = json.loads(self.path.read_text())

    def get(self, sentence: str, kind: str = "inclusion") -> dict | None:
        return self._data.get(_key(sentence, kind))

    def put(self, sentence: str, rule_kwargs: dict, kind: str | None = None) -> None:
        # Default the key's kind to the rule's own kind so a cached rule is
        # retrieved under the section it belongs to.
        k = kind or rule_kwargs.get("kind", "inclusion")
        self._data[_key(sentence, k)] = rule_kwargs
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

    def parse_sentence(
        self, sentence: str, rule_id: str, kind: str = "inclusion"
    ) -> Rule:
        sentence = sentence.strip()
        cached = self.cache.get(sentence, kind)
        if cached is not None:
            return Rule(id=rule_id, source_sentence=sentence, **cached)
        if self.backend is None:
            raise LookupError(
                f"Sentence not in cache and no LLM backend configured: {sentence!r}"
            )
        kwargs = self.backend.translate(sentence, kind)
        # Validate against the Rule schema BEFORE caching. If the backend's
        # output is invalid, this raises and nothing is cached or returned:
        # an invalid response never becomes a (guessed) rule.
        rule = Rule(id=rule_id, source_sentence=sentence, **kwargs)
        self.cache.put(sentence, kwargs, kind)
        return rule

    def parse_criteria(
        self, sentences: list[str], prefix: str = "r", kind: str = "inclusion"
    ) -> list[Rule]:
        rules = []
        for i, s in enumerate(sentences):
            if not s.strip():
                continue
            rules.append(self.parse_sentence(s, rule_id=f"{prefix}{i}", kind=kind))
        return rules

    def parse_sections(
        self, sections: list[tuple[str, str]], prefix: str = "r"
    ) -> list[Rule]:
        """Parse (sentence, kind) pairs as produced by split_criteria."""
        rules = []
        for i, (s, kind) in enumerate(sections):
            if not s.strip():
                continue
            rules.append(self.parse_sentence(s, rule_id=f"{prefix}{i}", kind=kind))
        return rules


# --- ClinicalTrials.gov API v2 -------------------------------------------------

CTGOV_V2 = "https://clinicaltrials.gov/api/v2/studies/{nct}"


def fetch_ctgov_study(
    nct_id: str, client: httpx.Client | None = None
) -> tuple[str, dict]:
    """Fetch an NCT ID once (API v2): (raw eligibility text, trial meta)."""
    nct = nct_id.strip().upper()
    owns = client is None
    client = client or httpx.Client(timeout=20.0)
    try:
        resp = client.get(CTGOV_V2.format(nct=nct), params={"format": "json"})
        resp.raise_for_status()
        data = resp.json()
    finally:
        if owns:
            client.close()
    ps = data.get("protocolSection", {})
    ident = ps.get("identificationModule", {})
    brief = ident.get("briefTitle") or nct
    acronym = ident.get("acronym")
    meta = {
        "nct_id": ident.get("nctId") or nct,
        # Some brief titles already lead with the acronym ("STEP 1: ...").
        "title": brief if not acronym or brief.startswith(acronym)
        else f"{acronym}: {brief}",
        "condition": ", ".join(ps.get("conditionsModule", {}).get("conditions", [])),
        "paraphrased": False,  # sentences are ClinicalTrials.gov's own text
        "source": "ctgov",
    }
    elig = ps.get("eligibilityModule", {}).get("eligibilityCriteria", "")
    return elig, meta


def fetch_ctgov_eligibility(nct_id: str, client: httpx.Client | None = None) -> str:
    """Fetch the raw eligibility criteria text for an NCT ID (API v2)."""
    return fetch_ctgov_study(nct_id, client)[0]


def split_criteria(text: str) -> list[tuple[str, str]]:
    """Split a raw eligibility block into (sentence, kind) pairs.

    Tracks which section each sentence came from: lines after an
    "Inclusion Criteria" header are ``inclusion``; lines after an
    "Exclusion Criteria" header are ``exclusion``. The section is returned as
    the rule kind so a fetched protocol is never stored as the wrong kind.
    Section header lines themselves are dropped.
    """
    out: list[tuple[str, str]] = []
    current = "inclusion"  # default before any header
    for raw in text.replace("\r", "\n").split("\n"):
        s = raw.strip().lstrip("-*•").strip()
        if not s:
            continue
        low = s.lower().rstrip(":")
        if "inclusion criteria" in low and len(low) <= len("key inclusion criteria"):
            current = "inclusion"
            continue
        if "exclusion criteria" in low and len(low) <= len("key exclusion criteria"):
            current = "exclusion"
            continue
        out.append((s, current))
    return out
