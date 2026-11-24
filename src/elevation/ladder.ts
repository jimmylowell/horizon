/**
 * Terrain detail by distance (docs/design.md, *Loading faster*): fine tiles
 * near the observer, coarser ones for the far ridges. A ridge 40 km away is
 * a fraction of a degree whether it is read from 30 m or 500 m pixels, but
 * reading it at full detail all the way out was most of the download.
 *
 * Measured round Salida on 2,100 sight lines toward a moonrise, against fine
 * tiles all the way out: median change 0.000°, 99% within 0.18°, worst 0.25°
 * (about a minute and a half of moonrise); 33 tiles (~2.7 MB) for a full
 * circle instead of 139 tiles (19 MB) at one zoom.
 */

import { destination, type LatLon } from "../geo";
import type { ElevationSampler } from "./horizon";
import { metersPerPixel, TILE_SIZE, tileKeyString, tilesForBBox, type TileKey } from "./tiles";

export interface ZoomBand {
  /** Tile zoom used in this band. */
  z: number;
  /** Band ends this far from the observer, metres. */
  toM: number;
}

/** The ladder: the near zoom to 8 km, two levels coarser to 40 km, four beyond. */
export function zoomLadder(nearZ: number): ZoomBand[] {
  return [
    { z: nearZ, toM: 8_000 },
    { z: Math.max(0, nearZ - 2), toM: 40_000 },
    { z: Math.max(0, nearZ - 4), toM: Infinity },
  ];
}

export function bandAt(bands: ZoomBand[], distM: number): ZoomBand {
  for (const b of bands) if (distM < b.toM) return b;
  return bands[bands.length - 1];
}

/**
 * A sampler that reads each point at the zoom of its distance from `from`.
 * Distance is flat (equirectangular): over 150 km it is within a fraction of
 * a percent of the great circle, far finer than the band edges need.
 */
export function ladderSampler(
  sample: (lat: number, lon: number, z: number) => number,
  from: LatLon,
  bands: ZoomBand[]
): ElevationSampler {
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((from.lat * Math.PI) / 180);
  return (lat, lon) => {
    const dy = (lat - from.lat) * mPerDegLat;
    const dx = (lon - from.lon) * mPerDegLon;
    return sample(lat, lon, bandAt(bands, Math.sqrt(dx * dx + dy * dy)).z);
  };
}

/**
 * Every tile a ray (or a fan of rays) needs under the ladder, band by band.
 * `radiusM` > 0 when the observers are spread round `origin` (the overlay):
 * each band then also covers ±radiusM of distance, since an observer that far
 * from the pin reads a point at a band edge from that much nearer or farther.
 */
export function ladderTiles(req: {
  origin: LatLon;
  radiusM: number;
  azimuthDeg: number;
  spreadDeg: number;
  maxDistM: number;
  bands: ZoomBand[];
}): TileKey[] {
  const { origin, radiusM, azimuthDeg, spreadDeg, maxDistM, bands } = req;
  const seen = new Map<string, TileKey>();
  let fromM = 0;
  for (const b of bands) {
    const tileM = metersPerPixel(origin.lat, b.z) * TILE_SIZE;
    // Sweep points half a tile apart (at most 15 km), each padded by at least
    // half the spacing, so every point of every ray in the band lies inside
    // some padded box: a tile skipped here would read as missing.
    const span = Math.min(maxDistM, b.toM) - fromM;
    const sweepStep = Math.max(1, Math.min(15_000, tileM / 2, Math.max(span, 1) / 4));
    const pad = Math.max(radiusM * 1.15, sweepStep * 0.6, 500);
    const start = Math.max(0, fromM - radiusM - sweepStep);
    // The march's last step can overshoot maxDistM by ~1%.
    const end = Math.min(maxDistM * 1.02, b.toM + radiusM) + sweepStep;
    const azs = spreadDeg > 0 ? [azimuthDeg - spreadDeg, azimuthDeg, azimuthDeg + spreadDeg] : [azimuthDeg];
    for (let d = start; d <= end; d += sweepStep) {
      for (const az of azs) {
        const c = d === 0 ? origin : destination(origin, d, az);
        const dLat = pad / 111_320;
        const dLon = pad / (111_320 * Math.cos((c.lat * Math.PI) / 180));
        for (const k of tilesForBBox(c.lat - dLat, c.lon - dLon, c.lat + dLat, c.lon + dLon, b.z)) {
          seen.set(tileKeyString(k), k);
        }
      }
    }
    fromM = b.toM;
    if (fromM >= maxDistM * 1.02) break;
  }
  return [...seen.values()];
}
