import React from "react";

const FIELDS = [
  { key: "target_enrollment", label: "Target enrollment", step: 1 },
  { key: "sites", label: "Sites", step: 1 },
  {
    key: "screened_per_site_per_month",
    label: "Screened / site / month",
    step: 1,
  },
  { key: "consent_rate", label: "Consent rate (0–1)", step: 0.05 },
  { key: "cost_per_day", label: "Cost per day ($)", step: 1000 },
];

export default function AssumptionsPanel({ assumptions, onChange }) {
  return (
    <div className="panel">
      <h3>Assumptions <span className="estimate-tag">estimates</span></h3>
      <div className="assumptions-grid">
        {FIELDS.map((f) => (
          <label key={f.key} className="assumption">
            <span>{f.label}</span>
            <input
              type="number"
              step={f.step}
              value={assumptions[f.key]}
              onChange={(e) =>
                onChange({ ...assumptions, [f.key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}
