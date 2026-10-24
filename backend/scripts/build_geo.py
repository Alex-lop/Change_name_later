"""Build backend/data/geo/*.json from public sources (stdlib only, re-runnable).

Inputs: Census cartographic county boundaries, CDC PLACES county data (newest
release), ACS 5-year table-based summary files, ClinicalTrials.gov API v2.
Every number in the outputs comes from one of those fetches; nothing is
estimated. A missing value stops the build.

Run:  python backend/scripts/build_geo.py [--cached]
--cached reuses the filtered ACS rows already saved under data/geo/raw/
(the originals are 20-200 MB each and are streamed, never stored).
"""
from __future__ import annotations

import io
import json
import math
import re
import struct
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

OUT = Path(__file__).resolve().parents[1] / "data" / "geo"
RAW = OUT / "raw"
TODAY = datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
CACHED = "--cached" in sys.argv

PAD = 10.0
W = 1000
COS_LAT = math.cos(math.radians(42.3))
DP_TOL = 0.5
MIN_RING_AREA = 1.0

ACS_YEAR = "2024"
ACS_LABEL = "2020-2024"
ACS_BASE = f"https://www2.census.gov/programs-surveys/acs/summary_file/{ACS_YEAR}/table-based-SF"
CB_URLS = [
    "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip",
    "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_500k.zip",
]
PLACES_MEASURES = ["DIABETES", "BPHIGH", "CHD", "STROKE", "KIDNEY", "OBESITY"]
# KIDNEY is not published in the 2024 (fu4u-a9bh) or 2025 (swc5-untb) county releases; newest that has it:
FALLBACK_MEASURES = {"KIDNEY": ("h3ej-a9ec", "2023", "PLACES: Local Data for Better Health, County Data 2023 release")}
DEMO_NCTS = ["NCT02692716", "NCT01179048", "NCT01720446", "NCT01131676"]
CT_FIELDS = "NCTId,BriefTitle,OverallStatus,LocationFacility,LocationCity,LocationState,LocationStatus,LocationGeoPoint"
CAPE = {"25001", "25007", "25019"}
AGE_BANDS = [[18, 24], [25, 34], [35, 44], [45, 54], [55, 64], [65, 74], [75, 84], [85, None]]
# B01001 male E-columns per band (verified against ACS20245YR_Table_Shells.txt); female = male + 24.
BAND_COLS = [[7, 8, 9, 10], [11, 12], [13, 14], [15, 16], [17, 18, 19], [20, 21, 22], [23, 24], [25]]
# B19001 bracket lower bounds for E002..E017 (E017 is "$200,000 or more").
B19001_LOWER = [0, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000, 60000, 75000, 100000, 125000, 150000, 200000]

sources: list[dict] = []


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def fetch(url: str, timeout=120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "sieve-build-geo/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def source(what, dataset, year, url):
    sources.append({"what": what, "dataset": dataset, "data_year": year, "url": url, "retrieved": TODAY})


# ---------------------------------------------------------------- boundaries
def read_dbf(buf: bytes) -> list[dict]:
    nrec, hlen, rlen = struct.unpack_from("<IHH", buf, 4)
    fields, pos = [], 32
    while buf[pos] != 0x0D:
        name = buf[pos:pos + 11].split(b"\0")[0].decode("ascii")
        fields.append((name, buf[pos + 16]))
        pos += 32
    out = []
    for i in range(nrec):
        rec, p = buf[hlen + i * rlen:hlen + (i + 1) * rlen], 1
        row = {}
        for name, ln in fields:
            row[name] = rec[p:p + ln].decode("latin-1").strip()
            p += ln
        out.append(row)
    return out


def read_shp(buf: bytes) -> list[list[list[tuple[float, float]]]]:
    """Polygon shapefile -> per record, list of rings of (lon, lat)."""
    shapes, pos = [], 100
    while pos < len(buf):
        _, clen = struct.unpack_from(">ii", buf, pos)
        pos += 8
        end = pos + clen * 2
        stype = struct.unpack_from("<i", buf, pos)[0]
        rings = []
        if stype == 5:
            nparts, npts = struct.unpack_from("<ii", buf, pos + 36)
            parts = list(struct.unpack_from(f"<{nparts}i", buf, pos + 44)) + [npts]
            p0 = pos + 44 + nparts * 4
            pts = struct.unpack_from(f"<{2 * npts}d", buf, p0)
            xy = list(zip(pts[0::2], pts[1::2]))
            rings = [xy[parts[i]:parts[i + 1]] for i in range(nparts)]
        shapes.append(rings)
        pos = end
    return shapes


def load_counties() -> dict[str, dict]:
    for url in CB_URLS:
        try:
            data = fetch(url, timeout=300)
            break
        except Exception as e:  # noqa: BLE001
            log("boundary fetch failed", url, e)
    else:
        sys.exit("no boundary file reachable")
    year = re.search(r"cb_(\d{4})", url).group(1)
    source("County boundaries", f"Census Bureau cartographic boundary file cb_{year}_us_county_500k (1:500,000)", year, url)
    with tempfile.TemporaryDirectory() as td:
        z = zipfile.ZipFile(io.BytesIO(data))
        z.extractall(td)
        shp = next(Path(td).glob("*.shp")).read_bytes()
        dbf = next(Path(td).glob("*.dbf")).read_bytes()
    recs, shapes = read_dbf(dbf), read_shp(shp)
    assert len(recs) == len(shapes)
    counties = {r["GEOID"]: {"name": r["NAME"], "rings": s} for r, s in zip(recs, shapes) if r["STATEFP"] == "25"}
    assert len(counties) == 14, len(counties)
    return counties


# ---------------------------------------------------------------- geometry
def ring_area(r):
    return 0.5 * sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(r, r[1:] + r[:1]))


def centroid(r):
    a = ring_area(r)
    cx = sum((x0 + x1) * (x0 * y1 - x1 * y0) for (x0, y0), (x1, y1) in zip(r, r[1:] + r[:1])) / (6 * a)
    cy = sum((y0 + y1) * (x0 * y1 - x1 * y0) for (x0, y0), (x1, y1) in zip(r, r[1:] + r[:1])) / (6 * a)
    return cx, cy


def point_in_ring(x, y, r):
    inside = False
    for (x0, y0), (x1, y1) in zip(r, r[1:] + r[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def label_point(r):
    cx, cy = centroid(r)
    if point_in_ring(cx, cy, r):
        return cx, cy
    xs = sorted(x0 + (cy - y0) * (x1 - x0) / (y1 - y0) for (x0, y0), (x1, y1) in zip(r, r[1:] + r[:1]) if (y0 > cy) != (y1 > cy))
    pairs = list(zip(xs[0::2], xs[1::2]))
    a, b = max(pairs, key=lambda p: p[1] - p[0])
    return (a + b) / 2, cy


def douglas_peucker(pts, tol):
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (x0, y0), (x1, y1) = pts[i], pts[j]
        dx, dy = x1 - x0, y1 - y0
        seg = math.hypot(dx, dy)
        best, bi = 0.0, -1
        for k in range(i + 1, j):
            x, y = pts[k]
            d = abs(dy * x - dx * y + x1 * y0 - y1 * x0) / seg if seg else math.hypot(x - x0, y - y0)
            if d > best:
                best, bi = d, k
        if best > tol:
            keep[bi] = True
            stack += [(i, bi), (bi, j)]
    return [p for p, k in zip(pts, keep) if k]


def path_d(rings):
    parts = []
    for r in rings:
        pts = [f"{x:.1f},{y:.1f}" for x, y in r]
        parts.append(f"M {pts[0]} L {' '.join(pts[1:])} Z")
    return " ".join(parts)


# ---------------------------------------------------------------- PLACES
def load_places() -> tuple[str, str, dict[str, dict]]:
    cat_url = "https://api.us.socrata.com/api/catalog/v1?domains=data.cdc.gov&q=PLACES%20County%20Data&limit=50"
    cat = json.loads(fetch(cat_url))
    best = None
    for r in cat["results"]:
        res = r["resource"]
        m = re.match(r"PLACES: Local Data for Better Health, County Data,? (\d{4}) release$", res["name"])
        if m and (best is None or int(m.group(1)) > best[0]):
            best = (int(m.group(1)), res["id"], res["name"])
    assert best, "no PLACES county dataset in catalog"
    release, rid, name = str(best[0]), best[1], best[2]
    where = "measureid in(" + ",".join(f"'{m}'" for m in PLACES_MEASURES) + ") AND datavaluetypeid in('CrdPrv','AgeAdjPrv')"
    url = f"https://data.cdc.gov/resource/{rid}.json?stateabbr=MA&$limit=5000&$where=" + urllib.parse.quote(where)
    rows = json.loads(fetch(url))
    (RAW / f"places_{rid}_MA.json").write_text(json.dumps(rows, indent=1))
    source("PLACES county measures (crude and age-adjusted prevalence)", name,
           ", ".join(sorted({r["year"] for r in rows})), url)
    per: dict[str, dict] = {}

    def merge(rows, extra):
        for r in rows:
            if r.get("data_value") in (None, ""):
                continue
            m = per.setdefault(r["locationid"], {}).setdefault(r["measureid"], {"year": r["year"], **extra})
            m["crude" if r["datavaluetypeid"] == "CrdPrv" else "age_adjusted"] = float(r["data_value"])

    merge(rows, {})
    present = sorted({m for d in per.values() for m in d})
    log("PLACES release", release, "measures present:", present)
    # Measures the newest release does not publish come from the newest release that does.
    for mid, (frid, frelease, fname) in FALLBACK_MEASURES.items():
        if mid in present:
            continue
        furl = f"https://data.cdc.gov/resource/{frid}.json?stateabbr=MA&measureid={mid}&$limit=5000&$where=" + urllib.parse.quote("datavaluetypeid in('CrdPrv','AgeAdjPrv')")
        frows = json.loads(fetch(furl))
        (RAW / f"places_{frid}_MA_{mid}.json").write_text(json.dumps(frows, indent=1))
        source(f"PLACES county measure {mid} (not published in the {release} release)", fname, ", ".join(sorted({r["year"] for r in frows})), furl)
        merge(frows, {"release": frelease})
        log("PLACES", mid, "from", frelease, "release:", len(frows), "rows")
    return release, name, per


# ---------------------------------------------------------------- ACS
def acs_rows(table: str, prefixes: tuple[str, ...]) -> tuple[list[str], dict[str, list[int]]]:
    """Stream the table-based summary file, keep header + MA rows, save them to raw/."""
    url = f"{ACS_BASE}/data/5YRData/acsdt5y{ACS_YEAR}-{table}.dat"
    out = RAW / f"acsdt5y{ACS_YEAR}-{table}_MA.dat"
    if not (CACHED and out.exists()):
        req = urllib.request.Request(url, headers={"User-Agent": "sieve-build-geo/1.0"})
        kept = []
        with urllib.request.urlopen(req, timeout=600) as r:
            for i, raw in enumerate(r):
                line = raw.decode("utf-8")
                if i == 0 or line.startswith(prefixes):
                    kept.append(line.rstrip("\n"))
        out.write_text("\n".join(kept) + "\n")
        log("ACS", table, len(kept) - 1, "MA rows")
    lines = out.read_text().splitlines()
    source(f"ACS table {table.upper()}", f"ACS 5-Year Estimates {ACS_LABEL}, table-based summary file {table.upper()}", ACS_LABEL, url)
    header = lines[0].split("|")
    rows = {}
    for ln in lines[1:]:
        f = ln.split("|")
        rows[f[0]] = [int(v) if v not in ("", ".") and re.fullmatch(r"-?\d+", v) else None for v in f[1:]]
    return header, rows


def e(row, n):
    """E-column n (1-based) from a split .dat row (E,M interleaved after GEO_ID)."""
    v = row[2 * (n - 1)]
    assert v is not None, f"null estimate E{n:03d}"
    return v


def load_geos() -> dict[str, str]:
    url = f"{ACS_BASE}/documentation/Geos{ACS_YEAR}5YR.txt"
    text = fetch(url).decode("utf-8", "replace")
    lines = text.splitlines()
    cols = lines[0].split("|")
    gi, ni, si = cols.index("GEO_ID"), cols.index("NAME"), cols.index("STUSAB")
    names, kept = {}, [lines[0]]
    for ln in lines[1:]:
        f = ln.split("|")
        if f[si] == "MA" and f[gi].startswith(("0500000US25", "0600000US25")):
            names[f[gi]] = f[ni]
            kept.append(ln)
    (RAW / f"Geos{ACS_YEAR}5YR_MA.txt").write_text("\n".join(kept) + "\n")
    source("Geography names (municipality labels)", f"ACS {ACS_LABEL} table-based summary file geography file Geos{ACS_YEAR}5YR.txt", ACS_LABEL, url)
    assert names, "no MA geographies in Geos file"
    return names


def muni_name(full: str) -> str:
    n = full.split(",")[0]
    return re.sub(r" (Town city|city|town|CDP)$", "", n)


def interpolated_median(brackets: list[int]) -> int:
    n = sum(brackets)
    half, cum = n / 2, 0
    for i, c in enumerate(brackets):
        if cum + c >= half:
            assert i < len(brackets) - 1, "median falls in the open top bracket; cannot interpolate"
            lo, hi = B19001_LOWER[i], B19001_LOWER[i + 1]
            return round(lo + (half - cum) / c * (hi - lo))
        cum += c
    raise AssertionError("empty brackets")


# ---------------------------------------------------------------- CT.gov
def ct_get(url: str, name: str):
    data = json.loads(fetch(url))
    (RAW / name).write_text(json.dumps(data, indent=1))
    return data


def ma_locations(study):
    ps = study["protocolSection"]
    out = []
    for loc in ps.get("contactsLocationsModule", {}).get("locations", []):
        gp = loc.get("geoPoint")
        if loc.get("state") == "Massachusetts" and gp:
            out.append({"facility": loc.get("facility"), "city": loc.get("city"), "status": loc.get("status"),
                        "lat": gp["lat"], "lon": gp["lon"]})
    return out


def home_model() -> dict:
    """The patient home model's own description (backend/dryrun/geo.py)."""
    import inspect

    sys.path.insert(0, str(OUT.parents[1]))
    from dryrun import geo

    return {"module": "backend/dryrun/geo.py", "seed": geo.SEED,
            "inputs": "county_inputs.json", "description": inspect.cleandoc(geo.__doc__)}


# ---------------------------------------------------------------- main
def main():
    RAW.mkdir(parents=True, exist_ok=True)
    counties = load_counties()

    # projection from the unsimplified MA bounds
    lons = [x for c in counties.values() for r in c["rings"] for x, _ in r]
    lats = [y for c in counties.values() for r in c["rings"] for _, y in r]
    lon_min, lon_max, lat_min, lat_max = min(lons), max(lons), min(lats), max(lats)
    S = (W - 2 * PAD) / ((lon_max - lon_min) * COS_LAT)
    H = round(2 * PAD + (lat_max - lat_min) * S)

    def proj(lon, lat):
        return (lon - lon_min) * COS_LAT * S + PAD, (lat_max - lat) * S + PAD

    for c in counties.values():
        c["proj"] = [[proj(*p) for p in r] for r in c["rings"]]
        c["proj"] = [r for r in c["proj"] if abs(ring_area(r)) >= MIN_RING_AREA] or [max(c["proj"], key=lambda r: abs(ring_area(r)))]
        c["simple"] = [douglas_peucker(r[:-1] if r[0] == r[-1] else r, DP_TOL) for r in c["proj"]]
        c["largest"] = max(c["proj"], key=lambda r: abs(ring_area(r)))

    def area_of(lon, lat):
        """Point-in-polygon on the unsimplified rings; nearest vertex as fallback."""
        for fips, c in counties.items():
            if any(point_in_ring(lon, lat, r) for r in c["rings"]):
                return fips, False
        # ponytail: nearest-vertex distance, not nearest-segment; fine at 1:500k for a fallback
        best = min(((math.hypot((lon - x) * COS_LAT, lat - y), fips) for fips, c in counties.items() for r in c["rings"] for x, y in r))
        return best[1], True

    places_release, places_name, places = load_places()

    # ACS
    _, b01001 = acs_rows("b01001", ("0500000US25",))
    _, b19013 = acs_rows("b19013", ("0500000US25",))
    _, b19001 = acs_rows("b19001", ("0500000US25",))
    _, b03003 = acs_rows("b03003", ("0500000US25",))
    _, b01003 = acs_rows("b01003", ("0500000US25", "0600000US25"))
    geo_names = load_geos()
    sources.append({"what": "B01001 column-to-age mapping check", "dataset": f"ACS{ACS_YEAR}5YR_Table_Shells.txt", "data_year": ACS_LABEL,
                    "url": f"{ACS_BASE}/documentation/ACS{ACS_YEAR}5YR_Table_Shells.txt", "retrieved": TODAY})

    county_inputs = {}
    acs = {}
    for fips, c in sorted(counties.items()):
        gid = f"0500000US{fips}"
        row = b01001[gid]
        bands = [sum(e(row, n) + e(row, n + 24) for n in cols) for cols in BAND_COLS]
        total = e(row, 1)
        pop65 = sum(bands[5:])
        hisp_row = b03003[gid]
        acs[fips] = {"total": total, "adults": sum(bands), "pop65": pop65, "bands": bands,
                     "median": e(b19013[gid], 1), "brackets": [e(b19001[gid], n) for n in range(2, 18)],
                     "hisp": e(hisp_row, 3), "hisp_total": e(hisp_row, 1)}
        assert sum(acs[fips]["brackets"]) == e(b19001[gid], 1)
        p = places.get(fips, {})
        missing = [m for m in PLACES_MEASURES if not {"crude", "age_adjusted"} <= set(p.get(m, {}))]
        assert not missing, f"{fips} lacks PLACES {missing}"
        county_inputs[fips] = {"name": f"{c['name']} County", "area_id": "cape_islands" if fips in CAPE else c["name"].lower(),
                               "adults_18plus": sum(bands), "adults_by_band": bands, "places": p}

    # most populous municipality per county (B01003 county subdivisions)
    top: dict[str, tuple[int, str]] = {}
    for gid, row in b01003.items():
        if gid.startswith("0600000US25") and gid in geo_names and "not defined" not in geo_names[gid]:
            fips = gid[9:14]
            pop = e(row, 1)
            if fips not in top or pop > top[fips][0]:
                top[fips] = (pop, muni_name(geo_names[gid]))
    assert set(top) >= set(counties), "missing municipality names"

    # areas
    groups: dict[str, list[str]] = {}
    for fips, c in counties.items():
        aid = "cape_islands" if fips in CAPE else c["name"].lower()
        groups.setdefault(aid, []).append(fips)
    areas = []
    for aid, fl in sorted(groups.items()):
        fl.sort()
        tot = sum(acs[f]["total"] for f in fl)
        adults = sum(acs[f]["adults"] for f in fl)
        if aid == "cape_islands":
            name, label = "Barnstable, Dukes and Nantucket Counties", "Cape and Islands"
            median = interpolated_median([sum(acs[f]["brackets"][i] for f in fl) for i in range(16)])
            diab = sum(places[f]["DIABETES"]["crude"] * acs[f]["adults"] for f in fl) / adults
        else:
            cname = counties[fl[0]]["name"]
            name, label = f"{cname} County", f"{cname} ({top[fl[0]][1]})"
            median, diab = acs[fl[0]]["median"], places[fl[0]]["DIABETES"]["crude"]
        largest = max((counties[f]["largest"] for f in fl), key=lambda r: abs(ring_area(r)))
        lx, ly = label_point(largest)
        areas.append({"id": aid, "name": name, "label": label, "fips": fl,
                      "paths": [path_d(counties[f]["simple"]) for f in fl],
                      "label_xy": [round(lx, 1), round(ly, 1)],
                      "context": {"adults_18plus": adults,
                                  "pct_65plus": round(100 * sum(acs[f]["pop65"] for f in fl) / tot, 1),
                                  "median_household_income": median,
                                  "pct_hispanic": round(100 * sum(acs[f]["hisp"] for f in fl) / sum(acs[f]["hisp_total"] for f in fl), 1),
                                  "diabetes_crude_pct": round(diab, 1),
                                  "acs_year": ACS_LABEL, "places_release": places_release}})

    # CT.gov
    fallback_notes = []

    def site(nct, title, loc):
        aid_fips, fb = area_of(loc["lon"], loc["lat"])
        if fb:
            fallback_notes.append(f"{nct} {loc['facility']} ({loc['city']}) mapped to nearest county {aid_fips}")
        x, y = proj(loc["lon"], loc["lat"])
        s = {"facility": loc["facility"], "city": loc["city"], "status": loc["status"], "lat": loc["lat"], "lon": loc["lon"],
             "xy": [round(x, 1), round(y, 1)], "area_id": county_inputs[aid_fips]["area_id"]}
        return ({"nct_id": nct, "title": title} | s) if title is not None else s

    trial_sites = {}
    for nct in DEMO_NCTS:
        url = f"https://clinicaltrials.gov/api/v2/studies/{nct}?fields={CT_FIELDS}"
        st = ct_get(url, f"ctgov_{nct}.json")
        trial_sites[nct] = [site(nct, None, loc) for loc in ma_locations(st)]
    source("Demo trial sites in Massachusetts (4 NCT IDs)", "ClinicalTrials.gov API v2, /studies/{nctId}", TODAY,
           f"https://clinicaltrials.gov/api/v2/studies/<NCT>?fields={CT_FIELDS}")

    query = "query.cond=type 2 diabetes&query.locn=Massachusetts&filter.overallStatus=RECRUITING"
    base = f"https://clinicaltrials.gov/api/v2/studies?{urllib.parse.quote(query, safe='=&')}&pageSize=100&fields={CT_FIELDS}"
    rec_sites, token, page = [], None, 1
    while True:
        url = base + (f"&pageToken={token}" if token else "")
        d = ct_get(url, f"ctgov_recruiting_t2d_MA_page{page}.json")
        for st in d.get("studies", []):
            idm = st["protocolSection"]["identificationModule"]
            rec_sites += [site(idm["nctId"], idm.get("briefTitle"), loc) for loc in ma_locations(st)]
        token = d.get("nextPageToken")
        if not token:
            break
        page += 1
    source("Recruiting type 2 diabetes trials with a Massachusetts site (snapshot)", "ClinicalTrials.gov API v2, /studies search", TODAY, base)

    # write
    areas_doc = {"viewBox": f"0 0 {W} {H}",
                 "projection": f"equirectangular: x = (lon - LON_MIN) * cos(42.3 deg) * S + PAD, y = (LAT_MAX - lat) * S + PAD; "
                               f"LON_MIN={lon_min:.6f}, LAT_MAX={lat_max:.6f}, S={S:.6f}, PAD={PAD:g}, cos(42.3 deg)={COS_LAT:.6f}; "
                               f"MA bounds from the unsimplified county rings (LON_MAX={lon_max:.6f}, LAT_MIN={lat_min:.6f})",
                 "boundary_source": sources[0]["dataset"], "areas": areas}
    (OUT / "areas.json").write_text(json.dumps(areas_doc, separators=(",", ":")))
    (OUT / "county_inputs.json").write_text(json.dumps({"acs_year": ACS_LABEL, "places_release": places_release, "age_bands": AGE_BANDS,
                                                         "counties": county_inputs}, indent=1))
    (OUT / "sites.json").write_text(json.dumps({"trial_sites": trial_sites,
                                                "recruiting_sites": {"as_of": TODAY, "query": query,
                                                                     "trials": len({s["nct_id"] for s in rec_sites}), "sites": rec_sites}}, indent=1))
    notes = ["api.census.gov requires a key (keyless requests redirect to missing_key.html); ACS values come from the official table-based summary files of the same release.",
             *[f"PLACES {mid} is not published in the 2024 or 2025 county releases, so it comes from the {rel} release (resource {rid}); its BRFSS year is in county_inputs.json."
               for mid, (rid, rel, _) in FALLBACK_MEASURES.items()],
             "Site-to-area assignment: ray-casting point-in-polygon on the unsimplified county rings; a point in no ring takes the county with the nearest ring vertex (listed in sites_fallback below).",
             "Shapes: Douglas-Peucker simplified to about 0.5 projected units; rings under 1.0 projected unit^2 dropped (each county keeps its largest ring).",
             *fallback_notes]
    (OUT / "sources.json").write_text(json.dumps({
        "sources": sources,
        "derived": ["cape_islands median_household_income: combined B19001 bracket counts of 25001+25007+25019, 50th percentile by linear interpolation within the bracket containing it (bracket bounds from the table shell).",
                    "cape_islands diabetes_crude_pct: mean of the three counties' PLACES crude DIABETES weighted by ACS B01001 adults 18+.",
                    "pct_65plus: B01001 population 65+ (E020-E025 + E044-E049) / B01001 total (E001) * 100, summed over the area's counties.",
                    "pct_hispanic: B03003 E003 / E001 * 100, summed over the area's counties.",
                    "adults_18plus and adults_by_band: B01001 male E007-E025 plus female E031-E049, grouped per age_bands.",
                    "label: most populous county subdivision by B01003 E001, name from the Geos file with ' city'/' town'/' Town city' stripped.",
                    "label_xy: centroid of the area's largest ring if inside it, else midpoint of the widest horizontal chord at the centroid's y."],
        "notes": notes,
        "home_model": home_model()}, indent=1))

    # checks
    assert len(areas) == 12 and len(county_inputs) == 14
    for f, ci in county_inputs.items():
        assert sum(ci["adults_by_band"]) == ci["adults_18plus"]
    log(f"areas.json {len((OUT / 'areas.json').read_bytes()) / 1024:.0f} KB  viewBox {areas_doc['viewBox']}  PLACES {places_release}")
    for a in areas:
        log(f"{a['id']:<13}{a['context']['adults_18plus']:>10}{a['context']['diabetes_crude_pct']:>7}  {a['label']}")
    log(f"demo sites: { {k: len(v) for k, v in trial_sites.items()} }  recruiting: {len(rec_sites)} sites / {len({s['nct_id'] for s in rec_sites})} trials")
    for n in fallback_notes:
        log("FALLBACK", n)


if __name__ == "__main__":
    main()
