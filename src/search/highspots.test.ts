import { describe, expect, it } from "vitest";
import { bestSpots, compassWord, scoreFaces, type Footprint } from "./highspots";

// A 20 m square building at Salida, corners clockwise and counter-clockwise.
const lat = 38.535;
const lon = -105.995;
const dLat = 20 / 111_320;
const dLon = 20 / (111_320 * Math.cos((lat * Math.PI) / 180));
const ccw = [
  { lat, lon },
  { lat, lon: lon + dLon },
  { lat: lat + dLat, lon: lon + dLon },
  { lat: lat + dLat, lon },
];
const inside = (p: { lat: number; lon: number }) =>
  p.lat > lat && p.lat < lat + dLat && p.lon > lon && p.lon < lon + dLon;

describe("scoreFaces", () => {
  const wall = (h: number) => (la: number, lo: number) => (inside({ lat: la, lon: lo }) ? h : 0);

  it("scores only the face looking toward the event, either winding", () => {
    for (const ring of [ccw, [...ccw].reverse()]) {
      const fp: Footprint[] = [{ ring, label: "Test Hall" }];
      const { faces, spots } = scoreFaces(fp, 270, 4, wall(8), () => 1);
      // Due west: only the west wall is within 90°; north and south sit at exactly 90° and are left out.
      expect(faces.length).toBe(1);
      expect(spots[0].facing).toBe("west");
      // The sample sits outside the building, to the west of it.
      expect(spots[0].point.lon).toBeLessThan(lon);
      expect(spots[0].label).toBe("Test Hall");
    }
  });

  it("leaves out a wall lower than the eye", () => {
    const { faces } = scoreFaces([{ ring: ccw, label: null }], 250, 6, wall(5), () => 1);
    expect(faces.length).toBe(0);
  });

  it("keeps the lowest skyline along a face and skips unknowns", () => {
    let n = 0;
    const { spots } = scoreFaces([{ ring: ccw, label: null }], 270, 3, wall(8), () => (n++ === 0 ? NaN : 5 - n));
    expect(spots.length).toBe(1);
    expect(Number.isFinite(spots[0].angleDeg)).toBe(true);
    expect(spots[0].angleDeg).toBe(5 - n);
  });
});

describe("bestSpots", () => {
  it("ranks by lowest angle and keeps spots apart", () => {
    const at = (dm: number, a: number) => ({
      point: { lat: lat + dm / 111_320, lon },
      label: null,
      facing: "west",
      wallHeightM: 8,
      angleDeg: a,
    });
    const best = bestSpots([at(0, 2), at(5, 1), at(100, 3), at(200, 0.5)], 3, 40);
    expect(best.map((s) => s.angleDeg)).toEqual([0.5, 1, 3]);
  });
});

describe("compassWord", () => {
  it("names the eight ways", () => {
    expect(compassWord(0)).toBe("north");
    expect(compassWord(250)).toBe("west");
    expect(compassWord(-45)).toBe("north-west");
  });
});
