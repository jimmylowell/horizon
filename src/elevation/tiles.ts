/**
 * Terrarium elevation tiles from AWS Open Data (Mapzen/Tilezen "Joerd").
 * Global coverage, no API key. elevation = (R*256 + G + B/256) - 32768.
 */

export const TILE_SIZE = 256;

export function terrariumUrl(z: number, x: number, y: number): string {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
}

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

export function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z;
}

/** Ground metres per pixel at a latitude and zoom. */
export function metersPerPixel(lat: number, z: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (2 ** z * TILE_SIZE);
}

/** Decode terrarium RGBA pixels into metres. */
export function decodeTerrarium(rgba: Uint8ClampedArray): Float32Array {
  const n = rgba.length / 4;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = rgba[o] * 256 + rgba[o + 1] + rgba[o + 2] / 256 - 32768;
  }
  return out;
}

export interface TileKey {
  z: number;
  x: number;
  y: number;
}

export function tileKeyString(k: TileKey): string {
  return `${k.z}/${k.x}/${k.y}`;
}

/**
 * Fetches, decodes and caches terrarium tiles; samples elevations bilinearly.
 * Failed/ocean-missing tiles are cached as null and sample as 0 m.
 */
export class TileCache {
  private tiles = new Map<string, Float32Array | null>();

  constructor(private maxTiles = 400) {}

  has(k: TileKey): boolean {
    return this.tiles.has(tileKeyString(k));
  }

  /** Fetch+decode all missing tiles, with limited concurrency. */
  async fetchTiles(
    keys: TileKey[],
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    const missing = keys.filter((k) => !this.has(k));
    let done = 0;
    const queue = [...missing];
    const workers = Array.from({ length: 8 }, async () => {
      for (;;) {
        const k = queue.shift();
        if (!k) return;
        await this.fetchOne(k);
        done++;
        onProgress?.(done, missing.length);
      }
    });
    await Promise.all(workers);
    this.evict();
  }

  private async fetchOne(k: TileKey): Promise<void> {
    const key = tileKeyString(k);
    try {
      let res: Response | null = null;
      // Dev only: try the local pre-downloaded cache first (scripts/fetch-terrain.mjs).
      if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
        try {
          const local = await fetch(`/terrain-cache/${k.z}/${k.x}/${k.y}.png`);
          if (local.ok) res = local;
        } catch {
          // fall through to remote
        }
      }
      if (!res) res = await fetch(terrariumUrl(k.z, k.x, k.y));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bmp = await createImageBitmap(await res.blob());
      const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const { data } = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
      this.tiles.set(key, decodeTerrarium(data));
    } catch {
      this.tiles.set(key, null);
    }
  }

  private evict(): void {
    while (this.tiles.size > this.maxTiles) {
      const oldest = this.tiles.keys().next().value;
      if (oldest === undefined) return;
      this.tiles.delete(oldest);
    }
  }

  /**
   * Bilinear elevation sample at lat/lon from cached tiles, clamped ≥ 0
   * (terrarium encodes bathymetry; the sea *surface* is the horizon blocker).
   * Missing tiles sample as 0.
   */
  sampleElevation(lat: number, lon: number, z: number): number {
    const n = 2 ** z;
    const fx = lonToTileX(lon, z);
    const fy = latToTileY(lat, z);
    const tx = ((Math.floor(fx) % n) + n) % n;
    const ty = Math.min(n - 1, Math.max(0, Math.floor(fy)));
    const tile = this.tiles.get(`${z}/${tx}/${ty}`);
    if (!tile) return 0;
    // Pixel coords within tile; clamp to the tile (1-px seam error is fine).
    const px = Math.min(TILE_SIZE - 1.001, Math.max(0, (fx - Math.floor(fx)) * TILE_SIZE - 0.5));
    const py = Math.min(TILE_SIZE - 1.001, Math.max(0, (fy - Math.floor(fy)) * TILE_SIZE - 0.5));
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const dx = px - x0;
    const dy = py - y0;
    const e00 = tile[y0 * TILE_SIZE + x0];
    const e10 = tile[y0 * TILE_SIZE + x0 + 1];
    const e01 = tile[(y0 + 1) * TILE_SIZE + x0];
    const e11 = tile[(y0 + 1) * TILE_SIZE + x0 + 1];
    const e = e00 * (1 - dx) * (1 - dy) + e10 * dx * (1 - dy) + e01 * (1 - dx) * dy + e11 * dx * dy;
    return Math.max(0, e);
  }
}

/** Enumerate tile keys covering a lat/lon bounding box at zoom z. */
export function tilesForBBox(
  south: number,
  west: number,
  north: number,
  east: number,
  z: number
): TileKey[] {
  const n = 2 ** z;
  const x0 = Math.floor(lonToTileX(west, z));
  const x1 = Math.floor(lonToTileX(east, z));
  const y0 = Math.max(0, Math.floor(latToTileY(north, z)));
  const y1 = Math.min(n - 1, Math.floor(latToTileY(south, z)));
  const keys: TileKey[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      keys.push({ z, x: ((x % n) + n) % n, y });
    }
  }
  return keys;
}
