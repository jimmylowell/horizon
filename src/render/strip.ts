/**
 * The skyline strip (docs/design.md, *Lidar in town*): from the pin, the
 * outline of the ridge, and in a baked town the rooftops and trees, across
 * the bearings around the event, with the sun's or moon's path drawn over
 * it, so you see where and when it goes behind something.
 *
 * Pure: takes the marched skyline and the path, returns SVG markup.
 */

/** Half-width of the strip either side of the event's bearing, degrees. */
export const STRIP_HALF_DEG = 25;
const STEP_DEG = 0.5;

export function stripAzimuths(centreDeg: number): number[] {
  const out: number[] = [];
  for (let a = -STRIP_HALF_DEG; a <= STRIP_HALF_DEG + 1e-9; a += STEP_DEG) out.push(centreDeg + a);
  return out;
}

export interface StripPoint {
  time: Date;
  azDeg: number;
  /** Apparent altitude of the disc's centre. */
  altDeg: number;
  radiusDeg: number;
}

export interface StripPath {
  points: StripPoint[];
  rising: boolean;
}

export interface StripSkyline {
  azimuths: number[];
  angles: number[];
  what: ("terrain" | "lidar")[];
}

/** Skyline angle at a bearing, interpolated; NaN outside the strip or unknown. */
export function skylineAt(s: StripSkyline, azDeg: number): number {
  const a0 = s.azimuths[0];
  const step = s.azimuths[1] - a0;
  let rel = (((azDeg - a0) % 360) + 540) % 360 - 180; // −180..180 from the left edge
  if (rel < -180 + 1e-9) rel += 360;
  const f = rel / step;
  if (f < 0 || f > s.azimuths.length - 1) return NaN;
  const i = Math.floor(f);
  const t = f - i;
  const a = s.angles[i];
  const b = s.angles[Math.min(i + 1, s.angles.length - 1)];
  return a + (b - a) * t;
}

/**
 * When the disc meets the skyline: setting, the first moment its top edge is
 * at or under it; rising, the first moment the top edge clears it. Same
 * definition as the readout's (top edge, through the air).
 */
export function pathMeetsSkyline(s: StripSkyline, path: StripPath): StripPoint | null {
  for (let i = 0; i < path.points.length; i++) {
    const p = path.points[i];
    const sky = skylineAt(s, p.azDeg);
    if (!Number.isFinite(sky)) continue;
    const top = p.altDeg + p.radiusDeg;
    const above = top > sky;
    if (path.rising ? above : !above) return p;
  }
  return null;
}

export interface StripOptions {
  width: number;
  height: number;
  colour: string;
  /** Clock format for the labels. */
  fmt: (d: Date) => string;
  now?: Date;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function renderSkylineStrip(s: StripSkyline, path: StripPath, o: StripOptions): string {
  const { width: W, height: H } = o;
  const padB = 14; // bearing labels
  const az0 = s.azimuths[0];
  const span = s.azimuths[s.azimuths.length - 1] - az0;
  const finite = s.angles.filter(Number.isFinite);
  const yMin = Math.min(-1.5, ...finite.map((a) => a - 0.5));
  const yMax = Math.min(25, Math.max(6, ...finite.map((a) => a + 3)));
  const x = (az: number) => {
    let rel = (((az - az0) % 360) + 360) % 360;
    if (rel > span + 90) rel -= 360;
    return (rel / span) * W;
  };
  const y = (alt: number) => (H - padB) * (1 - (alt - yMin) / (yMax - yMin));
  const parts: string[] = [];

  // Flat horizon line: where the open rise/set is.
  parts.push(`<line x1="0" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="flat"/>`);

  // Skyline, one column per bearing, terrain and lidar in their own tone.
  const colW = W / (s.azimuths.length - 1);
  for (let i = 0; i < s.azimuths.length; i++) {
    const a = s.angles[i];
    const cx = x(s.azimuths[i]) - colW / 2;
    if (!Number.isFinite(a)) {
      parts.push(`<rect x="${cx.toFixed(1)}" y="0" width="${(colW + 0.5).toFixed(1)}" height="${H - padB}" class="unknown"/>`);
      continue;
    }
    const top = y(a);
    parts.push(
      `<rect x="${cx.toFixed(1)}" y="${top.toFixed(1)}" width="${(colW + 0.5).toFixed(1)}" height="${(H - padB - top).toFixed(1)}" class="${s.what[i] === "lidar" ? "lidar" : "ridge"}"/>`
    );
  }

  // The path, its ten-minute ticks, and where it meets the skyline.
  const inStrip = path.points.filter((p) => x(p.azDeg) >= -10 && x(p.azDeg) <= W + 10);
  if (inStrip.length > 1) {
    const d = inStrip.map((p, i) => `${i ? "L" : "M"}${x(p.azDeg).toFixed(1)},${y(p.altDeg).toFixed(1)}`).join("");
    parts.push(`<path d="${d}" class="path" stroke="${o.colour}"/>`);
    for (const p of inStrip) {
      if (p.time.getMinutes() % 10 !== 0 || p.time.getSeconds() > 0) continue;
      const px = x(p.azDeg);
      const py = y(p.altDeg);
      if (py < 0 || py > H - padB) continue;
      parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="1.6" fill="${o.colour}"/>`);
      if (p.time.getMinutes() % 30 === 0) {
        parts.push(`<text x="${(px + 4).toFixed(1)}" y="${(py - 3).toFixed(1)}" class="tick">${esc(o.fmt(p.time))}</text>`);
      }
    }
  }
  const meet = pathMeetsSkyline(s, path);
  if (meet) {
    const px = x(meet.azDeg);
    const py = y(meet.altDeg);
    const r = Math.max(3, (meet.radiusDeg / (yMax - yMin)) * (H - padB));
    parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r.toFixed(1)}" fill="${o.colour}" class="disc"/>`);
    const anchor = px > W * 0.7 ? "end" : "start";
    const tx = anchor === "end" ? px - r - 3 : px + r + 3;
    parts.push(`<text x="${tx.toFixed(1)}" y="${(py + 4).toFixed(1)}" class="meet" text-anchor="${anchor}">${esc(o.fmt(meet.time))}</text>`);
  }
  if (o.now) {
    const near = path.points.reduce<StripPoint | null>(
      (best, p) => (!best || Math.abs(+p.time - +o.now!) < Math.abs(+best.time - +o.now!) ? p : best),
      null
    );
    if (near && Math.abs(+near.time - +o.now) < 3 * 60_000 && near.altDeg > yMin) {
      parts.push(`<circle cx="${x(near.azDeg).toFixed(1)}" cy="${y(near.altDeg).toFixed(1)}" r="4" class="now"/>`);
    }
  }

  // Bearings along the bottom, every 10°, with a compass letter on the 45s.
  for (let b = Math.ceil(az0 / 10) * 10; b <= az0 + span; b += 10) {
    const n = ((b % 360) + 360) % 360;
    const label = n % 45 === 0 ? COMPASS[n / 45] : `${n}°`;
    parts.push(`<text x="${x(b).toFixed(1)}" y="${H - 2}" class="bearing" text-anchor="middle">${label}</text>`);
  }

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Skyline from the pin with the ${path.rising ? "rising" : "setting"} path">${parts.join("")}</svg>`;
}
