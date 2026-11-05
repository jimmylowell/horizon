/**
 * Horizon profile by ray-marching a DEM along an azimuth, with earth
 * curvature + standard refraction folded in via the effective earth radius.
 */

import { DEG, EARTH_RADIUS_M, EFFECTIVE_RADIUS_M } from "../geo";

/** Ground elevation in metres; NaN where there is no terrain data. */
export type ElevationSampler = (lat: number, lon: number) => number;

/**
 * Near-field blockers (buildings) as extra height on top of the terrain.
 * Marched at its own fine step so street-width gaps between footprints
 * survive — the 40 m+ terrain step would jump whole city lots.
 */
export interface ObstacleField {
  /** Blocker height above ground at a point, metres (0 = none). */
  sample: ElevationSampler;
  /** Ignore obstacles beyond this ray distance (angularly negligible). */
  maxDistM: number;
  /** March step while within range; match the obstacle raster cell. */
  stepM: number;
}

export interface MarchOptions {
  /** Max ray distance in metres. */
  maxDistM?: number;
  /** Initial step in metres (grows ~1%/distance). Match to DEM pixel size. */
  startStepM?: number;
  /** Observer eye height above ground, metres. */
  eyeHeightM?: number;
  obstacles?: ObstacleField;
}

export interface HorizonResult {
  /** Highest apparent elevation angle along the ray, degrees (negative = dip below flat). */
  maxAngleDeg: number;
  /** Distance to the feature forming the horizon, metres. */
  horizonDistM: number;
  /** Ground elevation at the observer, metres. */
  groundM: number;
  /** The point forming the horizon (the skyline the body rises/sets behind). */
  horizonLat: number;
  horizonLon: number;
  /**
   * The ray crossed ground with no terrain data (a tile that failed to load),
   * or the observer stands on it. The angle is then a lower bound: whatever
   * is in the gap could only block more, so the spot is unknown, not clear.
   */
  noData: boolean;
}

/**
 * March one ray. `sample` must be synchronous (tiles prefetched).
 * angle(d) = atan((h(d) − h_eye − d²/2R′) / d), R′ = R/(1−k).
 */
export function marchHorizon(
  sample: ElevationSampler,
  lat0: number,
  lon0: number,
  azimuthDeg: number,
  opts: MarchOptions = {}
): HorizonResult {
  const maxDist = opts.maxDistM ?? 150_000;
  const startStep = opts.startStepM ?? 60;
  const eye = opts.eyeHeightM ?? 2;

  const ground = sample(lat0, lon0);
  if (!Number.isFinite(ground)) {
    // Nothing is known about where you stand, so nothing about the view.
    return {
      maxAngleDeg: NaN,
      horizonDistM: maxDist,
      groundM: NaN,
      horizonLat: lat0,
      horizonLon: lon0,
      noData: true,
    };
  }
  const h0 = ground + eye;

  const az = azimuthDeg * DEG;
  const sinAz = Math.sin(az);
  const cosAz = Math.cos(az);

  let latR = lat0 * DEG;
  let lonR = lon0 * DEG;
  let d = 0;
  let maxTan = -Infinity;
  let distAtMax = maxDist;
  let latAtMax = latR;
  let lonAtMax = lonR;
  let noData = false;

  // A grid point can land *on* a footprint (you'd stand beside it, not on the
  // roof): ignore obstacles until the ray exits that contiguous built run.
  const obs = opts.obstacles;
  let escapedOrigin = !obs || obs.sample(lat0, lon0) <= 0;

  while (d < maxDist) {
    const nearObs = obs !== undefined && d < obs.maxDistM;
    const step = nearObs ? obs.stepM : Math.max(startStep, d * 0.01);
    d += step;
    // Incremental constant-bearing advance (spherical approximation).
    latR += (step * cosAz) / EARTH_RADIUS_M;
    lonR += (step * sinAz) / (EARTH_RADIUS_M * Math.cos(latR));
    let h = sample(latR / DEG, lonR / DEG);
    if (!Number.isFinite(h)) {
      noData = true; // a gap in the terrain, never a 2 km-deep hole
      continue;
    }
    if (nearObs) {
      const oh = obs.sample(latR / DEG, lonR / DEG);
      if (oh > 0) {
        if (escapedOrigin) h += oh;
      } else {
        escapedOrigin = true;
      }
    }
    const tan = (h - h0 - (d * d) / (2 * EFFECTIVE_RADIUS_M)) / d;
    if (tan > maxTan) {
      maxTan = tan;
      distAtMax = d;
      latAtMax = latR;
      lonAtMax = lonR;
    }
  }

  return {
    maxAngleDeg: Math.atan(maxTan) / DEG,
    horizonDistM: distAtMax,
    groundM: ground,
    horizonLat: latAtMax / DEG,
    horizonLon: lonAtMax / DEG,
    noData,
  };
}

/** Azimuths for a full-circle ring, first ray aimed at the event. */
export function ringAzimuths(eventAzimuthDeg: number, count: number): number[] {
  return Array.from({ length: count }, (_, k) => (eventAzimuthDeg + (360 * k) / count) % 360);
}

/**
 * Full-circle horizon profile: one obstruction angle per ring azimuth, in
 * `ringAzimuths` order. Openness is about nearby walls, not distant ranges,
 * so callers pass a much shorter maxDistM than the event-fan march.
 * A direction whose ray crossed missing terrain is NaN: unknown, which
 * `skyOpenness` never counts as open.
 */
export function horizonRing(
  sample: ElevationSampler,
  lat: number,
  lon: number,
  eventAzimuthDeg: number,
  count: number,
  opts: MarchOptions = {}
): number[] {
  return ringAzimuths(eventAzimuthDeg, count).map(
    (az) => {
      const r = marchHorizon(sample, lat, lon, az, opts);
      return r.noData ? NaN : r.maxAngleDeg;
    }
  );
}

/**
 * Horizon over a small azimuth fan (event direction ± spread).
 * Returns the mean obstruction angle across rays plus the centre ray's
 * horizon distance and ground elevation; `noData` if any ray crossed a gap.
 */
export function horizonFan(
  sample: ElevationSampler,
  lat: number,
  lon: number,
  azimuthDeg: number,
  spreadDeg: number,
  opts: MarchOptions = {}
): HorizonResult {
  const offsets = spreadDeg > 0 ? [-spreadDeg, 0, spreadDeg] : [0];
  let sumAngle = 0;
  let centre: HorizonResult | null = null;
  let noData = false;
  for (const off of offsets) {
    const r = marchHorizon(sample, lat, lon, azimuthDeg + off, opts);
    sumAngle += r.maxAngleDeg;
    noData ||= r.noData;
    if (off === 0) centre = r;
  }
  return {
    maxAngleDeg: sumAngle / offsets.length,
    horizonDistM: centre!.horizonDistM,
    groundM: centre!.groundM,
    horizonLat: centre!.horizonLat,
    horizonLon: centre!.horizonLon,
    noData,
  };
}
