const BASE = "/api";

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function get(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export const api = {
  health: () => get("/health"),
  trials: () => get("/trials"),
  fieldBounds: () => get("/field-bounds"),
  parse: (body) => post("/parse", body),
  analyze: (body) => post("/analyze", body),
};
