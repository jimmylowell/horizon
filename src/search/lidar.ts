/**
 * Measured surface heights in town: the USGS lidar flight baked once into
 * 1 m tiles (scripts/lidar/bake.mjs, docs/design.md *Lidar in town*). Where a
 * town is baked, the pin's readout and the skyline strip march these instead
 * of OpenStreetMap footprints with guessed heights.
 *
 * A tile is an RGB PNG on a lat/lon grid: R = height above the bare ground
 * in quarter metres, G = what the highest return was (KIND), B unused.
 */

import type { LatLon } from "../geo";

export const KIND = { none: 0, building: 1, vegetation: 2, other: 3, nodata: 255 } as const;
export type BlockerKind = "roof" | "trees" | "other";

export interface LidarTown {
  id: string;
  name: string;
  /** Whole baked area: south, west, north, east. */
  s: number;
  w: number;
  n: number;
  e: number;
}

/**
 * The baked towns. Another town is another bake and a line here.
 * Salida's flight: USGS CO_SanLuisJuanMiguel_2020_D20.
 */
export const LIDAR_TOWNS: LidarTown[] = [{ id: "salida", name: "Salida", s: 38.52, w: -106.01, n: 38.54, e: -105.98 }];

const TILE_DEG = 0.01;
const CELL_LAT = 1e-5;
const CELL_LON = 1.25e-5;
const ROWS = Math.round(TILE_DEG / CELL_LAT);
const COLS = Math.round(TILE_DEG / CELL_LON);
/** Cell size in metres along the march (the cells are about 1.1 m square). */
export const LIDAR_CELL_M = 1.1;

export function lidarTownAt(p: LatLon): LidarTown | null {
  return LIDAR_TOWNS.find((t) => p.lat >= t.s && p.lat < t.n && p.lon >= t.w && p.lon < t.e) ?? null;
}

interface Tile {
  h: Uint8Array;
  k: Uint8Array;
}

/** Decoded RGBA → the two planes. Exported for the tests. */
export function splitPlanes(rgba: Uint8ClampedArray | Uint8Array, n: number): Tile {
  const h = new Uint8Array(n);
  const k = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    h[i] = rgba[i * 4];
    k[i] = rgba[i * 4 + 1];
  }
  return { h, k };
}

const tileKey = (s: number, w: number) => `${s.toFixed(2)}_${w.toFixed(2)}`;

export class LidarGrid {
  private tiles = new Map<string, Promise<Tile | null>>();
  private ready = new Map<string, Tile | null>();

  constructor(
    readonly town: LidarTown,
    private base: string,
    /** Swappable for tests. */
    private load: (url: string) => Promise<Tile | null> = loadTile
  ) {}

  /** Fetch every tile a box touches (inside the town). False if any failed. */
  async fetchBox(s: number, w: number, n: number, e: number): Promise<boolean> {
    const t = this.town;
    s = Math.max(s, t.s);
    w = Math.max(w, t.w);
    n = Math.min(n, t.n - 1e-9);
    e = Math.min(e, t.e - 1e-9);
    if (s > n || w > e) return true;
    const jobs: Promise<Tile | null>[] = [];
    for (let ts = Math.floor(s / TILE_DEG + 1e-9) * TILE_DEG; ts <= n; ts += TILE_DEG) {
      for (let tw = Math.floor(w / TILE_DEG + 1e-9) * TILE_DEG; tw <= e; tw += TILE_DEG) {
        const key = tileKey(ts, tw);
        let p = this.tiles.get(key);
        if (!p) {
          p = this.load(`${this.base}${t.id}/${key}.png`);
          this.tiles.set(key, p);
          void p.then((tile) => {
            this.ready.set(key, tile);
            if (!tile) this.tiles.delete(key); // try again next time
          });
        }
        jobs.push(p);
      }
    }
    const got = await Promise.all(jobs);
    return got.every((x) => x !== null);
  }

  private cell(lat: number, lon: number): { tile: Tile; i: number } | null {
    const t = this.town;
    if (lat < t.s || lat >= t.n || lon < t.w || lon >= t.e) return null;
    const ts = Math.floor(lat / TILE_DEG + 1e-9) * TILE_DEG;
    const tw = Math.floor(lon / TILE_DEG + 1e-9) * TILE_DEG;
    const tile = this.ready.get(tileKey(ts, tw));
    if (!tile) return null;
    const r = Math.min(ROWS - 1, Math.floor((ts + TILE_DEG - lat) / CELL_LAT));
    const c = Math.min(COLS - 1, Math.floor((lon - tw) / CELL_LON));
    return { tile, i: r * COLS + c };
  }

  /** Height above ground at a point, metres; 0 off the baked area or where unknown. */
  sample = (lat: number, lon: number): number => {
    const c = this.cell(lat, lon);
    if (!c || c.tile.k[c.i] === KIND.nodata) return 0;
    return c.tile.h[c.i] / 4;
  };

  /** What the flight recorded at a point, when something stands there. */
  kindAt(lat: number, lon: number): BlockerKind | null {
    const c = this.cell(lat, lon);
    if (!c || !(c.tile.h[c.i] > 1)) return null;
    const k = c.tile.k[c.i];
    return k === KIND.building ? "roof" : k === KIND.vegetation ? "trees" : k === KIND.nodata ? null : "other";
  }
}

async function loadTile(url: string): Promise<Tile | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob(), {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
    const canvas = new OffscreenCanvas(COLS, ROWS);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return splitPlanes(ctx.getImageData(0, 0, COLS, ROWS).data, COLS * ROWS);
  } catch {
    return null;
  }
}
