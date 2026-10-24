// Build a plain-text export of the modified protocol.
// - Active criteria with each changed threshold's before -> after value.
// - Criteria added in Dry Run are marked.
// - Not-evaluable criteria are listed with their reasons.

function fmtVal(v) {
  if (Array.isArray(v)) return v.join("–");
  return String(v);
}

function ruleLine(rule, original) {
  const label = rule.label || rule.source_sentence || rule.id;
  let expr;
  if (rule.logic) {
    expr = `${rule.logic} of ${(rule.children || []).length} conditions`;
  } else {
    expr = `${rule.field} ${rule.operator} ${fmtVal(rule.value)}${
      rule.unit ? " " + rule.unit : ""
    }`;
  }
  let line = `- [${rule.kind}] ${label}: ${expr}`;
  if (rule.added) line += "  (added in Dry Run)";
  // before -> after for a changed threshold
  if (
    original &&
    !rule.logic &&
    JSON.stringify(original.value) !== JSON.stringify(rule.value)
  ) {
    line += `  (was ${fmtVal(original.value)}, now ${fmtVal(rule.value)})`;
  }
  return line;
}

export function buildExportText({
  trialTitle,
  rules,
  originalById,
  activeIds,
  analysis,
}) {
  const lines = [];
  lines.push(`Dry Run — modified eligibility criteria`);
  if (trialTitle) lines.push(trialTitle);
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push("");

  if (analysis) {
    lines.push(
      `Confirmed eligible: ${analysis.confirmed_eligible} of ${analysis.total_patients} ` +
        `(${(analysis.confirmed_fraction * 100).toFixed(1)}%) adults with type 2 diabetes`
    );
    if (analysis.cost && analysis.cost.enrollment_months != null) {
      lines.push(
        `Est. enrollment time: ${analysis.cost.enrollment_months} months ` +
          `(estimate); delay cost ${
            analysis.cost.delay_cost != null
              ? "$" + Math.round(analysis.cost.delay_cost).toLocaleString()
              : "—"
          }`
      );
    }
    if (analysis.coverage) {
      lines.push(
        `Coverage: ${analysis.coverage.evaluable} of ${analysis.coverage.total} ` +
          `criteria evaluable (${Math.round(analysis.coverage.score * 100)}%)`
      );
    }
    lines.push("");
  }

  const activeEvaluable = rules.filter(
    (r) => activeIds.includes(r.id) && r.evaluable !== false
  );
  lines.push("ACTIVE CRITERIA");
  if (activeEvaluable.length === 0) lines.push("(none)");
  activeEvaluable.forEach((r) => lines.push(ruleLine(r, originalById[r.id])));

  const inactive = rules.filter(
    (r) => !activeIds.includes(r.id) && r.evaluable !== false
  );
  if (inactive.length) {
    lines.push("");
    lines.push("TURNED OFF");
    inactive.forEach((r) => lines.push(ruleLine(r, originalById[r.id])));
  }

  const notEvaluable =
    (analysis && analysis.coverage && analysis.coverage.not_evaluable) || [];
  if (notEvaluable.length) {
    lines.push("");
    lines.push("NOT EVALUABLE (shown, but change no count)");
    notEvaluable.forEach((u) =>
      lines.push(`- ${u.label}: ${u.reason}`)
    );
  }

  lines.push("");
  lines.push("Cost and enrollment figures are estimates.");
  return lines.join("\n");
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
