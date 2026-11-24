import { describe, expect, it } from "vitest";
import { parseLatLon, placesFrom, searchUrl } from "./place";

describe("pasted coordinates", () => {
  it("reads the forms people paste", () => {
    expect(parseLatLon("38.51748, -106.07600")).toEqual({ lat: 38.51748, lon: -106.076 });
    expect(parseLatLon("38.51748 -106.076")).toEqual({ lat: 38.51748, lon: -106.076 });
    expect(parseLatLon("38.5°N 106.1°W")).toEqual({ lat: 38.5, lon: -106.1 });
    expect(parseLatLon(" 38.5,-106.1 ")).toEqual({ lat: 38.5, lon: -106.1 });
  });
  it("leaves names and nonsense to the search", () => {
    expect(parseLatLon("Herks Werks")).toBeNull();
    expect(parseLatLon("CR 140")).toBeNull();
    expect(parseLatLon("95.0, 10")).toBeNull();
    expect(parseLatLon("38.5")).toBeNull();
  });
});

describe("Photon", () => {
  it("asks once, places near the map first", () => {
    const u = new URL(searchUrl("herks", { lat: 38.53, lon: -106.0 }));
    expect(u.origin + u.pathname).toBe("https://photon.komoot.io/api/");
    expect(u.searchParams.get("q")).toBe("herks");
    expect(u.searchParams.get("lat")).toBe("38.5300");
    expect(u.searchParams.get("lon")).toBe("-106.0000");
  });
  it("turns its answer into a name and a short where, repeats dropped", () => {
    // Photon's answer for "herks" near Salida, 2026-11-24 (trimmed).
    const stream = {
      geometry: { coordinates: [9.3997071, 52.1455416] as [number, number] },
      properties: { name: "Herksbach", city: "Hamelin", county: "Landkreis Hameln-Pyrmont", state: "Lower Saxony", country: "Germany" },
    };
    const features = [
      {
        geometry: { coordinates: [-106.0759981, 38.5174761] as [number, number] },
        properties: { name: "Herks Werks", street: "Fairgrounds Drive", city: "Poncha Springs", county: "Chaffee", state: "Colorado", country: "United States" },
      },
      stream,
      { ...stream, geometry: { coordinates: [9.3895267, 52.1463463] as [number, number] } },
    ];
    expect(placesFrom(features)).toEqual([
      { lat: 38.5174761, lon: -106.0759981, name: "Herks Werks", where: "Fairgrounds Drive, Poncha Springs, Chaffee County, Colorado" },
      { lat: 52.1455416, lon: 9.3997071, name: "Herksbach", where: "Hamelin, Landkreis Hameln-Pyrmont, Lower Saxony, Germany" },
    ]);
  });
});
