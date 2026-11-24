/**
 * Find a place by name, or read pasted coordinates (docs/design.md, *Place
 * search*). Names go to Photon (komoot's public geocoder over OpenStreetMap,
 * https://photon.komoot.io), one request per search and only when the search
 * is sent: its server asks for fair use and throttles heavy users. Photon
 * matches the start of a word ("herks" finds Herks Werks) and ranks places
 * near the map first, where Nominatim matched whole words only.
 */

import type { LatLon } from "../geo";

export interface Place extends LatLon {
  /** The place's own name, e.g. "Herks Werks". */
  name: string;
  /** Where it is, shortened: "Fairgrounds Drive, Poncha Springs, Chaffee County". */
  where: string;
}

/**
 * "38.51748, -106.07600", "38.51748 -106.076" or "38.5°N 106.1°W": a point,
 * no lookup. Null when the text is not a pair of coordinates.
 */
export function parseLatLon(text: string): LatLon | null {
  const t = text.trim().toUpperCase();
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/);
  if (!m) return null;
  let lat = parseFloat(m[1]);
  let lon = parseFloat(m[3]);
  if (m[2] === "S") lat = -Math.abs(lat);
  if (m[4] === "W") lon = -Math.abs(lon);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { lat, lon };
}

export const PHOTON = "https://photon.komoot.io/api/";

/** Places near this point rank first (not a limit: Denver still finds Denver). */
export function searchUrl(q: string, near?: LatLon): string {
  const p = new URLSearchParams({ q, limit: "8", lang: "en" });
  if (near) {
    p.set("lat", near.lat.toFixed(4));
    p.set("lon", near.lon.toFixed(4));
  }
  return `${PHOTON}?${p}`;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    housenumber?: string;
    street?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

/** Photon's answer as places: the name, then a short "where"; repeats dropped (a stream in pieces), at most five. */
export function placesFrom(features: PhotonFeature[]): Place[] {
  const out: Place[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const name = p.name ?? [p.housenumber, p.street].filter(Boolean).join(" ");
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // Photon gives US counties bare ("Chaffee"); say what they are.
    const county = p.county && p.country === "United States" && !/(County|Parish|Borough)$/.test(p.county) ? `${p.county} County` : p.county;
    const parts = [p.street && p.street !== name ? p.street : "", p.city ?? p.district, county, p.state, p.country === "United States" ? "" : p.country];
    const where = parts.filter((x, i): x is string => !!x && parts.indexOf(x) === i).join(", ");
    const key = `${name}|${where}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ lat, lon, name, where });
    if (out.length === 5) break;
  }
  return out;
}

/** One search; a newer search aborts the older one. */
export async function findPlaces(q: string, near: LatLon | undefined, signal: AbortSignal): Promise<Place[]> {
  const res = await fetch(searchUrl(q, near), { signal });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  return placesFrom(((await res.json()) as { features: PhotonFeature[] }).features ?? []);
}
