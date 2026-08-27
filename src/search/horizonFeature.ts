/**
 * Names the terrain forming the skyline: given the ray-marched horizon points
 * of the top spots, one batched Overpass query finds the named OSM feature
 * (peak, ridge, saddle) each event happens behind. The feature catalog lives
 * in data/horizon-features.json — no OSM tags are hard-coded here.
 */

import catalog from "../../data/horizon-features.json";
import { distanceM, type LatLon } from "../geo";
import { overpassQuery } from "./pois";

interface FeatureCategory {
  id: string;
  label: string;
  match: Record<string, string>[];
  searchRadiusM: number;
}

export interface SkylineFeature {
  name: string;
  /** Category label from the catalog ("peak", "ridge", …). */
  label: string;
  lat: number;
  lon: number;
  /** Elevation from the OSM `ele` tag, metres, when present and parseable. */
  eleM?: number;
}

function categories(): FeatureCategory[] {
  return catalog.categories as unknown as FeatureCategory[];
}

function compileQuery(points: LatLon[]): string {
  const clauses: string[] = [];
  for (const p of points) {
    for (const cat of categories()) {
      for (const rule of cat.match) {
        const tags = Object.entries(rule)
          .map(([k, v]) => `["${k}"="${v}"]`)
          .join("");
        clauses.push(
          `nwr${tags}["name"](around:${cat.searchRadiusM},${p.lat.toFixed(5)},${p.lon.toFixed(5)});`
        );
      }
    }
  }
  return `[out:json][timeout:15];\n(\n  ${clauses.join("\n  ")}\n);\nout center qt 400;`;
}

function matches(tags: Record<string, string>, cat: FeatureCategory): boolean {
  return cat.match.some((rule) => Object.entries(rule).every(([k, v]) => tags[k] === v));
}

/**
 * Resolve each horizon point to its named skyline feature, or null when
 * nothing named is close enough (or Overpass is down — this is decoration,
 * so it fails soft). Categories are tried in catalog order; within a
 * category the named feature nearest the horizon point wins.
 */
export async function nameSkylinePoints(points: LatLon[]): Promise<(SkylineFeature | null)[]> {
  if (points.length === 0) return [];
  const elements = await overpassQuery(compileQuery(points));
  if (elements === null) return points.map(() => null);

  return points.map((p) => {
    for (const cat of categories()) {
      let best: SkylineFeature | null = null;
      let bestD = cat.searchRadiusM;
      for (const el of elements) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat === undefined || lon === undefined || !el.tags?.name) continue;
        if (!matches(el.tags, cat)) continue;
        const d = distanceM(p, { lat, lon });
        if (d < bestD) {
          bestD = d;
          const ele = parseFloat(el.tags.ele ?? "");
          best = {
            name: el.tags.name,
            label: cat.label,
            lat,
            lon,
            eleM: Number.isFinite(ele) ? ele : undefined,
          };
        }
      }
      if (best) return best;
    }
    return null;
  });
}
