/**
 * Reachability reality check: distance from a candidate to the nearest mapped
 * road, built from the basemap's already-loaded `transportation` vector layer
 * (no extra API call). A "great spot" 4 km from any road is a hike, not a
 * drive — candidates far from roads get penalized and honestly flagged.
 *
 * Best effort by design: only roads in currently loaded tiles are indexed, and
 * low zooms omit minor roads. When nothing is indexed we fail open (no
 * penalties) rather than flagging everything.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { DEG, flatDistanceM, type LatLon } from "../geo";
import type { Candidate } from "./grid";
import { overpassJson } from "./overpass";
import type { TravelMode } from "./pois";

/** OpenMapTiles `transportation.class` values a car can use. */
const DRIVE_CLASSES = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "service",
  "unclassified",
  "residential",
  "track",
]);
const BIKE_EXTRA = new Set(["cycleway", "path"]);

const CELL_M = 1000;
const DENSIFY_M = 250;
const MAX_SEARCH_M = 5000;

export class RoadIndex {
  /** cell key -> packed [lat, lon, lat, lon, ...] */
  private cells = new Map<string, number[]>();
  private count = 0;

  private cellKey(lat: number, lon: number, cosLat: number): string {
    const cy = Math.floor((lat * 111_320) / CELL_M);
    const cx = Math.floor((lon * 111_320 * cosLat) / CELL_M);
    return `${cx}:${cy}`;
  }

  add(lat: number, lon: number, cosLat: number): void {
    const key = this.cellKey(lat, lon, cosLat);
    let arr = this.cells.get(key);
    if (!arr) {
      arr = [];
      this.cells.set(key, arr);
    }
    arr.push(lat, lon);
    this.count++;
  }

  get size(): number {
    return this.count;
  }

  /** Distance in metres to the nearest indexed road point, or null if none within reach. */
  nearestRoadM(p: LatLon): number | null {
    const cosLat = Math.cos(p.lat * DEG);
    const maxCells = Math.ceil(MAX_SEARCH_M / CELL_M);
    const cy0 = Math.floor((p.lat * 111_320) / CELL_M);
    const cx0 = Math.floor((p.lon * 111_320 * cosLat) / CELL_M);
    let best = Infinity;
    for (let ring = 0; ring <= maxCells; ring++) {
      // Once we have a hit closer than the nearest possible point in this ring, stop.
      if (best < (ring - 1) * CELL_M) break;
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const arr = this.cells.get(`${cx0 + dx}:${cy0 + dy}`);
          if (!arr) continue;
          for (let i = 0; i < arr.length; i += 2) {
            const dLat = (arr[i] - p.lat) * 111_320;
            const dLon = (arr[i + 1] - p.lon) * 111_320 * cosLat;
            const d = Math.hypot(dLat, dLon);
            if (d < best) best = d;
          }
        }
      }
    }
    return Number.isFinite(best) ? best : null;
  }
}

function eachLine(geom: GeoJSON.Geometry, cb: (coords: GeoJSON.Position[]) => void): void {
  if (geom.type === "LineString") cb(geom.coordinates);
  else if (geom.type === "MultiLineString") geom.coordinates.forEach(cb);
}

/**
 * Build the index from whatever transportation features the basemap currently
 * has loaded. Returns null when nothing usable is found.
 */
export function buildRoadIndex(map: MapLibreMap, mode: TravelMode): RoadIndex | null {
  if (mode === "walk") return null;
  const style = map.getStyle();
  if (!style?.sources) return null;

  const classes = mode === "bike" ? new Set([...DRIVE_CLASSES, ...BIKE_EXTRA]) : DRIVE_CLASSES;
  const index = new RoadIndex();

  for (const [id, src] of Object.entries(style.sources)) {
    if ((src as { type?: string }).type !== "vector") continue;
    let features;
    try {
      features = map.querySourceFeatures(id, { sourceLayer: "transportation" });
    } catch {
      continue;
    }
    for (const f of features) {
      const cls = (f.properties as { class?: string } | null)?.class;
      if (!cls || !classes.has(cls)) continue;
      eachLine(f.geometry, (coords) => {
        for (let i = 0; i < coords.length - 1; i++) {
          const [lon1, lat1] = coords[i];
          const [lon2, lat2] = coords[i + 1];
          const cosLat = Math.cos(lat1 * DEG);
          const segM = Math.hypot((lat2 - lat1) * 111_320, (lon2 - lon1) * 111_320 * cosLat);
          const steps = Math.max(1, Math.ceil(segM / DENSIFY_M));
          for (let s = 0; s < steps; s++) {
            const t = s / steps;
            index.add(lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t, cosLat);
          }
        }
      });
    }
    if (index.size > 0) break;
  }
  return index.size > 0 ? index : null;
}

/**
 * Mode-specific road-distance bands, metres. Within `flag` is fine; between
 * `flag` and `exclude` is a short walk (flagged, mild penalty); beyond
 * `exclude` the spot is not presented in this mode at all — the index only
 * sees roads mapped at the current tile zoom, so the exclude band is kept
 * generous to avoid dropping overlooks on unmapped minor roads.
 */
export function roadBandsM(mode: TravelMode): { flag: number; exclude: number } {
  return mode === "bike" ? { flag: 700, exclude: 2000 } : { flag: 1000, exclude: 2500 };
}

// ---------- roadside candidates (OSM ways via Overpass) ----------
//
// "Open terrain is fine as long as it's on a road": instead of scoring an
// abstract dot grid and filtering by road distance afterwards, sample points
// *along* the roads you can actually stop on. Every roadside pick is then a
// pull-off by construction.

/** Highway classes worth stopping on, per travel mode (motorway/trunk: can't stop). */
const ROAD_CLASSES: Record<TravelMode, string[]> = {
  drive: ["primary", "secondary", "tertiary", "unclassified", "residential", "track"],
  bike: ["primary", "secondary", "tertiary", "unclassified", "residential", "track", "cycleway"],
  walk: [
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "living_street",
    "track",
    "cycleway",
    "footway",
    "path",
    "pedestrian",
  ],
};
/** Beyond town scale, residential streets are noise (and buildings aren't marched). */
const RESIDENTIAL_MAX_RADIUS_M = 8000;

const ROAD_LABELS: Record<string, string> = {
  primary: "Highway",
  secondary: "Highway",
  tertiary: "Road",
  unclassified: "Road",
  residential: "Street",
  living_street: "Street",
  track: "Track",
  cycleway: "Bike path",
  footway: "Trail",
  path: "Trail",
  pedestrian: "Trail",
};

export interface RoadWay {
  id: number;
  tags: Record<string, string>;
  geometry: LatLon[];
}

export interface RoadFetchResult {
  roads: Candidate[];
  /** false when every Overpass mirror failed (distinct from "no roads here"). */
  ok: boolean;
}

/** Sampling interval scales with the ring so candidate counts stay bounded. */
export function roadSpacingM(radiusM: number): number {
  return Math.min(600, Math.max(120, radiusM / 50));
}

/**
 * Densify ways into points every `spacingM`, keep those inside the ring, and
 * thin to at most one point per spacing-sized cell (coarsening until under
 * `maxCount`). Pure, for testing.
 */
export function sampleRoads(
  ways: RoadWay[],
  centre: LatLon,
  radiusM: number,
  spacingM: number,
  maxCount: number
): Candidate[] {
  const cosLat = Math.cos(centre.lat * DEG);
  const raw: Candidate[] = [];
  for (const w of ways) {
    const cls = w.tags.highway;
    const g = w.geometry;
    if (!cls || !g || g.length < 2) continue;
    const name = w.tags.name ?? w.tags.ref;
    let carry = 0; // distance since the last emitted point
    let n = 0;
    const emit = (p: LatLon) => {
      if (flatDistanceM(centre, p) > radiusM) return;
      raw.push({
        id: `r:${w.id}:${n++}`,
        source: "road",
        label: ROAD_LABELS[cls] ?? "Road",
        name,
        weight: 1,
        roadClass: cls,
        ...p,
      });
    };
    emit(g[0]);
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1];
      const b = g[i];
      const seg = flatDistanceM(a, b);
      let t = spacingM - carry;
      while (t <= seg) {
        const f = t / seg;
        emit({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
        t += spacingM;
      }
      carry = seg - (t - spacingM);
    }
  }

  // Thin on a grid; named ways first so a junction keeps the signed road.
  raw.sort((a, b) => Number(!!b.name) - Number(!!a.name));
  let cell = spacingM;
  for (;;) {
    const seen = new Set<string>();
    const kept: Candidate[] = [];
    for (const c of raw) {
      const key = `${Math.floor((c.lat * 111_320) / cell)}:${Math.floor((c.lon * 111_320 * cosLat) / cell)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(c);
    }
    if (kept.length <= maxCount) return kept;
    cell *= 1.5;
  }
}

/** Roads you can stop on within the ring, sampled into candidates. */
export async function fetchRoadCandidates(
  centre: LatLon,
  radiusM: number,
  mode: TravelMode,
  maxCount: number
): Promise<RoadFetchResult> {
  const classes = ROAD_CLASSES[mode].filter(
    (c) => radiusM <= RESIDENTIAL_MAX_RADIUS_M || (c !== "residential" && c !== "living_street")
  );
  const query =
    `[out:json][timeout:25];\n` +
    `way["highway"~"^(${classes.join("|")})$"]["access"!~"^(private|no)$"]` +
    `(around:${Math.round(radiusM)},${centre.lat.toFixed(5)},${centre.lon.toFixed(5)});\n` +
    `out geom qt;`;
  const json = await overpassJson<{ elements: RoadWay[] }>(query);
  if (!json) return { roads: [], ok: false };
  const ways = json.elements.filter((e) => Array.isArray(e.geometry) && e.tags);
  return { roads: sampleRoads(ways, centre, radiusM, roadSpacingM(radiusM), maxCount), ok: true };
}
