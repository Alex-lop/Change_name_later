import React, { useEffect, useMemo, useRef, useState } from "react";

// A rolling-digit odometer for the eligible count. Each digit column holds
// 0-9 stacked vertically; changing the value slides the column to the new
// digit (~600ms). Thousands separators are rendered as static glyphs.
// prefers-reduced-motion: value changes snap with no transition.

function useReducedMotion() {
  return useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );
}

function Digit({ value, reduce }) {
  // value is 0-9; translate the strip up by value * 1em.
  const strip = [];
  for (let d = 0; d <= 9; d++) strip.push(d);
  return (
    <span className="odo-digit" aria-hidden="true">
      <span
        className="odo-strip"
        style={{
          transform: `translateY(-${value}em)`,
          transition: reduce ? "none" : undefined,
        }}
      >
        {strip.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </span>
    </span>
  );
}

export default function Odometer({ value }) {
  const reduce = useReducedMotion();
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const str = safe.toLocaleString("en-US"); // e.g. "1,529"

  // Render each char: digits roll, separators are static.
  const chars = str.split("");

  return (
    <span className="odometer" role="text" aria-label={safe.toLocaleString()}>
      {chars.map((c, i) =>
        /\d/.test(c) ? (
          <Digit key={i} value={Number(c)} reduce={reduce} />
        ) : (
          <span className="odo-sep" key={i} aria-hidden="true">
            {c}
          </span>
        )
      )}
    </span>
  );
}
