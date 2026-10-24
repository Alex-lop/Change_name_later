import React from "react";
import CriterionRow from "./CriterionRow";
import AddCriterion from "./AddCriterion";
import AssumptionsPanel from "./AssumptionsPanel";

// The protocol column. Reads like a protocol: a title, a coverage line, then
// sections "Inclusion criteria", "Exclusion criteria", "Not evaluable on this
// data". Each criterion shows its verbatim serif sentence, a sans gloss, and
// its controls. "Add a criterion" and the assumptions drawer sit at the bottom.
export default function ProtocolColumn({
  trialMeta,
  rules,
  originalById,
  bounds,
  activeIds,
  activeRuleIds, // order used by analysis -> code index for hover highlight
  coverage,
  onToggle,
  onValueChange,
  onAddRule,
  onDragStart,
  onDragEnd,
  onHover,
  assumptions,
  onAssumptionsChange,
}) {
  const codeIndexOf = {};
  (activeRuleIds || []).forEach((id, i) => (codeIndexOf[id] = i));

  const evaluable = rules.filter((r) => r.evaluable !== false);
  const inclusion = evaluable.filter((r) => r.kind !== "exclusion");
  const exclusion = evaluable.filter((r) => r.kind === "exclusion");
  const notEvaluable = rules.filter((r) => r.evaluable === false);

  const renderRow = (r) => (
    <CriterionRow
      key={r.id}
      rule={r}
      original={originalById[r.id]}
      bounds={bounds[r.field]}
      active={activeIds.includes(r.id)}
      codeIndex={codeIndexOf[r.id] != null ? codeIndexOf[r.id] : null}
      onToggle={onToggle}
      onValueChange={onValueChange}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onHover={onHover}
    />
  );

  const title = trialMeta?.title || "Pasted criteria";

  return (
    <div className="protocol-col-inner">
      <div className="trial-title">{title}</div>
      {coverage && coverage.total > 0 && (
        <div className="coverage-line">
          Dry Run can evaluate {coverage.evaluable} of {coverage.total} criteria
          on this data.
        </div>
      )}

      {inclusion.length > 0 && (
        <>
          <h2 className="section-heading">Inclusion criteria</h2>
          <ul className="criteria-list">{inclusion.map(renderRow)}</ul>
        </>
      )}

      {exclusion.length > 0 && (
        <>
          <h2 className="section-heading">Exclusion criteria</h2>
          <ul className="criteria-list">{exclusion.map(renderRow)}</ul>
        </>
      )}

      {notEvaluable.length > 0 && (
        <>
          <h2 className="section-heading">Not evaluable on this data</h2>
          <ul className="criteria-list">{notEvaluable.map(renderRow)}</ul>
        </>
      )}

      <AddCriterion onAdd={onAddRule} />

      <AssumptionsPanel
        assumptions={assumptions}
        onChange={onAssumptionsChange}
      />
    </div>
  );
}
