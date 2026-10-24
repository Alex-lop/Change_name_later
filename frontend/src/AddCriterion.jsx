import React, { useState } from "react";

const NUMERIC_FIELDS = [
  { field: "age", unit: "years" },
  { field: "hba1c", unit: "percent" },
  { field: "bmi", unit: "kg/m2" },
  { field: "egfr", unit: "ml/min/1.73m2" },
  { field: "systolic_bp", unit: "mmhg" },
  { field: "weight", unit: "kg" },
  { field: "fasting_glucose", unit: "mg/dl" },
  { field: "creatinine", unit: "mg/dl" },
];
const CATEGORICAL = [
  { field: "conditions", op: "has" },
  { field: "medications", op: "has" },
  { field: "sex", op: "in" },
];
const NUM_OPS = [">=", ">", "<=", "<", "between"];

// A form to add an eligibility criterion by hand, without the LLM parser.
// Builds a Rule the same engine evaluates, labeled "added in Dry Run".
export default function AddCriterion({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("numeric"); // numeric | categorical
  const [field, setField] = useState("age");
  const [operator, setOperator] = useState(">=");
  const [value, setValue] = useState("");
  const [valueHigh, setValueHigh] = useState("");
  const [catValue, setCatValue] = useState("");
  const [kind, setKind] = useState("inclusion");

  function submit(e) {
    e.preventDefault();
    let rule;
    const id = `added_${Date.now()}`;
    if (mode === "numeric") {
      const meta = NUMERIC_FIELDS.find((f) => f.field === field);
      const v =
        operator === "between"
          ? [Number(value), Number(valueHigh)]
          : Number(value);
      rule = {
        id,
        field,
        operator,
        value: v,
        unit: meta?.unit || null,
        kind,
        source_sentence: `Added: ${field} ${operator} ${
          operator === "between" ? `${value}–${valueHigh}` : value
        } ${meta?.unit || ""}`.trim(),
        label: "added in Dry Run",
        added: true,
      };
    } else {
      const meta = CATEGORICAL.find((f) => f.field === field);
      const tokens = catValue
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (tokens.length === 0) return;
      rule = {
        id,
        field,
        operator: meta?.op || "has",
        value: tokens,
        unit: null,
        kind,
        source_sentence: `Added: ${field} ${meta?.op || "has"} ${tokens.join(", ")}`,
        label: "added in Dry Run",
        added: true,
      };
    }
    onAdd(rule);
    setValue("");
    setValueHigh("");
    setCatValue("");
    setOpen(false);
  }

  const fieldOptions =
    mode === "numeric"
      ? NUMERIC_FIELDS.map((f) => f.field)
      : CATEGORICAL.map((f) => f.field);

  return (
    <div className="panel add-criterion">
      {!open ? (
        <button onClick={() => setOpen(true)}>+ Add a criterion</button>
      ) : (
        <form onSubmit={submit}>
          <h3>Add a criterion <span className="added-tag">no parser</span></h3>
          <div className="add-row">
            <label>
              Type
              <select
                value={mode}
                onChange={(e) => {
                  const m = e.target.value;
                  setMode(m);
                  setField(m === "numeric" ? "age" : "conditions");
                  setOperator(m === "numeric" ? ">=" : "has");
                }}
              >
                <option value="numeric">numeric</option>
                <option value="categorical">condition / medication / sex</option>
              </select>
            </label>
            <label>
              Field
              <select value={field} onChange={(e) => setField(e.target.value)}>
                {fieldOptions.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Kind
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="inclusion">inclusion</option>
                <option value="exclusion">exclusion</option>
              </select>
            </label>
          </div>

          {mode === "numeric" ? (
            <div className="add-row">
              <label>
                Operator
                <select
                  value={operator}
                  onChange={(e) => setOperator(e.target.value)}
                >
                  {NUM_OPS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {operator === "between" ? "Low" : "Value"}
                <input
                  type="number"
                  step="any"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  required
                />
              </label>
              {operator === "between" && (
                <label>
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
            </div>
          ) : (
            <div className="add-row">
              <label className="grow">
                Value(s), comma-separated
                <input
                  placeholder="e.g. t2d  or  metformin, insulin"
                  value={catValue}
                  onChange={(e) => setCatValue(e.target.value)}
                  required
                />
              </label>
            </div>
          )}

          <div className="add-actions">
            <button type="submit">Add</button>
            <button
              type="button"
              className="chip-btn"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
