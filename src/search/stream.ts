/**
 * Lidar streamed straight from USGS in the browser (docs/design.md, *Lidar
 * from USGS, live*). Runs in the worker. From a pin, the flight's Entwine
 * (EPT) index on AWS (bucket usgs-lidar-public) is walked, the nodes round
 * the pin are fetched ring by ring outward and coarse first inside each ring,
 * unpacked with laz-perf, and folded into a surface grid that sharpens as
 * they arrive. Same answer as the bake (scripts/lidar/bake.mjs): the highest
 * first return per ~1.1 m cell, noise and wire dropped. The ground comes from
 * the flight's own ground-class points (class 2), not a separate model: the
 * nearest 4.4 m cell with ground in it, or failing that the lowest of the
 * 17.6 m cells round it.
 */

import type { LatLon } from "../geo";
import type { BlockerKind } from "./lidar";

export const STREAM_CELL_M = 1.1;
/** Rings the stream completes in turn, metres from the pin. The last is the reach. */
export const STREAM_RINGS_M = [75, 150, 300, 600];
const HALF_M = STREAM_RINGS_M[STREAM_RINGS_M.length - 1] + 20;
const N = Math.ceil((2 * HALF_M) / STREAM_CELL_M);
const G1 = 4; // fine ground cell, in surface cells
const G2 = 16; // coarse ground cell
const NG1 = Math.ceil(N / G1);
const NG2 = Math.ceil(N / G2);
/** The finest node depth fetched: its point spacing at or under this, metres. */
const TARGET_SPACING_M = 1.4;
const DROP = new Set([7, 13, 14, 18]);
const KIND_BUILDING = 1;
const KIND_TREE = 2;
const KIND_OTHER = 3;

const R = 6378137;
const DEG = Math.PI / 180;
const mercX = (lon: number) => R * lon * DEG;
const mercY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));

export interface StreamProgress {
  /** Metres from the pin with every node loaded (0 until the first ring). */
  reachM: number;
  files: number;
  totalFiles: number;
  bytes: number;
  points: number;
  ms: number;
  done: boolean;
  stopped: boolean;
}

interface Node {
  key: string;
  depth: number;
  ring: number;
  dist: number;
}

export class StreamGrid {
  readonly surface = new Float32Array(N * N).fill(-Infinity);
  readonly kind = new Uint8Array(N * N);
  private g1 = new Float32Array(NG1 * NG1).fill(Infinity);
  private g2 = new Float32Array(NG2 * NG2).fill(Infinity);
  private cosLat: number;
  private x0: number;
  private y0: number;
  stopped = false;

  constructor(readonly pin: LatLon, readonly eptUrl: string) {
    this.cosLat = Math.cos(pin.lat * DEG);
    this.x0 = mercX(pin.lon);
    this.y0 = mercY(pin.lat);
  }

  /** Local cell index of a point, or -1 off the grid. */
  private cellOf(lat: number, lon: number): number {
    const e = (lon - this.pin.lon) * DEG * R * this.cosLat;
    const n = (lat - this.pin.lat) * 111_320;
    const c = Math.floor((e + HALF_M) / STREAM_CELL_M);
    const r = Math.floor((HALF_M - n) / STREAM_CELL_M);
    return c < 0 || r < 0 || c >= N || r >= N ? -1 : r * N + c;
  }

  private groundAt(i: number): number {
    const r = Math.floor(i / N), c = i % N;
    const f = this.g1[Math.floor(r / G1) * NG1 + Math.floor(c / G1)];
    if (f < Infinity) return f;
    const r2 = Math.floor(r / G2), c2 = Math.floor(c / G2);
    for (let k = 0; k <= 3; k++) {
      let best = Infinity;
      for (let dr = -k; dr <= k; dr++)
        for (let dc = -k; dc <= k; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== k) continue;
          const rr = r2 + dr, cc = c2 + dc;
          if (rr < 0 || cc < 0 || rr >= NG2 || cc >= NG2) continue;
          const g = this.g2[rr * NG2 + cc];
          if (g < best) best = g;
        }
      if (best < Infinity) return best;
    }
    return NaN;
  }

  /** Height above the ground at a point, metres; 0 where nothing has arrived. */
  sample = (lat: number, lon: number): number => {
    const i = this.cellOf(lat, lon);
    if (i < 0) return 0;
    const s = this.surface[i];
    if (s === -Infinity) return 0;
    const g = this.groundAt(i);
    // No 63.5 m cap as in the baked PNGs: downtown towers are taller.
    return Number.isFinite(g) ? Math.max(0, s - g) : 0;
  };

  kindAt(lat: number, lon: number): BlockerKind | null {
    const i = this.cellOf(lat, lon);
    if (i < 0 || !(this.sample(lat, lon) > 1)) return null;
    const k = this.kind[i];
    return k === KIND_BUILDING ? "roof" : k === KIND_TREE ? "trees" : "other";
  }

  /** Fold one unpacked point in (merc x, y, z). */
  add(x: number, y: number, z: number, ret: number, cls: number): void {
    const e = (x - this.x0) * this.cosLat;
    const n = (y - this.y0) * this.cosLat;
    const c = Math.floor((e + HALF_M) / STREAM_CELL_M);
    const r = Math.floor((HALF_M - n) / STREAM_CELL_M);
    if (c < 0 || r < 0 || c >= N || r >= N) return;
    if (cls === 2) {
      const a = Math.floor(r / G1) * NG1 + Math.floor(c / G1);
      if (z < this.g1[a]) this.g1[a] = z;
      const b = Math.floor(r / G2) * NG2 + Math.floor(c / G2);
      if (z < this.g2[b]) this.g2[b] = z;
    }
    if (ret !== 1 || DROP.has(cls)) return;
    const i = r * N + c;
    if (z > this.surface[i]) {
      this.surface[i] = z;
      this.kind[i] = cls === 6 ? KIND_BUILDING : cls >= 3 && cls <= 5 ? KIND_TREE : KIND_OTHER;
    }
  }

  /** Stream the flight round the pin; `onProgress` after each node and each ring. */
  async run(onProgress: (p: StreamProgress) => void, fetchFn: typeof fetch = fetch): Promise<StreamProgress> {
    const t0 = performance.now();
    const ept = await (await fetchFn(`${this.eptUrl}/ept.json`)).json();
    const [bx0, by0, , bx1] = ept.bounds as number[];
    const cube = bx1 - bx0;
    const span = ept.span as number;
    const maxDepth = Math.ceil(Math.log2(cube / span / (TARGET_SPACING_M / this.cosLat)));
    const half = HALF_M / this.cosLat; // in mercator metres
    const qx0 = this.x0 - half, qx1 = this.x0 + half, qy0 = this.y0 - half, qy1 = this.y0 + half;
    const nodes: Node[] = [];
    let bytes = 0;
    const walk = async (hk: string): Promise<void> => {
      const res = await fetchFn(`${this.eptUrl}/ept-hierarchy/${hk}.json`);
      const text = await res.text();
      bytes += text.length;
      const h = JSON.parse(text) as Record<string, number>;
      const subs: string[] = [];
      for (const [key, count] of Object.entries(h)) {
        const [d, x, y] = key.split("-").map(Number);
        if (d > maxDepth) continue;
        const size = cube / 2 ** d;
        const nx0 = bx0 + x * size, ny0 = by0 + y * size;
        if (nx0 > qx1 || nx0 + size < qx0 || ny0 > qy1 || ny0 + size < qy0) continue;
        if (count === -1) subs.push(key);
        else if (count > 0) {
          const dx = Math.max(nx0 - this.x0, 0, this.x0 - (nx0 + size));
          const dy = Math.max(ny0 - this.y0, 0, this.y0 - (ny0 + size));
          const dist = Math.hypot(dx, dy) * this.cosLat;
          const ring = STREAM_RINGS_M.findIndex((rm) => dist < rm);
          if (ring >= 0) nodes.push({ key, depth: d, ring, dist });
        }
      }
      await Promise.all(subs.map(walk));
    };
    await walk("0-0-0-0");
    nodes.sort((a, b) => a.ring - b.ring || a.depth - b.depth || a.dist - b.dist);
    const left = STREAM_RINGS_M.map((_, k) => nodes.filter((n) => n.ring === k).length);
    const laz = await lazPerf();
    let files = 0, points = 0, ringDone = -1;
    const prog = (done: boolean): StreamProgress => ({
      reachM: ringDone >= 0 ? STREAM_RINGS_M[ringDone] : 0,
      files, totalFiles: nodes.length, bytes, points,
      ms: performance.now() - t0, done, stopped: this.stopped,
    });
    const advance = () => {
      let moved = false;
      while (ringDone + 1 < left.length && left[ringDone + 1] === 0) {
        ringDone++;
        moved = true;
      }
      return moved;
    };
    if (advance()) onProgress(prog(false));
    const queue = [...nodes];
    const inFlight: { node: Node; buf: Promise<ArrayBuffer | null> }[] = [];
    const get = async (key: string): Promise<ArrayBuffer | null> => {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetchFn(`${this.eptUrl}/ept-data/${key}.laz`);
          if (r.ok) return await r.arrayBuffer();
        } catch {
          /* try again */
        }
      }
      return null;
    };
    const next = () => {
      const node = queue.shift();
      if (node) inFlight.push({ node, buf: get(node.key) });
    };
    for (let i = 0; i < 6; i++) next();
    while (inFlight.length && !this.stopped) {
      const { node, buf } = inFlight.shift()!;
      const ab = await buf;
      if (this.stopped) break;
      next();
      if (ab) {
        bytes += ab.byteLength;
        points += decode(laz, new Uint8Array(ab), this);
      }
      files++;
      left[node.ring]--;
      const moved = advance();
      if (moved || files % 8 === 0) onProgress(prog(false));
    }
    const end = prog(true);
    onProgress(end);
    return end;
  }
}

// ---- laz-perf -------------------------------------------------------------

// laz-perf's worker build (Emscripten); its own types need @types/emscripten.
// @ts-ignore
import { createLazPerf } from "laz-perf/lib/worker/index.js";
import wasmUrl from "laz-perf/lib/worker/laz-perf.wasm?url";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Laz = any;
let lazP: Promise<Laz> | null = null;
function lazPerf(): Promise<Laz> {
  if (!lazP) lazP = createLazPerf({ locateFile: () => wasmUrl }) as Promise<Laz>;
  return lazP;
}

/** Unpack one LAZ node into the grid; returns the points read. */
function decode(laz: Laz, buf: Uint8Array, grid: StreamGrid): number {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const f64 = (o: number) => dv.getFloat64(o, true);
  const sx = f64(131), sy = f64(139), sz = f64(147), ox = f64(155), oy = f64(163), oz = f64(171);
  const filePtr = laz._malloc(buf.length);
  laz.HEAPU8.set(buf, filePtr);
  const reader = new laz.LASZip();
  reader.open(filePtr, buf.length);
  const fmt = reader.getPointFormat();
  const len = reader.getPointLength();
  const n = reader.getCount();
  const ptPtr = laz._malloc(len);
  const ext = fmt >= 6;
  for (let i = 0; i < n; i++) {
    reader.getPoint(ptPtr);
    const v = new DataView(laz.HEAPU8.buffer, ptPtr, len);
    const x = v.getInt32(0, true) * sx + ox;
    const y = v.getInt32(4, true) * sy + oy;
    const z = v.getInt32(8, true) * sz + oz;
    const ret = ext ? v.getUint8(14) & 0x0f : v.getUint8(14) & 0x07;
    const cls = ext ? v.getUint8(16) : v.getUint8(15) & 0x1f;
    grid.add(x, y, z, ret, cls);
  }
  laz._free(ptPtr);
  reader.delete();
  laz._free(filePtr);
  return n;
}
