import { describe, expect, it } from "vitest";
import { buildGrid, buildingHeightM } from "./buildings";

describe("buildingHeightM", () => {
  it("prefers the height tag, tolerating units", () => {
    expect(buildingHeightM({ height: "12" })).toBe(12);
    expect(buildingHeightM({ height: "12.5 m" })).toBe(12.5);
  });

  it("falls back to levels × 3 m", () => {
    expect(buildingHeightM({ "building:levels": "5" })).toBe(15);
  });

  it("assumes at least one story for untagged buildings", () => {
    expect(buildingHeightM({})).toBe(4);
    expect(buildingHeightM({ "building:levels": "1" })).toBe(4);
    expect(buildingHeightM({ height: "garbage" })).toBe(4);
  });
});

describe("buildGrid", () => {
  const centre = { lat: 39, lon: -105 };
  const mLat = 1 / 111_320;
  const mLon = 1 / (111_320 * Math.cos((39 * Math.PI) / 180));
  // Axis-aligned square footprint: centre offset (xM east, yM north), half-size s.
  const square = (xM: number, yM: number, s: number, tags: Record<string, string> = {}) => ({
    type: "way",
    tags,
    geometry: [
      { lat: 39 + (yM - s) * mLat, lon: -105 + (xM - s) * mLon },
      { lat: 39 + (yM - s) * mLat, lon: -105 + (xM + s) * mLon },
      { lat: 39 + (yM + s) * mLat, lon: -105 + (xM + s) * mLon },
      { lat: 39 + (yM + s) * mLat, lon: -105 + (xM - s) * mLon },
    ],
  });

  it("fills footprints and leaves the street between them open", () => {
    // Two 20 m buildings flanking a 20 m gap centred on x = 0.
    const grid = buildGrid([square(-20, 0, 10, {}), square(20, 0, 10, { height: "9" })], centre, 200);
    expect(grid.count).toBe(2);
    expect(grid.sample(39, -105 - 20 * mLon)).toBe(4); // untagged → one story
    expect(grid.sample(39, -105 + 20 * mLon)).toBe(9); // height tag
    expect(grid.sample(39, -105)).toBe(0); // the street
    expect(grid.sample(39, -105 + 60 * mLon)).toBe(0); // open ground
  });

  it("registers footprints thinner than a cell via outline stamping", () => {
    const grid = buildGrid([square(0, 0, 1.2)], centre, 200);
    expect(grid.sample(39, -105)).toBe(4);
  });

  it("ignores degenerate and non-way elements", () => {
    const grid = buildGrid(
      [
        { type: "node" },
        { type: "way", geometry: [{ lat: 39, lon: -105 }] },
        { type: "way" },
      ],
      centre,
      200
    );
    expect(grid.count).toBe(0);
    expect(grid.sample(39, -105)).toBe(0);
  });

  it("finds the footprint a blocker point lies on, and none in the street", () => {
    const tall = square(20, 0, 10, { height: "9" });
    const grid = buildGrid([square(-20, 0, 10, {}), tall], centre, 200);
    expect(grid.footprintAt(39, -105 + 20 * mLon)).toEqual(tall.geometry);
    // On the outline cell just outside the polygon still names the building.
    expect(grid.footprintAt(39, -105 + 30.5 * mLon)).toEqual(tall.geometry);
    expect(grid.footprintAt(39, -105)).toBeNull();
  });
});
