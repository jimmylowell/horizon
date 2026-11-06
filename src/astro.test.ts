import { describe, expect, it } from "vitest";
import { Body, Observer, SearchAltitude } from "astronomy-engine";
import { centreAltitudeForTopEdge, eventTimeAt, obstructionEffect, semidiameterDeg } from "./astro";

// Salida, Colorado, 2026-11-05.
const LAT = 38.5347;
const LON = -105.9989;
const NOON = new Date("2026-11-05T19:00:00Z");

describe("one sun definition", () => {
  it("a flat horizon by our definition is the library's published sunset", () => {
    const open = eventTimeAt("sunset", LAT, LON, NOON)!;
    const target = centreAltitudeForTopEdge("sunset", LAT, LON, open, 0);
    const ours = SearchAltitude(Body.Sun, new Observer(LAT, LON, 0), -1, NOON, 1, target)!;
    expect(Math.abs(ours.date.getTime() - open.getTime())).toBeLessThan(30_000);
  });

  it("the sun's disc is about 0.27° in radius, the moon's about a quarter degree", () => {
    expect(semidiameterDeg("sunset", LAT, LON, NOON)).toBeCloseTo(0.27, 1);
    expect(semidiameterDeg("moonrise", LAT, LON, NOON)).toBeGreaterThan(0.24);
  });

  it("a tiny ridge costs almost nothing", () => {
    const open = eventTimeAt("sunset", LAT, LON, NOON)!;
    expect(obstructionEffect("sunset", LAT, LON, open, 0.1).lostMin).toBeLessThanOrEqual(1);
  });

  it("behind a 5° ridge the top edge goes later than the old centre-only time", () => {
    const open = eventTimeAt("sunset", LAT, LON, NOON)!;
    const now = obstructionEffect("sunset", LAT, LON, open, 5);
    const from = new Date(open.getTime() - 6 * 3600_000);
    const centreOnly = SearchAltitude(Body.Sun, new Observer(LAT, LON, 0), -1, from, 0.5, 5)!;
    const diffMin = (now.time!.getTime() - centreOnly.date.getTime()) / 60_000;
    expect(diffMin).toBeGreaterThan(1.5);
    expect(diffMin).toBeLessThan(5);
    expect(now.lostMin).toBeGreaterThan(20);
  });
});
