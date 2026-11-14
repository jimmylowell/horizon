import { describe, expect, it } from "vitest";
import { pathMeetsSkyline, renderSkylineStrip, skylineAt, stripAzimuths, type StripPath } from "./strip";

const sky = (angle: (az: number) => number) => {
  const azimuths = stripAzimuths(240);
  return { azimuths, angles: azimuths.map(angle), what: azimuths.map(() => "terrain" as const) };
};

// A straight setting path: 1° lower and 1° further round every 4 minutes.
const path = (): StripPath => ({
  rising: false,
  points: Array.from({ length: 20 }, (_, i) => ({
    time: new Date(Date.UTC(2026, 10, 14, 0, i * 4)),
    azDeg: 230 + i,
    altDeg: 10 - i,
    radiusDeg: 0.25,
  })),
});

describe("skyline strip", () => {
  it("spans the event bearing ±25° in half degrees", () => {
    const a = stripAzimuths(240);
    expect(a[0]).toBe(215);
    expect(a[a.length - 1]).toBe(265);
    expect(a.length).toBe(101);
  });

  it("interpolates the skyline and is unknown outside the strip", () => {
    const s = sky((az) => (az - 215) / 10);
    expect(skylineAt(s, 240)).toBeCloseTo(2.5, 6);
    expect(Number.isNaN(skylineAt(s, 300))).toBe(true);
  });

  it("finds the first moment the top edge is at or under the skyline", () => {
    // A 5° wall from 236° on: the path is at 6° at 234°, 5° at 235°, 4° at 236°.
    const s = sky((az) => (az >= 236 ? 5 : 0));
    const meet = pathMeetsSkyline(s, path());
    expect(meet?.azDeg).toBe(236);
  });

  it("a rising path meets the skyline when it first clears it", () => {
    const p = path();
    p.rising = true;
    p.points.reverse();
    const meet = pathMeetsSkyline(sky(() => 3), p);
    expect(meet?.altDeg).toBe(3); // top edge 3.25° > 3°
  });

  it("draws at the width it is given, with the meeting time", () => {
    const svg = renderSkylineStrip(sky((az) => (az >= 236 ? 5 : 0)), path(), {
      width: 360,
      height: 96,
      colour: "#f0a020",
      fmt: () => "4:17 PM",
    });
    expect(svg).toContain('width="360"');
    expect(svg).toContain("4:17 PM");
  });
});
