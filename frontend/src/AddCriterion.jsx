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

// Add a criterion by hand. One inline row on --paper-2 with four controls:
// field, comparison, value with unit, inclusion or exclusion. Builds a Rule the
// same engine evaluates, tagged "added in Sieve".
export default function AddCriterion({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("numeric");
  const [field, setField] = useState("age");
  const [operator, setOperator] = useState(">=");
  const [value, setValue] = useState("");
  const [valueHigh, setValueHigh] = useState("");
  const [catValue, setCatValue] = useState("");
  const [kind, setKind] = useState("inclusion");

  function submit(e) {
    e.preventDefault();
    const id = `added_${Date.now()}`;
    let rule;
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
        source_sentence: `${field} ${operator} ${
          operator === "between" ? `${value}–${valueHigh}` : value
        } ${meta?.unit || ""}`.trim(),
        label: `${field} ${operator} ${
          operator === "between" ? `${value}–${valueHigh}` : value
        }`.trim(),
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
        source_sentence: `${field} ${meta?.op || "has"} ${tokens.join(", ")}`,
        label: `${field} ${meta?.op || "has"} ${tokens.join(", ")}`,
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

  if (!open) {
    return (
      <button className="add-trigger" onClick={() => setOpen(true)}>
        + Add a criterion
      </button>
    );
  }

  return (
    <form className="add-panel" onSubmit={submit}>
      <div className="add-grid">
        <label className="add-field">
          Field
          <select
            value={field}
            onChange={(e) => setField(e.target.value)}
          >
            <optgroup label="numeric">
              {NUMERIC_FIELDS.map((f) => (
                <option key={f.field} value={f.field}>
                  {f.field}
                </option>
              ))}
            </optgroup>
            <optgroup label="category">
              {CATEGORICAL.map((f) => (
                <option key={f.field} value={f.field}>
                  {f.field}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <label className="add-field">
          Comparison
          {mode === "numeric" ? (
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
          ) : (
            <select disabled value="has">
              <option value="has">has</option>
            </select>
          )}
        </label>

        {mode === "numeric" ? (
          <>
            <label className="add-field">
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
          <label className="add-field">
            Value(s), comma-separated
            <input
              placeholder="e.g. metformin, insulin"
              value={catValue}
              onChange={(e) => setCatValue(e.target.value)}
              required
            />
          </label>
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
        <button type="submit" className="btn btn-primary">
          Add
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const m = mode === "numeric" ? "categorical" : "numeric";
            setMode(m);
            setField(m === "numeric" ? "age" : "conditions");
            setOperator(m === "numeric" ? ">=" : "has");
          }}
        >
          {mode === "numeric" ? "Switch to category" : "Switch to numeric"}
        </button>
      </div>
    </form>
  );
}
