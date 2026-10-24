import React from "react";
import { fmtMoney } from "./PriceTags";

function Delta({ value, unit, invert, digits = 0 }) {
  // invert=true means "lower is better" (months, cost): a decrease is good.
  if (value == null || value === 0) {
    return <span className="delta delta-zero">no change vs original</span>;
  }
  const up = value > 0;
  const good = invert ? !up : up;
  const sign = up ? "+" : "";
  return (
    <span className={`delta ${good ? "delta-good" : "delta-bad"}`}>
      {sign}
      {value.toFixed(digits)}
      {unit} vs original
    </span>
  );
}

// Sticky results header: confirmed-eligible, enrollment months, delay cost,
// each with its change versus the originally loaded protocol.
export default function ResultsHeader({ analysis, baseline }) {
  if (!analysis) return null;
  const cost = analysis.cost || {};
  const baseCost = baseline?.cost || {};

  const confDelta =
    baseline != null
      ? analysis.confirmed_eligible - baseline.confirmed_eligible
      : null;
  const monthsDelta =
    cost.enrollment_months != null && baseCost.enrollment_months != null
      ? cost.enrollment_months - baseCost.enrollment_months
      : null;
  const costDelta =
    cost.delay_cost != null && baseCost.delay_cost != null
      ? cost.delay_cost - baseCost.delay_cost
      : null;

  return (
    <div className="results-header">
      <div className="rh-metric">
        <div className="rh-num">
          {analysis.confirmed_eligible.toLocaleString()}
        </div>
        <div className="rh-label">confirmed eligible</div>
        <Delta value={confDelta} unit="" invert={false} />
      </div>
      <div className="rh-metric">
        <div className="rh-num">
          {cost.enrollment_months != null ? `${cost.enrollment_months}` : "—"}
          <span className="rh-unit"> mo</span>
        </div>
        <div className="rh-label">est. enrollment time</div>
        <Delta value={monthsDelta} unit=" mo" invert digits={1} />
      </div>
      <div className="rh-metric">
        <div className="rh-num">{fmtMoney(cost.delay_cost)}</div>
        <div className="rh-label">
          est. delay cost
          <span className="rh-note">
            {" "}
            {cost.delay_cost_label ||
              "vs. enrolling any adult with type 2 diabetes"}
          </span>
        </div>
        {costDelta != null && costDelta !== 0 ? (
          <span className={`delta ${costDelta > 0 ? "delta-bad" : "delta-good"}`}>
            {costDelta > 0 ? "+" : ""}
            {fmtMoney(costDelta)} vs original
          </span>
        ) : (
          <span className="delta delta-zero">no change vs original</span>
        )}
      </div>
    </div>
  );
}
