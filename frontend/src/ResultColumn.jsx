import React from "react";
import Odometer from "./Odometer";
import PatientField from "./PatientField";
import ConsortFlow from "./ConsortFlow";
import CostTable from "./CostTable";
import MapView, { MapCaption } from "./MapView";
import { fmtInt, fmtMoney, fmtMonths, fmtDelta } from "./format";

// The sticky result column: result sentence, three numbers, the patient field,
// a CONSORT-style flow, and the cost table.
export default function ResultColumn({
  analysis,
  baseline,
  edited,
  paraphrased,
  rulesById,
  assumptions,
  dragging,
  hotIndex,
  onHover,
  geo, // null until /api/geo answers
  showMap,
  areas,
  baselineAreas,
  nctId,
  fieldView,
  onFieldViewChange,
  selectedRuleId,
  onSelect,
  onClearSelection,
  noProtocol, // nothing was translated: every criterion was added by hand
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

  // Result sentence: as-written vs after edits.
  let sentence;
  if (noProtocol) {
    sentence = (
      <>
        {fmtInt(confirmed)} of {fmtInt(total)} eligible.
      </>
    );
  } else if (!edited || confDelta == null || confDelta === 0) {
    sentence = (
      <>
        {fmtInt(confirmed)} of {fmtInt(total)} eligible, as written.
      </>
    );
  } else {
    const more = confDelta > 0;
    const monthsPhrase =
      monthsDelta != null && Math.abs(monthsDelta) >= 0.05
        ? `, about ${fmtMonths(Math.abs(monthsDelta))} months ${monthsDelta < 0 ? "sooner" : "later"}`
        : "";
    sentence = (
      <>
        {fmtInt(Math.abs(confDelta))} {more ? "more" : "fewer"} patients{monthsPhrase}.
      </>
    );
  }

  const ariaLabel =
    `Patient field: ${fmtInt(confirmed)} eligible, ` +
    `${fmtInt(possibly - confirmed)} possibly eligible with missing data, ` +
    `${fmtInt(total - possibly)} excluded, of ${fmtInt(total)} synthetic patients.`;

  const labelOf = (id) => rulesById[id]?.label || rulesById[id]?.source_sentence || id;
  const activeRuleLabels = (analysis.active_rule_ids || []).map(labelOf);
  const selected = selectedRuleId
    ? { ruleId: selectedRuleId, gloss: labelOf(selectedRuleId) }
    : null;

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
          <div className="number-label">eligible</div>
          <div className="number-delta">
            {noProtocol
              ? "added by hand"
              : confDelta == null || confDelta === 0
                ? "as written"
                : `${fmtDelta(confDelta)} vs protocol`}
          </div>
        </div>

        <div className="number">
          <div className="number-value">
            {cost.enrollment_months != null
              ? `about ${fmtMonths(cost.enrollment_months)}`
              : "—"}
          </div>
          <div className="number-label">months to enroll</div>
          <div className="number-delta">
            {noProtocol
              ? "added by hand"
              : monthsDeltaStr
                ? `${monthsDeltaStr} mo vs protocol`
                : "as written"}
          </div>
        </div>

        <div className="number">
          <div className="number-value">
            {cost.delay_cost != null ? `about ${fmtMoney(cost.delay_cost)}` : "—"}
          </div>
          <div className="number-label">delay cost</div>
          <div className="number-delta">
            {noProtocol
              ? "added by hand"
              : costDeltaStr
                ? `${costDeltaStr} vs protocol`
                : "as written"}
          </div>
        </div>
      </div>

      <p className="uptoline">
        Up to {fmtInt(possibly)} if missing data checks out.
      </p>

      <PatientField
        codes={analysis.patient_codes}
        highlightCode={hotIndex}
        ariaLabel={ariaLabel}
        view={showMap ? fieldView : "age"}
        onViewChange={onFieldViewChange}
        mapSlot={
          showMap ? (
            <MapView
              geo={geo}
              areas={areas}
              baselineAreas={baselineAreas}
              selected={selected}
              onClearSelection={onClearSelection}
              nctId={nctId}
            />
          ) : null
        }
        mapCaption={showMap ? <MapCaption geo={geo} /> : null}
        geoPatients={geo?.patients || null}
        areaLabels={geo?.areas ? geo.areas.map((a) => a.label) : null}
        activeRuleLabels={activeRuleLabels}
      />

      <h2 className="section-heading">Enrollment funnel</h2>
      <ConsortFlow funnel={analysis.funnel} rulesById={rulesById} />

      <CostTable
        priceTags={analysis.price_tags}
        perRuleCost={analysis.per_rule_cost}
        baselineMonths={cost.enrollment_months}
        costPerDay={assumptions?.cost_per_day}
        activeRuleIds={analysis.active_rule_ids}
        paraphrased={paraphrased}
        dragging={dragging}
        onHover={onHover}
        hotIndex={hotIndex}
        selectedRuleId={selectedRuleId}
        onSelect={onSelect}
      />
    </div>
  );
}
