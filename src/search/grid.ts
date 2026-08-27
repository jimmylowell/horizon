/** Candidate grid: concentric rings of points filling the travel radius. */

import { destination, type LatLon } from "../geo";

export interface Candidate extends LatLon {
  id: string;
  /** "grid" or a POI category id. */
  source: string;
  name?: string;
  label?: string;
  weight: number;
}

export function gridCandidates(centre: LatLon, radiusM: number, rings = 12): Candidate[] {
  const spacing = radiusM / rings;
  const out: Candidate[] = [
    { id: "g0", source: "grid", weight: 1, ...centre },
  ];
  let n = 1;
  for (let i = 1; i <= rings; i++) {
    const r = i * spacing;
    const count = Math.max(6, Math.round((2 * Math.PI * r) / spacing));
    for (let j = 0; j < count; j++) {
      const bearing = (360 * j) / count + (i % 2) * (180 / count);
      out.push({
        id: `g${n++}`,
        source: "grid",
        weight: 1,
        ...destination(centre, r, bearing),
      });
    }
  }
  return out;
}

export function gridSpacingM(radiusM: number, rings = 12): number {
  return radiusM / rings;
}
