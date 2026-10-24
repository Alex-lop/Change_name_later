import React from "react";

const NUMERIC_OPS = [">=", ">", "<=", "<", "between"];

function isNumeric(op) {
  return NUMERIC_OPS.includes(op);
}

// Format a rule's value for display.
function fmtValue(rule) {
  if (Array.isArray(rule.value)) return rule.value.join("–");
  return String(rule.value);
}

// A single criterion row: toggle + label + engine expression, and for a
// numeric rule a slider bounded by that field's clinical range, with a tick
// marking the originally loaded value.
export default function CriterionRow({
  rule,
  original,
  bounds,
  active,
  onToggle,
  onValueChange,
}) {
  const numeric =
    !rule.logic &&
    isNumeric(rule.operator) &&
    bounds &&
    !Array.isArray(rule.value);
  const changed =
    original != null &&
    JSON.stringify(original.value) !== JSON.stringify(rule.value);

  // Compound rule: render logic + children, read-only (engine decides).
  if (rule.logic) {
    return (
      <li className={rule.evaluable === false ? "crit-uneval" : undefined}>
        <label className="crit-head">
          <input
            type="checkbox"
            checked={active}
            disabled={rule.evaluable === false}
            onChange={() => onToggle(rule.id)}
          />
          <span className={`kind kind-${rule.kind}`}>{rule.kind}</span>
          <span className="crit-label">{rule.label || rule.source_sentence}</span>
          <span className="logic-tag">{rule.logic}</span>
        </label>
        <ul className="children">
          {(rule.children || []).map((c, i) => (
            <li key={i} className={c.evaluable === false ? "crit-uneval" : undefined}>
              {c.logic ? (
                <span className="logic-tag">{c.logic}</span>
              ) : (
                <code>
                  {c.field} {c.operator}{" "}
                  {Array.isArray(c.value) ? c.value.join(", ") : String(c.value)}
                  {c.unit ? ` ${c.unit}` : ""}
                </code>
              )}
              {c.logic &&
                (c.children || []).map((gc, j) => (
                  <code key={j} className="grandchild">
                    {gc.field} {gc.operator}{" "}
                    {Array.isArray(gc.value)
                      ? gc.value.join(", ")
                      : String(gc.value)}
                    {gc.unit ? ` ${gc.unit}` : ""}
                  </code>
                ))}
              {c.evaluable === false && (
                <span className="uneval-reason">
                  not evaluable — {c.unevaluable_reason}
                </span>
              )}
            </li>
          ))}
        </ul>
      </li>
    );
  }

  // Not-evaluable leaf rule: shown with its reason, changes no count.
  if (rule.evaluable === false) {
    return (
      <li className="crit-uneval">
        <label className="crit-head">
          <span className={`kind kind-${rule.kind}`}>{rule.kind}</span>
          <span className="crit-label">{rule.label || rule.source_sentence}</span>
          <span className="uneval-tag">not evaluable</span>
        </label>
        <div className="uneval-reason">{rule.unevaluable_reason}</div>
      </li>
    );
  }

  return (
    <li className={rule.added ? "crit-added" : undefined}>
      <label className="crit-head">
        <input type="checkbox" checked={active} onChange={() => onToggle(rule.id)} />
        <span className={`kind kind-${rule.kind}`}>{rule.kind}</span>
        <span className="crit-label">{rule.label || rule.source_sentence}</span>
        {rule.added && <span className="added-tag">added in Dry Run</span>}
        <code>
          {rule.field} {rule.operator} {fmtValue(rule)}
          {rule.unit ? ` ${rule.unit}` : ""}
        </code>
      </label>

      {numeric && (
        <div className="slider-row">
          <input
            type="range"
            min={bounds.min}
            max={bounds.max}
            step={bounds.step}
            value={Number(rule.value)}
            disabled={!active}
            onChange={(e) => onValueChange(rule.id, Number(e.target.value))}
            aria-label={`${rule.field} threshold`}
          />
          <span className="slider-value">
            {rule.value}
            {rule.unit ? ` ${rule.unit}` : ""}
            {changed && original != null && (
              <span className="slider-orig"> (was {String(original.value)})</span>
            )}
          </span>
          {original != null && (
            <span
              className="slider-tick"
              title={`original protocol value: ${original.value}`}
              style={{
                left: `${
                  ((Number(original.value) - bounds.min) /
                    (bounds.max - bounds.min)) *
                  100
                }%`,
              }}
            />
          )}
        </div>
      )}
    </li>
  );
}

export { isNumeric };
