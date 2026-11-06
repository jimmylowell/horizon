/** Sun/moon rise & set events via astronomy-engine (MIT, worldwide, offline). */

import {
  AstroTime,
  Body,
  Equator,
  Horizon,
  Illumination,
  Observer,
  Refraction,
  SearchAltitude,
  SearchRiseSet,
} from "astronomy-engine";

export type EventKind = "sunrise" | "sunset" | "moonrise" | "moonset";

export const EVENT_KINDS: EventKind[] = ["sunrise", "sunset", "moonrise", "moonset"];

export interface SkyEvent {
  kind: EventKind;
  time: Date;
  /** Azimuth of the body at event time, degrees clockwise from north. */
  azimuthDeg: number;
  /** Moon illumination fraction (0..1) for moon events. */
  moonIllumination?: number;
}

function bodyOf(kind: EventKind): Body {
  return kind.startsWith("sun") ? Body.Sun : Body.Moon;
}

function directionOf(kind: EventKind): 1 | -1 {
  return kind.endsWith("rise") ? 1 : -1;
}

function azimuthAt(body: Body, time: AstroTime, obs: Observer): number {
  const eq = Equator(body, time, obs, true, true);
  return Horizon(time, obs, eq.ra, eq.dec, "normal").azimuth;
}

/** Next occurrence of each event kind after `from`, at the given location. */
export function nextEvents(
  lat: number,
  lon: number,
  from: Date = new Date()
): Partial<Record<EventKind, SkyEvent>> {
  const obs = new Observer(lat, lon, 0);
  const out: Partial<Record<EventKind, SkyEvent>> = {};
  for (const kind of EVENT_KINDS) {
    const body = bodyOf(kind);
    const t = SearchRiseSet(body, obs, directionOf(kind), from, 2);
    if (!t) continue;
    const ev: SkyEvent = {
      kind,
      time: t.date,
      azimuthDeg: azimuthAt(body, t, obs),
    };
    if (body === Body.Moon) {
      ev.moonIllumination = Illumination(Body.Moon, t).phase_fraction;
    }
    out[kind] = ev;
  }
  return out;
}

export interface GoldenHourSpan {
  start: Date;
  end: Date;
  /** Sun azimuth at span start/end, degrees clockwise from north. */
  startAzDeg: number;
  endAzDeg: number;
}

/**
 * Golden hour around a sun event (sun altitude between +6° and −4°); the
 * azimuth swing between the two crossings is what gets drawn on the map.
 * Null for moon events or when a crossing isn't found (high latitudes).
 */
export function goldenHourSpan(
  kind: EventKind,
  lat: number,
  lon: number,
  eventTime: Date
): GoldenHourSpan | null {
  if (!kind.startsWith("sun")) return null;
  const obs = new Observer(lat, lon, 0);
  const dir = directionOf(kind);
  const from = new Date(eventTime.getTime() - 3 * 3600_000);
  const hi = SearchAltitude(Body.Sun, obs, dir, from, 0.5, 6);
  const lo = SearchAltitude(Body.Sun, obs, dir, from, 0.5, -4);
  if (!hi || !lo) return null;
  // Rising sweeps −4°→+6°; setting sweeps +6°→−4°.
  const [first, last] = dir === 1 ? [lo, hi] : [hi, lo];
  return {
    start: first.date,
    end: last.date,
    startAzDeg: azimuthAt(Body.Sun, first, obs),
    endAzDeg: azimuthAt(Body.Sun, last, obs),
  };
}

/** Body azimuth at a given instant, degrees clockwise from north. */
export function azimuthAtTime(kind: EventKind, lat: number, lon: number, when: Date): number {
  return azimuthAt(bodyOf(kind), new AstroTime(when), new Observer(lat, lon, 0));
}

/** Event time recomputed at a specific spot (differs slightly by location). */
export function eventTimeAt(kind: EventKind, lat: number, lon: number, near: Date): Date | null {
  const obs = new Observer(lat, lon, 0);
  const start = new Date(near.getTime() - 6 * 3600_000);
  const t = SearchRiseSet(bodyOf(kind), obs, directionOf(kind), start, 1);
  return t ? t.date : null;
}

/**
 * The one definition of "on the horizon", for an open horizon and a ridge
 * alike: the **top edge** of the disc, as seen through the air, touches the
 * horizon line. That is how published rise and set times are defined, and it
 * is what astronomy-engine's `SearchRiseSet` finds for a flat horizon (top
 * edge, 34′ of refraction; see its docs). `SearchAltitude` instead tracks the
 * body's **centre** with no refraction, so a ridge time found with it alone
 * ran several minutes early against the open time it was compared with.
 *
 * Returns the geometric altitude the body's centre must reach for its top
 * edge to sit apparently on a horizon at `horizonDeg`: take off the lift of
 * refraction at that height (Saemundsson's formula, the library's "normal"
 * `Refraction`), then the disc's angular radius at that instant.
 */
export function centreAltitudeForTopEdge(
  kind: EventKind,
  lat: number,
  lon: number,
  when: Date,
  horizonDeg: number
): number {
  // Top edge's geometric altitude h, with h + refraction(h) = horizonDeg.
  let h = horizonDeg;
  for (let i = 0; i < 6; i++) h = horizonDeg - Refraction("normal", h);
  return h - semidiameterDeg(kind, lat, lon, when);
}

const KM_PER_AU = 1.4959787069098932e8;

/** Angular radius of the sun or moon disc from this spot, degrees. */
export function semidiameterDeg(kind: EventKind, lat: number, lon: number, when: Date): number {
  const body = bodyOf(kind);
  const radiusKm = body === Body.Sun ? 695_700 : 1_738.1; // the library's own radii
  const eq = Equator(body, new AstroTime(when), new Observer(lat, lon, 0), true, true);
  return (Math.asin(radiusKm / KM_PER_AU / eq.dist) * 180) / Math.PI;
}

/**
 * When the body actually appears/disappears behind terrain whose apparent
 * angle is `obstructionDeg`: the moment its top edge meets the ridge line,
 * by the same definition as the open-horizon time (`centreAltitudeForTopEdge`).
 * Returns null when the horizon is open (at or below flat) or not found.
 */
export function obstructedEventTime(
  kind: EventKind,
  lat: number,
  lon: number,
  eventTime: Date,
  obstructionDeg: number
): Date | null {
  if (!(obstructionDeg > 0)) return null;
  const obs = new Observer(lat, lon, 0);
  const dir = directionOf(kind);
  const target = centreAltitudeForTopEdge(kind, lat, lon, eventTime, obstructionDeg);
  // Rising: body clears the ridge after the open rise. Setting: it vanishes before.
  const start = new Date(eventTime.getTime() - (dir === 1 ? 0.5 : 6) * 3600_000);
  const t = SearchAltitude(bodyOf(kind), obs, dir, start, 0.5, target);
  return t ? t.date : null;
}

export interface ObstructionEffect {
  /** When the body actually clears / vanishes behind the ridge; null if the horizon is open. */
  time: Date | null;
  /** Minutes of the event lost to terrain (0 when open). */
  lostMin: number;
}

/**
 * What a terrain obstruction *means* for a rise/set: not an abstract angle
 * but minutes late (rising) or minutes early (setting). A 3° ridge costs a
 * mid-latitude moonrise about 20 minutes; that number is the verdict.
 */
export function obstructionEffect(
  kind: EventKind,
  lat: number,
  lon: number,
  eventTime: Date,
  obstructionDeg: number
): ObstructionEffect {
  const t = obstructedEventTime(kind, lat, lon, eventTime, obstructionDeg);
  if (!t) return { time: null, lostMin: 0 };
  const dir = directionOf(kind);
  return { time: t, lostMin: Math.max(0, Math.round((dir * (t.getTime() - eventTime.getTime())) / 60_000)) };
}
