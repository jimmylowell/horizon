/**
 * Which USGS lidar flight covers a spot (docs/design.md, *Lidar from USGS,
 * live*). The index is public/flights.json, baked by scripts/lidar/flights.mjs
 * from Hobu's boundary file of the bucket.
 */

import type { LatLon } from "../geo";

const R = 6378137;
const DEG = Math.PI / 180;
const mercX = (lon: number) => R * lon * DEG;
const mercY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));

// ---- which flight covers a spot ---------------------------------------------

/** One flight in the index (public/flights.json): name, box, year. */
export type FlightRow = [string, number, number, number, number, number];
export const EPT_ROOT = "https://s3-us-west-2.amazonaws.com/usgs-lidar-public/";

/**
 * The flight to stream for a pin: the index's boxes that hold it, newest
 * first, each checked against its own EPT hierarchy for points in the node
 * over the pin. Null when none has any.
 */
export async function findFlight(
  rows: FlightRow[],
  p: LatLon,
  fetchFn: typeof fetch = fetch
): Promise<{ name: string; candidates: number } | null> {
  const hits = rows.filter(([, w, s, e, n]) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n);
  hits.sort((a, b) => b[5] - a[5]);
  const x = mercX(p.lon), y = mercY(p.lat);
  for (const [name] of hits) {
    try {
      const url = EPT_ROOT + name;
      const ept = await (await fetchFn(`${url}/ept.json`)).json();
      const [bx0, by0, , bx1] = ept.bounds as number[];
      const cube = bx1 - bx0;
      const h = (await (await fetchFn(`${url}/ept-hierarchy/0-0-0-0.json`)).json()) as Record<string, number>;
      let deepest = -1, has = false;
      for (const [key, count] of Object.entries(h)) {
        const [d, kx, ky] = key.split("-").map(Number);
        const size = cube / 2 ** d;
        if (x < bx0 + kx * size || x >= bx0 + (kx + 1) * size || y < by0 + ky * size || y >= by0 + (ky + 1) * size) continue;
        if (d > deepest) {
          deepest = d;
          has = count !== 0;
        }
      }
      if (has && deepest >= 4) return { name, candidates: hits.length };
    } catch {
      /* next one */
    }
  }
  return null;
}
