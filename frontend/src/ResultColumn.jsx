import React from "react";
import Odometer from "./Odometer";
import PatientField from "./PatientField";
import ConsortFlow from "./ConsortFlow";
import CostTable from "./CostTable";
import { fmtInt, fmtMoney, fmtMonths, fmtDelta } from "./format";

// The sticky result column: result sentence, three numbers, the patient field,
// a CONSORT-style flow, and the cost table.
export default function ResultColumn({
  analysis,
  baseline,
  edited,
  populationLabel,
  rulesById,
  assumptions,
  dragging,
  hotIndex,
  onHover,
}) {
  if (!analysis) return null;

  const cost = analysis.cost || {};
  const baseCost = baseline?.cost || {};
  const total = analysis.total_patients;
  const confirmed = analysis.confirmed_eligible;
  const possibly = analysis.possibly_eligible;

  const confDelta =
    baseline != null ? confirmed - baseline.confirmed_eligible : null;
  const monthsDelta =
    cost.enrollment_months != null && baseCost.enrollment_months != null
      ? cost.enrollment_months - baseCost.enrollment_months
      : null;
  const costDelta =
    cost.delay_cost != null && baseCost.delay_cost != null
      ? cost.delay_cost - baseCost.delay_cost
      : null;

  const label = populationLabel || "adults with type 2 diabetes";

  // Result sentence: as-written vs after edits.
  let sentence;
  if (!edited || confDelta == null || confDelta === 0) {
    sentence = (
      <>
        As written, {fmtInt(confirmed)} of {fmtInt(total)} synthetic {label} are
        eligible.
      </>
    );
  } else {
    const more = confDelta > 0;
    const monthsPhrase =
      monthsDelta != null && Math.abs(monthsDelta) >= 0.05
        ? `, ${monthsDelta < 0 ? "shortening" : "lengthening"} enrollment by about ${fmtMonths(Math.abs(monthsDelta))} months`
        : "";
    sentence = (
      <>
        Your changes {more ? "admit" : "remove"} {fmtInt(Math.abs(confDelta))}{" "}
        {more ? "more" : "fewer"} patients{monthsPhrase}.
      </>
    );
  }

  const ariaLabel =
    `Patient field: ${fmtInt(confirmed)} eligible, ` +
    `${fmtInt(possibly - confirmed)} possibly eligible with missing data, ` +
    `${fmtInt(total - possibly)} excluded, of ${fmtInt(total)} synthetic patients.`;

  const monthsDeltaStr = fmtDelta(monthsDelta, { months: true });
  const costDeltaStr = fmtDelta(costDelta, { money: true });

  return (
    <div className="result-col-inner">
      <p className="result-sentence">{sentence}</p>

      <div className="numbers">
        <div className="number">
          <div className="number-value accent">
            <Odometer value={confirmed} />
          </div>
          <div className="number-label">eligible patients</div>
          <div className="number-delta">
            {confDelta == null || confDelta === 0
              ? "same as the protocol"
              : `${fmtDelta(confDelta)} vs the protocol`}
          </div>
        </div>

        <div className="number">
          <div className="number-value">
            {cost.enrollment_months != null
              ? `about ${fmtMonths(cost.enrollment_months)}`
              : "—"}
          </div>
          <div className="number-label">months to enroll (estimate)</div>
          <div className="number-delta">
            {monthsDeltaStr
              ? `${monthsDeltaStr} mo vs the protocol`
              : "same as the protocol"}
          </div>
        </div>

        <div className="number">
          <div className="number-value">
            {cost.delay_cost != null ? `about ${fmtMoney(cost.delay_cost)}` : "—"}
          </div>
          <div className="number-label">delay cost (estimate)</div>
          <div className="number-delta">
            {costDeltaStr
              ? `${costDeltaStr} vs the protocol`
              : "same as the protocol"}
          </div>
        </div>
      </div>

      <p className="uptoline">
        up to {fmtInt(possibly)} if missing data checks out.
      </p>

      <PatientField
        codes={analysis.patient_codes}
        highlightCode={hotIndex}
        ariaLabel={ariaLabel}
      />

      <h2 className="section-heading">How the cohort narrows</h2>
      <ConsortFlow funnel={analysis.funnel} rulesById={rulesById} />

      <CostTable
        priceTags={analysis.price_tags}
        perRuleCost={analysis.per_rule_cost}
        baselineMonths={cost.enrollment_months}
        costPerDay={assumptions?.cost_per_day}
        activeRuleIds={analysis.active_rule_ids}
        dragging={dragging}
        onHover={onHover}
        hotIndex={hotIndex}
      />
    </div>
  );
}
