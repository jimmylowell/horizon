import { describe, expect, it } from "vitest";
import { VIEW_RAYS, bearingStep, openingView, pathMeets, rayIndex, relDeg, renderSkylineView, skyAt, steepness, zoomStep, type CircleSkyline, type SkyPath } from "./view";

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

  it("opens wide enough for the hour either side of the meeting", () => {
    // A long path: 120 minutes, drifting 0.5° a minute, meeting at minute 60.
    const t0 = new Date(2026, 10, 14, 15, 0, 0).getTime();
    const path: SkyPath = {
      rising: false,
      points: Array.from({ length: 121 }, (_, m) => ({ time: new Date(t0 + m * 60_000), azDeg: 200 + 0.5 * m, altDeg: 20 - m / 5, radiusDeg: 0.25 })),
    };
    const o = openingView(path, path.points[60]);
    // −30° to +27.5° (past minute 115 it is under −3°), plus 16° spare: 80°.
    expect(o.fovDeg).toBe(80);
    expect(o.centreDeg).toBeCloseTo(228.75);
    // A short path still opens at 70°.
    expect(openingView(setting(), setting().points[7]).fovDeg).toBe(70);
  });

  it("zooms through its steps and stops at the whole circle", () => {
    expect(zoomStep(70, 1)).toBe(100);
    expect(zoomStep(85, -1)).toBe(70);
    expect(zoomStep(360, 1)).toBe(360);
    expect(zoomStep(30, -1)).toBe(30);
  });

  it("draws the whole circle with every compass point once, spaced apart", () => {
    const svg = renderSkylineView(flatAt(2), setting(), { width: 390, height: 200, centreDeg: 180, fovDeg: 360, colour: "#f80", fmt: () => "t" });
    for (const c of ["NE", "E", "SE", "S", "SW", "W", "NW"]) expect(svg.split(`>${c}<`).length - 1).toBe(1);
    expect(svg).not.toContain(">240°<"); // 45° steps at this width, not 10°
    expect(bearingStep(390, 70)).toBe(10);
    expect(bearingStep(390, 360)).toBe(45);
    expect(svg).toContain('class="path"');
  });

  it("says how much steeper than true the heights are drawn", () => {
    const s = flatAt(2);
    const narrow = steepness(s, { width: 390, height: 216, centreDeg: 0, fovDeg: 70 });
    const wide = steepness(s, { width: 390, height: 216, centreDeg: 0, fovDeg: 360 });
    // Same heights in view: the factor grows with the width across.
    expect(wide / narrow).toBeCloseTo(360 / 70);
  });

  it("draws the far side lighter where it was read to the short reach", () => {
    const short = Array(VIEW_RAYS).fill(true);
    const svg = renderSkylineView(flatAt(2), setting(), { width: 360, height: 200, centreDeg: 0, fovDeg: 70, colour: "#f80", fmt: () => "t", shortReach: short });
    expect(svg).toContain('class="ridge short"');
  });
});
