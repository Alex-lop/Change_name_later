import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMotionOff } from "./motion";
import { fmtDelta, fmtInt } from "./format";
import "./map.css";

// Choropleth of analysis.areas over the /api/geo shapes. Displays what the API
// returns: rates come from the rows; the only ratios made here are display
// shares (excluded_by / patients, statewide totals) and deltas vs. baseline.

// Token hexes from styles.css :root. Fills are mixed here so they can transition.
const PAPER = "#f2f4f3";
const ACCENT = "#1a5fff";
const INK = "#12161a";
const INK2 = "#4e5a60";
const RULE = "#cfd6d4";

function mix(a, b, t) {
  const c = (h, i) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return (
    "#" +
    [0, 1, 2]
      .map((i) => Math.round(c(a, i) + (c(b, i) - c(a, i)) * t).toString(16).padStart(2, "0"))
      .join("")
  );
}
// Five steps: lightly tinted paper up to exactly the accent.
const RAMP = [0.14, 0.34, 0.55, 0.77, 1].map((t) => mix(PAPER, ACCENT, t));

// Smallest clean top (percent) so five equal bins read cleanly: 22 -> 25 (0,5,..,25).
const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function niceCeil(maxPct) {
  if (!(maxPct > 0)) return 5;
  const per = maxPct / 5;
  const mag = 10 ** Math.floor(Math.log10(per));
  const s = STEPS.find((k) => k * mag >= per - 1e-9) ?? 10;
  return +(s * mag * 5).toPrecision(6);
}
// Five clean, equal bins covering [lo, hi] (percent): 61..73 -> 60..75 by 3.
// Criterion mode uses this so a criterion that keeps out 61-73% everywhere
// doesn't paint every county the top color.
function niceRange(lo, hi) {
  if (!(hi > 0)) return [0, 5];
  let per = Math.max(hi - lo, hi / 20) / 5;
  for (let i = 0; i < 30; i++) {
    const mag = 10 ** Math.floor(Math.log10(per));
    const step = (STEPS.find((k) => k * mag >= per - 1e-9) ?? 10) * mag;
    const bottom = Math.floor(lo / step + 1e-9) * step;
    if (bottom + 5 * step >= hi - 1e-9) {
      const b = bottom + 5 * step > 100 && hi <= 100 ? 100 - 5 * step : bottom; // no edge past 100%
      return [+b.toPrecision(6), +(b + 5 * step).toPrecision(6)];
    }
    per = step * 1.0001; // next clean step up
  }
  return [0, niceCeil(hi)];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// 'YYYY-MM-DD' -> 'Oct 20, 2026' without going through Date (no timezone shift).
function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  return m && MONTHS[+m[2] - 1] ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : s || "";
}

const pct = (f) => (Number.isFinite(f) ? (f * 100).toFixed(1) + "%" : "—");
const fullName = (a) => a.label || a.name || a.id;
const shortName = (a) => fullName(a).split(" (")[0];
const edgeText = (v) => String(+v.toFixed(2));
const NONE = new Set();

// What an area shows in the current mode: ok (value), hatch (fewer than 30), none (no counts).
function cellOf(row, ruleId) {
  if (!row) return { kind: "none" };
  if (row.suppressed) return { kind: "hatch" };
  if (ruleId == null) {
    return Number.isFinite(row.confirmed_rate) ? { kind: "ok", v: row.confirmed_rate } : { kind: "hatch" };
  }
  if (row.excluded_by == null) return { kind: "hatch" };
  const n = row.excluded_by[ruleId];
  return Number.isFinite(n) && row.patients > 0 ? { kind: "ok", v: n / row.patients } : { kind: "none" };
}

function contextLine(c) {
  if (!c) return null;
  const p = [];
  if (Number.isFinite(c.adults_18plus)) p.push(`Adults 18+ ${fmtInt(c.adults_18plus)}`);
  if (Number.isFinite(c.pct_65plus)) p.push(`65+ ${c.pct_65plus.toFixed(1)}%`);
  if (Number.isFinite(c.median_household_income)) {
    p.push(`Median household income $${fmtInt(c.median_household_income)}`);
  }
  if (Number.isFinite(c.pct_hispanic)) p.push(`Hispanic ${c.pct_hispanic.toFixed(1)}%`);
  if (Number.isFinite(c.diabetes_crude_pct)) p.push(`Diabetes (crude) ${c.diabetes_crude_pct.toFixed(1)}%`);
  return p.length ? p.join(" · ") : null;
}

function contextSource(c) {
  const p = [];
  if (c?.acs_year) p.push(`ACS ${c.acs_year}`);
  if (c?.places_release) p.push(`CDC PLACES ${c.places_release}`);
  return p.length ? p.join(" · ") : null;
}

function focusVisible(el) {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

function Ring({ color, r, w }) {
  return (
    <svg className="map-key" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r={r} fill="none" stroke={color} strokeWidth={w} />
    </svg>
  );
}

export default function MapView({ geo, areas, baselineAreas, selected, onClearSelection, nctId, placeholder }) {
  const motionOff = useMotionOff();
  const hatchId = "map-hatch-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const rootRef = useRef(null);
  const svgRef = useRef(null);
  const tipRef = useRef(null);

  const vb = useMemo(() => {
    const n = String(geo?.viewBox || "").split(/[\s,]+/).map(Number);
    return n.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0 ? n : [0, 0, 960, 500];
  }, [geo?.viewBox]);
  const geoAreas = useMemo(() => geo?.areas || [], [geo]);
  const areaById = useMemo(() => new Map(geoAreas.map((a) => [a.id, a])), [geoAreas]);
  const rowsById = useMemo(() => new Map((areas?.rows || []).map((r) => [r.id, r])), [areas]);
  const baseById = useMemo(() => new Map((baselineAreas?.rows || []).map((r) => [r.id, r])), [baselineAreas]);
  const hasData = Array.isArray(areas?.rows);
  const ruleId = selected ? selected.ruleId : null;
  const crit = ruleId != null;
  const gloss = selected ? selected.gloss || ruleId : "";

  const cells = useMemo(
    () => new Map(geoAreas.map((a) => [a.id, cellOf(rowsById.get(a.id), ruleId)])),
    [geoAreas, rowsById, ruleId]
  );

  // Eligibility bins span both analyses so edits and the protocol share a scale.
  // Criterion bins span this criterion's own range (see niceRange).
  const [bottom, top] = useMemo(() => {
    let max = 0;
    if (crit) {
      let min = Infinity;
      for (const c of cells.values()) {
        if (c.kind === "ok") {
          max = Math.max(max, c.v * 100);
          min = Math.min(min, c.v * 100);
        }
      }
      return niceRange(Number.isFinite(min) ? min : 0, max);
    }
    let min = Infinity;
    for (const m of [rowsById, baseById]) {
      for (const r of m.values()) {
        // Only drawn counties: an unmatched row id must not stretch the scale.
        if (areaById.has(r.id) && !r.suppressed && Number.isFinite(r.confirmed_rate)) {
          max = Math.max(max, r.confirmed_rate * 100);
          min = Math.min(min, r.confirmed_rate * 100);
        }
      }
    }
    // A narrow spread (e.g. 52-58%) still gets five distinct colors.
    return niceRange(Number.isFinite(min) ? min : 0, max);
  }, [crit, cells, rowsById, baseById, areaById]);
  const step = (top - bottom) / 5;
  const fillOf = (c) =>
    c.kind === "ok"
      ? RAMP[Math.min(4, Math.max(0, Math.floor((c.v * 100 - bottom) / step + 1e-9)))]
      : c.kind === "hatch"
        ? `url(#${hatchId})`
        : PAPER;

  const totals = areas?.totals;
  const statewide =
    !crit && totals && totals.patients > 0 && Number.isFinite(totals.confirmed)
      ? totals.confirmed / totals.patients
      : null;

  // Screen px per viewBox unit, so rings, labels and hatching keep a fixed screen size.
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const measure = () => {
      const r = svg.getBoundingClientRect();
      setBox((b) => (b && b.w === r.width && b.h === r.height ? b : { w: r.width, h: r.height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);
  const scale = box && box.w > 0 && box.h > 0 ? Math.min(box.w / vb[2], box.h / vb[3]) : 1;
  const u = (screenPx) => screenPx / scale;
  const showLabels = vb[2] * scale >= 420;

  // ---- hover / focus and the eased tooltip ---------------------------------
  const [hover, setHover] = useState(null);
  const [focus, setFocus] = useState(null); // { id, visible }
  const active = hover || focus?.id || null;
  const live = useRef({});
  live.current = { hover, focus, areaById, motionOff };
  const pointer = useRef(null);
  const cur = useRef(null);
  const tgt = useRef(null);
  const raf = useRef(0);

  const apply = () => {
    const el = tipRef.current;
    const c = cur.current;
    if (el && c) el.style.transform = `translate(${c.x}px, ${c.y}px)`;
  };
  const tick = () => {
    const c = cur.current;
    const g = tgt.current;
    if (!c || !g) {
      raf.current = 0;
      return;
    }
    c.x += (g.x - c.x) * 0.2;
    c.y += (g.y - c.y) * 0.2;
    if (live.current.motionOff || (Math.abs(g.x - c.x) < 0.5 && Math.abs(g.y - c.y) < 0.5)) {
      c.x = g.x;
      c.y = g.y;
      raf.current = 0;
    } else {
      raf.current = requestAnimationFrame(tick);
    }
    apply();
  };
  const moveTip = (x, y) => {
    tgt.current = { x, y };
    if (!cur.current || live.current.motionOff) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      cur.current = { x, y };
      apply();
    } else if (!raf.current) {
      raf.current = requestAnimationFrame(tick);
    }
  };
  // Anchor: the cursor while hovering, else the focused area's label point.
  const place = () => {
    const tip = tipRef.current;
    const root = rootRef.current;
    const svg = svgRef.current;
    if (!tip || !root || !svg) return;
    const rr = root.getBoundingClientRect();
    const { hover: h, focus: f } = live.current;
    let ax;
    let ay;
    if (h && pointer.current) {
      ax = pointer.current.x - rr.left;
      ay = pointer.current.y - rr.top;
    } else if (f) {
      const a = live.current.areaById.get(f.id);
      const ctm = svg.getScreenCTM();
      if (!a || !a.label_xy || !ctm) return;
      const p = svg.createSVGPoint();
      p.x = a.label_xy[0];
      p.y = a.label_xy[1];
      const q = p.matrixTransform(ctm);
      ax = q.x - rr.left;
      ay = q.y - rr.top;
    } else {
      return;
    }
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const W = root.clientWidth;
    const H = root.clientHeight;
    const G = 14;
    let x = ax + G;
    let y = ay + G;
    if (x + tw > W) x = ax - G - tw;
    if (y + th > H) y = ay - G - th;
    moveTip(Math.max(0, Math.min(x, W - tw)), Math.max(0, Math.min(y, H - th)));
  };

  useLayoutEffect(() => {
    if (!active) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      cur.current = null;
      return;
    }
    place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, !!hover, rowsById, baseById, ruleId]);

  useEffect(() => {
    if (!motionOff || !raf.current) return;
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    if (tgt.current) {
      cur.current = { ...tgt.current };
      apply();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionOff]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const onPointer = (e) => {
    const g = e.target.closest ? e.target.closest("[data-area]") : null;
    const id = g ? g.getAttribute("data-area") : null;
    pointer.current = { x: e.clientX, y: e.clientY };
    if (id !== live.current.hover) setHover(id);
    else if (id) place();
  };

  // ---- brief outline on areas whose shown value changed ---------------------
  const modeKey = crit ? "r:" + ruleId : "e";
  const shown = useMemo(
    () => new Map([...cells].map(([id, c]) => [id, c.kind === "ok" ? Math.round(c.v * 1000) : c.kind])),
    [cells]
  );
  const prevShown = useRef(null);
  const [flash, setFlash] = useState({ ids: NONE, seq: 0 });
  useEffect(() => {
    const p = prevShown.current;
    prevShown.current = { key: modeKey, shown };
    const changed = new Set();
    if (!motionOff && p && p.key === modeKey && p.shown !== shown) {
      for (const [id, v] of shown) {
        const was = p.shown.get(id);
        if (was !== undefined && was !== "none" && was !== v) changed.add(id);
      }
    }
    if (!changed.size) {
      setFlash((f) => (f.ids === NONE ? f : { ids: NONE, seq: f.seq }));
      return undefined;
    }
    setFlash((f) => ({ ids: changed, seq: f.seq + 1 }));
    const t = setTimeout(() => setFlash((f) => ({ ids: NONE, seq: f.seq })), 600);
    return () => clearTimeout(t);
  }, [shown, modeKey, motionOff]);

  // ---- words ------------------------------------------------------------------
  const infoOf = (a) => {
    const row = rowsById.get(a.id);
    const base = baseById.get(a.id);
    const sup = !!row && (!!row.suppressed || !Number.isFinite(row.confirmed));
    const kept =
      crit && row && !sup && row.excluded_by && Number.isFinite(row.excluded_by[ruleId])
        ? row.excluded_by[ruleId]
        : null;
    const d = row && !sup && base && Number.isFinite(base.confirmed) ? row.confirmed - base.confirmed : null;
    const delta =
      d == null ? null : d === 0 ? "same as the protocol as written" : `${fmtDelta(d)} vs the protocol as written`;
    return { row, sup, kept, delta };
  };
  const noCounts = hasData ? "No counts for this county yet." : "Area counts are not available yet.";

  const ariaOf = (a) => {
    const { row, sup, kept, delta } = infoOf(a);
    // The tooltip is aria-hidden, so its ACS/PLACES figures ride along here.
    const ctx = contextLine(a.context);
    const tail = ctx ? ` ${ctx.split(" · ").join(", ")}.` : "";
    if (!row) return `${fullName(a)}: ${noCounts}${tail}`;
    if (sup) return `${fullName(a)}: fewer than 30 patients.${tail}`;
    const bits = [
      `${fmtInt(row.patients)} synthetic patients`,
      `${fmtInt(row.confirmed)} eligible, ${pct(row.confirmed_rate)}`,
    ];
    if (kept != null) bits.push(`${fmtInt(kept)} kept out by this criterion, ${pct(kept / row.patients)}`);
    if (delta) bits.push(delta);
    return `${fullName(a)}: ${bits.join("; ")}.${tail}`;
  };

  let hi = null;
  let lo = null;
  let nSup = 0;
  for (const a of geoAreas) {
    const c = cells.get(a.id);
    if (c.kind === "hatch") nSup += 1;
    if (c.kind !== "ok") continue;
    if (!hi || c.v > hi.v) hi = { a, v: c.v };
    if (!lo || c.v < lo.v) lo = { a, v: c.v };
  }
  const n = geoAreas.length;
  const summary = [
    crit
      ? `Map of ${n} Massachusetts counties by the share of synthetic patients “${gloss}” keeps out.`
      : `Map of ${n} Massachusetts counties by confirmed-eligible share.`,
    !hasData && "Area counts are not available yet.",
    hi && `Highest: ${shortName(hi.a)} ${pct(hi.v)}.`,
    lo && `Lowest: ${shortName(lo.a)} ${pct(lo.v)}.`,
    statewide != null && `Statewide ${pct(statewide)}.`,
    nSup > 0 && `${nSup} ${nSup === 1 ? "county has" : "counties have"} fewer than 30 patients.`,
  ]
    .filter(Boolean)
    .join(" ");

  const outline = (id, key, color, w, cls) => {
    const a = areaById.get(id);
    if (!a) return null;
    return (
      <g key={key} className={cls}>
        {(a.paths || []).map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={w}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    );
  };

  // ---- sites ------------------------------------------------------------------
  const sites = (nctId && geo?.sites && Array.isArray(geo.sites[nctId]) && geo.sites[nctId]) || [];
  // One city label per city; skip it when the county label already says the same name.
  const siteLabels = [];
  const seenCity = new Set();
  for (const s of sites) {
    if (!s.xy || !s.city || seenCity.has(s.city)) continue;
    seenCity.add(s.city);
    const home = areaById.get(s.area_id);
    if (showLabels && home && shortName(home) === s.city) continue;
    siteLabels.push(s);
  }
  // County labels sitting on a trial ring move up so the ring stays readable.
  const labelDy = (a) =>
    sites.some((s) => s.xy && Math.hypot(s.xy[0] - a.label_xy[0], s.xy[1] - a.label_xy[1]) * scale < 16)
      ? -u(14)
      : 0;
  // Keep centered county labels inside the drawing (approximate 11px text width).
  const labelX = (a) => {
    const half = u(shortName(a).length * 3.2 + 3);
    return Math.min(Math.max(a.label_xy[0], vb[0] + half), vb[0] + vb[2] - half);
  };
  const rec = geo?.recruiting_sites && Array.isArray(geo.recruiting_sites.sites) ? geo.recruiting_sites : null;
  const [showRec, setShowRec] = useState(false);

  // ---- legend -------------------------------------------------------------------
  const anyShown = [...cells.values()].some((c) => c.kind !== "none");
  const statePos =
    statewide != null ? Math.min(100, Math.max(0, ((statewide * 100 - bottom) * 100) / (top - bottom))) : null;
  const stateAlign = statePos == null ? "" : statePos < 25 ? " start" : statePos > 75 ? " end" : "";

  const activeArea = active ? areaById.get(active) : null;
  const activeInfo = activeArea ? infoOf(activeArea) : null;

  return (
    <div ref={rootRef} className={`map-root${motionOff ? " map-motion-off" : ""}`}>
      <div className="map-mode">
        {crit ? (
          <>
            <span>Where “{gloss}” keeps patients out</span>
            <button
              type="button"
              className="map-clear"
              onClick={() => {
                onClearSelection?.();
                svgRef.current?.focus(); // this button unmounts; keep focus on the map
              }}
            >
              Show eligibility
            </button>
          </>
        ) : (
          <span>Confirmed-eligible share of synthetic patients, by county</span>
        )}
      </div>

      <svg
        ref={svgRef}
        className="map-svg"
        style={{ aspectRatio: `${vb[2]} / ${vb[3]}` }}
        viewBox={vb.join(" ")}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        tabIndex={-1}
        aria-label={summary}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => {
          setHover(null);
          // A click focuses the county; don't leave its tooltip parked after the pointer leaves.
          setFocus((f) => (f && !f.visible ? null : f));
        }}
      >
        <defs>
          <pattern
            id={hatchId}
            patternUnits="userSpaceOnUse"
            width={u(6)}
            height={u(6)}
            patternTransform="rotate(45)"
          >
            <rect width={u(6)} height={u(6)} fill={PAPER} />
            <line x1={u(3)} y1="0" x2={u(3)} y2={u(6)} stroke={INK2} strokeWidth={u(1)} />
          </pattern>
        </defs>

        {geoAreas.map((a) => {
          const c = cells.get(a.id);
          return (
            <g
              key={a.id}
              data-area={a.id}
              className="map-area"
              tabIndex={0}
              aria-label={ariaOf(a)}
              onFocus={(e) => {
                const visible = focusVisible(e.currentTarget);
                setFocus({ id: a.id, visible });
                // A parked cursor must not hold the tooltip; the next pointer move takes it back.
                if (visible) setHover(null);
              }}
              onBlur={() => setFocus((f) => (f && f.id === a.id ? null : f))}
            >
              {(a.paths || []).map((d, i) => (
                <path
                  key={i}
                  d={d}
                  className="map-shape"
                  style={{ fill: fillOf(c) }}
                  stroke={c.kind === "none" ? RULE : PAPER}
                  strokeWidth="1"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          );
        })}

        <g pointerEvents="none">
          {[...flash.ids].map((id) => outline(id, `f-${id}-${flash.seq}`, INK, 1, "map-flash"))}
          {hover && outline(hover, "hover", INK, 1)}
          {/* Ink, not accent: an accent ring vanishes on top-bin counties, which are filled with the accent. */}
          {focus && outline(focus.id, "focus", INK, focus.visible ? 2 : 1)}
        </g>

        {showLabels && (
          <g pointerEvents="none">
            {geoAreas.map(
              (a) =>
                a.label_xy && (
                  <text
                    key={a.id}
                    className="map-label"
                    x={labelX(a)}
                    y={a.label_xy[1] + labelDy(a)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={u(11)}
                    strokeWidth={u(3)}
                  >
                    {shortName(a)}
                  </text>
                )
            )}
          </g>
        )}

        {showRec &&
          rec &&
          rec.sites.map(
            (r, i) =>
              r.xy && (
                <g key={"rec" + i}>
                  <title>{`${r.nct_id}: ${r.title}`}</title>
                  {/* paper halo so the ring reads on any fill */}
                  <circle cx={r.xy[0]} cy={r.xy[1]} r={u(3)} fill="none" stroke={PAPER} strokeWidth="3.5" vectorEffect="non-scaling-stroke" />
                  <circle cx={r.xy[0]} cy={r.xy[1]} r={u(3)} fill="none" stroke={INK2} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
                </g>
              )
          )}

        {sites.map(
          (s, i) =>
            s.xy && (
              <g key={"site" + i}>
                <title>{s.facility}</title>
                <circle cx={s.xy[0]} cy={s.xy[1]} r={u(5)} fill="none" stroke={PAPER} strokeWidth="4" vectorEffect="non-scaling-stroke" />
                <circle cx={s.xy[0]} cy={s.xy[1]} r={u(5)} fill="none" stroke={ACCENT} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              </g>
            )
        )}
        {siteLabels.map((s) => (
          <text
            key={"city-" + s.city}
            className="map-label"
            x={s.xy[0] + u(8)}
            y={s.xy[1]}
            dominantBaseline="central"
            fontSize={u(11)}
            strokeWidth={u(3)}
            pointerEvents="none"
          >
            {s.city}
          </text>
        ))}
      </svg>

      <div className="map-legend">
        {!hasData ? (
          <p className="map-note">Area counts are not available yet.</p>
        ) : !anyShown ? (
          <p className="map-note">Area counts are not available {crit ? "for this criterion" : "yet"}.</p>
        ) : (
          <>
            {crit && (
              <p className="map-legend-title">Share of each county's synthetic patients this criterion keeps out</p>
            )}
            <div className="map-legend-row">
              <div className="map-ramp">
                {statePos != null && (
                  <div className="map-ramp-state">
                    <span className={"map-ramp-state-label" + stateAlign} style={{ left: statePos + "%" }}>
                      statewide {pct(statewide)}
                    </span>
                  </div>
                )}
                <div className="map-ramp-bar">
                  {RAMP.map((color) => (
                    <span key={color} style={{ background: color }} />
                  ))}
                  {statePos != null && <i className="map-ramp-tick" style={{ left: statePos + "%" }} />}
                </div>
                <div className="map-ramp-edges" aria-hidden="true">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <span key={i} style={{ left: i * 20 + "%" }}>
                      {edgeText(bottom + i * step)}
                      {i === 5 ? "%" : ""}
                    </span>
                  ))}
                </div>
              </div>
              <div className="map-legend-hatch">
                <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true">
                  <defs>
                    <pattern
                      id={hatchId + "-key"}
                      patternUnits="userSpaceOnUse"
                      width="5"
                      height="5"
                      patternTransform="rotate(45)"
                    >
                      <rect width="5" height="5" fill={PAPER} />
                      <line x1="2.5" y1="0" x2="2.5" y2="5" stroke={INK2} strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width="18" height="12" fill={`url(#${hatchId}-key)`} />
                </svg>
                fewer than 30 patients
              </div>
            </div>
          </>
        )}
      </div>

      <div className="map-sites">
        <p className="map-sites-line">
          {sites.length ? (
            <>
              <Ring color={ACCENT} r={5} w={1.5} /> {sites.length} Massachusetts{" "}
              {sites.length === 1 ? "site" : "sites"} this trial lists on ClinicalTrials.gov
            </>
          ) : (
            "This trial lists no Massachusetts sites on ClinicalTrials.gov."
          )}
        </p>
        {rec && (
          <label className="map-toggle">
            <input type="checkbox" checked={showRec} onChange={(e) => setShowRec(e.target.checked)} />
            <Ring color={INK2} r={3} w={1.2} />
            <span>
              Recruiting type 2 diabetes trials in Massachusetts, as of {fmtDate(rec.as_of)}
              {Number.isFinite(rec.trials) ? ` (${rec.trials} ${rec.trials === 1 ? "trial" : "trials"})` : ""}
            </span>
          </label>
        )}
      </div>

      {activeArea && (
        <div ref={tipRef} className="map-tip" aria-hidden="true">
          <div className="map-tip-title">{fullName(activeArea)}</div>
          {!activeInfo.row ? (
            <div>{noCounts}</div>
          ) : activeInfo.sup ? (
            <div>fewer than 30 patients</div>
          ) : (
            <>
              <div>{fmtInt(activeInfo.row.patients)} synthetic patients</div>
              <div>
                {fmtInt(activeInfo.row.confirmed)} eligible ({pct(activeInfo.row.confirmed_rate)})
              </div>
              {activeInfo.kept != null && (
                <div>
                  {fmtInt(activeInfo.kept)} kept out by this criterion ({pct(activeInfo.kept / activeInfo.row.patients)})
                </div>
              )}
              {activeInfo.delta && <div>{activeInfo.delta}</div>}
            </>
          )}
          {contextLine(activeArea.context) && <div className="map-tip-context">{contextLine(activeArea.context)}</div>}
          {contextSource(activeArea.context) && (
            <div className="map-tip-source">{contextSource(activeArea.context)}</div>
          )}
        </div>
      )}

      {hasData && (
        // The wrapper clips: a <table> ignores width:1px and would widen the pane's scroll area.
        <div className="visually-hidden">
        <table>
          <caption>
            {crit
              ? `Where “${gloss}” keeps patients out, by county`
              : "Confirmed-eligible share of synthetic patients, by county"}
          </caption>
          <thead>
            <tr>
              <th scope="col">County</th>
              <th scope="col">Synthetic patients</th>
              <th scope="col">Confirmed eligible</th>
              <th scope="col">Share</th>
              <th scope="col">Change vs protocol as written</th>
              {crit && <th scope="col">Kept out by this criterion</th>}
            </tr>
          </thead>
          <tbody>
            {geoAreas.map((a) => {
              const { row, sup, kept, delta } = infoOf(a);
              const span = crit ? 5 : 4;
              return (
                <tr key={a.id}>
                  <th scope="row">{fullName(a)}</th>
                  {!row ? (
                    <td colSpan={span}>{noCounts}</td>
                  ) : sup ? (
                    <td colSpan={span}>fewer than 30 patients</td>
                  ) : (
                    <>
                      <td>{fmtInt(row.patients)}</td>
                      <td>{fmtInt(row.confirmed)}</td>
                      <td>{pct(row.confirmed_rate)}</td>
                      <td>{delta || "—"}</td>
                      {crit && <td>{kept != null ? `${fmtInt(kept)} (${pct(kept / row.patients)})` : "—"}</td>}
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

export function MapCaption({ geo, placeholder }) {
  const sources = (geo && Array.isArray(geo.sources) && geo.sources) || [];
  // One short line: each source named by what it supplies and linked; the full
  // dataset name and year sit in the link title. A shared retrieval date shows once.
  const dates = [...new Set(sources.map((s) => s.retrieved).filter(Boolean))];
  return (
    <div className="map-caption">
      {sources.length > 0 && (
        <p>
          Sources{dates.length === 1 ? `, retrieved ${fmtDate(dates[0])}` : ""}:{" "}
          {sources.map((s, i) => {
            const title = [s.dataset, s.data_year, dates.length !== 1 && s.retrieved && `retrieved ${fmtDate(s.retrieved)}`]
              .filter(Boolean)
              .join(", ");
            return (
              <span key={i}>
                {i > 0 && " · "}
                {/^https?:\/\//.test(s.url || "") ? (
                  <a href={s.url} target="_blank" rel="noreferrer" title={title}>
                    {s.what}
                  </a>
                ) : (
                  <span title={title}>{s.what}</span>
                )}
              </span>
            );
          })}
          .
        </p>
      )}
      <p>Patients are synthetic. The map scores places, never people. Figures are estimates.</p>
      {placeholder && <p>Placeholder map: shapes and numbers are stand-ins until the geo API answers.</p>}
    </div>
  );
}
