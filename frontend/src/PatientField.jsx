import React, { useEffect, useMemo, useRef } from "react";

// The signature: 10,000 short vertical marks, one per synthetic patient, on a
// grid, ordered by age (youngest left), never reshuffled. State is shown by
// shape, not only color:
//   eligible  (-2): upright, full length, full ink
//   possibly  (-1): upright, half length, 45% ink
//   excluded  (else): fallen to ~80deg from vertical, 15% ink
// Hovering/focusing a criterion lights up (accent, 1px thicker) the patients
// that criterion alone keeps out: the patients whose code === that criterion's
// index. Those are exactly its price-tag count.
//
// Motion: on a state change only the changed marks move; they settle on a
// damped spring (~600ms). On first load the field stands up, sweeping youngest
// -> oldest (~900ms). prefers-reduced-motion shows final state immediately.

const INK = "#12161a";
const ACCENT = "#1a5fff";

function stateOf(code) {
  if (code === -2) return "eligible";
  if (code === -1) return "possibly";
  return "excluded";
}

// target lean angle (radians from vertical) per state
function targetLean(state) {
  if (state === "excluded") return (80 * Math.PI) / 180;
  return 0;
}
function lengthFactor(state) {
  if (state === "possibly") return 0.5;
  return 1;
}
function strokeFor(state) {
  if (state === "eligible") return INK; // full ink
  if (state === "possibly") return "rgba(18,22,26,0.45)";
  return "rgba(18,22,26,0.15)";
}

export default function PatientField({ codes, highlightCode, ariaLabel }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  // Per-mark animation state: current lean (angle) kept across renders.
  const leanRef = useRef(null); // Float32Array
  const prevStateRef = useRef(null); // Array<string>
  const rafRef = useRef(0);
  const firstLoadRef = useRef(true);
  const animatingRef = useRef(false);
  const dprRef = useRef(1);
  const geomRef = useRef({ cols: 0, rows: 0, cw: 0, rh: 0, w: 0, h: 0 });

  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  const n = codes ? codes.length : 0;

  // Compute grid geometry for the current wrapper width.
  function computeGeom() {
    const wrap = wrapRef.current;
    if (!wrap || n === 0) return null;
    const w = Math.max(240, wrap.clientWidth);
    // Aim for a square-ish cell; cap height ~640px.
    const maxH = 640;
    // choose columns so that rows*cellH <= maxH with roughly square cells
    let cols = Math.ceil(Math.sqrt((n * w) / maxH));
    cols = Math.max(20, cols);
    const cw = w / cols;
    const rows = Math.ceil(n / cols);
    let rh = cw; // square cells
    if (rows * rh > maxH) rh = maxH / rows;
    const h = Math.min(maxH, rows * rh);
    return { cols, rows, cw, rh, w, h };
  }

  function draw(progressByIndex) {
    const canvas = canvasRef.current;
    if (!canvas || n === 0) return;
    const g = geomRef.current;
    const dpr = dprRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const lean = leanRef.current;
    const markLen = Math.min(g.rh * 0.72, g.cw * 2.4);
    const hl = highlightCode;

    // Batch strokes by visual bucket (state + highlight) to minimize state
    // changes. We still set per-mark transform, so we group by color/width.
    // Draw non-highlighted first, highlighted last (on top).
    const order = [false, true];
    for (const wantHighlight of order) {
      for (let i = 0; i < n; i++) {
        const code = codes[i];
        const state = stateOf(code);
        const isHot =
          hl != null && hl >= 0 && code === hl; // excluded by this criterion alone
        if (isHot !== wantHighlight) continue;

        const col = i % g.cols;
        const row = (i - col) / g.cols;
        const cx = col * g.cw + g.cw / 2;
        const baseY = row * g.rh + g.rh / 2;

        // first-load sweep: scale the mark up from 0 as the sweep reaches it
        const p = progressByIndex ? progressByIndex(i) : 1;
        if (p <= 0) continue;

        const angle = lean[i];
        const len = markLen * lengthFactor(state) * p;
        const halfLen = len / 2;

        const sinA = Math.sin(angle);
        const cosA = Math.cos(angle);
        // mark is a line centered at (cx, baseY), vertical then rotated
        const dx = sinA * halfLen;
        const dy = cosA * halfLen;

        ctx.beginPath();
        ctx.moveTo(cx - dx, baseY + dy);
        ctx.lineTo(cx + dx, baseY - dy);
        ctx.lineWidth = isHot ? 2 : 1;
        ctx.strokeStyle = isHot ? ACCENT : strokeFor(state);
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Resize + initial geometry.
  function resize() {
    const canvas = canvasRef.current;
    const g = computeGeom();
    if (!canvas || !g) return;
    geomRef.current = g;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    dprRef.current = dpr;
    canvas.width = Math.round(g.w * dpr);
    canvas.height = Math.round(g.h * dpr);
    canvas.style.height = g.h + "px";
  }

  // (Re)initialize lean/state arrays when the number of patients changes.
  useEffect(() => {
    if (n === 0) return;
    if (!leanRef.current || leanRef.current.length !== n) {
      leanRef.current = new Float32Array(n);
      prevStateRef.current = new Array(n);
      for (let i = 0; i < n; i++) {
        const st = stateOf(codes[i]);
        leanRef.current[i] = targetLean(st);
        prevStateRef.current[i] = st;
      }
      firstLoadRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  // Draw + animate whenever codes or highlight change.
  useEffect(() => {
    if (n === 0) return;
    resize();
    const lean = leanRef.current;
    const prev = prevStateRef.current;
    if (!lean) return;

    cancelAnimationFrame(rafRef.current);

    // Reduced motion: snap to final, draw once.
    if (reduceMotion) {
      for (let i = 0; i < n; i++) {
        const st = stateOf(codes[i]);
        lean[i] = targetLean(st);
        prev[i] = st;
      }
      firstLoadRef.current = false;
      draw(() => 1);
      return;
    }

    // First orchestrated moment: stand-up sweep youngest -> oldest.
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      for (let i = 0; i < n; i++) {
        const st = stateOf(codes[i]);
        lean[i] = targetLean(st);
        prev[i] = st;
      }
      const dur = 900;
      const start = performance.now();
      animatingRef.current = true;
      const step = (now) => {
        const t = Math.min(1, (now - start) / dur);
        // sweep position across indices
        const sweep = t;
        const feather = 0.12;
        const progressByIndex = (i) => {
          const frac = i / n;
          const p = (sweep - frac) / feather;
          return Math.max(0, Math.min(1, p));
        };
        draw(progressByIndex);
        if (t < 1) rafRef.current = requestAnimationFrame(step);
        else {
          animatingRef.current = false;
          draw(() => 1);
        }
      };
      rafRef.current = requestAnimationFrame(step);
      return;
    }

    // State-change spring: only marks whose target changed animate.
    const from = Float32Array.from(lean);
    const to = new Float32Array(n);
    let anyMoving = false;
    for (let i = 0; i < n; i++) {
      const st = stateOf(codes[i]);
      to[i] = targetLean(st);
      if (Math.abs(to[i] - from[i]) > 1e-4) anyMoving = true;
      prev[i] = st;
    }

    if (!anyMoving) {
      draw(() => 1);
      return;
    }

    const dur = 600;
    const start = performance.now();
    animatingRef.current = true;
    // damped spring with slight overshoot
    const springEase = (t) => {
      // critically-ish damped with a small overshoot
      const omega = 9;
      const zeta = 0.42;
      const wd = omega * Math.sqrt(1 - zeta * zeta);
      return (
        1 -
        Math.exp(-zeta * omega * t) *
          (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t))
      );
    };
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = springEase(t);
      for (let i = 0; i < n; i++) {
        lean[i] = from[i] + (to[i] - from[i]) * e;
      }
      draw(() => 1);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else {
        for (let i = 0; i < n; i++) lean[i] = to[i];
        animatingRef.current = false;
        draw(() => 1);
      }
    };
    rafRef.current = requestAnimationFrame(step);

    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes, reduceMotion]);

  // Redraw on highlight change (no spring — just re-color). Skipped on the
  // initial mount and while an animation is running (the rAF loop redraws with
  // the current highlight itself), so it never cuts the first-load sweep short.
  const hlFirstRef = useRef(true);
  useEffect(() => {
    if (hlFirstRef.current) {
      hlFirstRef.current = false;
      return;
    }
    if (n === 0 || !leanRef.current || animatingRef.current) return;
    draw(() => 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightCode]);

  // Redraw on container resize.
  useEffect(() => {
    const onResize = () => {
      resize();
      draw(() => 1);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes]);

  return (
    <div className="field-block">
      <div className="field-frame" ref={wrapRef}>
        <span className="crop tl" />
        <span className="crop tr" />
        <span className="crop bl" />
        <span className="crop br" />
        <canvas
          ref={canvasRef}
          className="patient-canvas"
          role="img"
          aria-label={ariaLabel}
        />
      </div>
      <p className="field-caption">
        Each mark is one synthetic patient. Standing: eligible. Short: missing
        data. Fallen: excluded.
      </p>
    </div>
  );
}
