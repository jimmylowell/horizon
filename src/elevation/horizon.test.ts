import { describe, expect, it } from "vitest";
import { destination, distanceM, EFFECTIVE_RADIUS_M } from "../geo";
import { skyOpenness } from "../search/score";
import { horizonRing, marchHorizon, ringAzimuths } from "./horizon";
import { decodeTerrarium } from "./tiles";

describe("decodeTerrarium", () => {
  it("decodes known encodings", () => {
    // elevation = R*256 + G + B/256 - 32768
    const px = new Uint8ClampedArray([
      128, 0, 0, 255, // 0 m
      128, 100, 0, 255, // 100 m
      134, 226, 0, 255, // 1762 m
      127, 156, 0, 255, // -100 m
    ]);
    const out = decodeTerrarium(px);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(100);
    expect(out[2]).toBe(134 * 256 + 226 - 32768);
    expect(out[3]).toBe(-100);
  });
});

describe("marchHorizon", () => {
  it("flat plain: small negative dip with horizon ≈ √(2R′h)", () => {
    const r = marchHorizon(() => 0, 39, -105, 270, { eyeHeightM: 2, maxDistM: 30_000 });
    // dip = √(2h/R′) ≈ 0.0424° at h = 2 m; horizon ≈ 5.4 km
    expect(r.maxAngleDeg).toBeLessThan(0);
    expect(r.maxAngleDeg).toBeCloseTo(-0.0424, 1);
    const expected = Math.sqrt(2 * EFFECTIVE_RADIUS_M * 2);
    expect(r.horizonDistM).toBeGreaterThan(expected * 0.75);
    expect(r.horizonDistM).toBeLessThan(expected * 1.35);
  });

  it("a 100 m wall at ~1 km subtends ~5.6°", () => {
    const origin = { lat: 39, lon: -105 };
    const sample = (lat: number, lon: number) => {
      const d = distanceM(origin, { lat, lon });
      return d > 900 && d < 1100 ? 100 : 0;
    };
    const r = marchHorizon(sample, origin.lat, origin.lon, 0, {
      eyeHeightM: 2,
      maxDistM: 20_000,
      startStepM: 30,
    });
    expect(r.maxAngleDeg).toBeGreaterThan(4.5);
    expect(r.maxAngleDeg).toBeLessThan(6.5);
    expect(r.horizonDistM).toBeGreaterThan(850);
    expect(r.horizonDistM).toBeLessThan(1150);
  });

  it("elevated observer above a plain sees a deep dip and far horizon", () => {
    const origin = { lat: 39, lon: -105 };
    // 300 m hill only right at the observer.
    const sample = (lat: number, lon: number) =>
      distanceM(origin, { lat, lon }) < 100 ? 300 : 0;
    const r = marchHorizon(sample, origin.lat, origin.lon, 270, { maxDistM: 120_000 });
    expect(r.maxAngleDeg).toBeLessThan(-0.4);
    expect(r.horizonDistM).toBeGreaterThan(40_000);
  });

  it("incremental stepping tracks the true bearing over 100 km", () => {
    // Compare the internal incremental advance against the exact formula by
    // sampling a "wall" placed with the exact destination() point.
    const origin = { lat: 45, lon: 7 };
    const wall = destination(origin, 100_000, 60);
    const sample = (lat: number, lon: number) =>
      distanceM(wall, { lat, lon }) < 1500 ? 4000 : 0;
    const r = marchHorizon(sample, origin.lat, origin.lon, 60, { maxDistM: 120_000 });
    // If drift were severe the ray would miss the wall entirely.
    expect(r.maxAngleDeg).toBeGreaterThan(1);
  });

  it("reports the horizon-forming point's coordinates", () => {
    const origin = { lat: 39, lon: -105 };
    const ridge = destination(origin, 26_000, 250);
    const sample = (lat: number, lon: number) =>
      distanceM(ridge, { lat, lon }) < 1000 ? 800 : 0;
    const r = marchHorizon(sample, origin.lat, origin.lon, 250, {
      maxDistM: 60_000,
      startStepM: 60,
    });
    expect(r.horizonDistM).toBeGreaterThan(24_000);
    expect(r.horizonDistM).toBeLessThan(28_000);
    // The reported skyline point sits on the ridge, not just at the right distance.
    expect(distanceM(ridge, { lat: r.horizonLat, lon: r.horizonLon })).toBeLessThan(1500);
  });
});

describe("horizonRing + skyOpenness", () => {
  const origin = { lat: 39, lon: -105 };
  // Half-bowl: a 500 m ridge wraps the eastern semicircle ~2 km out, the
  // western half is open plain.
  const halfBowl = (lat: number, lon: number) => {
    const eastM = (lon - origin.lon) * 111_320 * Math.cos((origin.lat * Math.PI) / 180);
    const d = distanceM(origin, { lat, lon });
    return eastM > 0 && d > 1800 && d < 2600 ? 500 : 0;
  };

  it("half-open bowl reads ~180° open; facing the open side scores higher", () => {
    const angles = horizonRing(halfBowl, origin.lat, origin.lon, 270, 24, {
      maxDistM: 10_000,
      startStepM: 30,
      eyeHeightM: 2,
    });
    const azs = ringAzimuths(270, 24);
    const facingOpen = skyOpenness(angles, azs, 270);
    const facingRidge = skyOpenness(angles, azs, 90);
    expect(facingOpen.openSkyDeg).toBeGreaterThan(120);
    expect(facingOpen.openSkyDeg).toBeLessThan(240);
    // Same terrain, same rays — the cosine lobe rewards an event over the
    // open half and penalizes one behind the ridge.
    expect(facingOpen.openness).toBeGreaterThan(0.5);
    expect(facingRidge.openness).toBeLessThan(0.5);
    // The unweighted display arc is identical either way.
    expect(facingRidge.openSkyDeg).toBe(facingOpen.openSkyDeg);
  });

  it("a flat plain is fully open", () => {
    const angles = horizonRing(() => 0, origin.lat, origin.lon, 0, 8, { maxDistM: 8000 });
    const sky = skyOpenness(angles, ringAzimuths(0, 8), 0);
    expect(sky.openSkyDeg).toBe(360);
    expect(sky.openness).toBe(1);
  });
});

describe("marchHorizon with obstacles", () => {
  const origin = { lat: 39, lon: -105 };
  const flat = () => 0;

  it("a one-story building 30 m away blocks a low sun", () => {
    // 4 m building spanning 30–45 m along the ray, terrain-only step 60 m
    // (which alone would jump straight over it).
    const obstacles = {
      sample: (lat: number, lon: number) => {
        const d = distanceM(origin, { lat, lon });
        return d > 30 && d < 45 ? 4 : 0;
      },
      maxDistM: 2000,
      stepM: 4,
    };
    const r = marchHorizon(flat, origin.lat, origin.lon, 0, {
      eyeHeightM: 2,
      maxDistM: 10_000,
      startStepM: 60,
      obstacles,
    });
    // 2 m above eye level at ~35 m ≈ atan(2/35) ≈ 3.3°
    expect(r.maxAngleDeg).toBeGreaterThan(2);
    expect(r.horizonDistM).toBeLessThan(60);
  });

  it("a street gap between buildings stays open", () => {
    // Buildings on both sides of a 20 m street; the ray runs down the middle.
    const obstacles = {
      sample: (_lat: number, lon: number) => {
        // Offset east of the ray (due north): buildings everywhere except |x| < 10 m.
        const xM = (lon - origin.lon) * 111_320 * Math.cos((origin.lat * Math.PI) / 180);
        return Math.abs(xM) < 10 ? 0 : 6;
      },
      maxDistM: 2000,
      stepM: 4,
    };
    const r = marchHorizon(flat, origin.lat, origin.lon, 0, {
      eyeHeightM: 2,
      maxDistM: 10_000,
      startStepM: 60,
      obstacles,
    });
    expect(r.maxAngleDeg).toBeLessThan(0.1);
  });

  it("starting inside a footprint ignores that building but not the next", () => {
    // Built run 0–20 m (the block the point landed on), gap, then a second
    // building 60–80 m out.
    const obstacles = {
      sample: (lat: number, lon: number) => {
        const d = distanceM(origin, { lat, lon });
        if (d < 20) return 5;
        if (d > 60 && d < 80) return 5;
        return 0;
      },
      maxDistM: 2000,
      stepM: 4,
    };
    const r = marchHorizon(flat, origin.lat, origin.lon, 0, {
      eyeHeightM: 2,
      maxDistM: 10_000,
      startStepM: 60,
      obstacles,
    });
    // Blocked by the second building (~2.5°), not the one underfoot (~9°+).
    expect(r.maxAngleDeg).toBeGreaterThan(1.5);
    expect(r.maxAngleDeg).toBeLessThan(4);
    expect(r.horizonDistM).toBeGreaterThan(55);
  });
});
