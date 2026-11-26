import { describe, expect, it } from "vitest";
import { computeDay } from "./day";
import { VIEW_RAYS } from "../render/view";

const LAT = 38.51748;
const LON = -106.07596;
const flat = { angles: new Array(VIEW_RAYS).fill(0), what: new Array(VIEW_RAYS).fill("terrain" as const) };
const ridge = { angles: new Array(VIEW_RAYS).fill(3), what: flat.what };

describe("the day over a skyline", () => {
  it("over a flat skyline every crossing is the flat-horizon time, within a minute", () => {
    const d = computeDay(LAT, LON, "2026-11-24", flat);
    expect(d.crossings.length).toBeGreaterThanOrEqual(3);
    for (const c of d.crossings) expect(Math.abs(c.deltaMin!)).toBeLessThanOrEqual(1);
  });

  it("a 3° ridge makes every rise late and every set early", () => {
    const d = computeDay(LAT, LON, "2026-11-24", ridge);
    expect(d.crossings.length).toBeGreaterThanOrEqual(3);
    for (const c of d.crossings) expect(c.deltaMin!).toBeGreaterThan(10);
    const times = d.crossings.map((c) => +c.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("the paths run the whole day, a minute apart", () => {
    const d = computeDay(LAT, LON, "2026-11-24", flat);
    expect(d.sun.az.length).toBe(1441);
    expect(d.moon.alt.length).toBe(1441);
  });
});
