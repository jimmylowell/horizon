/**
 * OSM building footprints via Overpass, rasterized into a local height grid
 * the ray-marcher samples as extra blocker height on top of the terrain.
 *
 * Most OSM buildings carry no height at all, so the model is deliberately
 * blunt: `height` tag if present, else `building:levels` × 3 m, else assume
 * one story (~4 m) — enough to block a low sun/moon from street level. That
 * is what resolves city blocks: solid where the buildings are, open down the
 * street canyons.
 */

import type { LatLon } from "../geo";
import { overpassJson } from "./overpass";

/** Beyond this ray distance a one-story building subtends ~0.1° — ignore. */
export const BUILDING_RANGE_M = 2000;
/** Raster cell size; must stay well under a street width to keep corridors open. */
const CELL_M = 4;
const METERS_PER_LEVEL = 3;
/** One story incl. roof — the "at least one story" assumption for untagged buildings. */
const DEFAULT_HEIGHT_M = 4;
const MAX_WAYS = 80_000;
const M_PER_DEG_LAT = 111_320;

export interface BuildingGrid {
  cellM: number;
  /** Number of footprints rasterized. */
  count: number;
  /** Blocker height above ground at a point, metres (0 = no building). */
  sample: (lat: number, lon: number) => number;
}

interface OverpassWay {
  type: string;
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

export function buildingHeightM(tags: Record<string, string>): number {
  const h = parseFloat(tags.height ?? tags["building:height"] ?? "");
  if (Number.isFinite(h) && h > 0) return h;
  const levels = parseFloat(tags["building:levels"] ?? "");
  if (Number.isFinite(levels) && levels > 0) {
    return Math.max(DEFAULT_HEIGHT_M, levels * METERS_PER_LEVEL);
  }
  return DEFAULT_HEIGHT_M;
}

/** Rasterize footprint polygons into a height grid centred on `centre`. */
export function buildGrid(
  ways: OverpassWay[],
  centre: LatLon,
  halfM: number,
  cellM = CELL_M
): BuildingGrid {
  const size = Math.ceil((2 * halfM) / cellM);
  const heights = new Uint8Array(size * size);
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((centre.lat * Math.PI) / 180);
  const toCol = (lon: number) => ((lon - centre.lon) * mPerDegLon + halfM) / cellM;
  const toRow = (lat: number) => ((lat - centre.lat) * M_PER_DEG_LAT + halfM) / cellM;

  const stamp = (col: number, row: number, h: number) => {
    if (col < 0 || row < 0 || col >= size || row >= size) return;
    const i = row * size + col;
    if (h > heights[i]) heights[i] = h;
  };

  let count = 0;
  for (const way of ways) {
    const geom = way.geometry;
    if (way.type !== "way" || !geom || geom.length < 3) continue;
    const h = Math.min(255, Math.round(buildingHeightM(way.tags ?? {})));
    const xs = geom.map((p) => toCol(p.lon));
    const ys = geom.map((p) => toRow(p.lat));

    // Scanline even-odd fill (cell centres at +0.5).
    const rowMin = Math.max(0, Math.floor(Math.min(...ys)));
    const rowMax = Math.min(size - 1, Math.ceil(Math.max(...ys)));
    for (let row = rowMin; row <= rowMax; row++) {
      const scanY = row + 0.5;
      const hits: number[] = [];
      for (let i = 0; i < xs.length; i++) {
        const j = (i + 1) % xs.length;
        if (ys[i] <= scanY !== ys[j] <= scanY) {
          hits.push(xs[i] + ((scanY - ys[i]) / (ys[j] - ys[i])) * (xs[j] - xs[i]));
        }
      }
      hits.sort((a, b) => a - b);
      for (let k = 0; k + 1 < hits.length; k += 2) {
        const c0 = Math.ceil(hits[k] - 0.5);
        const c1 = Math.floor(hits[k + 1] - 0.5);
        for (let c = c0; c <= c1; c++) stamp(c, row, h);
      }
    }

    // Stamp outlines too, so footprints thinner than a cell still register.
    for (let i = 0; i < xs.length; i++) {
      const j = (i + 1) % xs.length;
      const steps = Math.max(1, Math.ceil(2 * Math.hypot(xs[j] - xs[i], ys[j] - ys[i])));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        stamp(Math.floor(xs[i] + t * (xs[j] - xs[i])), Math.floor(ys[i] + t * (ys[j] - ys[i])), h);
      }
    }
    count++;
  }

  return {
    cellM,
    count,
    sample: (lat, lon) => {
      const c = Math.floor(toCol(lon));
      const r = Math.floor(toRow(lat));
      if (c < 0 || r < 0 || c >= size || r >= size) return 0;
      return heights[r * size + c];
    },
  };
}

/**
 * Fetch and rasterize every building footprint covering the search ring
 * (plus blocker range). Returns null when Overpass fails — the caller
 * degrades to terrain-only, same as a POI-lookup failure.
 */
export async function fetchBuildings(
  centre: LatLon,
  radiusM: number
): Promise<BuildingGrid | null> {
  const halfM = radiusM + BUILDING_RANGE_M;
  const dLat = halfM / M_PER_DEG_LAT;
  const dLon = halfM / (M_PER_DEG_LAT * Math.cos((centre.lat * Math.PI) / 180));
  const bbox = `${centre.lat - dLat},${centre.lon - dLon},${centre.lat + dLat},${centre.lon + dLon}`;
  // Fetched alongside the terrain tiles, so it holds up the first answer:
  // capped like the road lookup (a little longer; the payload is bigger).
  const query = `[out:json][timeout:12];\nway["building"]["building"!="no"](${bbox});\nout geom qt ${MAX_WAYS};`;
  const json = await overpassJson<{ elements: OverpassWay[] }>(query, 12_000);
  if (!json) return null;
  return buildGrid(json.elements, centre, halfM);
}
