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
  const numeric = isNumeric(rule.operator) && bounds && !Array.isArray(rule.value);
  const changed =
    original != null &&
    JSON.stringify(original.value) !== JSON.stringify(rule.value);

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
