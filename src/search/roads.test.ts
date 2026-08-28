import { describe, expect, it } from "vitest";
import { destination } from "../geo";
import { sampleRoads, type RoadWay } from "./roads";

const centre = { lat: 38.57, lon: -106.08 };

/** Straight way of `lengthM` heading east from the centre. */
function way(id: number, lengthM: number, tags: Record<string, string>, verts = 2): RoadWay {
  const geometry = Array.from({ length: verts }, (_, i) =>
    destination(centre, (lengthM * i) / (verts - 1), 90)
  );
  return { id, tags, geometry };
}

describe("sampleRoads", () => {
  it("emits a point every spacing along a way, inside the ring only", () => {
    const pts = sampleRoads([way(1, 2000, { highway: "tertiary", ref: "CR 160" })], centre, 5000, 400, 1000);
    expect(pts.length).toBe(6); // 0, 400 … 2000
    expect(pts.every((p) => p.source === "road" && p.roadClass === "tertiary")).toBe(true);
    expect(pts[0].name).toBe("CR 160");
    expect(pts[0].label).toBe("Road");
  });

  it("drops samples beyond the radius", () => {
    const pts = sampleRoads([way(1, 2000, { highway: "track" })], centre, 1000, 400, 1000);
    expect(pts.length).toBe(3); // 0, 400, 800
    expect(pts[0].label).toBe("Track");
  });

  it("carries spacing across vertices so dense geometry isn't oversampled", () => {
    const pts = sampleRoads([way(1, 2000, { highway: "unclassified" }, 41)], centre, 5000, 400, 1000);
    expect(pts.length).toBe(6);
  });

  it("thins to the cap by coarsening the cell", () => {
    const pts = sampleRoads([way(1, 8000, { highway: "primary" })], centre, 10_000, 100, 20);
    expect(pts.length).toBeLessThanOrEqual(20);
    expect(pts.length).toBeGreaterThan(5);
  });

  it("skips ways without usable geometry", () => {
    expect(sampleRoads([{ id: 1, tags: { highway: "track" }, geometry: [] }], centre, 1000, 100, 10)).toEqual([]);
  });
});
