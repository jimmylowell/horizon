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
 * The ray that forms the skyline at a meeting bearing: of the two rays either
 * side, the higher, since the disc meets the line between them because of it.
 * The nearer ray can be the far ridge just past a near wall's edge
 * (docs/design.md, *What is in the way*). An unknown ray loses to a known one.
 */
export function meetRay(s: CircleSkyline, azDeg: number): number {
  const n = s.angles.length;
  const f = ((((azDeg % 360) + 360) % 360) / 360) * n;
  if (Math.abs(f - Math.round(f)) < 1e-9) return Math.round(f) % n; // on a ray
  const a = Math.floor(f) % n;
  const b = (a + 1) % n;
  const x = s.angles[a];
  const y = s.angles[b];
  if (!Number.isFinite(y)) return a;
  if (!Number.isFinite(x)) return b;
  return y > x ? b : a;
}

/** What the reading calls the thing at a meeting bearing, before it has a name. */
export function meetWord(s: CircleSkyline, azDeg: number): string {
  return s.what[meetRay(s, azDeg)] === "lidar" ? "a roof or tree" : "the ridge";
}

/**
 * Where the disc meets the skyline: setting, the step after the last moment
 * its top edge is above it; rising, the first moment the top edge clears it.
 * `unknown` when the path crosses missing terrain on the way. `hidden` when
 * the top edge is under the skyline at every point: there is no meeting, and
 * the point given is the one nearest the flat event (top edge at 0°). Null
 * only when the path is clear to its end.
 */
export function pathMeets(
  s: CircleSkyline,
  path: SkyPath,
): { point: PathPoint; index: number; unknown: boolean; hidden?: boolean } | null {
  const above = (p: PathPoint) => p.altDeg + p.radiusDeg > skyAt(s, p.azDeg);
  const pts = path.points;
  const hidden = () => {
    if (!pts.length) return null;
    let index = 0;
    pts.forEach((p, i) => {
      if (Math.abs(p.altDeg + p.radiusDeg) < Math.abs(pts[index].altDeg + pts[index].radiusDeg)) index = i;
    });
    return { point: pts[index], index, unknown: false, hidden: true };
  };
  if (path.rising) {
    for (let i = 0; i < pts.length; i++) {
      if (!Number.isFinite(skyAt(s, pts[i].azDeg))) return { point: pts[i], index: i, unknown: true };
      if (above(pts[i])) return { point: pts[i], index: i, unknown: false };
    }
    return hidden();
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    if (!Number.isFinite(skyAt(s, pts[i].azDeg))) return { point: pts[i], index: i, unknown: true };
    if (above(pts[i])) return i + 1 < pts.length ? { point: pts[i + 1], index: i + 1, unknown: false } : null;
  }
  return hidden();
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
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function renderSkylineView(s: CircleSkyline, path: SkyPath, o: ViewOptions): string {
  const { width: W, height: H, centreDeg: c, fovDeg: fov } = o;
  const padB = 16;
  const x = (az: number) => W / 2 + (relDeg(az, c) / fov) * W;
  const inView = (az: number) => Math.abs(relDeg(az, c)) <= fov / 2 + 1;
  const n = s.angles.length;
  const step = 360 / n;
  const visible: number[] = [];
  for (let i = 0; i < n; i++) if (inView(i * step) && Number.isFinite(s.angles[i])) visible.push(s.angles[i]);
  const yMin = Math.min(-2, ...visible.map((a) => a - 0.5));
  const yMax = Math.min(35, Math.max(10, ...visible.map((a) => a + 4)));
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
      `<rect x="${cx.toFixed(1)}" y="${top.toFixed(1)}" width="${(colW + 0.6).toFixed(1)}" height="${(H - padB - top).toFixed(1)}" class="${s.what[i] === "lidar" ? "lidar" : "ridge"}"/>`
    );
  }

  // The path, broken where it leaves the window, a dot every ten minutes
  // and a time every half hour.
  let d = "";
  let pen = false;
  for (const p of path.points) {
    if (!inView(p.azDeg) || p.altDeg < yMin - 2) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(p.azDeg).toFixed(1)},${y(p.altDeg).toFixed(1)}`;
    pen = true;
  }
  if (d) parts.push(`<path d="${d}" class="path" stroke="${o.colour}"/>`);
  for (const p of path.points) {
    if (!inView(p.azDeg) || p.time.getMinutes() % 10 !== 0 || p.time.getSeconds() > 0) continue;
    const px = x(p.azDeg);
    const py = y(p.altDeg);
    if (py < 0 || py > H - padB) continue;
    parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="1.8" fill="${o.colour}"/>`);
    const nearMeet = o.meet && Math.abs(+p.time - +o.meet.time) < 12 * 60_000;
    if (p.time.getMinutes() % 30 === 0 && !nearMeet) {
      parts.push(`<text x="${(px + 4).toFixed(1)}" y="${(py - 4).toFixed(1)}" class="tick">${esc(o.fmt(p.time))}</text>`);
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
  for (let b = Math.ceil(left / 10) * 10; b <= c + fov / 2; b += 10) {
    const nb = ((b % 360) + 360) % 360;
    const label = nb % 45 === 0 ? COMPASS[nb / 45] : `${nb}°`;
    parts.push(`<text x="${x(b).toFixed(1)}" y="${H - 3}" class="bearing${nb % 45 === 0 ? " cardinal" : ""}" text-anchor="middle">${label}</text>`);
  }

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Skyline from the pin, facing ${Math.round(((c % 360) + 360) % 360)}°">${parts.join("")}</svg>`;
}
