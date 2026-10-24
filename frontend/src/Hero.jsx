import "./hero.css";
import { useEffect, useRef, useState } from "react";
import { useMotionOff, usePrefersReducedMotion } from "./motion";

// Landing field, ported from field.js: short ink ticks that spring toward the
// cursor and its wake. No idle wave and no scroll lean: the rAF loop runs only
// while something moves. On "Open PIONEER 6" the excluded share of ticks falls
// over (the patient field's excluded look), the rest stand up, then onEnter().
const PI = Math.PI;
const R = 220, R2 = R * R;                                   // pointer radius
const WR = 120, WR2 = WR * WR, WAKE_MS = 800, WAKE_MAX = 30; // wake points
const LEN = 9, GROW = 3, A0 = 0.08, ASTEP = (0.35 - 0.08) / 7;
const FALLEN = (80 * PI) / 180;                              // same as PatientField
const RAMP_MS = 400, FALL_MS = 950, SLIDE_MS = 450, WAIT_MS = 1500;
const PASS = { passive: true };

const smooth = (q) => q * q * (3 - 2 * q);
const modPi = (a) => a - PI * Math.round(a / PI);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Deterministic [0, 1) hash of an integer: which ticks fall, and to which side.
function hash(i) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export default function Hero({ excludedFraction, onEnter }) {
  const ctxOff = useMotionOff();
  const reduce = usePrefersReducedMotion(); // in case the hero sits outside MotionContext
  const off = ctxOff || reduce;
  const canvasRef = useRef(null);
  const fieldRef = useRef(null); // { fall(f) } while the field is animated
  const fracRef = useRef(excludedFraction);
  fracRef.current = excludedFraction;
  const alive = useRef(true);
  const started = useRef(false);
  const [clicked, setClicked] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas && canvas.getContext("2d");
    if (!ctx) return;
    const INK = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#12161a";
    const buckets = [[], [], [], [], [], [], [], []];
    let W = 0, H = 0, gridW = 0, gridH = -1e3, ticks = [];
    let raf = 0, rt = 0, pointer = false, px = 0, py = 0, wx = 0, wy = 0;
    let wake = [], wn = 0, fallFrac = null, fallAt = 0;

    function build() {
      const tight = W <= 620, cap = tight ? 600 : 1800;
      let step = tight ? 34 : 26;
      const est = Math.ceil(W / step) * Math.ceil(H / step);
      if (est > cap) step *= Math.sqrt(est / cap);
      ticks = [];
      const ox = ((W % step) + step) / 2, oy = ((H % step) + step) / 2;
      for (let y = oy; y < H; y += step)
        for (let x = ox; x < W; x += step) ticks.push({ x, y, a: 0, v: 0, f: 0 });
      if (fallFrac != null) assignFall();
    }

    // Exactly round(n * f) ticks, in hash order, fall to +/-80deg; the rest stand.
    function assignFall() {
      const n = ticks.length, k = Math.round(n * fallFrac);
      const order = ticks.map((_, i) => i).sort((a, b) => hash(a) - hash(b));
      order.forEach((i, j) => { ticks[i].f = j < k ? (hash(~i) < 0.5 ? -FALLEN : FALLEN) : 0; });
    }

    function size() {
      W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Rebuild the grid only for a real layout change; a phone's address bar must not.
      if (!ticks.length || W !== gridW || Math.abs(H - gridH) > 120) { gridW = W; gridH = H; build(); }
    }

    // One spring step and one draw. Returns true while anything still moves.
    function draw(now) {
      const live = [];
      for (const p of wake) {
        const age = now - p.t;
        if (age < WAKE_MS) live.push({ x: p.x, y: p.y, d: p.d, e: 1 - age / WAKE_MS });
      }
      const falling = fallFrac != null;
      const ramp = falling ? Math.min(1, Math.max(0, (now - fallAt) / RAMP_MS)) : 0;
      let maxV = 0, maxE = 0;
      for (const b of buckets) b.length = 0;

      for (const t of ticks) {
        const { x, y } = t;
        let target = 0, m = 0, dx, dy, d2, w;
        if (falling) {
          target = t.f;
          m = ramp * (t.f ? 2 / 7 : 1); // fallen at ~15% ink like PatientField; the standing rest darken
        } else {
          if (pointer) {
            dx = px - x; dy = py - y;
            if (dx < R && dx > -R && dy < R && dy > -R && (d2 = dx * dx + dy * dy) < R2) {
              w = 1 - smooth(Math.sqrt(d2) / R);
              target += modPi(Math.atan2(dx, -dy) - target) * w;
              m = w;
            }
          }
          for (const p of live) {
            dx = p.x - x; dy = p.y - y;
            if (dx >= WR || dx <= -WR || dy >= WR || dy <= -WR) continue;
            if ((d2 = dx * dx + dy * dy) >= WR2) continue;
            w = (1 - smooth(Math.sqrt(d2) / WR)) * p.e;
            target += modPi(p.d - target) * w;
            if (w > m) m = w;
          }
        }
        const e = modPi(target - t.a);
        t.v += e * 0.12; t.v *= 0.82; t.a += t.v;
        if (Math.abs(t.v) > maxV) maxV = Math.abs(t.v);
        if (Math.abs(e) > maxE) maxE = Math.abs(e);

        const half = (LEN + m * GROW) / 2, s = Math.sin(t.a) * half, c = Math.cos(t.a) * half;
        const b = Math.round(m * 7);
        buckets[b > 7 ? 7 : b].push(x - s, y + c, x + s, y - c);
      }

      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1; ctx.strokeStyle = INK;
      buckets.forEach((L, i) => {
        if (!L.length) return;
        ctx.globalAlpha = A0 + i * ASTEP;
        ctx.beginPath();
        for (let k = 0; k < L.length; k += 4) { ctx.moveTo(L[k], L[k + 1]); ctx.lineTo(L[k + 2], L[k + 3]); }
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      return maxV > 5e-4 || maxE > 1e-3 || live.length > 0 || (falling && ramp < 1);
    }

    function frame(now) {
      raf = 0;
      if (draw(now)) raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };

    function onPoint(e) {
      if (fallFrac != null) return; // pointer influence stops once the fall starts
      px = e.clientX; py = e.clientY; pointer = true;
      const dx = px - wx, dy = py - wy;
      if (dx * dx + dy * dy > 64) { // a new wake point every 8px of travel
        wake[wn++ % WAKE_MAX] = { x: px, y: py, d: modPi(Math.atan2(dx, -dy)), t: performance.now() };
        wx = px; wy = py;
      }
      kick();
    }
    const onLeave = () => { pointer = false; kick(); };   // cursor left the window, or a finger lifted
    const onUp = (e) => { if (e.pointerType === "touch") onLeave(); };
    const onVis = () => (document.hidden ? stop() : kick());
    const onResize = () => {
      clearTimeout(rt);
      rt = setTimeout(() => { size(); if (off) draw(0); else kick(); }, 150);
    };

    size();
    addEventListener("resize", onResize, PASS);
    if (off) { // static: upright ticks at the base alpha, drawn once
      draw(0);
      return () => { clearTimeout(rt); removeEventListener("resize", onResize, PASS); };
    }

    const doc = document.documentElement;
    addEventListener("pointermove", onPoint, PASS);
    addEventListener("pointerdown", onPoint, PASS);
    addEventListener("pointerup", onUp, PASS);
    addEventListener("pointercancel", onLeave, PASS); // a touch that became a scroll ends here
    doc.addEventListener("mouseleave", onLeave, PASS);
    document.addEventListener("visibilitychange", onVis);
    fieldRef.current = {
      fall(f) {
        fallFrac = Math.min(1, Math.max(0, f)); fallAt = performance.now(); pointer = false;
        assignFall(); kick();
      },
    };
    draw(performance.now());

    return () => {
      stop(); clearTimeout(rt); fieldRef.current = null;
      removeEventListener("resize", onResize, PASS);
      removeEventListener("pointermove", onPoint, PASS);
      removeEventListener("pointerdown", onPoint, PASS);
      removeEventListener("pointerup", onUp, PASS);
      removeEventListener("pointercancel", onLeave, PASS);
      doc.removeEventListener("mouseleave", onLeave, PASS);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [off]);

  async function enter() {
    if (started.current) return;
    started.current = true;
    setClicked(true);
    if (off) { onEnter(); return; }
    const t0 = performance.now();
    while (!Number.isFinite(fracRef.current) && performance.now() - t0 < WAIT_MS) await sleep(50);
    if (!alive.current) return;
    const f = fracRef.current, field = fieldRef.current;
    if (!Number.isFinite(f) || !field) { onEnter(); return; }
    field.fall(f);
    await sleep(FALL_MS);
    if (!alive.current) return;
    setLeaving(true); // the page moves up to the workbench
    await sleep(SLIDE_MS);
    if (alive.current) onEnter();
  }

  return (
    <section className={`hero${leaving ? " is-leaving" : ""}`} aria-label="Sieve">
      <canvas ref={canvasRef} className="hero-field" aria-hidden="true" />
      <img className="hero-mark" src="/sieve-mark.png" alt="Sieve" />
      <div className="hero-card">
        <h1>See what each criterion costs.</h1>
        <button type="button" className="hero-enter" onClick={enter} disabled={clicked}>
          Open PIONEER 6
        </button>
      </div>
    </section>
  );
}
