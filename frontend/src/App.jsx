import React, { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import FunnelChart from "./FunnelChart";
import AssumptionsPanel from "./AssumptionsPanel";
import PriceTags, { fmtMoney } from "./PriceTags";

const DEFAULT_ASSUMPTIONS = {
  target_enrollment: 1000,
  sites: 50,
  screened_per_site_per_month: 20,
  consent_rate: 0.6,
  cost_per_day: 40000,
};

export default function App() {
  const [trials, setTrials] = useState([]);
  const [health, setHealth] = useState(null);
  const [nctId, setNctId] = useState("");
  const [criteriaText, setCriteriaText] = useState("");
  const [rules, setRules] = useState([]);
  const [unparsed, setUnparsed] = useState([]);
  const [activeIds, setActiveIds] = useState([]);
  const [assumptions, setAssumptions] = useState(DEFAULT_ASSUMPTIONS);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const rulesById = useMemo(() => {
    const m = {};
    rules.forEach((r) => (m[r.id] = r));
    return m;
  }, [rules]);

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
    api.trials().then((d) => setTrials(d.trials)).catch(() => {});
  }, []);

  async function loadParse(body) {
    setError(null);
    setLoading(true);
    try {
      const res = await api.parse(body);
      setRules(res.rules);
      setUnparsed(res.unparsed || []);
      setActiveIds(res.rules.map((r) => r.id));
    } catch (e) {
      setError(e.message);
      setRules([]);
      setActiveIds([]);
    } finally {
      setLoading(false);
    }
  }

  // Re-analyze whenever rules, toggles, or assumptions change.
  useEffect(() => {
    if (rules.length === 0) {
      setAnalysis(null);
      return;
    }
    let cancelled = false;
    api
      .analyze({ rules, active_rule_ids: activeIds, assumptions })
      .then((res) => !cancelled && setAnalysis(res))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [rules, activeIds, assumptions]);

  function toggle(id) {
    setActiveIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const cost = analysis?.cost;

  return (
    <div className="app">
      <header>
        <h1>Dry Run</h1>
        <p className="tagline">
          Test a trial&apos;s eligibility criteria on a synthetic patient
          population before launch — and see what each criterion costs.
        </p>
        {health && (
          <p className="pop">
            Synthetic population:{" "}
            <strong>{health.population.toLocaleString()}</strong>{" "}
            {health.population_label || "patients"}
          </p>
        )}
      </header>

      <section className="loader panel">
        <h3>1. Load a trial</h3>
        <div className="demo-trials">
          {trials.map((t) => (
            <button
              key={t.nct_id}
              className="chip-btn"
              onClick={() => loadParse({ nct_id: t.nct_id })}
            >
              {t.nct_id} — {t.title.split(":")[0]}
            </button>
          ))}
        </div>
        <div className="load-row">
          <input
            placeholder="ClinicalTrials.gov NCT ID (e.g. NCT01179048)"
            value={nctId}
            onChange={(e) => setNctId(e.target.value)}
          />
          <button
            disabled={!nctId}
            onClick={() => loadParse({ nct_id: nctId })}
          >
            Load NCT
          </button>
        </div>
        <details>
          <summary>Or paste eligibility criteria text</summary>
          <textarea
            rows={5}
            placeholder={"HbA1c of at least 7.0 %.\nAge 50 years or older."}
            value={criteriaText}
            onChange={(e) => setCriteriaText(e.target.value)}
          />
          <button
            disabled={!criteriaText.trim()}
            onClick={() => loadParse({ criteria_text: criteriaText })}
          >
            Parse text
          </button>
        </details>
        {loading && <p>Loading…</p>}
        {error && <p className="error">{error}</p>}
        {unparsed.length > 0 && (
          <div className="warn">
            {unparsed.length} sentence(s) could not be translated (no cached
            parse). They are omitted rather than guessed.
          </div>
        )}
      </section>

      {rules.length > 0 && (
        <>
          <section className="panel">
            <h3>2. Criteria ({activeIds.length}/{rules.length} active)</h3>
            <ul className="criteria-list">
              {rules.map((r) => (
                <li key={r.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={activeIds.includes(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                    <span className={`kind kind-${r.kind}`}>{r.kind}</span>
                    <span className="crit-label">
                      {r.label || r.source_sentence}
                    </span>
                    <code>
                      {r.field} {r.operator}{" "}
                      {Array.isArray(r.value) ? r.value.join("–") : String(r.value)}
                      {r.unit ? ` ${r.unit}` : ""}
                    </code>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          {analysis && (
            <>
              <section className="summary-cards">
                <div className="card">
                  <div className="card-num">
                    {analysis.confirmed_eligible.toLocaleString()}
                  </div>
                  <div className="card-label">
                    Confirmed eligible (meets all)
                  </div>
                  <div className="card-sub">
                    {(analysis.confirmed_fraction * 100).toFixed(1)}% of
                    population
                  </div>
                </div>
                <div className="card">
                  <div className="card-num">
                    {analysis.possibly_eligible.toLocaleString()}
                  </div>
                  <div className="card-label">
                    Possibly eligible (meets or unknown)
                  </div>
                  <div className="card-sub">
                    {(analysis.possibly_fraction * 100).toFixed(1)}% of
                    population
                  </div>
                </div>
                <div className="card">
                  <div className="card-num">
                    {cost?.enrollment_months != null
                      ? `${cost.enrollment_months} mo`
                      : "—"}
                  </div>
                  <div className="card-label">Est. enrollment time</div>
                  <div className="card-sub">
                    delay cost {fmtMoney(cost?.delay_cost)}
                  </div>
                  <div className="card-note">
                    {cost?.delay_cost_label ||
                      "vs. enrolling any adult with type 2 diabetes"}
                  </div>
                </div>
              </section>

              <section className="panel">
                <h3>Eligibility funnel</h3>
                <FunnelChart funnel={analysis.funnel} rulesById={rulesById} />
              </section>

              <PriceTags
                priceTags={analysis.price_tags}
                perRuleCost={analysis.per_rule_cost}
                baselineMonths={cost?.enrollment_months}
              />
            </>
          )}

          <AssumptionsPanel
            assumptions={assumptions}
            onChange={setAssumptions}
          />
        </>
      )}

      <footer>
        <p>
          LLM translates criteria only; a deterministic engine decides every
          verdict. Parses are cached so the demo runs offline. All cost figures
          are labeled estimates.
        </p>
      </footer>
    </div>
  );
}
