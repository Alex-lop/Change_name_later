import React, { useRef } from "react";
import { fmtValue } from "./format";

const NUMERIC_OPS = [">=", ">", "<=", "<", "between"];
const OP_WORDS = {
  ">=": "at least",
  ">": "greater than",
  "<=": "at most",
  "<": "below",
  "between": "between",
  "==": "equal to",
  "!=": "not",
  "has": "has",
  "not_has": "without",
  "in": "is",
  "not_in": "is not",
};

function isNumericOp(op) {
  return NUMERIC_OPS.includes(op);
}

// A plain-sans gloss of the rule beneath the verbatim serif sentence.
function glossText(rule) {
  if (rule.logic) {
    return rule.label || `${rule.logic.replace("_", " ")} of several conditions`;
  }
  const word = OP_WORDS[rule.operator] || rule.operator;
  const val = fmtValue(rule.value);
  const unit = rule.unit ? ` ${rule.unit}` : "";
  return `${rule.field} ${word} ${val}${unit}`;
}

// Redline amendment line: original struck, new value underlined.
function Redline({ original, rule }) {
  if (!original || rule.logic) return null;
  if (JSON.stringify(original.value) === JSON.stringify(rule.value)) return null;
  const unit = rule.unit ? ` ${rule.unit}` : "";
  return (
    <span className="crit-gloss">
      amended to {rule.field}{" "}
      <span className="redline-old">
        {fmtValue(original.value)}
        {unit}
      </span>
      <span className="redline-new">
        {fmtValue(rule.value)}
        {unit}
      </span>
    </span>
  );
}

// One protocol criterion: verbatim serif sentence, a sans gloss, controls.
// A real checkbox drives the on/off left edge. Numeric rules get a restyled
// native slider with an as-written tick and arrow-key steps from bounds.
export default function CriterionRow({
  rule,
  original,
  bounds,
  active,
  codeIndex, // index into active_rule_ids, or null if inactive/uneval
  onToggle,
  onValueChange,
  onDragStart,
  onDragEnd,
  onHover,
}) {
  const rangeRef = useRef(null);

  const numeric =
    !rule.logic &&
    isNumericOp(rule.operator) &&
    bounds &&
    !Array.isArray(rule.value);

  // Not-evaluable leaf or compound.
  if (rule.evaluable === false) {
    return (
      <li className="criterion uneval">
        <div className="crit-body">
          <div className="crit-sentence">{rule.source_sentence}</div>
          <div className="crit-uneval-reason">
            Not evaluable on this data — {rule.unevaluable_reason}
          </div>
        </div>
      </li>
    );
  }

  const classes = ["criterion"];
  if (!active) classes.push("off");

  const fillPct =
    numeric && bounds.max > bounds.min
      ? ((Number(rule.value) - bounds.min) / (bounds.max - bounds.min)) * 100
      : 0;
  const tickPct =
    numeric && original != null && bounds.max > bounds.min
      ? ((Number(original.value) - bounds.min) / (bounds.max - bounds.min)) * 100
      : null;

  const canHover = codeIndex != null && codeIndex >= 0;

  return (
    <li
      className={classes.join(" ")}
      onMouseEnter={() => canHover && onHover && onHover(codeIndex)}
      onMouseLeave={() => canHover && onHover && onHover(null)}
    >
      <div className="crit-top">
        <input
          type="checkbox"
          className="crit-check"
          checked={active}
          onChange={() => onToggle(rule.id)}
          aria-label={`Apply criterion: ${rule.label || rule.source_sentence}`}
        />
        <div className="crit-body">
          <div className="crit-sentence">
            {rule.source_sentence || rule.label}
            {rule.added && (
              <span className="crit-added-tag">added in Dry Run</span>
            )}
          </div>
          <div className="crit-gloss">
            {rule.added ? (
              <span className="redline-added">{glossText(rule)}</span>
            ) : (
              glossText(rule)
            )}
          </div>
          <Redline original={original} rule={rule} />

          {numeric && (
            <div className="slider-wrap">
              <div className="slider-head">
                <span className="slider-value">
                  {rule.value}
                  <span className="slider-unit">
                    {rule.unit ? ` ${rule.unit}` : ""}
                  </span>
                </span>
                {original != null && (
                  <span className="slider-aswritten">
                    as written: {fmtValue(original.value)}
                  </span>
                )}
              </div>
              <div className="range-row">
                <input
                  ref={rangeRef}
                  type="range"
                  className="range"
                  min={bounds.min}
                  max={bounds.max}
                  step={bounds.step}
                  value={Number(rule.value)}
                  disabled={!active}
                  style={{ "--fill": `${fillPct}%` }}
                  onChange={(e) =>
                    onValueChange(rule.id, Number(e.target.value))
                  }
                  onPointerDown={() => onDragStart && onDragStart()}
                  onPointerUp={() => onDragEnd && onDragEnd()}
                  onKeyUp={() => onDragEnd && onDragEnd()}
                  aria-label={`${rule.field} threshold`}
                  aria-valuetext={`${rule.value}${rule.unit ? " " + rule.unit : ""}`}
                />
                {tickPct != null && (
                  <span
                    className="as-written-tick"
                    style={{ left: `${tickPct}%` }}
                    title={`as written: ${original.value}`}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export { isNumericOp };
