import { describe, expect, it } from "vitest";
import { CUT_PX, FRAME_PX, embedFocalPx, embedUrl, frameHeadings, frameLayout, frameOn, project, rel, zoomFor } from "./geometry";

describe("the Street View frames", () => {
  it("the embed address is the measured one, pitch up positive", () => {
    expect(embedUrl({ pano: "abc_DEF-1", lat: 38.51748, lon: -106.07596, heading: -10, pitch: 0, zoom: 1.25 })).toBe(
      "https://www.google.com/maps/embed?pb=!4v1732500000000!6m8!1m7!1sabc_DEF-1!2m2!1d38.51748!2d-106.07596!3f350.00!4f0!5f1.2500"
    );
  });

  it("focal length is max(width/2 × 2^(zoom−1), height/2)", () => {
    expect(embedFocalPx(980, 400, 1)).toBe(490);
    expect(embedFocalPx(980, 400, 2)).toBe(980);
    expect(embedFocalPx(400, 2000, 1)).toBe(1000);
  });

  for (const w of [390, 1280]) {
    it(`at ${w} px the kept 640 px span the frame's angle, and the width term is the one in force`, () => {
      const l = frameLayout(w, 2000);
      const z = zoomFor(l.angleDeg);
      const f = embedFocalPx(l.iframeW, l.iframeH, z);
      expect(l.iframeW).toBe(FRAME_PX + 2 * CUT_PX);
      // half the kept width is f·tan(angle/2)
      expect(f * Math.tan((l.angleDeg / 2) * (Math.PI / 180))).toBeCloseTo(FRAME_PX / 2, 6);
      expect((l.iframeW / 2) * 2 ** (z - 1)).toBeGreaterThan(l.iframeH / 2);
      // on screen, the same focal length scaled
      expect(f * l.scale).toBeCloseTo(l.focal, 6);
    });
  }

  it("40° frames at 700 px and over, 30° below", () => {
    expect(frameLayout(1280, 600).angleDeg).toBe(40);
    expect(frameLayout(700, 600).angleDeg).toBe(40);
    expect(frameLayout(699, 600).angleDeg).toBe(30);
  });

  it("with pitch 0 the frames meet exactly at the joins", () => {
    const l = frameLayout(1280, 600);
    const join = 57 + l.angleDeg / 2; // between the middle and right frames
    for (const alt of [-2, 0, 3.5, 12, 25]) {
      const a = project(l, 57, join - 1e-9, alt)!;
      const b = project(l, 57, join + 1e-9, alt)!;
      expect(a[0]).toBeCloseTo(b[0], 4);
      expect(a[1]).toBeCloseTo(b[1], 4);
      expect(a[0]).toBeCloseTo(2 * l.frameW, 4);
    }
  });

  it("the centre bearing at altitude 0 is the middle of the picture; outside it is null", () => {
    const l = frameLayout(390, 300);
    const [x, y] = project(l, 100, 100, 0)!;
    expect(x).toBeCloseTo(l.width / 2, 6);
    expect(y).toBeCloseTo(l.height / 2, 6);
    expect(project(l, 100, 100 + 46, 0)).toBeNull();
    expect(project(l, 100, 100 - 44, 0)).not.toBeNull();
  });

  it("frame headings straddle the centre, one angle apart", () => {
    expect(frameHeadings(10, 40)).toEqual([330, 10, 50]);
  });

  it("an event is framed a third of the way in, the path across the rest", () => {
    const A = 40;
    const h = frameOn(90, +1, A); // path heads clockwise from the crossing
    expect(rel(90, h)).toBeCloseTo(-A / 2, 6); // a third of 120° in from the left edge
    const l = frameLayout(1280, 600);
    const [x] = project(l, h, 90, 0)!;
    expect(x / l.width).toBeCloseTo(1 / 3, 2);
    expect(rel(frameOn(90, -1, A), 90)).toBeCloseTo(-A / 2, 6);
  });
});
