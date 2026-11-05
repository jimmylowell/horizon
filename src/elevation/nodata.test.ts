// A terrain tile that fails to load is no data, not sea level
// (docs/salida-test.md, finding 7). Synthetic terrain: a 2,100 m plateau like
// Salida's valley floor, with a 2,600 m ridge filling the tile ~20 km west.
import { describe, expect, it } from "vitest";
import { destination } from "../geo";
import { skyOpenness } from "../search/score";
import { spotReading } from "../search/reading";
import { horizonFan, horizonRing, marchHorizon, ringAzimuths } from "./horizon";
import { latToTileY, lonToTileX, TILE_SIZE, TileCache, tilesForBBox, type TileKey } from "./tiles";

const Z = 11; // ~15 km tiles at this latitude
const ORIGIN = { lat: 38.5347, lon: -105.9989 };
const WEST = 270;
const RIDGE = destination(ORIGIN, 20_000, WEST);
const keyAt = (p: { lat: number; lon: number }): TileKey => ({
  z: Z,
  x: Math.floor(lonToTileX(p.lon, Z)),
  y: Math.floor(latToTileY(p.lat, Z)),
});
const same = (a: TileKey, b: TileKey) => a.x === b.x && a.y === b.y;
const ridgeKey = keyAt(RIDGE);

/** Every tile within 60 km loaded; the ridge tile loaded or failed. */
function cache(ridge: "loaded" | "failed", origin: "loaded" | "failed" = "loaded"): TileCache {
  const c = new TileCache(1000);
  for (const k of tilesForBBox(ORIGIN.lat - 0.6, ORIGIN.lon - 0.8, ORIGIN.lat + 0.6, ORIGIN.lon + 0.8, Z)) {
    if (same(k, ridgeKey)) {
      c.put(k, ridge === "failed" ? null : new Float32Array(TILE_SIZE * TILE_SIZE).fill(2600));
    } else if (same(k, keyAt(ORIGIN)) && origin === "failed") {
      c.put(k, null);
    } else {
      c.put(k, new Float32Array(TILE_SIZE * TILE_SIZE).fill(2100));
    }
  }
  return c;
}
const sampler = (c: TileCache) => (lat: number, lon: number) => c.sampleElevation(lat, lon, Z);
const opts = { maxDistM: 40_000, startStepM: 60 };

describe("missing terrain tile", () => {
  it("the ridge sits in its own tile, away from the observer's", () => {
    expect(same(ridgeKey, keyAt(ORIGIN))).toBe(false);
  });

  it("samples as NaN, never 0 m", () => {
    const c = cache("failed");
    expect(Number.isNaN(c.sampleElevation(RIDGE.lat, RIDGE.lon, Z))).toBe(true);
    expect(c.sampleElevation(ORIGIN.lat, ORIGIN.lon, Z)).toBeCloseTo(2100);
  });

  it("with the ridge tile loaded, the ray west is blocked and has full data", () => {
    const r = marchHorizon(sampler(cache("loaded")), ORIGIN.lat, ORIGIN.lon, WEST, opts);
    expect(r.noData).toBe(false);
    expect(r.maxAngleDeg).toBeGreaterThan(1); // 500 m up at ~13 km
  });

  it("with the ridge tile failed, the ray is unknown, not clear", () => {
    const r = marchHorizon(sampler(cache("failed")), ORIGIN.lat, ORIGIN.lon, WEST, opts);
    expect(r.noData).toBe(true);
    // The known terrain alone looks open: that is exactly what must not be shown as open.
    expect(r.maxAngleDeg).toBeLessThan(0.5);
    const reading = spotReading({ kind: "sunset", lostMin: 0, whenText: null, noData: r.noData });
    expect(reading.unknown).toBe(true);
    expect(reading.grade).toBe("u");
    expect(reading.label).toMatch(/^Unknown/);
    expect(reading.label).not.toMatch(/open/i);
  });

  it("marks the whole fan unknown when any ray crosses the gap", () => {
    const f = horizonFan(sampler(cache("failed")), ORIGIN.lat, ORIGIN.lon, WEST, 8, opts);
    expect(f.noData).toBe(true);
    const east = horizonFan(sampler(cache("failed")), ORIGIN.lat, ORIGIN.lon, 90, 8, opts);
    expect(east.noData).toBe(false);
  });

  it("an observer standing on a failed tile knows nothing", () => {
    const r = marchHorizon(sampler(cache("loaded", "failed")), ORIGIN.lat, ORIGIN.lon, WEST, opts);
    expect(r.noData).toBe(true);
    expect(Number.isNaN(r.groundM)).toBe(true);
  });

  it("sky ring: a direction across the gap is not counted as open sky", () => {
    const n = 24;
    const loaded = horizonRing(sampler(cache("loaded")), ORIGIN.lat, ORIGIN.lon, WEST, n, opts);
    const failed = horizonRing(sampler(cache("failed")), ORIGIN.lat, ORIGIN.lon, WEST, n, opts);
    expect(Number.isNaN(failed[0])).toBe(true); // ring starts at the event azimuth
    const azs = ringAzimuths(WEST, n);
    const open = (a: number[]) => skyOpenness(a, azs, WEST).openSkyDeg;
    expect(open(failed)).toBeLessThanOrEqual(open(loaded));
  });
});

describe("spotReading", () => {
  it("a blocked spot with a gap is a minimum, not a reading", () => {
    const r = spotReading({ kind: "sunset", lostMin: 20, whenText: "4:34 PM", noData: true });
    expect(r.label).toBe("Behind the ridge ~4:34 PM or earlier (−20 min or more)");
    expect(r.grade).toBe("u");
  });

  it("full data reads as before", () => {
    expect(spotReading({ kind: "sunrise", lostMin: 0, whenText: null, noData: false }).label).toBe(
      "Open horizon — full rise"
    );
    expect(spotReading({ kind: "moonrise", lostMin: 12, whenText: "6:01 PM", noData: false }).label).toBe(
      "Clears the ridge ~6:01 PM (+12 min)"
    );
  });
});
