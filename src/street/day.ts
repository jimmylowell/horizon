/**
 * The day's sun and moon over a skyline, for the Street View screen
 * (docs/design.md, *Street View*): positions every minute from local
 * midnight, and the moments each one's top edge crosses the skyline, set
 * against the flat-horizon time the strip uses.
 */

import { bodyPosition, eventTimeAt, type EventKind } from "../astro";
import { skyAt, type CircleSkyline } from "../render/view";

export type BodyKey = "sun" | "moon";

export interface BodyDay {
  /** Per minute from the day's start, 0..1440. */
  az: Float32Array;
  alt: Float32Array;
  radius: Float32Array;
  /** Top edge above the skyline that minute. */
  up: Uint8Array;
}

export interface Crossing {
  body: BodyKey;
  kind: "up" | "down";
  time: Date;
  azDeg: number;
  /** Minutes late (up) or early (down) against a flat horizon; null when no flat time was found. */
  deltaMin: number | null;
  /** Sign of the path's bearing change from the crossing into the sky. */
  pathDir: number;
}

export interface Day {
  start: number;
  sun: BodyDay;
  moon: BodyDay;
  crossings: Crossing[];
}

const KIND: Record<BodyKey, { up: EventKind; down: EventKind }> = {
  sun: { up: "sunrise", down: "sunset" },
  moon: { up: "moonrise", down: "moonset" },
};

/** Local midnight of a YYYY-MM-DD date, in this device's time zone. */
export function dayStart(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function bodyDay(body: BodyKey, lat: number, lon: number, start: number, sky: CircleSkyline): BodyDay {
  const n = 1441;
  const out: BodyDay = { az: new Float32Array(n), alt: new Float32Array(n), radius: new Float32Array(n), up: new Uint8Array(n) };
  const kind = KIND[body].up;
  for (let m = 0; m < n; m++) {
    const p = bodyPosition(kind, lat, lon, new Date(start + m * 60_000));
    out.az[m] = p.azDeg;
    out.alt[m] = p.altDeg;
    out.radius[m] = p.radiusDeg;
    out.up[m] = p.altDeg + p.radiusDeg > skyAt(sky, p.azDeg) ? 1 : 0;
  }
  return out;
}

/** The crossing to the second: bisect between the minute before and the minute it changed. */
function refine(body: BodyKey, lat: number, lon: number, sky: CircleSkyline, t0: number, t1: number, rising: boolean): { time: Date; azDeg: number } {
  let lo = t0;
  let hi = t1;
  let best = bodyPosition(KIND[body].up, lat, lon, new Date(t1));
  for (let k = 0; k < 8; k++) {
    const mid = (lo + hi) / 2;
    const p = bodyPosition(KIND[body].up, lat, lon, new Date(mid));
    const above = p.altDeg + p.radiusDeg > skyAt(sky, p.azDeg);
    if (rising ? above : !above) {
      hi = mid;
      best = p;
    } else lo = mid;
  }
  return { time: new Date(hi), azDeg: best.azDeg };
}

export function computeDay(lat: number, lon: number, date: string, sky: CircleSkyline): Day {
  const start = dayStart(date);
  const day: Day = { start, sun: bodyDay("sun", lat, lon, start, sky), moon: bodyDay("moon", lat, lon, start, sky), crossings: [] };
  for (const body of ["sun", "moon"] as const) {
    const b = day[body];
    let upAt = -1;
    let downAt = -1;
    for (let m = 1; m <= 1440; m++) {
      if (!b.up[m - 1] && b.up[m] && upAt < 0) upAt = m;
      if (b.up[m - 1] && !b.up[m]) downAt = m;
    }
    for (const [kind, at] of [["up", upAt], ["down", downAt]] as const) {
      if (at < 0) continue;
      const rising = kind === "up";
      const c = refine(body, lat, lon, sky, start + (at - 1) * 60_000, start + at * 60_000, rising);
      const flat = eventTimeAt(KIND[body][kind], lat, lon, c.time);
      // A flat time more than six hours off is another day's, not this crossing's.
      const ok = flat && Math.abs(+flat - +c.time) < 6 * 3600_000;
      const deltaMin = ok ? Math.round(((rising ? 1 : -1) * (+c.time - +flat!)) / 60_000) : null;
      const m2 = Math.max(0, Math.min(1440, at + (rising ? 20 : -20)));
      const d = ((b.az[m2] - c.azDeg) % 360 + 540) % 360 - 180;
      day.crossings.push({ body, kind, time: c.time, azDeg: c.azDeg, deltaMin, pathDir: Math.sign(d) || 1 });
    }
  }
  day.crossings.sort((a, b) => +a.time - +b.time);
  return day;
}
