import { describe, expect, it } from "vitest";
import { verdict } from "./verdict";

describe("verdict", () => {
  it("says go higher when a blocked valley gains little anywhere (Salida)", () => {
    expect(verdict({ kind: "sunset", radiusKm: 25, hereLostMin: 25, bestGainMin: 4.6 })).toEqual({
      kind: "higher",
      text: "Nowhere within 25 km sees this sunset more than 5 minutes longer; go higher.",
    });
  });

  it("uses 'sooner' for a rise", () => {
    expect(verdict({ kind: "moonrise", radiusKm: 2, hereLostMin: 20, bestGainMin: 1 })?.text).toBe(
      "Nowhere within 2 km sees this moonrise more than 1 minute sooner; go higher."
    );
  });

  it("handles no gain at all", () => {
    expect(verdict({ kind: "sunrise", radiusKm: 7.5, hereLostMin: 12, bestGainMin: -3 })?.text).toBe(
      "Nowhere within 7.5 km sees this sunrise sooner than here; go higher."
    );
  });

  it("says stay put when here is already open", () => {
    expect(verdict({ kind: "sunset", radiusKm: 25, hereLostMin: 1, bestGainMin: 1 })?.kind).toBe("stay");
  });

  it("stays quiet when a spot is worth the trip", () => {
    expect(verdict({ kind: "sunset", radiusKm: 25, hereLostMin: 25, bestGainMin: 6 })).toBeNull();
  });
});
