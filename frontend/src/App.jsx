import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import ProtocolColumn from "./ProtocolColumn";
import ResultColumn from "./ResultColumn";
import TrialLoader from "./TrialLoader";
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
  const [unparsed, setUnparsed] = useState([]); // [{sentence, kind}] not in the cache
  const [loaderOpen, setLoaderOpen] = useState(false);
  const [draft, setDraft] = useState(null); // the untranslated sentence being added by hand
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
  // criterion added. With nothing translated, any added criterion is an edit.
  const edited = useMemo(() => {
    if (originalRules.length === 0) return rules.length > 0;
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

  // Load a seeded trial or any NCT ID (fetched live from ClinicalTrials.gov),
  // or pasted criteria text. Cached sentences become rules; the rest are kept
  // verbatim so they can be added by hand. A failed load keeps the current trial.
  const loadTrial = (nctId) => loadParse({ nct_id: nctId }, nctId);
  const loadText = (text) => loadParse({ criteria_text: text }, null);

  async function loadParse(body, nctId) {
    setError(null);
    setLoading(true);
    try {
      const res = await api.parse(body);
      const loaded = res.rules.map((r) => JSON.parse(JSON.stringify(r)));
      const pending =
        res.unparsed_items || (res.unparsed || []).map((s) => ({ sentence: s, kind: null }));
      if (loaded.length === 0 && pending.length === 0) {
        throw new Error("No eligibility criteria were found in that text.");
      }
      setHotIndex(null);
      setSelectedRuleId(null);
      setDraft(null);
      setRules(loaded);
      setOriginalRules(loaded.map((r) => JSON.parse(JSON.stringify(r))));
      setTrialMeta(res.trial || (nctId ? { nct_id: nctId } : { title: "Pasted criteria", source: "text" }));
      setCurrentNct(nctId ? nctId.trim().toUpperCase() : "");
      setUnparsed(pending);
      setActiveIds(loaded.map((r) => r.id));
      setBaseline(null);
      setLoaderOpen(false);
    } catch (e) {
      setError(friendlyError(e, nctId));
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
    setDraft(null);
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
  // Untranslated sentences still waiting for a hand-made rule.
  const pending = unparsed.filter(
    (u) => !rules.some((r) => r.added && r.source_sentence === u.sentence)
  );
  const trialLoaded = rules.length > 0 || unparsed.length > 0;
  const noProtocol = originalRules.length === 0;
  const inRegistry = trials.some((t) => t.nct_id === currentNct);
  const provenance =
    trialMeta?.source === "text"
      ? "Pasted criteria"
      : trialMeta?.paraphrased === false
        ? "Verbatim from ClinicalTrials.gov"
        : trialMeta?.paraphrased
          ? "Paraphrased, abridged"
          : "";
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
        <img className="wordmark" src="/sieve-mark.png" alt="Sieve" />
        <select
          className="trial-picker"
          value={currentNct}
          onChange={(e) => e.target.value && loadTrial(e.target.value)}
          aria-label="Choose a trial"
        >
          {trials.map((t) => (
            <option key={t.nct_id} value={t.nct_id}>
              {t.title.split(":")[0]} ({t.nct_id})
            </option>
          ))}
          {trialLoaded && !inRegistry && (
            <option value={currentNct}>
              {currentNct
                ? `${(trialMeta?.title || "").split(":")[0] || "Loaded"} (${currentNct})`
                : "Pasted criteria"}
            </option>
          )}
        </select>
        <button
          type="button"
          className="btn"
          aria-expanded={loaderOpen}
          onClick={() => setLoaderOpen((o) => !o)}
        >
          Load any trial
        </button>
        {provenance && <span className="trial-provenance">{provenance}</span>}
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
            {noProtocol
              ? "added by hand"
              : confDelta == null || confDelta === 0
                ? "as written"
                : `${fmtDelta(confDelta)} vs protocol`}
          </span>
        </div>
      )}

      {loaderOpen && (
        <TrialLoader
          loading={loading}
          onLoadNct={loadTrial}
          onLoadText={loadText}
          onClose={() => setLoaderOpen(false)}
        />
      )}

      {error && <div className="error" role="alert">{error}</div>}
      {loading && <div className="loading">Loading trial…</div>}
      {pending.length > 0 && (
        <div className="notice">
          {pending.length} sentence{pending.length > 1 ? "s" : ""} not translated
          yet. {pending.length > 1 ? "They change" : "It changes"} no count until
          you add {pending.length > 1 ? "them" : "it"}.
        </div>
      )}

      {trialLoaded && (
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
              untranslated={pending}
              draft={draft}
              onTranslate={setDraft}
              onDraftDone={() => setDraft(null)}
              assumptions={assumptions}
              onAssumptionsChange={setAssumptions}
            />
          </div>

          <div className="result-col">
            {rules.length === 0 ? (
              <div className="result-empty">
                <p className="result-sentence">Nothing is counted yet.</p>
                <p>
                  Add a criterion by hand. Counts use the{" "}
                  {fmtInt(health?.population)} synthetic adults with type 2
                  diabetes.
                </p>
              </div>
            ) : (
            <ResultColumn
              analysis={analysis}
              baseline={baseline}
              edited={edited}
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
              noProtocol={noProtocol}
            />
            )}
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
