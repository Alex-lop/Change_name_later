import React from "react";

function fmtMoney(x) {
  if (x == null) return "—";
  return "$" + Math.round(x).toLocaleString();
}

function fmtMonths(x) {
  if (x == null) return "—";
  return x.toFixed(1) + " mo";
}

// Top demographic skews of the excluded group (largest absolute deltas).
// Sex only — race deltas are not shown on generated data.
function topDeltas(deltas) {
  if (!deltas) return [];
  const out = [];
  const d = deltas.sex || {};
  for (const [k, v] of Object.entries(d)) {
    out.push({ label: `${k}`, value: v });
  }
  out.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return out.slice(0, 2);
}

export default function PriceTags({ priceTags, perRuleCost, baselineMonths }) {
  const costById = {};
  (perRuleCost || []).forEach((c) => (costById[c.rule_id] = c));

  // Months a criterion adds = current enrollment months minus the months it
  // would take if that criterion were removed. Sort largest-first.
  const monthsAdded = (t) => {
    const c = costById[t.rule_id];
    const without = c ? c.enrollment_months_without : null;
    if (baselineMonths == null || without == null) return -Infinity;
    return baselineMonths - without;
  };
  const sorted = [...priceTags].sort((a, b) => monthsAdded(b) - monthsAdded(a));

  return (
    <div className="panel">
      <h3>Criterion price tags <span className="estimate-tag">estimates</span></h3>
      <div className="price-tags">
        {sorted.map((t) => {
          const c = costById[t.rule_id];
          // Enrollment months saved if this criterion were dropped.
          const monthsWithout = c ? c.enrollment_months_without : null;
          const saved =
            baselineMonths != null && monthsWithout != null
              ? baselineMonths - monthsWithout
              : null;
          return (
            <div className="price-tag" key={t.rule_id}>
              <div className="pt-header">
                <span className={`pt-kind pt-${t.kind}`}>{t.kind}</span>
                <span className="pt-label">{t.label}</span>
              </div>
              <div className="pt-metrics">
                <div>
                  <strong>{t.excluded.toLocaleString()}</strong>
                  <span>excluded</span>
                </div>
                <div>
                  <strong>{t.unknown.toLocaleString()}</strong>
                  <span>unknown (missing data)</span>
                </div>
                <div>
                  <strong>
                    {saved != null ? fmtMonths(Math.max(0, saved)) : "—"}
                  </strong>
                  <span>months it adds</span>
                </div>
              </div>
              {t.demographic_deltas == null ? (
                <div className="pt-demo pt-demo-hidden">
                  Demographic deltas hidden (excluded group under 30 patients)
                </div>
              ) : (
                t.demographic_deltas.mean_age_delta != null && (
                  <div className="pt-demo">
                    Excluded group age{" "}
                    {t.demographic_deltas.mean_age_delta >= 0 ? "+" : ""}
                    {t.demographic_deltas.mean_age_delta}y vs the cohort this
                    criterion acts on
                    {topDeltas(t.demographic_deltas).map((d, i) => (
                      <span className="demo-chip" key={i}>
                        {d.label} {d.value >= 0 ? "+" : ""}
                        {d.value}pp
                      </span>
                    ))}
                  </div>
                )
              )}
              <div className="pt-source">“{t.source_sentence}”</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { fmtMoney, fmtMonths };
