/**
 * Facing away from the sun: the sky opposite a sunset (or a sunrise) is its
 * own show. The Belt of Venus is a pink band "roughly 10–20° above the
 * horizon" over the antisolar point, during twilight, "separated from the
 * horizon by the dark band of Earth's shadow" as twilight goes on
 * (Wikipedia, *Belt of Venus*, https://en.wikipedia.org/wiki/Belt_of_Venus).
 * A spot for it is one whose horizon opposite the sun is low and wide, so
 * the band and the shadow under it are both in view.
 */

import type { EventKind } from "./verdict";
import type { Reading } from "./reading";

/** Half-width of the fan marched opposite the sun: 60° of sky in all. */
export const AWAY_SPREAD_DEG = 30;

/** The Belt of Venus's band, degrees above the horizon (Wikipedia, above). */
export const BELT_LOW_DEG = 10;
export const BELT_HIGH_DEG = 20;

/** The antisolar bearing: straight opposite the event. */
export function awayAzimuth(eventAzimuthDeg: number): number {
  return (((eventAzimuthDeg + 180) % 360) + 360) % 360;
}

/** Away mode makes sense for the sun only; the belt is a sunlight effect. */
export function canFaceAway(kind: EventKind): boolean {
  return kind === "sunrise" || kind === "sunset";
}

/**
 * What a spot shows opposite the sun, given the average horizon angle across
 * the fan. Grades follow the cards' scale (4 best … 0 worst, "u" unknown).
 */
export function awayReading(horizonDeg: number, noData: boolean): Reading {
  if (noData || !Number.isFinite(horizonDeg)) {
    return { label: "Unknown: terrain didn't load opposite the sun", grade: "u", unknown: true };
  }
  const up = Math.max(0, horizonDeg);
  const angle = horizonDeg <= 0 ? "at or below flat" : `${up.toFixed(1)}° up`;
  if (up < BELT_LOW_DEG) {
    const grade = up < 2 ? 4 : up < 5 ? 3 : 2;
    return { label: `Opposite the sun, horizon ${angle}: the Belt of Venus in full view`, grade, unknown: false };
  }
  if (up < BELT_HIGH_DEG) {
    return { label: `Opposite the sun, horizon ${angle}: the ridge cuts into the Belt of Venus`, grade: 1, unknown: false };
  }
  return { label: `Opposite the sun, horizon ${angle}: the ridge hides the Belt of Venus`, grade: 0, unknown: false };
}

/** Degrees lower than here, for the card's chip; null when either side is unknown. */
export function awayGainVsHere(
  spotDeg: number,
  hereDeg: number,
  noData: boolean
): { text: string; cls: string } | null {
  if (noData || !Number.isFinite(spotDeg) || !Number.isFinite(hereDeg)) return null;
  const d = Math.round((Math.max(0, hereDeg) - Math.max(0, spotDeg)) * 10) / 10;
  if (d > 0) return { text: `${d.toFixed(1)}° lower than here`, cls: "good" };
  if (d < 0) return { text: `${(-d).toFixed(1)}° higher than here`, cls: "bad" };
  return { text: "same as here", cls: "same" };
}
