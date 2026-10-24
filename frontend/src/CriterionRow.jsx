import React from "react";
import { fmtValue } from "./format";
import { branchName, childAt, leaves } from "./exportCriteria";
import "./criterion.css";

const NUMERIC_OPS = [">=", ">", "<=", "<", "between"];
const SLIDER_OPS = [">=", ">", "<=", "<"];
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

// Lists read "mi, stroke"; a between range reads "7.0–10.0".
function glossValue(rule) {
  return Array.isArray(rule.value) && rule.operator !== "between"
    ? rule.value.join(", ")
    : fmtValue(rule.value);
}

// A plain-sans gloss of the rule beneath the verbatim serif sentence.
function glossText(rule) {
  if (rule.logic) {
    return rule.label || `${rule.logic.replace("_", " ")} of several conditions`;
  }
  const word = OP_WORDS[rule.operator] || rule.operator;
  const unit = rule.unit ? ` ${rule.unit}` : "";
  return `${rule.field} ${word} ${glossValue(rule)}${unit}`;
}

// A nested leaf that gets a slider: one-number threshold with known bounds.
function slidable(node, allBounds) {
  return (
    !node.logic &&
    SLIDER_OPS.includes(node.operator) &&
    typeof node.value === "number" &&
    !!allBounds[node.field]
  );
}

// all_of reads "x, with conditions has y" or "x and y"; nested any_of "x or y".
function joiner(logic, child) {
  if (logic === "any_of") return " or ";
  return child.operator === "has" ? ", with " : " and ";
}

// Inline gloss of a nested node; one-number values in slider-value weight.
function Clause({ node, top }) {
  if (node.logic) {
    const kids = (node.children || []).map((c, i) => (
      <React.Fragment key={i}>
        {i > 0 && joiner(node.logic, c)}
        <Clause node={c} />
      </React.Fragment>
    ));
    return top ? kids : <>({kids})</>;
  }
  if (typeof node.value !== "number") return glossText(node);
  return (
    <>
      {node.field} {OP_WORDS[node.operator] || node.operator}{" "}
      <span className="slider-value">{node.value}</span>
      {node.unit ? ` ${node.unit}` : ""}
    </>
  );
}

// Restyled native range: value + unit (or the caller's head line), an
// as-written tick, arrow-key steps from bounds.
function Slider({
  head,
  value,
  unit,
  asWritten,
  bounds,
  disabled,
  label,
  onChange,
  onDragStart,
  onDragEnd,
}) {
  const span = bounds.max - bounds.min;
  const pct = (v) => (span > 0 ? ((Number(v) - bounds.min) / span) * 100 : 0);
  const u = unit ? ` ${unit}` : "";
  return (
    <div className="slider-wrap">
      <div className="slider-head">
        {head || (
          <span className="slider-value">
            {value}
            <span className="slider-unit">{u}</span>
          </span>
        )}
        {asWritten != null && (
          <span className="slider-aswritten">
            as written: {fmtValue(asWritten)}
          </span>
        )}
      </div>
      <div className="range-row">
        <input
          type="range"
          className="range"
          min={bounds.min}
          max={bounds.max}
          step={bounds.step}
          value={Number(value)}
          disabled={disabled}
          style={{ "--fill": `${pct(value)}%` }}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={() => onDragStart && onDragStart()}
          onPointerUp={() => onDragEnd && onDragEnd()}
          onKeyUp={() => onDragEnd && onDragEnd()}
          aria-label={label}
          aria-valuetext={`${value}${u}`}
        />
        {asWritten != null && span > 0 && (
          <span
            className="as-written-tick"
            style={{ left: `${pct(asWritten)}%` }}
            title={`as written: ${asWritten}`}
          />
        )}
      </div>
    </div>
  );
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

// One line per changed value inside a compound rule.
function NestedRedlines({ original, rule }) {
  if (!original || !rule.logic) return null;
  return leaves(rule).map(({ node, path }) => {
    const o = childAt(original, path);
    if (!o || JSON.stringify(o.value) === JSON.stringify(node.value)) return null;
    const unit = node.unit ? ` ${node.unit}` : "";
    return (
      <div className="crit-gloss" key={path.join(".")}>
        amended: {node.field} ({branchName(path[0])}){" "}
        <span className="redline-old">
          {fmtValue(o.value)}
          {unit}
        </span>
        <span className="redline-new">
          {fmtValue(node.value)}
          {unit}
        </span>
      </div>
    );
  });
}

// The structure of an any_of / all_of: "Either: …" / "Or: …", one line per
// branch. A branch with one threshold uses its line as the slider's head.
function Tree({ rule, original, allBounds, active, onValueChange, onDragStart, onDragEnd }) {
  const either = rule.logic === "any_of";
  return (
    <div className="crit-tree">
      {(rule.children || []).map((child, i) => {
        const lead = either
          ? i === 0 ? "Either: " : "Or: "
          : i === 0 ? "" : child.operator === "has" ? "with " : "and ";
        const text = (
          <span className="crit-branch-text">
            {lead}
            <Clause node={child} top />
          </span>
        );
        const sliders = leaves(child, [i]).filter(({ node }) =>
          slidable(node, allBounds)
        );
        const slider = ({ node, path }, head) => (
          <Slider
            key={path.join(".")}
            head={head}
            value={node.value}
            unit={node.unit}
            asWritten={childAt(original, path)?.value ?? null}
            bounds={allBounds[node.field]}
            disabled={!active}
            label={`${node.field} threshold, ${branchName(path[0])} of: ${
              rule.label || rule.source_sentence
            }`}
            onChange={(v) => onValueChange(rule.id, v, path)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        );
        return (
          <div className="crit-branch" key={i}>
            {sliders.length === 1 ? (
              slider(sliders[0], text)
            ) : (
              <>
                {text}
                {sliders.map((s) =>
                  slider(
                    s,
                    <span className="crit-branch-text">
                      {s.node.field}{" "}
                      <span className="slider-value">{s.node.value}</span>
                      {s.node.unit ? ` ${s.node.unit}` : ""}
                    </span>
                  )
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// One protocol criterion: verbatim serif sentence, a sans gloss, controls.
// A real checkbox drives the on/off left edge. Numeric thresholds, top-level
// or nested in any_of/all_of, get a restyled native slider with an as-written
// tick and arrow-key steps from bounds. An active row can be selected.
export default function CriterionRow({
  rule,
  original,
  bounds,
  allBounds = {},
  active,
  codeIndex, // index into active_rule_ids, or null if inactive/uneval
  selected,
  onSelect,
  onToggle,
  onValueChange,
  onDragStart,
  onDragEnd,
  onHover,
}) {
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
            Not counted — {rule.unevaluable_reason}
          </div>
        </div>
      </li>
    );
  }

  const canHover = codeIndex != null && codeIndex >= 0;
  const canSelect = !!onSelect && codeIndex != null;

  const classes = ["criterion"];
  if (!active) classes.push("off");
  if (canSelect) classes.push("selectable");
  if (selected) classes.push("selected");

  // Clicks on controls (and near-misses on a slider track) never select.
  const onRowClick = (e) => {
    if (!e.target.closest("input, button, select, label, a, .range-row")) {
      onSelect(rule.id);
    }
  };
  const sentenceButton = canSelect && {
    role: "button",
    tabIndex: 0,
    "aria-pressed": !!selected,
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(rule.id);
      }
    },
  };

  return (
    <li
      className={classes.join(" ")}
      onMouseEnter={() => canHover && onHover && onHover(codeIndex)}
      onMouseLeave={() => canHover && onHover && onHover(null)}
      onClick={canSelect ? onRowClick : undefined}
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
          <div className="crit-sentence" {...sentenceButton}>
            {rule.source_sentence || rule.label}
            {rule.added && (
              <span className="crit-added-tag">added in Sieve</span>
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
          <NestedRedlines original={original} rule={rule} />

          {rule.logic && (
            <Tree
              rule={rule}
              original={original}
              allBounds={allBounds}
              active={active}
              onValueChange={onValueChange}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}

          {numeric && (
            <Slider
              value={rule.value}
              unit={rule.unit}
              asWritten={original != null ? original.value : null}
              bounds={bounds}
              disabled={!active}
              label={`${rule.field} threshold`}
              onChange={(v) => onValueChange(rule.id, v)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
        </div>
      </div>
    </li>
  );
}

export { isNumericOp, glossText };
