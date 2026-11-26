/**
 * The Street View screen's geometry (docs/design.md, *Street View*): three
 * locked Maps Embed frames side by side, and where a bearing and an altitude
 * land on them. Pure, so the measured numbers stay under test.
 */

const DEG = Math.PI / 180;

/** Each frame is rendered this wide, then scaled, so Google's own labels stay small. */
export const FRAME_PX = 640;
/** Extra width rendered each side and cut off: where Google draws its address box and buttons. */
export const CUT_PX = 170;
/** Frames in the picture. */
export const FRAMES = 3;

/** Degrees across one frame: 40 at 700 px wide and over, 30 below. */
export function frameDeg(screenWidth: number): number {
  return screenWidth >= 700 ? 40 : 30;
}

/** −180..180: how far `az` is clockwise of `from`. */
export function rel(az: number, from: number): number {
  return ((((az - from) % 360) + 540) % 360) - 180;
}

/**
 * The embed's focal length in pixels, measured in the session for both of
 * Google's viewers: max(width/2 × 2^(zoom−1), height/2).
 */
export function embedFocalPx(width: number, height: number, zoom: number): number {
  return Math.max((width / 2) * 2 ** (zoom - 1), height / 2);
}

/**
 * The zoom that puts `angleDeg` across the FRAME_PX kept of an iframe
 * FRAME_PX + 2 × CUT_PX wide. Valid while the width term of
 * `embedFocalPx` is the larger, which `frameLayout` keeps true.
 */
export function zoomFor(angleDeg: number): number {
  const keptFocal = FRAME_PX / 2 / Math.tan((angleDeg / 2) * DEG);
  return 1 + Math.log2(keptFocal / ((FRAME_PX + 2 * CUT_PX) / 2));
}

/** The no-key embed address. Pitch is up-positive. */
export function embedUrl(p: { pano: string; lat: number; lon: number; heading: number; pitch: number; zoom: number }): string {
  const h = ((p.heading % 360) + 360) % 360;
  return (
    "https://www.google.com/maps/embed?pb=!4v1732500000000!6m8!1m7!1s" +
    encodeURIComponent(p.pano) +
    `!2m2!1d${p.lat}!2d${p.lon}!3f${h.toFixed(2)}!4f${p.pitch}!5f${p.zoom.toFixed(4)}`
  );
}

export interface Layout {
  /** One frame's width and the whole picture's, CSS px. */
  frameW: number;
  width: number;
  height: number;
  /** Degrees across one frame. */
  angleDeg: number;
  /** Focal length on screen, px. */
  focal: number;
  /** Scale from the rendered iframe to the screen. */
  scale: number;
  /** The iframe's own size before scaling. */
  iframeW: number;
  iframeH: number;
}

/**
 * Lay the picture out in `screenWidth` × at most `maxHeight`. The height is
 * kept under ±31° (wide) or ±40° (narrow) of altitude, so the frame is never
 * taller than the width term of the focal length allows.
 */
export function frameLayout(screenWidth: number, maxHeight: number): Layout {
  const angleDeg = frameDeg(screenWidth);
  const frameW = Math.floor(screenWidth / FRAMES);
  const width = frameW * FRAMES;
  const focal = frameW / 2 / Math.tan((angleDeg / 2) * DEG);
  const cap = 2 * focal * Math.tan((screenWidth >= 700 ? 31 : 40) * DEG);
  const height = Math.round(Math.min(Math.max(maxHeight, 160), cap));
  const scale = frameW / FRAME_PX;
  return { frameW, width, height, angleDeg, focal, scale, iframeW: FRAME_PX + 2 * CUT_PX, iframeH: Math.round(height / scale) };
}

/** Headings of the three frames for a picture centred on `heading`. */
export function frameHeadings(heading: number, angleDeg: number): number[] {
  return Array.from({ length: FRAMES }, (_, i) => (((heading + (i - (FRAMES - 1) / 2) * angleDeg) % 360) + 360) % 360);
}

/**
 * Where a bearing and an apparent altitude land on the picture, CSS px from
 * its top left; null when the bearing is outside it.
 */
export function project(l: Layout, heading: number, azDeg: number, altDeg: number): [number, number] | null {
  const r = rel(azDeg, heading);
  const half = (FRAMES / 2) * l.angleDeg;
  if (Math.abs(r) > half + 0.3) return null;
  const i = Math.max(-1, Math.min(1, Math.round(r / l.angleDeg)));
  const a = (r - i * l.angleDeg) * DEG;
  return [(i + FRAMES / 2) * l.frameW + l.focal * Math.tan(a), l.height / 2 - (l.focal * Math.tan(altDeg * DEG)) / Math.cos(a)];
}

/**
 * The heading that frames an event: the crossing a third of the way in from
 * the side it comes from, the path across the rest. `pathDir` is the sign of
 * the path's bearing change away from the crossing (into the sky).
 */
export function frameOn(crossAz: number, pathDir: number, angleDeg: number): number {
  const offset = (0.5 - 1 / 3) * FRAMES * angleDeg;
  return (((crossAz + Math.sign(pathDir || 1) * offset) % 360) + 360) % 360;
}
