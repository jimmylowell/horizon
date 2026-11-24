// Terrain detail by distance: the right zoom at each distance, and a tile
// cover with no holes (a hole would read as missing terrain, "unknown").
import { describe, expect, it } from "vitest";
import { destination } from "../geo";
import { horizonFan, marchHorizon } from "./horizon";
import { bandAt, ladderSampler, ladderTiles, zoomLadder } from "./ladder";
import { TILE_SIZE, TileCache, tileKeyString } from "./tiles";

const PIN = { lat: 38.51748, lon: -106.076 };
const bands = zoomLadder(12);

/** A cache holding exactly these tiles, flat ground at 2,300 m. */
function cacheOf(keys: ReturnType<typeof ladderTiles>): TileCache {
  const c = new TileCache(100_000);
  for (const k of keys) c.put(k, new Float32Array(TILE_SIZE * TILE_SIZE).fill(2300));
  return c;
}

describe("zoom ladder", () => {
  it("is fine near, coarser far", () => {
    expect(bands.map((b) => b.z)).toEqual([12, 10, 8]);
    expect(bandAt(bands, 0).z).toBe(12);
    expect(bandAt(bands, 7_999).z).toBe(12);
    expect(bandAt(bands, 8_000).z).toBe(10);
    expect(bandAt(bands, 39_999).z).toBe(10);
    expect(bandAt(bands, 150_000).z).toBe(8);
  });

  it("samples each point at the zoom of its distance from the observer", () => {
    const seen: number[] = [];
    const s = ladderSampler((_lat, _lon, z) => (seen.push(z), 0), PIN, bands);
    for (const d of [100, 9_000, 60_000]) {
      const p = destination(PIN, d, 55);
      s(p.lat, p.lon);
    }
    expect(seen).toEqual([12, 10, 8]);
  });

  it("covers every bearing of a full-circle skyline with no hole", () => {
    const keys = new Map<string, ReturnType<typeof ladderTiles>[number]>();
    for (let az = 0; az < 360; az += 3) {
      for (const k of ladderTiles({ origin: PIN, radiusM: 0, azimuthDeg: az, spreadDeg: 0, maxDistM: 120_000, bands })) {
        keys.set(tileKeyString(k), k);
      }
    }
    const c = cacheOf([...keys.values()]);
    const s = ladderSampler((lat, lon, z) => c.sampleElevation(lat, lon, z), PIN, bands);
    for (let az = 0; az < 360; az += 0.5) {
      const r = marchHorizon(s, PIN.lat, PIN.lon, az, { maxDistM: 120_000, startStepM: 40 });
      expect(r.noData, `bearing ${az}`).toBe(false);
    }
    // A handful of coarse tiles stand in for hundreds of fine ones.
    expect(keys.size).toBeLessThan(80);
  });

  it("covers a fan from every observer of an overlay circle", () => {
    const radiusM = 3_000;
    const keys = ladderTiles({ origin: PIN, radiusM, azimuthDeg: 57, spreadDeg: 8, maxDistM: 120_000, bands });
    const c = cacheOf(keys);
    for (let ring = 0; ring <= 6; ring++) {
      for (let b = 0; b < 360; b += 30) {
        const o = destination(PIN, (radiusM * ring) / 6, b);
        const s = ladderSampler((lat, lon, z) => c.sampleElevation(lat, lon, z), o, bands);
        const r = horizonFan(s, o.lat, o.lon, 57, 8, { maxDistM: 120_000, startStepM: 40 });
        expect(r.noData, `observer ${ring}/${b}`).toBe(false);
      }
    }
  });
});
