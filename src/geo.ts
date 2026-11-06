/** Shared geodesy helpers (spherical earth — fine at our accuracy). */

export const EARTH_RADIUS_M = 6371008.8;
/**
 * Effective radius including standard atmospheric refraction for visible
 * light: R′ = 7/6 R, i.e. refraction coefficient k = 1/7 ≈ 0.143 in
 * R′ = R / (1 − k). Source: Wikipedia, "Horizon", § Effect of atmospheric
 * refraction › Simple method—Young (citing A. T. Young, "Distance to the
 * Horizon", SDSU). https://en.wikipedia.org/wiki/Horizon#Simple_method%E2%80%94Young
 * Real refraction varies with the air's temperature gradient; this is the
 * standard-atmosphere figure.
 */
export const EFFECTIVE_RADIUS_M = (EARTH_RADIUS_M * 7) / 6;

export const DEG = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Destination point given start, distance (m) and bearing (deg), spherical. */
export function destination(from: LatLon, distM: number, bearingDeg: number): LatLon {
  const δ = distM / EARTH_RADIUS_M;
  const θ = bearingDeg * DEG;
  const φ1 = from.lat * DEG;
  const λ1 = from.lon * DEG;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * sinφ2
    );
  return { lat: φ2 / DEG, lon: ((λ2 / DEG + 540) % 360) - 180 };
}

/**
 * Fast flat-earth distance in metres for nearby points (equirectangular) —
 * plenty for neighbour tests and dedupe inside a travel ring.
 */
export function flatDistanceM(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLon = (b.lon - a.lon) * 111_320 * Math.cos(a.lat * DEG);
  return Math.hypot(dLat, dLon);
}

/** Great-circle distance in metres. */
export function distanceM(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * DEG;
  const φ2 = b.lat * DEG;
  const dφ = (b.lat - a.lat) * DEG;
  const dλ = (b.lon - a.lon) * DEG;
  const s =
    Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}
