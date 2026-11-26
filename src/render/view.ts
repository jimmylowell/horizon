/**
 * The skyline view (docs/design.md, *Skyline first*): the whole circle of
 * skyline from the pin, of which a window `fovDeg` wide is drawn at a time,
 * centred on `centreDeg`, with the sun's or moon's path wherever it is.
 *
 * Pure: takes the marched skyline and the path, returns SVG markup.
 */

/** Bearings marched round the circle: every half degree. */
export const VIEW_STEP_DEG = 0.5;
export const VIEW_RAYS = 360 / VIEW_STEP_DEG;

export function circleAzimuths(): number[] {
  return Array.from({ length: VIEW_RAYS }, (_, i) => i * VIEW_STEP_DEG);
}

export interface PathPoint {
  time: Date;
  azDeg: number;
  /** Apparent altitude of the disc's centre. */
  altDeg: number;
  radiusDeg: number;
}

export interface SkyPath {
  points: PathPoint[];
  rising: boolean;
}

export interface CircleSkyline {
  /** One per `circleAzimuths()` bearing; NaN = unknown. */
  angles: number[];
  what: ("terrain" | "lidar")[];
}

/** −180..180: how far `az` is clockwise of `from`. */
export function relDeg(az: number, from: number): number {
  return ((((az - from) % 360) + 540) % 360) - 180;
}

/** Skyline angle at any bearing, interpolated round the circle; NaN unknown. */
export function skyAt(s: CircleSkyline, azDeg: number): number {
  const n = s.angles.length;
  const f = ((((azDeg % 360) + 360) % 360) / 360) * n;
  const i = Math.floor(f) % n;
  const t = f - Math.floor(f);
  const a = s.angles[i];
  const b = s.angles[(i + 1) % n];
  return a + (b - a) * t;
}

/** Index of the ray nearest a bearing. */
export function rayIndex(azDeg: number, n = VIEW_RAYS): number {
  return Math.round(((((azDeg % 360) + 360) % 360) / 360) * n) % n;
}

/**
 * Where the disc meets the skyline: setting, the step after the last moment
 * its top edge is above it; rising, the first moment the top edge clears it.
 * `unknown` when the path crosses missing terrain on the way.
 */
export function pathMeets(s: CircleSkyline, path: SkyPath): { point: PathPoint; index: number; unknown: boolean } | null {
  const above = (p: PathPoint) => p.altDeg + p.radiusDeg > skyAt(s, p.azDeg);
  const pts = path.points;
  if (path.rising) {
    for (let i = 0; i < pts.length; i++) {
      if (!Number.isFinite(skyAt(s, pts[i].azDeg))) return { point: pts[i], index: i, unknown: true };
      if (above(pts[i])) return { point: pts[i], index: i, unknown: false };
    }
    return null;
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    if (!Number.isFinite(skyAt(s, pts[i].azDeg))) return { point: pts[i], index: i, unknown: true };
    if (above(pts[i])) return i + 1 < pts.length ? { point: pts[i + 1], index: i + 1, unknown: false } : null;
  }
  return null;
}

export interface ViewOptions {
  width: number;
  height: number;
  centreDeg: number;
  fovDeg: number;
  colour: string;
  fmt: (d: Date) => string;
  /** The moment the disc meets the skyline, already refined. */
  meet?: PathPoint | null;
  /** Bearing picked by a tap: a mark on the skyline. */
  picked?: number | null;
  now?: Date;
  /** Per ray: read to the shorter reach only, drawn a shade lighter. */
  shortReach?: boolean[];
}

/** The zoom steps of the strip, in degrees across (docs/design.md, *The strip, wider*). */
export const FOV_STEPS = [30, 50, 70, 100, 140, 200, 280, 360];
export const FOV_MIN = 30;
export const FOV_MAX = 360;

/**
 * The opening width: the path from an hour before the meeting to an hour
 * after, 8° spare each side, rounded up to 10°, between 70° and 360°.
 * Returns the width and the bearing to centre on.
 */
export function openingView(path: SkyPath, meet: PathPoint, hourMs = 3_600_000): { fovDeg: number; centreDeg: number } {
  const t = +meet.time;
  let lo = 0;
  let hi = 0;
  for (const p of path.points) {
    if (Math.abs(+p.time - t) > hourMs || p.altDeg < -3) continue;
    const r = relDeg(p.azDeg, meet.azDeg);
    lo = Math.min(lo, r);
    hi = Math.max(hi, r);
  }
  const span = Math.ceil((hi - lo + 16) / 10) * 10;
  const fovDeg = Math.min(FOV_MAX, Math.max(70, span));
  const centreDeg = fovDeg >= FOV_MAX ? meet.azDeg : (((meet.azDeg + (lo + hi) / 2) % 360) + 360) % 360;
  return { fovDeg, centreDeg };
}

/** The next zoom step out (dir 1) or in (dir −1) from any width. */
export function zoomStep(fov: number, dir: 1 | -1): number {
  if (dir > 0) return FOV_STEPS.find((f) => f > fov + 0.5) ?? FOV_MAX;
  return [...FOV_STEPS].reverse().find((f) => f < fov - 0.5) ?? FOV_MIN;
}

/** The height range drawn for a window: from the skyline in view. */
export function viewRange(s: CircleSkyline, centreDeg: number, fovDeg: number): { yMin: number; yMax: number } {
  const n = s.angles.length;
  const step = 360 / n;
  let lo = -2;
  let hi = 10;
  for (let i = 0; i < n; i++) {
    const a = s.angles[i];
    if (!Number.isFinite(a) || Math.abs(relDeg(i * step, centreDeg)) > fovDeg / 2 + 1) continue;
    lo = Math.min(lo, a - 0.5);
    hi = Math.max(hi, a + 4);
  }
  return { yMin: lo, yMax: Math.min(35, hi) };
}

/** How many times steeper than true the strip draws heights against bearings. */
export function steepness(s: CircleSkyline, o: { width: number; height: number; centreDeg: number; fovDeg: number }): number {
  const { yMin, yMax } = viewRange(s, o.centreDeg, o.fovDeg);
  return (o.height - PAD_B) / (yMax - yMin) / (o.width / o.fovDeg);
}

/**
 * The path's dot and label spacing for a window: the shortest of the steps
 * that keeps dots 6 px and times 56 px apart, measured along the path in view.
 */
export function pathCadence(path: SkyPath, o: { width: number; height: number; centreDeg: number; fovDeg: number }, yMin: number, yMax: number): { dotMin: number; labelMin: number } {
  const { width: W, height: H, centreDeg: c, fovDeg: fov } = o;
  const px = (az: number) => (relDeg(az, c) / fov) * W;
  const py = (alt: number) => ((H - PAD_B) * alt) / (yMax - yMin);
  // Pixels the path moves in ten minutes, the median over the stretch in view.
  const gaps: number[] = [];
  const pts = path.points;
  for (let i = 10; i < pts.length; i += 10) {
    const a = pts[i - 10];
    const b = pts[i];
    if (Math.abs(relDeg(a.azDeg, c)) > fov / 2 || Math.abs(relDeg(b.azDeg, c)) > fov / 2) continue;
    gaps.push(Math.hypot(px(b.azDeg) - px(a.azDeg), py(b.altDeg) - py(a.altDeg)));
  }
  if (!gaps.length) return { dotMin: 10, labelMin: 30 };
  gaps.sort((x, y) => x - y);
  const per10 = gaps[Math.floor(gaps.length / 2)];
  const dotMin = [10, 20, 30, 60].find((m) => (per10 * m) / 10 >= 6) ?? 60;
  const labelMin = [30, 60, 120, 180].find((m) => (per10 * m) / 10 >= 56) ?? 180;
  return { dotMin, labelMin };
}

/** The bearing label step: the finest of 10°, 15°, 45°, 90° with labels 34 px apart. */
export function bearingStep(width: number, fovDeg: number): number {
  return [10, 15, 45, 90].find((b) => (b * width) / fovDeg >= 34) ?? 90;
}

const PAD_B = 16;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function renderSkylineView(s: CircleSkyline, path: SkyPath, o: ViewOptions): string {
  const { width: W, height: H, centreDeg: c, fovDeg: fov } = o;
  const padB = PAD_B;
  const x = (az: number) => W / 2 + (relDeg(az, c) / fov) * W;
  const inView = (az: number) => Math.abs(relDeg(az, c)) <= fov / 2 + 1;
  const n = s.angles.length;
  const step = 360 / n;
  const { yMin, yMax } = viewRange(s, c, fov);
  const cad = pathCadence(path, o, yMin, yMax);
  const y = (alt: number) => (H - padB) * (1 - (alt - yMin) / (yMax - yMin));
  const parts: string[] = [];

  parts.push(`<line x1="0" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="flat"/>`);

  // Skyline: one column per ray in view.
  const colW = (step / fov) * W;
  for (let i = 0; i < n; i++) {
    const az = i * step;
    if (!inView(az)) continue;
    const cx = x(az) - colW / 2;
    const a = s.angles[i];
    if (!Number.isFinite(a)) {
      parts.push(`<rect x="${cx.toFixed(1)}" y="0" width="${(colW + 0.6).toFixed(1)}" height="${H - padB}" class="unknown"/>`);
      continue;
    }
    const top = y(a);
    parts.push(
      `<rect x="${cx.toFixed(1)}" y="${top.toFixed(1)}" width="${(colW + 0.6).toFixed(1)}" height="${(H - padB - top).toFixed(1)}" class="${s.what[i] === "lidar" ? "lidar" : o.shortReach?.[i] ? "ridge short" : "ridge"}"/>`
    );
  }

  // The path, broken where it leaves the window, a dot every ten minutes
  // and a time every half hour.
  let d = "";
  let pen = false;
  let lastX = 0;
  for (const p of path.points) {
    if (!inView(p.azDeg) || p.altDeg < yMin - 2) {
      pen = false;
      continue;
    }
    const px = x(p.azDeg);
    // On the whole circle the path can cross the back bearing: lift the pen there.
    if (pen && Math.abs(px - lastX) > W / 2) pen = false;
    d += `${pen ? "L" : "M"}${px.toFixed(1)},${y(p.altDeg).toFixed(1)}`;
    pen = true;
    lastX = px;
  }
  if (d) parts.push(`<path d="${d}" class="path" stroke="${o.colour}"/>`);
  // Times give way to one already drawn where the arc bunches up (its top on a wide view).
  const boxes: [number, number, number, number][] = [];
  const free = (x0: number, y0: number, w: number) => !boxes.some(([bx, by, bw]) => x0 < bx + bw && bx < x0 + w && Math.abs(y0 - by) < 14);
  for (const p of path.points) {
    const mod = p.time.getHours() * 60 + p.time.getMinutes();
    if (!inView(p.azDeg) || mod % cad.dotMin !== 0 || p.time.getSeconds() > 0) continue;
    const px = x(p.azDeg);
    const py = y(p.altDeg);
    if (py < 0 || py > H - padB) continue;
    parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="1.8" fill="${o.colour}"/>`);
    const nearMeet = o.meet && Math.abs(+p.time - +o.meet.time) < cad.labelMin * 0.4 * 60_000;
    const label = o.fmt(p.time);
    const lw = label.length * 6.2;
    if (mod % cad.labelMin === 0 && !nearMeet && free(px + 4, py - 4, lw)) {
      boxes.push([px + 4, py - 4, lw, 0]);
      parts.push(`<text x="${(px + 4).toFixed(1)}" y="${(py - 4).toFixed(1)}" class="tick">${esc(label)}</text>`);
    }
  }

  if (o.meet && inView(o.meet.azDeg)) {
    const px = x(o.meet.azDeg);
    const py = y(o.meet.altDeg);
    const r = Math.max(4, (o.meet.radiusDeg / (yMax - yMin)) * (H - padB));
    parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r.toFixed(1)}" fill="${o.colour}" class="disc"/>`);
    const anchor = px > W * 0.65 ? "end" : "start";
    const tx = anchor === "end" ? px - r - 4 : px + r + 4;
    parts.push(`<text x="${tx.toFixed(1)}" y="${(py + 4).toFixed(1)}" class="meet" text-anchor="${anchor}">${esc(o.fmt(o.meet.time))}</text>`);
  }
  if (o.now) {
    const near = path.points.reduce<PathPoint | null>(
      (best, p) => (!best || Math.abs(+p.time - +o.now!) < Math.abs(+best.time - +o.now!) ? p : best),
      null
    );
    if (near && Math.abs(+near.time - +o.now) < 3 * 60_000 && inView(near.azDeg) && near.altDeg > yMin) {
      parts.push(`<circle cx="${x(near.azDeg).toFixed(1)}" cy="${y(near.altDeg).toFixed(1)}" r="5" class="now"/>`);
    }
  }
  if (o.picked != null && inView(o.picked)) {
    const a = skyAt(s, o.picked);
    const px = x(o.picked);
    parts.push(`<line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="0" y2="${H - padB}" class="pick"/>`);
    if (Number.isFinite(a)) parts.push(`<circle cx="${px.toFixed(1)}" cy="${y(a).toFixed(1)}" r="4" class="pick-dot"/>`);
  }

  // Bearings: every 10°, a compass letter on the 45s.
  const left = c - fov / 2;
  const bs = bearingStep(W, fov);
  for (let b = Math.ceil(left / bs) * bs; b <= c + fov / 2; b += bs) {
    const nb = ((b % 360) + 360) % 360;
    const bx = W / 2 + ((b - c) / fov) * W;
    if (bx < 8 || bx > W - 8) continue; // half off the edge
    const label = nb % 45 === 0 ? COMPASS[nb / 45] : `${nb}°`;
    parts.push(`<text x="${bx.toFixed(1)}" y="${H - 3}" class="bearing${nb % 45 === 0 ? " cardinal" : ""}" text-anchor="middle">${label}</text>`);
  }

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Skyline from the pin, facing ${Math.round(((c % 360) + 360) % 360)}°">${parts.join("")}</svg>`;
}
