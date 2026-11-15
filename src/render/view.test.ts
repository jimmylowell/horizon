import { describe, expect, it } from "vitest";
import { VIEW_RAYS, pathMeets, rayIndex, relDeg, renderSkylineView, skyAt, type CircleSkyline, type SkyPath } from "./view";

const flatAt = (deg: number): CircleSkyline => ({ angles: Array(VIEW_RAYS).fill(deg), what: Array(VIEW_RAYS).fill("terrain") });

/** A setting path: 10° up at 240°, down 1° a minute, drifting 0.2° north a minute. */
function setting(): SkyPath {
  const t0 = new Date(2026, 10, 14, 16, 0, 0).getTime();
  return {
    rising: false,
    points: Array.from({ length: 15 }, (_, m) => ({ time: new Date(t0 + m * 60_000), azDeg: 240 + 0.2 * m, altDeg: 10 - m, radiusDeg: 0.25 })),
  };
}

describe("skyline view", () => {
  it("wraps bearings round north", () => {
    expect(relDeg(5, 355)).toBeCloseTo(10);
    expect(relDeg(355, 5)).toBeCloseTo(-10);
    expect(rayIndex(359.9)).toBe(0);
    const s = flatAt(1);
    s.angles[VIEW_RAYS - 1] = 3; // 359.5°
    expect(skyAt(s, 359.75)).toBeCloseTo(2); // halfway to 0°, which reads 1
  });

  it("meets a 4° skyline when the top edge drops under it", () => {
    const m = pathMeets(flatAt(4), setting());
    // top = 10 − m + 0.25 ≤ 4 first at m = 7 (3.25); m = 6 is still 4.25 above
    expect(m?.index).toBe(7);
    expect(m?.unknown).toBe(false);
  });

  it("says unknown when the path crosses missing terrain", () => {
    const s = flatAt(4);
    s.angles.fill(NaN);
    expect(pathMeets(s, setting())?.unknown).toBe(true);
  });

  it("draws any window of the circle, with compass points", () => {
    const svg = renderSkylineView(flatAt(2), setting(), { width: 360, height: 200, centreDeg: 0, fovDeg: 70, colour: "#f80", fmt: () => "t" });
    expect(svg).toContain(">N<");
    expect(svg).not.toContain('class="path"'); // the path is in the west, out of this window
    const west = renderSkylineView(flatAt(2), setting(), { width: 360, height: 200, centreDeg: 250, fovDeg: 70, colour: "#f80", fmt: () => "t" });
    expect(west).toContain('class="path"');
    expect(west).toContain(">W<");
  });
});
