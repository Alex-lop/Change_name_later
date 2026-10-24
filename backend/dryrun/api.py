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

from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import parser as parser_mod
from . import synthea
from . import units
from .analysis import VerdictMatrix, analyze
from .cost import Assumptions, cost_model
from .model import Rule
from .seed import load_registry
from .store import DEFAULT_CSV, get_store

app = FastAPI(title="Dry Run", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_parser = parser_mod.RuleParser()

# Built frontend (vite) output, served in production. Optional in dev.
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


@app.on_event("startup")
def _ensure_population() -> None:
    """Generate the synthetic population CSV at startup if it is missing.

    Keeps deployment one-step: the container does not need a separate data
    generation stage. The seed is fixed so the population is reproducible.
    """
    csv_path = Path(DEFAULT_CSV)
    if not csv_path.exists():
        pop = synthea.generate_population()  # all adults with type 2 diabetes
        synthea.write_csv(pop, csv_path)


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
    sections: list[tuple[str, str]] = []  # (sentence, kind)
    trial_meta: dict | None = None
    source = "text"

    if req.nct_id:
        registry = load_registry()
        key = req.nct_id.strip().upper()
        if key in registry:
            trial_meta = registry[key]
            for c in trial_meta["criteria"]:
                # Registry criteria are {sentence, kind} objects.
                sections.append((c["sentence"], c.get("kind", "inclusion")))
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
            sections = parser_mod.split_criteria(raw)
            source = "ctgov"
    elif req.criteria_text:
        sections = parser_mod.split_criteria(req.criteria_text)
        source = "text"
    else:
        raise HTTPException(
            status_code=400, detail="Provide either nct_id or criteria_text."
        )

    rules: list[Rule] = []
    unparsed: list[str] = []
    for i, (s, kind) in enumerate(sections):
        try:
            rules.append(_parser.parse_sentence(s, rule_id=f"r{i}", kind=kind))
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

    # Not-evaluable rules never change a count: drop them from the active set
    # used for the funnel, confirmed/possibly counts, and price tags. They are
    # still returned so the UI can list them with their reason.
    evaluable_ids = {r.id for r in req.rules if r.evaluable}
    active_ids = [rid for rid in active_ids if rid in evaluable_ids]

    matrix = VerdictMatrix.build(req.rules, patients)
    result = analyze(req.rules, matrix, active_ids, store, patients=patients)

    # Coverage score: evaluable criteria / total criteria across the rule set.
    total_rules = len(req.rules)
    n_evaluable = sum(1 for r in req.rules if r.evaluable)
    result["coverage"] = {
        "evaluable": n_evaluable,
        "total": total_rules,
        "score": round(n_evaluable / total_rules, 4) if total_rules else 0.0,
        "not_evaluable": [
            {
                "rule_id": r.id,
                "label": r.label or r.source_sentence,
                "reason": r.unevaluable_reason,
            }
            for r in req.rules
            if not r.evaluable
        ],
    }

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


# --- static frontend (production) ---------------------------------------------


def mount_frontend(app: FastAPI, dist: Path) -> None:
    """Serve the built Vite app from ``dist`` at ``/`` if it exists.

    Mounted AFTER every API route so it never shadows ``/api/*``. Uses
    Starlette's StaticFiles, which resolves and contains every request path
    inside ``dist`` (rejecting ``..`` / percent-encoded traversal), and with
    ``html=True`` serves ``index.html`` for ``/``. The app has no client-side
    router, so no SPA catch-all fallback is needed.
    """
    if dist.exists():
        app.mount("/", StaticFiles(directory=str(dist), html=True), name="frontend")


mount_frontend(app, FRONTEND_DIST)
