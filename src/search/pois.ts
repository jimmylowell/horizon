/**
 * OSM points of interest via Overpass API. The query is compiled at runtime
 * from data/poi-catalog.json — no OSM tags are hard-coded here.
 */

import catalog from "../../data/poi-catalog.json";
import { flatDistanceM, type LatLon } from "../geo";
import type { Candidate } from "./grid";
import { overpassJson } from "./overpass";

export type TravelMode = "walk" | "bike" | "drive";

interface PoiCategory {
  id: string;
  label: string;
  match: Record<string, string>[];
  modes: string[];
  weight: number;
  cap?: number;
}

export function categoriesForMode(mode: TravelMode): PoiCategory[] {
  return (catalog.categories as PoiCategory[]).filter((c) => c.modes.includes(mode));
}

function compileQuery(cats: PoiCategory[], bbox: [number, number, number, number]): string {
  const [s, w, n, e] = bbox;
  const clauses = cats
    .flatMap((c) => c.match)
    .map((rule) => {
      const tags = Object.entries(rule)
        .map(([k, v]) => `["${k}"="${v}"]`)
        .join("");
      return `nwr${tags}(${s},${w},${n},${e});`;
    })
    .join("\n  ");
  return `[out:json][timeout:20];\n(\n  ${clauses}\n);\nout center qt 1200;`;
}

export interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Run a compiled Overpass query against the shared mirror list. Returns null
 * when every mirror failed (distinct from a query with no results).
 */
export async function overpassQuery(query: string): Promise<OverpassElement[] | null> {
  const json = await overpassJson<{ elements: OverpassElement[] }>(query);
  return json === null ? null : json.elements;
}

function categoryOf(tags: Record<string, string>, cats: PoiCategory[]): PoiCategory | null {
  for (const c of cats) {
    for (const rule of c.match) {
      if (Object.entries(rule).every(([k, v]) => tags[k] === v)) return c;
    }
  }
  return null;
}

export interface PoiFetchResult {
  pois: Candidate[];
  /** false when every Overpass mirror failed (distinct from "none nearby"). */
  ok: boolean;
}

/**
 * Fetch POI candidates within the travel ring, trying Overpass mirrors in
 * order. Degrades gracefully: `ok: false` lets the UI say the place lookup
 * itself failed rather than pretending there are no places.
 */
export async function fetchPois(
  centre: LatLon,
  radiusM: number,
  mode: TravelMode
): Promise<PoiFetchResult> {
  const cats = categoriesForMode(mode);
  if (cats.length === 0) return { pois: [], ok: true };
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((centre.lat * Math.PI) / 180));
  const bbox: [number, number, number, number] = [
    centre.lat - dLat,
    centre.lon - dLon,
    centre.lat + dLat,
    centre.lon + dLon,
  ];
  const elements = await overpassQuery(compileQuery(cats, bbox));
  if (elements === null) return { pois: [], ok: false };
  const out: Candidate[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined || !el.tags) continue;
    const cat = categoryOf(el.tags, cats);
    if (!cat) continue;
    out.push({
      id: `p:${el.type}/${el.id}`,
      source: cat.id,
      label: cat.label,
      name: el.tags.name,
      weight: cat.weight,
      lat,
      lon,
    });
  }
  return { pois: postProcess(out, cats), ok: true };
}

/**
 * Keep OSM results useful: per-category caps from the catalog (named entries
 * survive first) and merging of unnamed same-category clusters (a lot with
 * three mapped parking areas should be one candidate, not three cards).
 */
function postProcess(pois: Candidate[], cats: PoiCategory[]): Candidate[] {
  const capOf = new Map(cats.map((c) => [c.id, c.cap ?? Infinity]));
  const out: Candidate[] = [];
  const DEDUPE_M = 200;
  for (const cat of cats) {
    const group = pois
      .filter((p) => p.source === cat.id)
      .sort((a, b) => Number(!!b.name) - Number(!!a.name));
    const keptCat: Candidate[] = [];
    for (const p of group) {
      if (keptCat.length >= capOf.get(cat.id)!) break;
      if (!p.name) {
        const dup = keptCat.some((q) => !q.name && flatDistanceM(q, p) < DEDUPE_M);
        if (dup) continue;
      }
      keptCat.push(p);
    }
    out.push(...keptCat);
  }
  return out;
}
