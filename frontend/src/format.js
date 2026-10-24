// Shared number formatting. Sans numbers use tabular figures; "about" is added
// by callers on estimates.

export function fmtInt(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  return Math.round(x).toLocaleString("en-US");
}

export function fmtMoney(x) {
  if (x == null || !Number.isFinite(x)) return "—";
  const abs = Math.abs(x);
  if (abs >= 1_000_000) return "$" + (x / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return "$" + (x / 1_000).toFixed(0) + "k";
  return "$" + Math.round(x).toLocaleString("en-US");
}

export function fmtMonths(x, digits = 1) {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}

// Signed delta string, e.g. "+412" / "−3.1" using a true minus sign.
export function fmtDelta(x, { money = false, months = false } = {}) {
  if (x == null || !Number.isFinite(x) || x === 0) return null;
  const sign = x > 0 ? "+" : "−";
  const mag = Math.abs(x);
  if (money) return sign + fmtMoney(mag).replace("$", "$");
  if (months) return sign + mag.toFixed(1);
  return sign + Math.round(mag).toLocaleString("en-US");
}

export function fmtValue(v) {
  if (Array.isArray(v)) return v.join("–");
  return String(v);
}
