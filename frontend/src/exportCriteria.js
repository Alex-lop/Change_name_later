// Build a plain-text export of the modified protocol.
// - Active criteria with each changed threshold's before -> after value,
//   thresholds nested in any_of / all_of included.
// - Criteria added in Sieve are marked.
// - Not-evaluable criteria are listed with their reasons.

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];

// "second branch" for top-level child index 1 of a compound rule.
export function branchName(i) {
  return ORDINALS[i] ? `${ORDINALS[i]} branch` : `branch ${i + 1}`;
}

// The node at a child-index path inside a rule; [] is the rule itself.
export function childAt(rule, path) {
  return path.reduce((n, i) => n && n.children && n.children[i], rule);
}

// Every leaf under a node, with its child-index path.
export function leaves(node, path = [], out = []) {
  if (node.logic) {
    (node.children || []).forEach((c, i) => leaves(c, [...path, i], out));
  } else {
    out.push({ node, path });
  }
  return out;
}

// Lists read "mi, stroke"; a between range reads "7.0–10.0".
function fmtVal(v, op) {
  if (Array.isArray(v)) return v.join(op === "between" ? "–" : ", ");
  return String(v);
}

// "age >= 50 years"; a compound lists its children: "any_of(all_of(…), …)".
function expr(node) {
  if (node.logic) {
    return `${node.logic}(${(node.children || []).map(expr).join(", ")})`;
  }
  return `${node.field} ${node.operator} ${fmtVal(node.value, node.operator)}${
    node.unit ? " " + node.unit : ""
  }`;
}

function amended(original, rule) {
  return original && JSON.stringify(original.value) !== JSON.stringify(rule.value);
}

function ruleLine(rule, original) {
  const label = rule.label || rule.source_sentence || rule.id;
  let line = `- [${rule.kind}] ${label}: ${expr(rule)}`;
  if (rule.added) line += "  (added in Sieve)";
  // Redline a changed threshold: struck original, new value, Sieve wording.
  if (!rule.logic && amended(original, rule)) {
    line += `  (amended in Sieve: ~~${fmtVal(original.value, rule.operator)}~~ ${fmtVal(rule.value, rule.operator)})`;
  }
  // A nested threshold also names its field and branch.
  if (rule.logic && original) {
    leaves(rule).forEach(({ node, path }) => {
      const o = childAt(original, path);
      if (amended(o, node)) {
        line += `  (amended in Sieve: ${node.field} ~~${fmtVal(o.value, node.operator)}~~ ${fmtVal(node.value, node.operator)}, ${branchName(path[0])})`;
      }
    });
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
  lines.push(`Sieve — modified eligibility criteria`);
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
