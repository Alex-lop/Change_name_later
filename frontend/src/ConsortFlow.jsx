import React from "react";
import { fmtInt } from "./format";

// A CONSORT-style flow. Counts run down the left; each criterion's exclusions
// branch right on a hairline elbow. Hairlines and small type, no fills.
// `funnel` is the backend's ordered [{rule_id|null, remaining}] list.
export default function ConsortFlow({ funnel, rulesById }) {
  if (!funnel || funnel.length === 0) return null;

  const rows = [];
  rows.push(
    <div className="consort-row" key="all">
      <span className="consort-main">All synthetic patients</span>
      <span className="consort-count">{fmtInt(funnel[0].remaining)}</span>
    </div>
  );

  for (let i = 1; i < funnel.length; i++) {
    const step = funnel[i];
    const prev = funnel[i - 1].remaining;
    const dropped = prev - step.remaining;
    const r = rulesById[step.rule_id];
    const label =
      (r && (r.label || r.source_sentence)) || step.rule_id || "criterion";
    rows.push(
      <React.Fragment key={step.rule_id || i}>
        {dropped > 0 && (
          <div className="consort-branch">
            <span>Excluded by {label}</span>
            <span className="consort-count">−{fmtInt(dropped)}</span>
          </div>
        )}
        <div className="consort-row">
          <span className="consort-main">Remaining after {label}</span>
          <span className="consort-count">{fmtInt(step.remaining)}</span>
        </div>
      </React.Fragment>
    );
  }

  return (
    <div className="consort" aria-label="CONSORT-style enrollment flow">
      {rows}
    </div>
  );
}
