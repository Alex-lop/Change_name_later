import React, { useMemo, useRef } from "react";
import { fmtInt, fmtMoney, fmtMonths } from "./format";

const DAYS_PER_MONTH = 30.4375;

// "What each criterion costs" as a real table, sorted by months added.
// Columns: criterion, patients kept out, months added, delay cost, with a thin
// ink bar for months. Re-sort when a slider is released, not during a drag.
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
export default function CostTable({
  priceTags,
  perRuleCost,
  baselineMonths,
  costPerDay,
  activeRuleIds,
  dragging,
  onHover,
  hotIndex,
}) {
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

  const maxAdded = Math.max(
    0.0001,
    ...sorted.map((x) => x.added)
  );

  if (!priceTags || priceTags.length === 0) return null;

  return (
    <div className="cost-table-wrap">
      <table className="cost-table">
        <caption>What each criterion costs</caption>
        <thead>
          <tr>
            <th scope="col">Criterion</th>
            <th scope="col" className="num">Patients kept out</th>
            <th scope="col" className="num">Months added</th>
            <th scope="col" className="num">Delay cost</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ tag, added }) => {
            const idx = indexOf[tag.rule_id];
            const daysAdded = added * DAYS_PER_MONTH;
            const delay = costPerDay != null ? daysAdded * costPerDay : null;
            const dd = tag.demographic_deltas;
            const ageDelta = dd && dd.mean_age_delta;
            return (
              <tr
                key={tag.rule_id}
                className={`cost-row ${hotIndex === idx ? "hot" : ""}`}
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
                  <div className="cost-source">“{tag.source_sentence}”</div>
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
