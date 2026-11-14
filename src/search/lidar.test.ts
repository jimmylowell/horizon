import { describe, expect, it } from "vitest";
import { KIND, LidarGrid, lidarTownAt, splitPlanes } from "./lidar";

const COLS = 800;
const ROWS = 1000;

describe("lidar tiles", () => {
  it("knows Salida and nowhere else", () => {
    expect(lidarTownAt({ lat: 38.5345, lon: -105.9962 })?.id).toBe("salida");
    expect(lidarTownAt({ lat: 38.84, lon: -106.13 })).toBeNull(); // Buena Vista
  });

  it("splits RGBA into height and kind", () => {
    const { h, k } = splitPlanes(new Uint8Array([40, 3, 0, 255, 0, 255, 0, 255]), 2);
    expect([...h]).toEqual([40, 0]);
    expect([...k]).toEqual([3, 255]);
  });

  it("reads quarter metres at the right cell, and 0 off the tiles or where unknown", async () => {
    const h = new Uint8Array(COLS * ROWS);
    const k = new Uint8Array(COLS * ROWS);
    // Row 0 is the tile's north edge; cell (row 500, col 400) is the middle.
    h[500 * COLS + 400] = 48; // 12 m
    k[500 * COLS + 400] = KIND.other;
    k[0] = KIND.nodata;
    h[0] = 80;
    const town = lidarTownAt({ lat: 38.53, lon: -106 })!;
    const g = new LidarGrid(town, "x/", async () => ({ h, k }));
    expect(await g.fetchBox(38.525, -106.005, 38.526, -106.004)).toBe(true);
    // Tile 38.52_-106.01 spans 38.52–38.53 N, 106.01–106.00 W.
    const lat = 38.53 - 500.5e-5;
    const lon = -106.01 + 400.5 * 1.25e-5;
    expect(g.sample(lat, lon)).toBe(12);
    expect(g.kindAt(lat, lon)).toBe("other");
    expect(g.sample(38.53 - 0.5e-5, -106.01 + 0.5 * 1.25e-5)).toBe(0); // nodata
    expect(g.sample(38.6, -106)).toBe(0); // outside the town
  });
});
