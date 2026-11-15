import { describe, expect, it } from "vitest";
import { footprintHolding } from "./blocker";

// A 20 m square in Salida, by its corners.
const lat0 = 38.535;
const lon0 = -105.995;
const dLat = 20 / 111_320;
const dLon = 20 / (111_320 * Math.cos((lat0 * Math.PI) / 180));
const square = {
  ring: [
    { lat: lat0, lon: lon0 },
    { lat: lat0 + dLat, lon: lon0 },
    { lat: lat0 + dLat, lon: lon0 + dLon },
    { lat: lat0, lon: lon0 + dLon },
  ],
  label: "128 F Street",
};

describe("footprintHolding", () => {
  it("names the outline that holds the point", () => {
    expect(footprintHolding([square], { lat: lat0 + dLat / 2, lon: lon0 + dLon / 2 })?.label).toBe("128 F Street");
  });
  it("allows a metre outside the wall, for a misdrawn outline", () => {
    expect(footprintHolding([square], { lat: lat0 + dLat / 2, lon: lon0 - dLon / 20 })).not.toBeNull(); // 1 m west
  });
  it("finds nothing further out: the page then says a tree or something unmapped", () => {
    expect(footprintHolding([square], { lat: lat0 + dLat / 2, lon: lon0 - dLon / 4 })).toBeNull(); // 5 m west
  });
});
