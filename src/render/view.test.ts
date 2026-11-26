import { describe, expect, it } from "vitest";
import { VIEW_RAYS, meetRay, meetWord, pathMeets, rayIndex, relDeg, renderSkylineView, skyAt, type CircleSkyline, type SkyPath } from "./view";

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

  it("names a made-up tower in front of flat ground, not the ridge just past its edge", () => {
    // Flat ground: the far terrain 0.5° up all round. A tower 10 m away, 40° up,
    // fills the rays from 241.5° round; the sun slides into its edge sideways.
    const s = flatAt(0.5);
    for (let k = 483; k < 500; k++) {
      s.angles[k] = 40;
      s.what[k] = "lidar";
    }
    const path: SkyPath = {
      rising: false,
      points: Array.from({ length: 15 }, (_, m) => ({ time: new Date(2026, 10, 26, 16, m), azDeg: 240 + 0.2 * m, altDeg: 7 - 0.1 * m, radiusDeg: 0.27 })),
    };
    const m = pathMeets(s, path)!;
    // At 241.0° the disc is over the 0.5° ground; at 241.2° the line to the tower is 16° up.
    expect(m.point.azDeg).toBeCloseTo(241.2);
    // The nearest ray is 241°, the low ground: the old naming said "the ridge".
    expect(s.what[rayIndex(m.point.azDeg)]).toBe("terrain");
    expect(meetRay(s, m.point.azDeg)).toBe(483);
    expect(meetWord(s, m.point.azDeg)).toBe("a roof or tree");
  });

  it("names a real ridge behind low roofs as the ridge", () => {
    // Terrain 3° up; low roofs 1.5° up on every other ray, below the ridge.
    const s = flatAt(3);
    for (let k = 470; k < 500; k += 2) {
      s.angles[k] = 1.5;
      s.what[k] = "lidar";
    }
    const m = pathMeets(s, setting())!;
    expect(m.unknown).toBe(false);
    expect(meetWord(s, m.point.azDeg)).toBe("the ridge");
    // Halfway between a roof ray (241°) and a ridge ray (241.5°), rounding picks the roof; the ridge is what is higher.
    expect(s.what[rayIndex(241.1)]).toBe("lidar");
    expect(meetWord(s, 241.1)).toBe("the ridge");
  });

  it("says hidden, not open, when a wall beside the pin covers the whole path", () => {
    const s = flatAt(34);
    s.what.fill("lidar");
    const m = pathMeets(s, setting())!;
    expect(m.hidden).toBe(true);
    // The point nearest the flat event: the top edge nearest 0° (m = 10, 0.25°).
    expect(m.index).toBe(10);
    expect(meetWord(s, m.point.azDeg)).toBe("a roof or tree");
    expect(pathMeets(flatAt(-5), setting())).toBeNull(); // clear to the path's end (−3.75°): open
  });

  it("never names an unknown ray over a known one", () => {
    const s = flatAt(2);
    s.angles[481] = NaN;
    expect(meetRay(s, 240.4)).toBe(480);
    expect(meetRay(s, 240.5)).toBe(481);
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
