/**
 * What is in the way (docs/design.md, *Skyline first*): the OpenStreetMap
 * building whose outline holds a lidar point. The skyline point is the top
 * of the first wall the ray meets, so it can sit a cell outside a slightly
 * misdrawn outline: `toleranceM` allows for that. No outline within it means
 * the caller says "a tree or something unmapped", never a guess.
 */
import type { LatLon } from "../geo";
import type { Footprint } from "./highspots";

const M_LAT = 111_320;

export function footprintHolding(footprints: Footprint[], p: LatLon, toleranceM = 1.5): Footprint | null {
  const mLon = M_LAT * Math.cos((p.lat * Math.PI) / 180);
  const xy = (q: LatLon) => [(q.lon - p.lon) * mLon, (q.lat - p.lat) * M_LAT] as const;
  let best: Footprint | null = null;
  let bestD = toleranceM;
  for (const f of footprints) {
    const pts = f.ring.map(xy);
    // Inside (even-odd) with the point at the origin.
    let odd = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > 0 !== yj > 0 && 0 < xi + ((0 - yi) / (yj - yi)) * (xj - xi)) odd = !odd;
    }
    if (odd) return f;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const d = segDist(pts[j], pts[i]);
      if (d <= bestD) {
        bestD = d;
        best = f;
      }
    }
  }
  return best;
}

/** Distance from the origin to a segment, metres. */
function segDist(a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2)) : 0;
  return Math.hypot(a[0] + t * dx, a[1] + t * dy);
}
