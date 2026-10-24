import React, { useState } from "react";

// Load any trial: an NCT ID, fetched live from ClinicalTrials.gov API v2, or
// pasted eligibility text. Sentences Sieve has already translated become
// rules; the rest are listed verbatim so they can be added by hand.
export default function TrialLoader({ loading, onLoadNct, onLoadText, onClose }) {
  const [mode, setMode] = useState("nct");
  const [nct, setNct] = useState("");
  const [text, setText] = useState("");
  const id = nct.trim().toUpperCase();
  const valid = /^NCT\d{8}$/.test(id);

  return (
    <section className="loader" aria-label="Load any trial">
      {mode === "nct" ? (
        <form
          className="loader-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !loading) onLoadNct(id);
          }}
        >
          <label className="loader-field">
            ClinicalTrials.gov ID
            <input
              value={nct}
              onChange={(e) => setNct(e.target.value)}
              placeholder="NCT03819153"
              spellCheck={false}
              autoComplete="off"
              autoFocus
              aria-describedby="loader-note"
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={!valid || loading}>
            {loading ? "Loading…" : "Load trial"}
          </button>
          <button className="btn-text" type="button" onClick={() => setMode("text")}>
            Paste criteria instead
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() && !loading) onLoadText(text);
          }}
        >
          <label className="loader-field">
            Eligibility criteria
            <textarea
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Inclusion Criteria:\nAge 18 years or older\n\nExclusion Criteria:\nType 1 diabetes"}
              autoFocus
              aria-describedby="loader-note"
            />
          </label>
          <div className="loader-row">
            <button className="btn btn-primary" type="submit" disabled={!text.trim() || loading}>
              {loading ? "Loading…" : "Use these criteria"}
            </button>
            <button className="btn-text" type="button" onClick={() => setMode("nct")}>
              Load an NCT ID instead
            </button>
          </div>
        </form>
      )}
      <p className="loader-note" id="loader-note">
        Cached sentences become criteria. The rest stay as text until you add
        them. Counts use the synthetic type 2 diabetes cohort.
      </p>
      <button className="btn-text loader-close" type="button" onClick={onClose}>
        Close
      </button>
    </section>
  );
}
