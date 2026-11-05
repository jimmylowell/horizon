import { describe, expect, it } from "vitest";
import { awayAzimuth, awayGainVsHere, awayReading, canFaceAway } from "./away";

describe("facing away from the sun", () => {
  it("looks straight opposite the event", () => {
    expect(awayAzimuth(245)).toBe(65);
    expect(awayAzimuth(110)).toBe(290);
    expect(awayAzimuth(180)).toBe(0);
  });

  it("is offered for the sun only", () => {
    expect(canFaceAway("sunset")).toBe(true);
    expect(canFaceAway("sunrise")).toBe(true);
    expect(canFaceAway("moonrise")).toBe(false);
  });

  it("grades the horizon against the Belt of Venus band, 10–20° up", () => {
    expect(awayReading(-0.4, false).grade).toBe(4);
    expect(awayReading(-0.4, false).label).toContain("at or below flat");
    expect(awayReading(3, false).grade).toBe(3);
    expect(awayReading(8, false).label).toContain("full view");
    expect(awayReading(14, false).label).toContain("cuts into");
    expect(awayReading(25, false).grade).toBe(0);
  });

  it("never calls missing terrain open", () => {
    expect(awayReading(1, true).grade).toBe("u");
    expect(awayReading(NaN, false).unknown).toBe(true);
  });

  it("compares with here in degrees", () => {
    expect(awayGainVsHere(2, 6.5, false)?.text).toBe("4.5° lower than here");
    expect(awayGainVsHere(6, 2, false)?.cls).toBe("bad");
    expect(awayGainVsHere(-1, -2, false)?.text).toBe("same as here");
    expect(awayGainVsHere(2, 6, true)).toBeNull();
  });
});
