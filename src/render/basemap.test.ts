import { describe, expect, it } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { guardNumberComparisons, repairBasemapStyle } from "./basemap";

describe("guardNumberComparisons", () => {
  it("guards the highway-shield ref_length test", () => {
    const f = ["all", ["<=", ["get", "ref_length"], 6], ["==", ["get", "network"], "us-interstate"]];
    expect(guardNumberComparisons(f)).toEqual([
      "all",
      ["all", ["==", ["typeof", ["get", "ref_length"]], "number"], ["<=", ["get", "ref_length"], 6]],
      ["==", ["get", "network"], "us-interstate"],
    ]);
  });

  it("guards a comparison written number-first", () => {
    expect(guardNumberComparisons([">", 3, ["get", "rank"]])).toEqual([
      "all",
      ["==", ["typeof", ["get", "rank"]], "number"],
      [">", 3, ["get", "rank"]],
    ]);
  });

  it("leaves equality, zoom and non-number comparisons alone", () => {
    const f = ["all", ["==", ["get", "class"], "motorway"], [">=", ["zoom"], 8], ["<", ["get", "a"], ["get", "b"]]];
    expect(guardNumberComparisons(f)).toEqual(f);
  });
});

describe("repairBasemapStyle", () => {
  it("rewrites layer filters and keeps layers without one", () => {
    const style = {
      version: 8,
      sources: {},
      layers: [
        { id: "bg", type: "background" },
        { id: "shield", type: "symbol", source: "s", filter: ["<=", ["get", "ref_length"], 6] },
      ],
    } as unknown as StyleSpecification;
    const out = repairBasemapStyle(undefined, style);
    expect(out.layers[0]).toEqual(style.layers[0]);
    expect((out.layers[1] as { filter: unknown }).filter).toEqual([
      "all",
      ["==", ["typeof", ["get", "ref_length"]], "number"],
      ["<=", ["get", "ref_length"], 6],
    ]);
  });
});
