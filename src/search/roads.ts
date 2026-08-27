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
import { DEG, type LatLon } from "../geo";
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
