import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import ProtocolColumn from "./ProtocolColumn";
import ResultColumn from "./ResultColumn";
import { buildExportText, downloadText } from "./exportCriteria";
import { fmtInt, fmtDelta } from "./format";

const DEFAULT_ASSUMPTIONS = {
  target_enrollment: 1000,
  sites: 50,
  screened_per_site_per_month: 20,
  consent_rate: 0.6,
  cost_per_day: 40000,
};

// Hero demo trial loaded on first visit so nobody lands on an empty screen.
const HERO_NCT = "NCT02692716"; // PIONEER 6

export default function App() {
  const [trials, setTrials] = useState([]);
  const [health, setHealth] = useState(null);
  const [bounds, setBounds] = useState({});
  const [currentNct, setCurrentNct] = useState("");
  const [rules, setRules] = useState([]);
  const [originalRules, setOriginalRules] = useState([]);
  const [unparsed, setUnparsed] = useState([]);
  const [activeIds, setActiveIds] = useState([]);
  const [assumptions, setAssumptions] = useState(DEFAULT_ASSUMPTIONS);
  const [analysis, setAnalysis] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [trialMeta, setTrialMeta] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hotIndex, setHotIndex] = useState(null);

  const rulesById = useMemo(() => {
    const m = {};
    rules.forEach((r) => (m[r.id] = r));
    return m;
  }, [rules]);

  const originalById = useMemo(() => {
    const m = {};
    originalRules.forEach((r) => (m[r.id] = r));
    return m;
  }, [originalRules]);

  // Edited = any threshold changed, a toggle changed, or a criterion added.
  const edited = useMemo(() => {
    if (originalRules.length === 0) return false;
    const origIds = originalRules.map((r) => r.id);
    const origActive = new Set(origIds);
    if (activeIds.length !== origIds.length) return true;
    for (const id of origIds) if (!activeIds.includes(id)) return true;
    for (const r of rules) {
      if (r.added) return true;
      const o = originalById[r.id];
      if (o && JSON.stringify(o.value) !== JSON.stringify(r.value)) return true;
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, activeIds, originalRules, originalById]);

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
    api.fieldBounds().then((d) => setBounds(d.bounds || {})).catch(() => {});
    api
      .trials()
      .then((d) => {
        setTrials(d.trials || []);
        // Load the hero trial (PIONEER 6) if present, else the first trial.
        const hero =
          (d.trials || []).find((t) => t.nct_id === HERO_NCT) ||
          (d.trials || [])[0];
        if (hero) loadTrial(hero.nct_id);
      })
      .catch((e) => setError(friendlyError(e, null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function friendlyError(e, nct) {
    const base = e?.message || "Something went wrong.";
    if (nct) {
      return `Couldn't load ${nct} from ClinicalTrials.gov. Check the ID, or pick a demo trial. (${base})`;
    }
    return base;
  }

  async function loadTrial(nctId) {
    setError(null);
    setLoading(true);
    setHotIndex(null);
    try {
      const res = await api.parse({ nct_id: nctId });
      const loaded = res.rules.map((r) => JSON.parse(JSON.stringify(r)));
      setRules(loaded);
      setOriginalRules(loaded.map((r) => JSON.parse(JSON.stringify(r))));
      setTrialMeta(res.trial || null);
      setCurrentNct(nctId);
      setUnparsed(res.unparsed || []);
      setActiveIds(loaded.map((r) => r.id));
      setBaseline(null);
      try {
        const base = await api.analyze({
          rules: loaded,
          active_rule_ids: loaded.map((r) => r.id),
          assumptions,
        });
        setBaseline(base);
      } catch {
        /* non-fatal */
      }
    } catch (e) {
      setError(friendlyError(e, nctId));
      setRules([]);
      setOriginalRules([]);
      setActiveIds([]);
    } finally {
      setLoading(false);
    }
  }

  // Re-analyze on any change, debounced. The original-protocol baseline is
  // recomputed with the SAME assumptions so deltas reflect only rule edits.
  useEffect(() => {
    if (rules.length === 0) {
      setAnalysis(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      api
        .analyze({ rules, active_rule_ids: activeIds, assumptions })
        .then((res) => !cancelled && setAnalysis(res))
        .catch((e) => !cancelled && setError(e.message));
      if (originalRules.length > 0) {
        api
          .analyze({
            rules: originalRules,
            active_rule_ids: originalRules.map((r) => r.id),
            assumptions,
          })
          .then((res) => !cancelled && setBaseline(res))
          .catch(() => {});
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [rules, activeIds, assumptions, originalRules]);

  function toggle(id) {
    setActiveIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function setRuleValue(id, value) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  }

  function resetToProtocol() {
    const restored = originalRules.map((r) => JSON.parse(JSON.stringify(r)));
    setRules(restored);
    setActiveIds(restored.map((r) => r.id));
    setHotIndex(null);
  }

  function addRule(rule) {
    setRules((prev) => [...prev, rule]);
    setActiveIds((prev) => [...prev, rule.id]);
  }

  function exportChanges() {
    const text = buildExportText({
      trialTitle: trialMeta?.title,
      rules,
      originalById,
      activeIds,
      analysis,
    });
    const name = (trialMeta?.nct_id || "dry-run") + "-amended-criteria.txt";
    downloadText(name, text);
  }

  const confDelta =
    analysis && baseline
      ? analysis.confirmed_eligible - baseline.confirmed_eligible
      : null;

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">Dry Run</span>
        <select
          className="trial-picker"
          value={currentNct}
          onChange={(e) => loadTrial(e.target.value)}
          aria-label="Choose a demo trial"
        >
          {trials.map((t) => (
            <option key={t.nct_id} value={t.nct_id}>
              {t.title.split(":")[0]} ({t.nct_id})
            </option>
          ))}
        </select>
        <div className="topbar-actions">
          <button
            className="btn"
            onClick={resetToProtocol}
            disabled={!edited}
          >
            Reset to protocol
          </button>
          <button
            className="btn btn-primary"
            onClick={exportChanges}
            disabled={!analysis}
          >
            Export changes
          </button>
        </div>
      </header>

      {/* Mobile sticky mini-bar: eligible count + its change. */}
      {analysis && (
        <div className="mini-bar">
          <span className="mini-num">
            {fmtInt(analysis.confirmed_eligible)}
          </span>
          <span className="mini-label">eligible</span>
          <span className="mini-delta">
            {confDelta == null || confDelta === 0
              ? "as written"
              : `${fmtDelta(confDelta)} vs protocol`}
          </span>
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {loading && <div className="loading">Loading trial…</div>}
      {unparsed.length > 0 && (
        <div className="notice">
          {unparsed.length} sentence
          {unparsed.length > 1 ? "s" : ""} could not be translated from the
          cache and {unparsed.length > 1 ? "are" : "is"} omitted rather than
          guessed.
        </div>
      )}

      {rules.length > 0 && (
        <div className="workbench">
          <div className="protocol-col">
            <ProtocolColumn
              trialMeta={trialMeta}
              rules={rules}
              originalById={originalById}
              bounds={bounds}
              activeIds={activeIds}
              activeRuleIds={analysis?.active_rule_ids}
              coverage={analysis?.coverage}
              onToggle={toggle}
              onValueChange={setRuleValue}
              onAddRule={addRule}
              onDragStart={() => setDragging(true)}
              onDragEnd={() => setDragging(false)}
              onHover={setHotIndex}
              assumptions={assumptions}
              onAssumptionsChange={setAssumptions}
            />
          </div>

          <div className="result-col">
            <ResultColumn
              analysis={analysis}
              baseline={baseline}
              edited={edited}
              populationLabel={analysis?.population_label}
              rulesById={rulesById}
              assumptions={assumptions}
              dragging={dragging}
              hotIndex={hotIndex}
              onHover={setHotIndex}
            />
          </div>
        </div>
      )}

      <footer className="footer">
        Synthetic patients only. Figures are planning estimates, not medical
        advice.
      </footer>
    </div>
  );
}
