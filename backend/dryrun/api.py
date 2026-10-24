"""FastAPI app wiring the Dry Run engine together.

Endpoints:
  GET  /api/health                  -> liveness + population size
  GET  /api/trials                  -> seeded demo trials (offline)
  POST /api/parse                   -> translate criteria text or an NCT ID
                                       into structured rules (cache-first)
  POST /api/analyze                 -> funnel, counts, price tags, cost model
                                       for a set of rules + active toggles

The parser is translate-only. Analysis is fully deterministic. The frontend
holds the parsed rules and re-posts /api/analyze whenever the user toggles a
criterion or edits assumptions.
"""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import parser as parser_mod
from . import synthea
from . import units
from .analysis import VerdictMatrix, analyze
from .cost import Assumptions, cost_model
from .model import Rule
from .seed import load_registry
from .store import get_store

app = FastAPI(title="Dry Run", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_parser = parser_mod.RuleParser()


# --- request/response models ---------------------------------------------------


class ParseRequest(BaseModel):
    nct_id: str | None = None
    criteria_text: str | None = None


class ParseResponse(BaseModel):
    source: str
    trial: dict | None = None
    rules: list[Rule]
    unparsed: list[str] = []


class AnalyzeRequest(BaseModel):
    rules: list[Rule]
    active_rule_ids: list[str] | None = None
    assumptions: dict[str, Any] | None = None


# --- endpoints -----------------------------------------------------------------


@app.get("/api/health")
def health() -> dict:
    store = get_store()
    return {
        "status": "ok",
        "population": store.count(),
        "population_label": synthea.POPULATION_LABEL,
    }


@app.get("/api/trials")
def trials() -> dict:
    return {"trials": list(load_registry().values())}


@app.get("/api/field-bounds")
def field_bounds() -> dict:
    """Clinical slider bounds per numeric field (canonical units)."""
    return {"bounds": units.FIELD_BOUNDS}


@app.post("/api/parse", response_model=ParseResponse)
def parse(req: ParseRequest) -> ParseResponse:
    sentences: list[str] = []
    trial_meta: dict | None = None
    source = "text"

    if req.nct_id:
        registry = load_registry()
        key = req.nct_id.strip().upper()
        if key in registry:
            trial_meta = registry[key]
            sentences = list(trial_meta["criteria"])
            source = "registry"
        else:
            # Not seeded: try a live ClinicalTrials.gov v2 fetch.
            try:
                raw = parser_mod.fetch_ctgov_eligibility(key)
            except (httpx.HTTPError, httpx.InvalidURL) as e:
                raise HTTPException(
                    status_code=502,
                    detail=f"Could not fetch {key} from ClinicalTrials.gov: {e}",
                )
            if not raw:
                raise HTTPException(
                    status_code=404, detail=f"No eligibility criteria for {key}"
                )
            sentences = parser_mod.split_criteria(raw)
            source = "ctgov"
    elif req.criteria_text:
        sentences = parser_mod.split_criteria(req.criteria_text)
        source = "text"
    else:
        raise HTTPException(
            status_code=400, detail="Provide either nct_id or criteria_text."
        )

    rules: list[Rule] = []
    unparsed: list[str] = []
    for i, s in enumerate(sentences):
        try:
            rules.append(_parser.parse_sentence(s, rule_id=f"r{i}"))
        except LookupError:
            # No cached parse and no LLM backend: report it, don't fabricate.
            unparsed.append(s)

    return ParseResponse(
        source=source, trial=trial_meta, rules=rules, unparsed=unparsed
    )


@app.post("/api/analyze")
def analyze_endpoint(req: AnalyzeRequest) -> dict:
    if not req.rules:
        raise HTTPException(status_code=400, detail="No rules provided.")
    store = get_store()
    patients = store.patients()

    active_ids = (
        req.active_rule_ids
        if req.active_rule_ids is not None
        else [r.id for r in req.rules]
    )
    # Only build the matrix for rules we actually have; ignore unknown ids.
    valid_ids = {r.id for r in req.rules}
    active_ids = [rid for rid in active_ids if rid in valid_ids]

    matrix = VerdictMatrix.build(req.rules, patients)
    result = analyze(req.rules, matrix, active_ids, store)

    assumptions = Assumptions.from_dict(req.assumptions)
    frac = result["confirmed_fraction"]
    result["cost"] = cost_model(frac, assumptions)

    # Per-criterion enrollment effect: enrollment time if THIS criterion were
    # removed (looser) -> should never be greater than the all-criteria time.
    per_rule_cost = []
    for rid in active_ids:
        others = [x for x in active_ids if x != rid]
        from .analysis import confirmed_eligible

        conf_without = confirmed_eligible(matrix, others)
        frac_without = len(conf_without) / result["total_patients"] if result[
            "total_patients"
        ] else 0.0
        cm = cost_model(frac_without, assumptions)
        per_rule_cost.append(
            {
                "rule_id": rid,
                "eligible_fraction_without": cm["eligible_fraction"],
                "enrollment_months_without": cm["enrollment_months"],
            }
        )
    result["per_rule_cost"] = per_rule_cost
    result["active_rule_ids"] = active_ids
    result["population_label"] = synthea.POPULATION_LABEL
    return result
