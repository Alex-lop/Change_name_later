import React, { useLayoutEffect, useMemo, useRef } from "react";
import { fmtInt, fmtMoney, fmtMonths } from "./format";
import { useMotionOff } from "./motion";
import "./cost.css";

const DAYS_PER_MONTH = 30.4375;

// "What each criterion costs" as a real table, sorted by months added.
// Columns: criterion, patients kept out, months added, delay cost, with a thin
// ink bar for months. Re-sort when a slider is released, not during a drag;
// on a re-sort, rows that moved slide to their new place (FLIP, 300ms).
// A demographic note appears only when the excluded group has >= 30 patients.
//
// Props:
//   priceTags, perRuleCost: from analysis
//   baselineMonths: current all-criteria enrollment months
//   costPerDay: from assumptions (for the per-criterion delay cost)
//   activeRuleIds: order of active criteria (code index == position here)
//   dragging: when true, the sort order is frozen (re-sort on release)
//   onHover(codeIndex|null): drives the patient-field highlight
//   hotIndex: currently highlighted code index (for row emphasis)
//   selectedRuleId: rule_id of the selected row, or null
//   onSelect(ruleId): optional; row click / Enter / Space (caller toggles)
export default function CostTable({
  priceTags,
  perRuleCost,
  baselineMonths,
  costPerDay,
  activeRuleIds,
  paraphrased,
  dragging,
  onHover,
  hotIndex,
  selectedRuleId,
  onSelect,
}) {
  const motionOff = useMotionOff();

  const costById = useMemo(() => {
    const m = {};
    (perRuleCost || []).forEach((c) => (m[c.rule_id] = c));
    return m;
  }, [perRuleCost]);

  const indexOf = useMemo(() => {
    const m = {};
    (activeRuleIds || []).forEach((id, i) => (m[id] = i));
    return m;
  }, [activeRuleIds]);

  const monthsAdded = (t) => {
    const c = costById[t.rule_id];
    const without = c ? c.enrollment_months_without : null;
    if (baselineMonths == null || without == null) return 0;
    return Math.max(0, baselineMonths - without);
  };

  // Freeze the row order while dragging: keep the previous sorted id list.
  const frozenOrderRef = useRef([]);
  const sorted = useMemo(() => {
    const withAdded = (priceTags || []).map((t) => ({
      tag: t,
      added: monthsAdded(t),
    }));
    if (dragging && frozenOrderRef.current.length) {
      const pos = {};
      frozenOrderRef.current.forEach((id, i) => (pos[id] = i));
      withAdded.sort(
        (a, b) =>
          (pos[a.tag.rule_id] ?? 1e9) - (pos[b.tag.rule_id] ?? 1e9)
      );
    } else {
      withAdded.sort((a, b) => b.added - a.added);
      frozenOrderRef.current = withAdded.map((x) => x.tag.rule_id);
    }
    return withAdded;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceTags, perRuleCost, baselineMonths, dragging]);

  // FLIP on re-sort. After every render, remember each row's layout top
  // (offsetTop ignores transforms and page scroll). When the order changes,
  // rows whose top moved start at their old place and slide to 0. First
  // render, a different set of rule_ids (another trial), or motion off: snap.
  const tbodyRef = useRef(null);
  const flipRef = useRef({ tops: {}, order: null, set: null });
  useLayoutEffect(() => {
    const rows = tbodyRef.current ? [...tbodyRef.current.children] : [];
    const ids = rows.map((el) => el.dataset.id);
    const order = ids.join("\n");
    const set = [...ids].sort().join("\n");
    const prev = flipRef.current;
    if (motionOff || set !== prev.set) {
      rows.forEach((el) => {
        el.style.transition = "";
        el.style.transform = "";
      });
    } else if (order !== prev.order) {
      const moved = [];
      rows.forEach((el) => {
        const shift = prev.tops[el.dataset.id] - el.offsetTop;
        if (!(Math.abs(shift) >= 1)) return;
        // Continue from where an interrupted slide currently is.
        const now = new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
        el.style.transition = "none";
        el.style.transform = `translateY(${shift + now}px)`;
        moved.push(el);
      });
      if (moved.length) {
        void tbodyRef.current.offsetHeight; // reflow: commit the start position
        moved.forEach((el) => {
          el.style.transition = "transform 300ms ease";
          el.style.transform = "";
        });
      }
    }
    const tops = {};
    rows.forEach((el) => (tops[el.dataset.id] = el.offsetTop));
    flipRef.current = { tops, order, set };
  });

  const onSlideEnd = (e) => {
    if (e.propertyName === "transform" && e.target.parentNode === e.currentTarget) {
      e.target.style.transition = "";
    }
  };

  const maxAdded = Math.max(
    0.0001,
    ...sorted.map((x) => x.added)
  );

  if (!priceTags || priceTags.length === 0) return null;

  return (
    <div className="cost-table-wrap">
      <table className={`cost-table${onSelect ? " selectable" : ""}`}>
        <caption>
          What each criterion costs
          {onSelect && (
            <span className="cost-hint">
              Select a row to map where it keeps patients out.
            </span>
          )}
        </caption>
        <thead>
          <tr>
            <th scope="col">Criterion</th>
            <th scope="col" className="num">Patients kept out</th>
            <th scope="col" className="num">Months added</th>
            <th scope="col" className="num">Delay cost</th>
          </tr>
        </thead>
        <tbody ref={tbodyRef} onTransitionEnd={onSlideEnd}>
          {sorted.map(({ tag, added }) => {
            const idx = indexOf[tag.rule_id];
            const daysAdded = added * DAYS_PER_MONTH;
            const delay = costPerDay != null ? daysAdded * costPerDay : null;
            const dd = tag.demographic_deltas;
            const ageDelta = dd && dd.mean_age_delta;
            const selected =
              selectedRuleId != null && tag.rule_id === selectedRuleId;
            return (
              <tr
                key={tag.rule_id}
                data-id={tag.rule_id}
                className={`cost-row${hotIndex === idx ? " hot" : ""}${
                  selected ? " selected" : ""
                }`}
                aria-current={selected ? "true" : undefined}
                onClick={onSelect ? () => onSelect(tag.rule_id) : undefined}
                onKeyDown={
                  onSelect
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          // A held key would toggle the selection on every repeat.
                          if (!e.repeat) onSelect(tag.rule_id);
                        }
                      }
                    : undefined
                }
                onMouseEnter={() => onHover && onHover(idx)}
                onMouseLeave={() => onHover && onHover(null)}
                onFocus={() => onHover && onHover(idx)}
                onBlur={() => onHover && onHover(null)}
                tabIndex={0}
              >
                <td>
                  <div className="cost-crit">{tag.label}</div>
                  {dd && ageDelta != null && ageDelta !== 0 && (
                    <div className="cost-demo">
                      on average {Math.abs(ageDelta)} years{" "}
                      {ageDelta > 0 ? "older" : "younger"} than the rest of the
                      cohort
                    </div>
                  )}
                  <div className="cost-source">
                    {paraphrased
                      ? tag.source_sentence
                      : `“${tag.source_sentence}”`}
                  </div>
                </td>
                <td className="num">{fmtInt(tag.excluded)}</td>
                <td className="num month-bar-cell">
                  <div>{fmtMonths(added)}</div>
                  <div className="month-bar-track">
                    <div
                      className="month-bar"
                      style={{ width: `${(added / maxAdded) * 100}%` }}
                    />
                  </div>
                </td>
                <td className="num">{fmtMoney(delay)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
