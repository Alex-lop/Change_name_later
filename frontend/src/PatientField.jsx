import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMotionOff } from "./motion";
import "./field.css";

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
// The pointer is a lens: nearby marks grow up to 2px and darken, never change
// angle (angle is state), and a tooltip names the nearest synthetic patient.
//
// Motion: on a state change only the changed marks move; they settle on a
// damped spring (~600ms). On first load the field stands up, sweeping youngest
// -> oldest (~900ms). useMotionOff() shows final state immediately.
//
// With a mapSlot, a "By age | By place" toggle slides between this canvas and
// the lead's map, which gets the canvas height.

const INK = "#12161a";
const ACCENT = "#1a5fff";
const FALLEN = (80 * Math.PI) / 180;
const FEATHER = 0.12; // sweep edge width, as a fraction of the field
const MAX_H = 640;
const LENS_R = 60; // px
const LEVELS = 4; // lens darkness buckets
// Buckets, stroked in this order: excluded by lens level [0..LEVELS], possibly
// by lens level, eligible, highlighted (on top).
const ELIGIBLE = 2 * (LEVELS + 1);
const HOT = ELIGIBLE + 1;
const lensAlpha = (base, level) => base + (1 - base) * 0.6 * (level / LEVELS);

function verdict(code, labels) {
  if (code === -2) return "Eligible";
  if (code === -1) return "Possibly eligible: missing data";
  if (code >= 0) return `Excluded by: ${labels?.[code] || "one criterion"}`;
  return "Excluded: several criteria involved";
}

// damped spring with a small overshoot, t in [0, 1]
function springEase(t) {
  const omega = 9;
  const zeta = 0.42;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return (
    1 -
    Math.exp(-zeta * omega * t) *
      (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t))
  );
}

export default function PatientField({
  codes,
  highlightCode,
  ariaLabel,
  view = "age",
  onViewChange,
  mapSlot = null,
  mapCaption = null,
  geoPatients = null,
  areaLabels = null,
  activeRuleLabels = [],
}) {
  const motionOff = useMotionOff();
  const hasMap = mapSlot != null;
  const placeView = hasMap && view === "place";

  const frameRef = useRef(null);
  const agePaneRef = useRef(null);
  const mapPaneRef = useRef(null);
  const canvasRef = useRef(null);
  const tipRef = useRef(null);
  const leanRef = useRef(null); // Float32Array: current lean per mark
  const firstLoadRef = useRef(true); // true until a sweep finishes or is skipped
  const sweepStartRef = useRef(null); // sweep start time, kept across interruptions
  const animatingRef = useRef(false);
  const sweepRef = useRef(null); // sweep position while sweeping, else null
  const lensRef = useRef(null); // pointer {x, y} in canvas px, or null
  const rafRef = useRef(0); // animation loop
  const pointerRafRef = useRef(0); // coalesced pointer redraw
  const dprRef = useRef(1);
  const geomRef = useRef({ cols: 0, rows: 0, cw: 0, rh: 0, w: 0, h: 0 });
  // Latest props for rAF callbacks and handlers created in older renders.
  const live = useRef(null);
  live.current = { codes, highlightCode };

  const [fieldH, setFieldH] = useState(0);
  const [hover, setHover] = useState(null); // {i, x, y}: nearest mark, pointer in frame px

  // Fit the grid to the pane width. True when the canvas was resized (cleared).
  function resize() {
    const canvas = canvasRef.current;
    const pane = agePaneRef.current;
    const n = live.current.codes ? live.current.codes.length : 0;
    if (!canvas || !pane || n === 0) return false;
    const w = Math.max(240, pane.clientWidth);
    const cols = Math.max(20, Math.ceil(Math.sqrt((n * w) / MAX_H)));
    const cw = w / cols;
    const rows = Math.ceil(n / cols);
    const rh = Math.min(cw, MAX_H / rows); // square cells, capped at MAX_H tall
    const h = rows * rh;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const g = geomRef.current;
    if (g.w === w && g.cols === cols && g.rows === rows && dprRef.current === dpr) {
      return false;
    }
    geomRef.current = { cols, rows, cw, rh, w, h };
    dprRef.current = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + "px";
    setFieldH(h);
    return true;
  }

  function draw() {
    const canvas = canvasRef.current;
    const lean = leanRef.current;
    const { codes, highlightCode: hl } = live.current;
    const n = codes ? codes.length : 0;
    if (!canvas || !lean || n === 0 || lean.length !== n) return;
    const { cols, cw, rh, w, h } = geomRef.current;
    const dpr = dprRef.current;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";

    const markLen = Math.min(rh * 0.72, cw * 2.4);
    const sweep = sweepRef.current;
    const lens = lensRef.current;
    const paths = new Array(HOT + 1);
    for (let i = 0; i < n; i++) {
      let p = 1; // first-load sweep: marks grow from 0 as the sweep reaches them
      if (sweep != null) {
        p = (sweep - i / n) / FEATHER;
        if (p <= 0) continue;
        if (p > 1) p = 1;
      }
      const code = codes[i];
      const col = i % cols;
      const cx = col * cw + cw / 2;
      const cy = ((i - col) / cols) * rh + rh / 2;
      let len = markLen * (code === -1 ? 0.5 : 1) * p;
      let level = 0;
      if (lens) {
        const dx = cx - lens.x;
        const dy = cy - lens.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < LENS_R * LENS_R) {
          const prox = 1 - Math.sqrt(d2) / LENS_R;
          len += 2 * prox;
          level = Math.ceil(prox * LEVELS);
        }
      }
      const b =
        hl != null && hl >= 0 && code === hl
          ? HOT
          : code === -2
          ? ELIGIBLE
          : code === -1
          ? LEVELS + 1 + level
          : level;
      const path = paths[b] || (paths[b] = new Path2D());
      const sx = Math.sin(lean[i]) * len * 0.5;
      const sy = Math.cos(lean[i]) * len * 0.5;
      path.moveTo(cx - sx, cy + sy);
      path.lineTo(cx + sx, cy - sy);
    }
    for (let b = 0; b <= HOT; b++) {
      if (!paths[b]) continue;
      ctx.lineWidth = b === HOT ? 2 : 1;
      ctx.strokeStyle =
        b === HOT
          ? ACCENT
          : b === ELIGIBLE
          ? INK
          : `rgba(18,22,26,${
              b <= LEVELS ? lensAlpha(0.15, b) : lensAlpha(0.45, b - LEVELS - 1)
            })`;
      ctx.stroke(paths[b]);
    }
  }

  // Run frame(t) for t in [0, 1) each animation frame, then done(). Returns stop.
  function animate(dur, frame, done, start = performance.now()) {
    const stop = () => {
      cancelAnimationFrame(rafRef.current);
      animatingRef.current = false;
      sweepRef.current = null;
    };
    const step = (now) => {
      // rAF timestamps can predate `start` by a frame
      const t = Math.max(0, (now - start) / dur);
      if (t < 1) {
        frame(t);
        draw();
        rafRef.current = requestAnimationFrame(step);
      } else {
        stop();
        done();
        draw();
      }
    };
    animatingRef.current = true;
    step(performance.now());
    return stop;
  }

  // New codes or motion setting: sweep on first load, then spring only the
  // marks whose state changed; motion off snaps to the final state.
  useEffect(() => {
    const n = codes ? codes.length : 0;
    if (n === 0) return;
    resize();
    const target = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      target[i] = codes[i] === -2 || codes[i] === -1 ? 0 : FALLEN;
    }
    let lean = leanRef.current;
    if (!lean || lean.length !== n) {
      lean = leanRef.current = target.slice();
      firstLoadRef.current = true;
      sweepStartRef.current = null;
    }
    if (motionOff) {
      lean.set(target);
      firstLoadRef.current = false;
      draw();
      return;
    }
    if (firstLoadRef.current) {
      // Cleared only when the sweep finishes, so an interrupted sweep (new
      // codes such as the geo re-fetch, StrictMode remount) resumes where it
      // was instead of being lost or blanking and starting over.
      if (sweepStartRef.current == null) sweepStartRef.current = performance.now();
      lean.set(target);
      return animate(
        900,
        (t) => {
          sweepRef.current = t * (1 + FEATHER);
        },
        () => {
          firstLoadRef.current = false;
        },
        sweepStartRef.current
      );
    }
    const from = lean.slice();
    if (!from.some((a, i) => Math.abs(a - target[i]) > 1e-4)) {
      draw();
      return;
    }
    return animate(
      600,
      (t) => {
        const e = springEase(t);
        for (let i = 0; i < n; i++) lean[i] = from[i] + (target[i] - from[i]) * e;
      },
      () => lean.set(target)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes, motionOff]);

  // Highlight changes just recolor; a running animation picks it up itself.
  useEffect(() => {
    if (!animatingRef.current) draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightCode]);

  // Pane resize (window or layout). Deferred a frame so changing the canvas
  // height inside the observer callback cannot trip the ResizeObserver loop.
  useEffect(() => {
    const pane = agePaneRef.current;
    if (!pane || typeof ResizeObserver === "undefined") return;
    let id = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(id);
      id = requestAnimationFrame(() => {
        if (resize()) draw();
      });
    });
    ro.observe(pane);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      cancelAnimationFrame(pointerRafRef.current);
      pointerRafRef.current = 0; // or scheduleRedraw stays blocked after a StrictMode remount
    },
    []
  );

  // The hidden pane is neither focusable nor announced (React 18 has no inert prop).
  useEffect(() => {
    if (agePaneRef.current) agePaneRef.current.inert = placeView;
    if (mapPaneRef.current) mapPaneRef.current.inert = !placeView;
  }, [placeView, hasMap]);

  function scheduleRedraw() {
    if (animatingRef.current || pointerRafRef.current) return; // animation frames apply the lens
    pointerRafRef.current = requestAnimationFrame(() => {
      pointerRafRef.current = 0;
      draw();
    });
  }

  // The mark whose grid cell holds (x, y), else the nearest center (only
  // possible past the last mark of a short last row).
  function nearest(x, y) {
    const { cols, rows, cw, rh } = geomRef.current;
    const n = live.current.codes.length;
    const col = Math.min(cols - 1, Math.max(0, Math.floor(x / cw)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(y / rh)));
    if (row * cols + col < n) return row * cols + col;
    let best = -1;
    let bestD = Infinity;
    for (let j = Math.max(0, (rows - 2) * cols); j < n; j++) {
      const c = j % cols;
      const dx = c * cw + cw / 2 - x;
      const dy = ((j - c) / cols) * rh + rh / 2 - y;
      if (dx * dx + dy * dy < bestD) {
        bestD = dx * dx + dy * dy;
        best = j;
      }
    }
    return best;
  }

  function onPointerMove(e) {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    const g = geomRef.current;
    if (placeView || !canvas || !frame || !g.w || !live.current.codes?.length) return;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = ((e.clientX - r.left) * g.w) / r.width;
    const y = ((e.clientY - r.top) * g.h) / r.height;
    lensRef.current = { x, y };
    scheduleRedraw();
    const f = frame.getBoundingClientRect();
    setHover({ i: nearest(x, y), x: e.clientX - f.left, y: e.clientY - f.top });
  }

  function clearPointer() {
    if (lensRef.current) {
      lensRef.current = null;
      scheduleRedraw();
    }
    setHover(null);
  }

  useEffect(() => {
    if (placeView) clearPointer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeView]);

  const tipI =
    hover && !placeView && codes && hover.i >= 0 && hover.i < codes.length
      ? hover.i
      : -1;
  let placeLine = null;
  if (
    tipI >= 0 &&
    geoPatients &&
    areaLabels &&
    geoPatients.age &&
    geoPatients.age.length === codes.length
  ) {
    const label = geoPatients.area ? areaLabels[geoPatients.area[tipI]] : null;
    placeLine = `Age ${geoPatients.age[tipI]}` + (label ? ` · ${label}` : "");
  }

  // Keep the tooltip inside the frame: below-right of the pointer, flipped
  // left/up near the edges. Runs before paint, so it never shows misplaced.
  useLayoutEffect(() => {
    const el = tipRef.current;
    const frame = frameRef.current;
    if (!el || !frame || !hover) return;
    const gap = 16;
    let x = hover.x + gap;
    if (x + el.offsetWidth > frame.clientWidth) x = hover.x - gap - el.offsetWidth;
    let y = hover.y + gap;
    if (y + el.offsetHeight > frame.clientHeight) y = hover.y - gap - el.offsetHeight;
    el.style.transform = `translate(${Math.max(0, x)}px, ${Math.max(0, y)}px)`;
  });

  return (
    <div className="field-block">
      <div className="field-frame" ref={frameRef}>
        <span className="crop tl" />
        <span className="crop tr" />
        <span className="crop bl" />
        <span className="crop br" />
        {hasMap && (
          <div className="field-toggle" role="group" aria-label="Field view">
            <button
              type="button"
              aria-pressed={!placeView}
              onClick={() => onViewChange?.("age")}
            >
              By age
            </button>
            <button
              type="button"
              aria-pressed={placeView}
              onClick={() => onViewChange?.("place")}
            >
              By place
            </button>
          </div>
        )}
        <div className="field-viewport">
          <div
            className={
              "field-track" + (hasMap ? " two" : "") + (motionOff ? " still" : "")
            }
            style={
              hasMap
                ? { transform: placeView ? "translateX(-50%)" : "translateX(0)" }
                : undefined
            }
          >
            <div
              className="field-pane"
              ref={agePaneRef}
              aria-hidden={placeView || undefined}
            >
              <canvas
                ref={canvasRef}
                className="patient-canvas"
                role="img"
                aria-label={ariaLabel}
                onPointerDown={onPointerMove /* a touch press shows it too */}
                onPointerMove={onPointerMove}
                onPointerLeave={clearPointer}
                onPointerCancel={clearPointer}
              />
            </div>
            {hasMap && (
              <div
                className="field-pane field-map"
                ref={mapPaneRef}
                aria-hidden={!placeView || undefined}
                style={fieldH ? { height: fieldH } : undefined}
              >
                {mapSlot}
              </div>
            )}
          </div>
        </div>
        {tipI >= 0 && (
          <div className="field-tip" ref={tipRef} aria-hidden="true">
            <span className="field-tip-muted">Synthetic patient</span>
            {placeLine && <span>{placeLine}</span>}
            <span>{verdict(codes[tipI], activeRuleLabels)}</span>
          </div>
        )}
      </div>
      {placeView ? (
        mapCaption != null && <div className="field-caption">{mapCaption}</div>
      ) : (
        <p className="field-caption">
          One mark per patient. Standing: eligible. Short: missing data. Fallen: excluded.
        </p>
      )}
    </div>
  );
}
