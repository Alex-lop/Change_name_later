import React from "react";

// Horizontal funnel: each step's bar width is proportional to remaining count.
export default function FunnelChart({ funnel, rulesById }) {
  if (!funnel || funnel.length === 0) return null;
  const max = funnel[0].remaining || 1;
  return (
    <div className="funnel">
      {funnel.map((step, i) => {
        const pct = (step.remaining / max) * 100;
        const label =
          step.rule_id == null
            ? step.label || "All patients"
            : (rulesById[step.rule_id]?.label ||
               rulesById[step.rule_id]?.source_sentence ||
               step.rule_id);
        return (
          <div className="funnel-row" key={i}>
            <div className="funnel-label" title={label}>
              {label}
            </div>
            <div className="funnel-bar-track">
              <div
                className="funnel-bar"
                style={{ width: `${pct}%` }}
                role="img"
                aria-label={`${label}: ${step.remaining} patients remaining`}
              />
            </div>
            <div className="funnel-count">
              {step.remaining.toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
