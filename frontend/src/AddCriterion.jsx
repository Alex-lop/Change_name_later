import React, { useEffect, useRef, useState } from "react";

const NUMERIC_FIELDS = [
  { field: "age", unit: "years", name: "age" },
  { field: "hba1c", unit: "percent", name: "HbA1c" },
  { field: "bmi", unit: "kg/m2", name: "BMI" },
  { field: "egfr", unit: "ml/min/1.73m2", name: "eGFR" },
  { field: "systolic_bp", unit: "mmhg", name: "systolic blood pressure" },
  { field: "weight", unit: "kg", name: "weight" },
  { field: "fasting_glucose", unit: "mg/dl", name: "fasting glucose" },
  { field: "creatinine", unit: "mg/dl", name: "creatinine" },
];
// Tokens the synthetic records actually carry (backend/dryrun/synthea.py).
// Condition and medication lists are closed-world: no record means "doesn't have it".
const CATEGORICAL = {
  conditions: {
    op: "has",
    name: "conditions",
    tokens: [
      ["t2d", "type 2 diabetes"],
      ["t1d", "type 1 diabetes"],
      ["hypertension", "hypertension"],
      ["ckd", "chronic kidney disease"],
      ["dialysis", "dialysis"],
      ["chf", "heart failure"],
      ["mi", "myocardial infarction"],
      ["stroke", "stroke"],
      ["pancreatitis", "pancreatitis"],
      ["cancer", "cancer"],
    ],
  },
  medications: {
    op: "has",
    name: "medications",
    tokens: [
      ["metformin", "metformin"],
      ["insulin", "insulin"],
      ["glp1 agonist", "GLP-1 receptor agonist"],
      ["dpp4 inhibitor", "DPP-4 inhibitor"],
      ["lisinopril", "lisinopril (ACE inhibitor)"],
    ],
  },
  sex: { op: "in", name: "sex", tokens: [["male", "male"], ["female", "female"]] },
};
const NUM_OPS = [">=", ">", "<=", "<", "between"];
const isNumeric = (f) => NUMERIC_FIELDS.some((x) => x.field === f);

// ---- suggestion from an untranslated sentence --------------------------------
// A best guess to save typing. The person checks it and presses Add; nothing is
// counted until they do.
const FIELD_HINTS = [
  ["egfr", /\be?gfr\b|glomerular filtration/i], // before creatinine: "creatinine-based eGFR"
  ["hba1c", /\bhba1c\b|\ba1c\b|glycated|glycosylated/i],
  ["bmi", /\bbmi\b|body mass index/i],
  ["systolic_bp", /systolic/i],
  ["fasting_glucose", /fasting (plasma )?glucose|\bfpg\b/i],
  ["creatinine", /\bcreatinine\b/i],
  ["weight", /\bweight\b/i],
  ["age", /\bage[ds]?\b|years of age|years old/i],
];
const NUM = String.raw`(\d+(?:\.\d+)?)`;
// Order matters on ties: ">=" phrases contain ">" phrases.
const OPS = [
  [">=", /≥|>=|at least|greater than or equal to|above or equal to|equal to or (?:greater|above|more) than|minimum of/i],
  ["<=", /≤|<=|at most|less than or equal to|below or equal to|equal to or (?:less|below|lower) than|no more than|maximum of|up to/i],
  [">", />|greater than|more than|above|over|exceeding|higher than/i],
  ["<", /<|less than|below|under|lower than/i],
];
const CONDITION_HINTS = [
  ["t1d", /type 1 diabetes|\bt1dm?\b/i],
  ["t2d", /type 2 diabetes|\bt2dm?\b/i],
  ["dialysis", /dialysis/i],
  ["pancreatitis", /pancreatitis/i],
  ["chf", /heart failure/i],
  ["mi", /myocardial infarction|heart attack/i],
  ["stroke", /\bstroke\b/i],
  ["cancer", /malignan|cancer|neoplasm/i],
  ["hypertension", /hypertension/i],
  ["ckd", /chronic kidney disease|\bckd\b/i],
];
const MED_HINTS = [
  ["metformin", /metformin/i],
  ["insulin", /\binsulin\b/i],
  ["glp1 agonist", /glp-?1/i],
  ["dpp4 inhibitor", /dpp-?4/i],
  ["lisinopril", /lisinopril|ace inhibitor/i],
];

export function suggestRule(sentence) {
  const s = sentence || "";
  for (const [field, rx] of FIELD_HINTS) {
    const m = rx.exec(s);
    if (!m) continue;
    const after = s.slice(m.index);
    const between = new RegExp(String.raw`between\s+${NUM}\D{0,12}?\s+and\s+${NUM}`, "i").exec(after);
    if (between) return { field, operator: "between", value: between[1], valueHigh: between[2] };
    const postfix = new RegExp(String.raw`${NUM}[^,;]{0,20}?\bor (older|more|higher|greater|above|younger|less|lower|below)\b`, "i").exec(after);
    let best = null;
    for (const [op, orx] of OPS) {
      const om = new RegExp(String.raw`(?:${orx.source})\D{0,24}?${NUM}`, "i").exec(after);
      if (om && (best == null || om.index < best.index)) best = { index: om.index, op, value: om[1] };
    }
    if (postfix && (best == null || postfix.index < best.index)) {
      const up = /older|more|higher|greater|above/i.test(postfix[2]);
      return { field, operator: up ? ">=" : "<=", value: postfix[1] };
    }
    if (best) return { field, operator: best.op, value: best.value };
    return { field };
  }
  const conds = CONDITION_HINTS.filter(([, rx]) => rx.test(s)).map(([t]) => t);
  if (conds.length) return { field: "conditions", tokens: conds };
  const meds = MED_HINTS.filter(([, rx]) => rx.test(s)).map(([t]) => t);
  if (meds.length) return { field: "medications", tokens: meds };
  return null;
}

// Add a criterion by hand. One inline row on --paper-2: field, comparison,
// value with unit (or which conditions/medications), inclusion or exclusion.
// Builds a Rule the same engine evaluates, tagged "added in Sieve". When it
// comes from an untranslated sentence (`draft`), that sentence is kept word
// for word as the rule's source.
export default function AddCriterion({ onAdd, draft, onDraftDone }) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState("age");
  const [operator, setOperator] = useState(">=");
  const [value, setValue] = useState("");
  const [valueHigh, setValueHigh] = useState("");
  const [tokens, setTokens] = useState([]);
  const [kind, setKind] = useState("inclusion");
  const [suggested, setSuggested] = useState(false);
  const panelRef = useRef(null);

  const numeric = isNumeric(field);

  // A sentence handed over from "Not translated yet": open, prefill, show it.
  useEffect(() => {
    if (!draft) return;
    const g = suggestRule(draft.sentence);
    setOpen(true);
    setKind(draft.kind || "inclusion");
    setSuggested(!!g);
    setField(g?.field || "age");
    setOperator(g?.operator || (g?.field && !isNumeric(g.field) ? "has" : ">="));
    setValue(g?.value ?? "");
    setValueHigh(g?.valueHigh ?? "");
    setTokens(g?.tokens || []);
    requestAnimationFrame(() =>
      panelRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" })
    );
  }, [draft]);

  function close() {
    setOpen(false);
    setSuggested(false);
    onDraftDone?.();
  }

  function submit(e) {
    e.preventDefault();
    const id = `added_${Date.now()}`;
    let rule;
    if (numeric) {
      const meta = NUMERIC_FIELDS.find((f) => f.field === field);
      const between = operator === "between";
      const v = between ? [Number(value), Number(valueHigh)] : Number(value);
      const shown = between ? `${value}–${valueHigh}` : value;
      const label = `${kind === "exclusion" ? "Exclude " : ""}${meta.name} ${operator} ${shown}`;
      rule = {
        id,
        field,
        operator,
        value: v,
        unit: meta.unit,
        kind,
        source_sentence: draft?.sentence || `${field} ${operator} ${shown} ${meta.unit}`,
        label,
        added: true,
      };
    } else {
      const meta = CATEGORICAL[field];
      if (tokens.length === 0) return;
      const names = tokens.map((t) => meta.tokens.find(([k]) => k === t)?.[1] || t);
      const label =
        kind === "exclusion"
          ? `Exclude ${names.join(" or ")}`
          : field === "sex"
            ? `Sex: ${names.join(" or ")}`
            : `Has ${names.join(" or ")}`;
      rule = {
        id,
        field,
        operator: meta.op,
        value: tokens,
        unit: null,
        kind,
        source_sentence: draft?.sentence || `${field} ${meta.op} ${tokens.join(", ")}`,
        label,
        added: true,
      };
    }
    onAdd(rule);
    setValue("");
    setValueHigh("");
    setTokens([]);
    setOpen(false);
    setSuggested(false);
  }

  if (!open) {
    return (
      <button className="add-trigger" onClick={() => setOpen(true)}>
        + Add a criterion
      </button>
    );
  }

  const cat = CATEGORICAL[field];

  return (
    <form className="add-panel" onSubmit={submit} ref={panelRef} aria-label="Add a criterion">
      {draft && (
        <p className="add-draft">
          <span className="add-draft-label">Adding by hand:</span>{" "}
          <span className="add-draft-sentence">{draft.sentence}</span>
        </p>
      )}
      {suggested && (
        <p className="add-suggested">
          Filled in from the sentence as a suggestion. Check it before adding.
        </p>
      )}
      <div className="add-grid">
        <label className="add-field">
          Field
          <select
            value={field}
            onChange={(e) => {
              const f = e.target.value;
              setField(f);
              setTokens([]);
              setOperator(isNumeric(f) ? ">=" : CATEGORICAL[f].op);
            }}
          >
            <optgroup label="Measurements">
              {NUMERIC_FIELDS.map((f) => (
                <option key={f.field} value={f.field}>
                  {f.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Records">
              {Object.entries(CATEGORICAL).map(([f, m]) => (
                <option key={f} value={f}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        {numeric ? (
          <>
            <label className="add-field">
              Comparison
              <select value={operator} onChange={(e) => setOperator(e.target.value)}>
                {NUM_OPS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <label className="add-field">
              {operator === "between" ? "Low" : "Value"} (
              {NUMERIC_FIELDS.find((f) => f.field === field)?.unit})
              <input
                type="number"
                step="any"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </label>
            {operator === "between" && (
              <label className="add-field">
                High
                <input
                  type="number"
                  step="any"
                  value={valueHigh}
                  onChange={(e) => setValueHigh(e.target.value)}
                  required
                />
              </label>
            )}
          </>
        ) : (
          <fieldset className="add-tokens">
            <legend>{field === "sex" ? "Is" : "Has any of"}</legend>
            {cat.tokens.map(([t, name]) => (
              <label key={t} className="add-token">
                <input
                  type="checkbox"
                  checked={tokens.includes(t)}
                  onChange={(e) =>
                    setTokens((prev) =>
                      e.target.checked ? [...prev, t] : prev.filter((x) => x !== t)
                    )
                  }
                />
                {name}
              </label>
            ))}
          </fieldset>
        )}

        <label className="add-field">
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="inclusion">inclusion</option>
            <option value="exclusion">exclusion</option>
          </select>
        </label>
      </div>

      <div className="add-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!numeric && tokens.length === 0}
        >
          Add
        </button>
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}
