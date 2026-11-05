/**
 * Scoring worker: prefetches the terrarium tiles covering the search ring and
 * the ray corridor toward the event azimuth (plus OSM building footprints on
 * town-scale searches), then ray-marches every candidate. A follow-up "ring"
 * request marches a full-circle sky profile for the ranking finalists,
 * reusing the search's cached tiles and building raster.
 */

import { DEG, destination, type LatLon } from "../geo";
import { horizonFan, horizonRing, type ObstacleField } from "../elevation/horizon";
import {
  metersPerPixel,
  TILE_SIZE,
  TileCache,
  tileKeyString,
  tilesForBBox,
  type TileKey,
} from "../elevation/tiles";
import { BUILDING_RANGE_M, fetchBuildings } from "./buildings";

export interface SearchRequest {
  type: "search";
  requestId: number;
  origin: LatLon;
  radiusM: number;
  azimuthDeg: number;
  spreadDeg: number;
  maxDistM: number;
  zoom: number;
  eyeHeightM: number;
  /** Fetch OSM building footprints and march them as near-field blockers. */
  buildings: boolean;
  /**
   * Score against the building raster of this earlier search instead of
   * fetching footprints again (the OSM pass after the terrain-first pass).
   */
  reuseObstaclesOf?: number;
  candidates: { id: string; lat: number; lon: number }[];
}

export interface RingRequest {
  type: "ring";
  requestId: number;
  /** The search whose building raster this refines (obstacle reuse). */
  searchRequestId: number;
  azimuthDeg: number;
  rayCount: number;
  maxDistM: number;
  zoom: number;
  eyeHeightM: number;
  candidates: { id: string; lat: number; lon: number }[];
}

/** One point, one event direction: the "from here" readout. */
export interface ProbeRequest {
  type: "probe";
  requestId: number;
  point: LatLon;
  azimuthDeg: number;
  spreadDeg: number;
  maxDistM: number;
  zoom: number;
  eyeHeightM: number;
}

export interface CandidateResult {
  id: string;
  obstructionDeg: number;
  horizonDistM: number;
  groundM: number;
  /** Point on the skyline the event happens behind (centre ray). */
  horizonLat: number;
  horizonLon: number;
  /** The event rays crossed missing terrain (or the spot sits on it). */
  noData: boolean;
}

export interface RingResult {
  id: string;
  /** Obstruction per ring azimuth, in `ringAzimuths` order. */
  angles: number[];
}

export type WorkerMessage =
  | {
      type: "progress";
      requestId: number;
      phase: "tiles" | "scoring" | "sky";
      done: number;
      total: number;
    }
  | {
      type: "result";
      requestId: number;
      results: CandidateResult[];
      /** Footprints marched; null = requested but Overpass failed (terrain-only). */
      buildingCount: number | null;
    }
  | { type: "ringResult"; requestId: number; results: RingResult[] }
  | { type: "probeResult"; requestId: number; result: Omit<CandidateResult, "id"> }
  /** The request threw; main rejects it instead of waiting forever. */
  | { type: "error"; requestId: number; message: string };

const cache = new TileCache(500);

/** Building raster from the last search, kept for the ring follow-up. */
let lastObstacles: { searchRequestId: number; obstacles: ObstacleField | undefined } = {
  searchRequestId: -1,
  obstacles: undefined,
};

function corridorTiles(req: {
  origin: LatLon;
  radiusM: number;
  azimuthDeg: number;
  spreadDeg: number;
  maxDistM: number;
  zoom: number;
}): TileKey[] {
  const { origin, radiusM, azimuthDeg, spreadDeg, maxDistM, zoom } = req;
  const seen = new Map<string, TileKey>();
  // Sweep points no farther apart than half a tile, each padded by at least
  // half the spacing, so every point of every ray lies inside some padded
  // box. With a fixed 15 km sweep and a 500 m pad the probe used to skip the
  // tiles between sweep points, and they read as 0 m; now a skipped tile
  // would read as missing, so the cover has to be complete.
  const tileM = metersPerPixel(origin.lat, zoom) * TILE_SIZE;
  const sweepStep = Math.min(15_000, maxDistM / 8, tileM / 2);
  const pad = Math.max(radiusM * 1.15, sweepStep * 0.6, 500);
  // The march's last step can overshoot maxDistM by ~1%.
  const reach = maxDistM * 1.02 + sweepStep;
  for (let d = 0; d <= reach; d += sweepStep) {
    for (const az of [azimuthDeg - spreadDeg, azimuthDeg, azimuthDeg + spreadDeg]) {
      const c = d === 0 ? origin : destination(origin, d, az);
      const dLat = pad / 111_320;
      const dLon = pad / (111_320 * Math.cos((c.lat * Math.PI) / 180));
      for (const k of tilesForBBox(c.lat - dLat, c.lon - dLon, c.lat + dLat, c.lon + dLon, zoom)) {
        seen.set(tileKeyString(k), k);
      }
    }
  }
  return [...seen.values()];
}

/** Disc of tiles covering the finalists' bbox padded by the ring ray range. */
function ringTiles(req: RingRequest): TileKey[] {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const c of req.candidates) {
    minLat = Math.min(minLat, c.lat);
    maxLat = Math.max(maxLat, c.lat);
    minLon = Math.min(minLon, c.lon);
    maxLon = Math.max(maxLon, c.lon);
  }
  const midLat = (minLat + maxLat) / 2;
  const pad = req.maxDistM * 1.05;
  const dLat = pad / 111_320;
  const dLon = pad / (111_320 * Math.cos(midLat * DEG));
  const seen = new Map<string, TileKey>();
  for (const k of tilesForBBox(minLat - dLat, minLon - dLon, maxLat + dLat, maxLon + dLon, req.zoom)) {
    seen.set(tileKeyString(k), k);
  }
  return [...seen.values()];
}

const post = (m: WorkerMessage) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<SearchRequest | RingRequest | ProbeRequest>) => {
  const req = e.data;
  try {
    if (req.type === "search") await handleSearch(req);
    else if (req.type === "ring") await handleRing(req);
    else if (req.type === "probe") await handleProbe(req);
  } catch (err) {
    post({ type: "error", requestId: req.requestId, message: String(err) });
  }
};

async function handleSearch(req: SearchRequest): Promise<void> {
  const keys = corridorTiles(req);
  const [, grid] = await Promise.all([
    cache.fetchTiles(keys, (done, total) =>
      post({ type: "progress", requestId: req.requestId, phase: "tiles", done, total })
    ),
    req.buildings ? fetchBuildings(req.origin, req.radiusM) : Promise.resolve(null),
  ]);
  let obstacles: ObstacleField | undefined = grid
    ? { sample: grid.sample, maxDistM: BUILDING_RANGE_M, stepM: grid.cellM }
    : undefined;
  if (req.reuseObstaclesOf !== undefined) {
    // Second pass of one search: keep the first pass's raster (and keep it
    // as the one the ring follow-up asks for).
    if (lastObstacles.searchRequestId === req.reuseObstaclesOf) obstacles = lastObstacles.obstacles;
  } else {
    lastObstacles = { searchRequestId: req.requestId, obstacles };
  }

  const stepM = Math.max(40, metersPerPixel(req.origin.lat, req.zoom));
  const results: CandidateResult[] = [];
  const sample = (lat: number, lon: number) => cache.sampleElevation(lat, lon, req.zoom);
  for (let i = 0; i < req.candidates.length; i++) {
    const c = req.candidates[i];
    const r = horizonFan(sample, c.lat, c.lon, req.azimuthDeg, req.spreadDeg, {
      maxDistM: req.maxDistM,
      startStepM: stepM,
      eyeHeightM: req.eyeHeightM,
      obstacles,
    });
    results.push({
      id: c.id,
      obstructionDeg: r.maxAngleDeg,
      horizonDistM: r.horizonDistM,
      groundM: r.groundM,
      horizonLat: r.horizonLat,
      horizonLon: r.horizonLon,
      noData: r.noData,
    });
    if (i % 50 === 0) {
      post({
        type: "progress",
        requestId: req.requestId,
        phase: "scoring",
        done: i,
        total: req.candidates.length,
      });
    }
  }
  post({
    type: "result",
    requestId: req.requestId,
    results,
    buildingCount: req.buildings ? (grid ? grid.count : null) : 0,
  });
}

async function handleProbe(req: ProbeRequest): Promise<void> {
  const keys = corridorTiles({ ...req, origin: req.point, radiusM: 0 });
  await cache.fetchTiles(keys, (done, total) =>
    post({ type: "progress", requestId: req.requestId, phase: "tiles", done, total })
  );
  const stepM = Math.max(40, metersPerPixel(req.point.lat, req.zoom));
  const sample = (lat: number, lon: number) => cache.sampleElevation(lat, lon, req.zoom);
  const r = horizonFan(sample, req.point.lat, req.point.lon, req.azimuthDeg, req.spreadDeg, {
    maxDistM: req.maxDistM,
    startStepM: stepM,
    eyeHeightM: req.eyeHeightM,
  });
  post({
    type: "probeResult",
    requestId: req.requestId,
    result: {
      obstructionDeg: r.maxAngleDeg,
      horizonDistM: r.horizonDistM,
      groundM: r.groundM,
      horizonLat: r.horizonLat,
      horizonLon: r.horizonLon,
      noData: r.noData,
    },
  });
}

async function handleRing(req: RingRequest): Promise<void> {
  const results: RingResult[] = [];
  try {
    if (req.candidates.length) {
      await cache.fetchTiles(ringTiles(req), (done, total) =>
        post({ type: "progress", requestId: req.requestId, phase: "tiles", done, total })
      );
      const obstacles =
        lastObstacles.searchRequestId === req.searchRequestId
          ? lastObstacles.obstacles
          : undefined;
      const stepM = Math.max(40, metersPerPixel(req.candidates[0].lat, req.zoom));
      const sample = (lat: number, lon: number) => cache.sampleElevation(lat, lon, req.zoom);
      for (let i = 0; i < req.candidates.length; i++) {
        const c = req.candidates[i];
        results.push({
          id: c.id,
          angles: horizonRing(sample, c.lat, c.lon, req.azimuthDeg, req.rayCount, {
            maxDistM: req.maxDistM,
            startStepM: stepM,
            eyeHeightM: req.eyeHeightM,
            obstacles,
          }),
        });
        if (i % 10 === 0) {
          post({
            type: "progress",
            requestId: req.requestId,
            phase: "sky",
            done: i,
            total: req.candidates.length,
          });
        }
      }
    }
  } catch {
    // Fall through with whatever finished — main degrades to stage-1 scores.
  }
  post({ type: "ringResult", requestId: req.requestId, results });
}
