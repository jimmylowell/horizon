/**
 * High spots on building faces (docs/design.md, *Eye height and high spots
 * in town*). Each OpenStreetMap footprint edge that looks toward the event is
 * sampled every few metres, one step outside the wall, at the slider's height
 * above the ground. A face counts only where the lidar just inside the wall
 * reaches that height, so the spot is beside a measured wall, not in the air.
 * The score is the skyline angle toward the event from that spot: lower is a
 * later sunset (or an earlier rise).
 *
 * It names a spot on a building's face, never a balcony: no source here
 * records balconies, windows or whether anyone can stand there.
 */

import { DEG, destination, type LatLon } from "../geo";

export interface Footprint {
  ring: LatLon[];
  /** OSM `name`, else house number and street, else null. */
  label: string | null;
}

export interface ScoredFace {
  a: LatLon;
  b: LatLon;
  /** Lowest skyline angle among the face's samples, degrees. */
  angleDeg: number;
}

export interface HighSpot {
  point: LatLon;
  label: string | null;
  /** Compass word for the way the face looks: "west", "south-west"… */
  facing: string;
  /** Lidar height just inside the wall, metres above the ground. */
  wallHeightM: number;
  angleDeg: number;
}

/** Spacing of samples along a face, metres. */
export const FACE_STEP_M = 4;
/** How far outside the wall a sample sits, metres (about two lidar cells). */
export const FACE_OUT_M = 1.5;
/** How far inside the wall the lidar is read for the wall's height, metres. */
const FACE_IN_M = 1.5;
/** Faces shorter than this are skipped: a corner kink, not a wall. */
const MIN_FACE_M = 3;

const M_PER_DEG_LAT = 111_320;

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
export const compassWord = (azDeg: number) => COMPASS[Math.round((((azDeg % 360) + 360) % 360) / 45) % 8];

/** Signed area in local metres; positive = counter-clockwise. */
function signedArea(ring: LatLon[], mPerDegLon: number): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j].lon * mPerDegLon) * (ring[i].lat * M_PER_DEG_LAT) - (ring[i].lon * mPerDegLon) * (ring[j].lat * M_PER_DEG_LAT);
  }
  return a / 2;
}

/**
 * Score every face that looks toward `azimuthDeg` (its outward side within
 * 90° of it). `wallHeight` is the lidar height above ground; `skyAngle` marches
 * from a point at the eye height and returns the skyline angle, or NaN when
 * unknown. Faces whose wall does not reach the eye are left out.
 */
export function scoreFaces(
  footprints: Footprint[],
  azimuthDeg: number,
  eyeHeightM: number,
  wallHeight: (lat: number, lon: number) => number,
  skyAngle: (p: LatLon) => number
): { faces: ScoredFace[]; spots: HighSpot[] } {
  const faces: ScoredFace[] = [];
  const spots: HighSpot[] = [];
  for (const fp of footprints) {
    const ring = fp.ring.length > 1 && fp.ring[0].lat === fp.ring[fp.ring.length - 1].lat && fp.ring[0].lon === fp.ring[fp.ring.length - 1].lon
      ? fp.ring.slice(0, -1)
      : fp.ring;
    if (ring.length < 3) continue;
    const mPerDegLon = M_PER_DEG_LAT * Math.cos(ring[0].lat * DEG);
    const ccw = signedArea(ring, mPerDegLon) > 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const dx = (b.lon - a.lon) * mPerDegLon;
      const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
      const len = Math.hypot(dx, dy);
      if (len < MIN_FACE_M) continue;
      const along = Math.atan2(dx, dy) / DEG; // bearing a → b
      // Outward normal: right of travel on a counter-clockwise ring.
      const out = (along + (ccw ? 90 : -90) + 360) % 360;
      const off = Math.abs((((out - azimuthDeg) % 360) + 540) % 360 - 180);
      if (off >= 90) continue;
      const n = Math.max(1, Math.floor(len / FACE_STEP_M));
      let best: HighSpot | null = null;
      for (let s = 0; s < n; s++) {
        const t = (s + 0.5) / n;
        const onWall = { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon) };
        const inside = destination(onWall, FACE_IN_M, out + 180);
        const h = wallHeight(inside.lat, inside.lon);
        if (!(h >= eyeHeightM)) continue;
        const p = destination(onWall, FACE_OUT_M, out);
        const ang = skyAngle(p);
        if (!Number.isFinite(ang)) continue;
        if (!best || ang < best.angleDeg) best = { point: p, label: fp.label, facing: compassWord(out), wallHeightM: h, angleDeg: ang };
      }
      if (best) {
        faces.push({ a, b, angleDeg: best.angleDeg });
        spots.push(best);
      }
    }
  }
  return { faces, spots };
}

/**
 * The best few spots, no two within `apartM` of each other, so one long
 * wall does not fill the list.
 */
export function bestSpots(spots: HighSpot[], count = 3, apartM = 40): HighSpot[] {
  const sorted = [...spots].sort((x, y) => x.angleDeg - y.angleDeg);
  const kept: HighSpot[] = [];
  for (const s of sorted) {
    const mPerDegLon = M_PER_DEG_LAT * Math.cos(s.point.lat * DEG);
    const near = kept.some(
      (k) => Math.hypot((k.point.lat - s.point.lat) * M_PER_DEG_LAT, (k.point.lon - s.point.lon) * mPerDegLon) < apartM
    );
    if (near) continue;
    kept.push(s);
    if (kept.length === count) break;
  }
  return kept;
}
