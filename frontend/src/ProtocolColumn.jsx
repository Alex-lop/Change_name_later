import React from "react";
import CriterionRow from "./CriterionRow";
import AddCriterion from "./AddCriterion";
import AssumptionsPanel from "./AssumptionsPanel";

// The synthetic population is adults with type 2 diabetes. A trial whose
// condition is something else (or includes people without diabetes) gets a
// plain note saying what the counts do and don't cover.
const T2D_FIRST = /^\s*(type ?2 diabetes|diabetes mellitus,? type ?2|t2dm?\b)/i;

// The protocol column. Reads like a protocol: a title, a coverage line, then
// sections "Inclusion criteria", "Exclusion criteria", "Not evaluable on this
// data", "Not translated yet". Each criterion shows its verbatim serif
// sentence, a sans gloss, and its controls. "Add a criterion" and the
// assumptions drawer sit at the bottom.
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
  selectedRuleId,
  onSelect,
  untranslated = [], // [{sentence, kind}] not in the translation cache
  draft,
  onTranslate,
  onDraftDone,
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
      allBounds={bounds}
      active={activeIds.includes(r.id)}
      codeIndex={codeIndexOf[r.id] != null ? codeIndexOf[r.id] : null}
      onToggle={onToggle}
      onValueChange={onValueChange}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onHover={onHover}
      selected={selectedRuleId === r.id}
      onSelect={onSelect}
    />
  );

  const title = trialMeta?.title || trialMeta?.nct_id || "Pasted criteria";
  const condition = trialMeta?.condition;
  const n = untranslated.length;

  return (
    <div className="protocol-col-inner">
      <div className="trial-title">{title}</div>
      {coverage && coverage.total > 0 ? (
        <div className="coverage-line">
          Sieve can evaluate {coverage.evaluable} of {coverage.total} criteria
          on this data.{n > 0 && ` ${n} more ${n > 1 ? "aren't" : "isn't"} translated yet.`}
        </div>
      ) : (
        n > 0 && (
          <div className="coverage-line">
            None of these {n} criteria {n > 1 ? "are" : "is"} translated yet.
          </div>
        )
      )}
      {condition && !T2D_FIRST.test(condition) && (
        <p className="population-note">
          This study is about {condition}. Sieve's synthetic population is
          adults with type 2 diabetes, so the counts show how these criteria act
          on that group, not on everyone the study could enroll.
        </p>
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

      {n > 0 && (
        <>
          <h2 className="section-heading">Not translated yet</h2>
          <p className="section-note">
            These sentences aren't in Sieve's translation cache, so they change
            no count. Add the ones you need by hand; the sentence stays word for
            word.
          </p>
          <ul className="criteria-list">
            {untranslated.map((u, i) => (
              <li
                key={i + u.sentence}
                className={`criterion untranslated${draft?.sentence === u.sentence ? " drafting" : ""}`}
              >
                <div className="crit-body">
                  <div className="crit-sentence">{u.sentence}</div>
                  <div className="crit-untranslated-row">
                    {u.kind && (
                      <span className="crit-kind">
                        {u.kind === "exclusion" ? "Exclusion" : "Inclusion"}
                      </span>
                    )}
                    <button
                      type="button"
                      className="crit-translate"
                      aria-pressed={draft?.sentence === u.sentence}
                      onClick={() => onTranslate?.(u)}
                    >
                      Add by hand
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <AddCriterion onAdd={onAddRule} draft={draft} onDraftDone={onDraftDone} />

      <AssumptionsPanel
        assumptions={assumptions}
        onChange={onAssumptionsChange}
      />
    </div>
  );
}
