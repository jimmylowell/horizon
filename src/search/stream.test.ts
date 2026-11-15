import { describe, expect, it } from "vitest";
import { StreamGrid } from "./stream";
import { findFlight, type FlightRow } from "./flights";

const R = 6378137;
const DEG = Math.PI / 180;
const mx = (lon: number) => R * lon * DEG;
const my = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));

describe("StreamGrid", () => {
  const pin = { lat: 38.5347, lon: -105.9937 };
  it("reads a roof as surface minus the flight's own ground", () => {
    const g = new StreamGrid(pin, "x");
    const lon = pin.lon + 0.0002;
    g.add(mx(lon), my(pin.lat), 2100, 1, 2); // ground point
    g.add(mx(lon), my(pin.lat), 2108.5, 1, 1); // first return 8.5 m up
    expect(g.sample(pin.lat, lon)).toBeCloseTo(8.5, 1);
  });
  it("drops noise and later returns, and reads 0 where nothing arrived", () => {
    const g = new StreamGrid(pin, "x");
    g.add(mx(pin.lon), my(pin.lat), 2100, 1, 2);
    g.add(mx(pin.lon), my(pin.lat), 2150, 1, 18); // high noise
    g.add(mx(pin.lon), my(pin.lat), 2120, 2, 1); // second return
    expect(g.sample(pin.lat, pin.lon)).toBe(0);
    expect(g.sample(pin.lat + 0.003, pin.lon)).toBe(0);
  });
  it("takes the ground from a neighbouring cell under a wide roof", () => {
    const g = new StreamGrid(pin, "x");
    g.add(mx(pin.lon + 0.0003), my(pin.lat), 2100, 1, 2); // ground ~26 m east
    g.add(mx(pin.lon), my(pin.lat), 2106, 1, 1);
    expect(g.sample(pin.lat, pin.lon)).toBeCloseTo(6, 1);
  });
});

describe("findFlight", () => {
  const rows: FlightRow[] = [
    ["OLD_2010", -107, 38, -105, 39, 2010],
    ["NEW_2020", -107, 38, -105, 39, 2020],
    ["FAR_2021", -90, 30, -89, 31, 2021],
  ];
  // The pin sits 1 km inside the cube's corner, so node 4-0-0-0 (12.5 km) holds it.
  const x0 = mx(-106) - 1000, y0 = my(38.5) - 1000;
  const ept = { bounds: [x0, y0, 0, x0 + 200_000, y0 + 200_000, 200_000] };
  const fake = (empty: string) =>
    (async (url: string) => {
      const n = url.includes(empty) ? 0 : 10;
      const body = url.endsWith("ept.json") ? ept : { "0-0-0-0": 100, "1-0-0-0": 50, "4-0-0-0": n, "4-5-5-0": 10 };
      return new Response(JSON.stringify(body));
    }) as unknown as typeof fetch;
  it("skips a flight whose own index has no points over the pin", async () => {
    const f = await findFlight(rows, { lat: 38.5, lon: -106 }, fake("NEW_2020"));
    expect(f?.name).toBe("OLD_2010");
  });
  it("returns null where no box holds the pin", async () => {
    expect(await findFlight(rows, { lat: 45, lon: -100 }, fake("none"))).toBeNull();
  });
});
