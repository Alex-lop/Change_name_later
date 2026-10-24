import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import ProtocolColumn from "./ProtocolColumn";
import ResultColumn from "./ResultColumn";
import { buildExportText, downloadText } from "./exportCriteria";
import { fmtInt, fmtDelta } from "./format";
import { MotionContext, usePrefersReducedMotion } from "./motion";
import { MAP_ENABLED, HERO_ENABLED } from "./flags";
import Hero from "./Hero";

const DEFAULT_ASSUMPTIONS = {
  target_enrollment: 1000,
  sites: 50,
  screened_per_site_per_month: 20,
  consent_rate: 0.6,
  cost_per_day: 40000,
};

// Hero demo trial loaded on first visit so nobody lands on an empty screen.
const HERO_NCT = "NCT02692716"; // PIONEER 6

// The map shows only live geo data. Until /api/geo answers, the field shows
// without the "By place" view and this interval retries.
const GEO_RETRY_MS = 10000;

// Immutably set the value at a child path inside a (possibly compound) rule.
// path [] is the rule's own value; [1, 0] is children[1].children[0].value.
function setAtPath(rule, path, value) {
  if (path.length === 0) return { ...rule, value };
  const [i, ...rest] = path;
  return {
    ...rule,
    children: rule.children.map((c, j) => (j === i ? setAtPath(c, rest, value) : c)),
  };
}

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
  const [geo, setGeo] = useState(null);
  const [geoLive, setGeoLive] = useState(false);
  const [selectedRuleId, setSelectedRuleId] = useState(null);
  const [fieldView, setFieldView] = useState("age");
  const [paused, setPaused] = useState(false);
  const [showHero, setShowHero] = useState(HERO_ENABLED);
  const shellRef = useRef(null);
  const reducedMotion = usePrefersReducedMotion();
  const motionOff = reducedMotion || paused;

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

  // Edited = any threshold changed (nested ones too), a toggle changed, or a
  // criterion added.
  const edited = useMemo(() => {
    if (originalRules.length === 0) return false;
    const origIds = originalRules.map((r) => r.id);
    if (activeIds.length !== origIds.length) return true;
    for (const id of origIds) if (!activeIds.includes(id)) return true;
    for (const r of rules) {
      if (r.added) return true;
      const o = originalById[r.id];
      if (o && JSON.stringify(o.value) !== JSON.stringify(r.value)) return true;
      if (o && JSON.stringify(o.children) !== JSON.stringify(r.children)) return true;
    }
    return false;
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

  // Area shapes, context, sites and per-patient homes (the field tooltip uses
  // those even when the map is switched off).
  useEffect(() => {
    let timer;
    let stopped = false;
    const tryLive = () =>
      api
        .geo()
        .then((g) => {
          if (stopped) return;
          setGeo(g);
          setGeoLive(true);
        })
        .catch(() => {
          if (!stopped) timer = setTimeout(tryLive, GEO_RETRY_MS);
        });
    tryLive();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  // While the hero covers the page, the workbench underneath is inert and the
  // page doesn't scroll behind it.
  // Focus moves into the workbench once it is no longer inert.
  useEffect(() => {
    if (shellRef.current) shellRef.current.inert = showHero;
    document.body.style.overflow = showHero ? "hidden" : "";
    if (!showHero && HERO_ENABLED) document.querySelector(".trial-picker")?.focus();
  }, [showHero]);

  // Escape returns the map from a criterion to eligibility.
  useEffect(() => {
    if (!selectedRuleId) return;
    const onKey = (e) => e.key === "Escape" && setSelectedRuleId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedRuleId]);

  // A criterion that is switched off (or a new trial) can't stay selected.
  useEffect(() => {
    if (selectedRuleId && analysis && !analysis.active_rule_ids?.includes(selectedRuleId)) {
      setSelectedRuleId(null);
    }
  }, [analysis, selectedRuleId]);

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
    setSelectedRuleId(null);
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
    } catch (e) {
      setError(friendlyError(e, nctId));
      setRules([]);
      setOriginalRules([]);
      setActiveIds([]);
    } finally {
      setLoading(false);
    }
  }

  // Re-analyze the current protocol on rule/toggle/assumption changes, debounced.
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
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // geoLive: re-fetch once when the geo API comes up, so area counts appear.
  }, [rules, activeIds, assumptions, geoLive]);

  // Recompute the original-protocol baseline only when the loaded protocol or
  // the assumptions change — NOT on every rule edit — so deltas reflect only
  // rule edits and we don't fire a second /api/analyze on each slider move.
  useEffect(() => {
    if (originalRules.length === 0) {
      setBaseline(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      api
        .analyze({
          rules: originalRules,
          active_rule_ids: originalRules.map((r) => r.id),
          assumptions,
        })
        .then((res) => !cancelled && setBaseline(res))
        .catch(() => {});
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [originalRules, assumptions, geoLive]);

  function toggle(id) {
    setActiveIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function setRuleValue(id, value, path = []) {
    setRules((prev) => prev.map((r) => (r.id === id ? setAtPath(r, path, value) : r)));
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

  // Selecting a criterion maps where it keeps patients out; a second click on
  // the same criterion returns the map to eligibility.
  function selectRule(id) {
    setSelectedRuleId((prev) => (prev === id ? null : id));
    if (selectedRuleId !== id) setFieldView("place");
  }

  function exportChanges() {
    const text = buildExportText({
      trialTitle: trialMeta?.title,
      rules,
      originalById,
      activeIds,
      analysis,
    });
    const name = (trialMeta?.nct_id || "sieve") + "-amended-criteria.txt";
    downloadText(name, text);
  }

  const confDelta =
    analysis && baseline
      ? analysis.confirmed_eligible - baseline.confirmed_eligible
      : null;

  const showMap = MAP_ENABLED && geo != null;
  const onSelect = showMap ? selectRule : undefined;

  return (
    <MotionContext.Provider value={motionOff}>
    {showHero && (
      <Hero
        // Share of patients the protocol as written excludes (fallen marks).
        excludedFraction={
          baseline && currentNct === HERO_NCT ? 1 - baseline.possibly_fraction : null
        }
        onEnter={() => setShowHero(false)}
      />
    )}
    <div ref={shellRef} className={`shell${motionOff ? " motion-off" : ""}`}>
      <header className="topbar">
        <span className="wordmark">Sieve</span>
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
        <span className="trial-provenance">
          {trials.find((t) => t.nct_id === currentNct)?.paraphrased === false
            ? "Verbatim from ClinicalTrials.gov"
            : "Paraphrased, abridged"}
        </span>
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
              selectedRuleId={selectedRuleId}
              onSelect={onSelect}
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
              paraphrased={trialMeta?.paraphrased}
              rulesById={rulesById}
              assumptions={assumptions}
              dragging={dragging}
              hotIndex={hotIndex}
              onHover={setHotIndex}
              geo={geo}
              showMap={showMap}
              areas={analysis?.areas ?? null}
              baselineAreas={baseline?.areas ?? null}
              nctId={currentNct}
              fieldView={fieldView}
              onFieldViewChange={setFieldView}
              selectedRuleId={selectedRuleId}
              onSelect={onSelect}
              onClearSelection={() => setSelectedRuleId(null)}
            />
          </div>
        </div>
      )}

      <footer className="footer">
        <span>
          Synthetic patients only. Figures are planning estimates, not medical
          advice.
        </span>
        <button
          type="button"
          className="btn-text"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? "Resume motion" : "Pause motion"}
        </button>
      </footer>
    </div>
    </MotionContext.Provider>
  );
}
