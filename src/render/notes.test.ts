import { describe, expect, it } from "vitest";
import { resultNotes } from "./notes";

const base = { heatmap: true, terrainBlocksAll: false, osm: "ok" as const, roadsIn: true, buildingsMissing: false };

describe("resultNotes", () => {
  it("is just the colour key when everything answered", () => {
    const n = resultNotes(base);
    expect(n.short).toEqual(["map: worse → better here"]);
    expect(n.full).toHaveLength(1);
    expect(n.warn).toBe(false);
  });

  it("folds the Salida case (OSM down, valley blocked) into one short line", () => {
    const n = resultNotes({ ...base, terrainBlocksAll: true, osm: "failed" });
    expect(n.short.join(" · ")).toBe("map: worse → better here · ⚠ terrain only, OSM down");
    expect(n.full[0]).toMatch(/^Terrain blocks some of the view/);
    expect(n.full[1]).toMatch(/^OpenStreetMap isn't answering/);
    expect(n.warn).toBe(true);
  });

  it("is empty with no heatmap and nothing to warn about", () => {
    expect(resultNotes({ ...base, heatmap: false }).short).toEqual([]);
  });

  it("says roads are coming while the lookup is pending", () => {
    const n = resultNotes({ ...base, osm: "pending" });
    expect(n.short).toContain("adding roads…");
    expect(n.warn).toBe(false);
  });

  it("notes a ring with no roads only once OSM has answered", () => {
    expect(resultNotes({ ...base, roadsIn: false }).short).toContain("no roads to stop on");
    expect(resultNotes({ ...base, roadsIn: false, osm: "pending" }).short).not.toContain("no roads to stop on");
  });

  it("warns when buildings are missing, alongside an OSM failure", () => {
    const n = resultNotes({ ...base, osm: "failed", buildingsMissing: true });
    expect(n.short).toEqual(["map: worse → better here", "⚠ terrain only, OSM down", "⚠ buildings ignored"]);
    expect(n.full).toHaveLength(3);
  });

  it("warns when terrain tiles failed to load", () => {
    const n = resultNotes({ ...base, terrainMissing: true });
    expect(n.short).toContain("⚠ some terrain missing");
    expect(n.full.at(-1)).toMatch(/marked unknown/);
    expect(n.warn).toBe(true);
  });
});
