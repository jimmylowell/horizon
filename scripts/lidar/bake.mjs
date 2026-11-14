// Bake one town's lidar into 1 m height-above-ground tiles for the browser.
//
//   node scripts/lidar/bake.mjs <town> <downloadDir> <outDir>
//
// <downloadDir> is what fetch.mjs left: dem/*.tif and catalog.json.
// <outDir> gets <town>/index.json and <town>/<s>_<w>.png, ready to upload to
// R2 (scripts/lidar/README.md).
//
// Surface: the highest first return in each cell, from the USGS point cloud,
// read from USGS's Entwine (EPT) copy of the flight on AWS: only the nodes
// over the town are fetched. Ground: the USGS 1 m bare-earth model of the
// same flight. Height above ground = surface − ground. Points the flight
// classed as noise (7, 18) or wire (13, 14) are dropped: a wire is a few
// centimetres across, and a 1 m cell would turn it into a wall.
//
// Cells are on a lat/lon grid (CELL_LAT × CELL_LON degrees, about
// 1.1 m × 1.1 m at Salida), so the browser looks a point up with no map
// projection. Each PNG pixel: R = height above ground in quarter metres
// (0–254, 0–63.5 m), G = what the highest return was (KIND), B = 0.
// G = 255 marks a cell the ground model does not cover.
//
// Needs laz-perf, geotiff, proj4 and pngjs (npm install --no-save them; run
// from the folder they are installed in, or set NODE_PATH).

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(join(process.cwd(), "noop.js"));
const { createLazPerf } = require("laz-perf");
const { fromFile } = require("geotiff");
const proj4 = require("proj4");
const { PNG } = require("pngjs");

const [town, dlDir, outRoot] = process.argv.slice(2);
if (!town || !dlDir || !outRoot) {
  console.error("usage: node scripts/lidar/bake.mjs <town> <downloadDir> <outDir>");
  process.exit(2);
}
const towns = JSON.parse(readFileSync(new URL("./towns.json", import.meta.url), "utf8"));
const t = towns[town];
const [bw, bs, be, bn] = t.bbox;

const CELL_LAT = 1e-5;
const CELL_LON = 1.25e-5;
const TILE_DEG = 0.01;
const KIND = { none: 0, building: 1, vegetation: 2, other: 3, nodata: 255 };
const DROP = new Set([7, 13, 14, 18]);
const classKind = (c) => (c === 6 ? KIND.building : c >= 3 && c <= 5 ? KIND.vegetation : KIND.other);

// The output grid: whole 0.01° tiles covering the bbox.
const ts = Math.floor(bs / TILE_DEG + 1e-9) * TILE_DEG;
const tw = Math.floor(bw / TILE_DEG + 1e-9) * TILE_DEG;
const tn = Math.ceil(bn / TILE_DEG - 1e-9) * TILE_DEG;
const te = Math.ceil(be / TILE_DEG - 1e-9) * TILE_DEG;
const GW = Math.round((te - tw) / CELL_LON);
const GH = Math.round((tn - ts) / CELL_LAT);
console.log(`grid ${ts.toFixed(2)}..${tn.toFixed(2)} N, ${tw.toFixed(2)}..${te.toFixed(2)} E: ${GW} × ${GH} cells`);
const surface = new Float32Array(GW * GH).fill(-Infinity);
const surfKind = new Uint8Array(GW * GH);
// Ground-class points, kept per cell to check the cloud's heights against
// the ground model (same datum, or a constant offset to take out).
const groundPts = new Float32Array(GW * GH).fill(NaN);

// ---- 1. Point cloud from the EPT index -----------------------------------

const R = 6378137;
const mercX = (lon) => (R * lon * Math.PI) / 180;
const mercY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const lonOf = (x) => ((x / R) * 180) / Math.PI;
const latOf = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
const qx0 = mercX(tw), qx1 = mercX(te), qy0 = mercY(ts), qy1 = mercY(tn);

const ept = await (await fetch(`${t.ept}/ept.json`)).json();
const [rx0, ry0, , rx1, ry1] = ept.bounds;

async function getJson(url) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    await new Promise((s) => setTimeout(s, 1000 * (i + 1)));
  }
  throw new Error(url);
}
async function getBuf(url) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url);
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    await new Promise((s) => setTimeout(s, 1000 * (i + 1)));
  }
  throw new Error(url);
}

// Every node whose square overlaps the town, at every depth (each point is
// stored in exactly one node, so full density means all depths).
const nodes = [];
async function walk(hierKey) {
  const h = await getJson(`${t.ept}/ept-hierarchy/${hierKey}.json`);
  const subs = [];
  for (const [key, count] of Object.entries(h)) {
    const [d, x, y] = key.split("-").map(Number);
    const size = (rx1 - rx0) / 2 ** d;
    const nx0 = rx0 + x * size, ny0 = ry0 + y * size;
    if (nx0 > qx1 || nx0 + size < qx0 || ny0 > qy1 || ny0 + size < qy0) continue;
    if (count === -1) subs.push(key);
    else if (count > 0) nodes.push(key);
  }
  for (const s of subs) await walk(s);
}
await walk("0-0-0-0");
console.log(`${nodes.length} EPT nodes over the town`);

const laz = await createLazPerf();
const classCounts = new Map();
let gpsMin = Infinity, gpsMax = -Infinity, kept = 0, total = 0;
function decode(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const f64 = (o) => dv.getFloat64(o, true);
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
    if (x < qx0 || x >= qx1 || y < qy0 || y >= qy1) continue;
    total++;
    const ret = ext ? v.getUint8(14) & 0x0f : v.getUint8(14) & 0x07;
    const cls = ext ? v.getUint8(16) : v.getUint8(15) & 0x1f;
    classCounts.set(cls, (classCounts.get(cls) ?? 0) + 1);
    const gps = ext ? v.getFloat64(22, true) : fmt === 1 || fmt === 3 ? v.getFloat64(20, true) : NaN;
    if (gps < gpsMin) gpsMin = gps;
    if (gps > gpsMax) gpsMax = gps;
    const z = v.getInt32(8, true) * sz + oz;
    const c = Math.floor((lonOf(x) - tw) / CELL_LON);
    const r = Math.floor((tn - latOf(y)) / CELL_LAT); // row 0 = north
    if (c < 0 || r < 0 || c >= GW || r >= GH) continue;
    const k = r * GW + c;
    if (cls === 2) groundPts[k] = z;
    if (ret !== 1 || DROP.has(cls)) continue;
    kept++;
    if (z > surface[k]) {
      surface[k] = z;
      surfKind[k] = classKind(cls);
    }
  }
  laz._free(ptPtr);
  reader.delete();
  laz._free(filePtr);
}

const t0 = Date.now();
let done = 0;
const queue = [...nodes];
// Fetch eight at a time; decode one at a time (the decoder is synchronous).
const pending = [];
const fetchNext = () => {
  const key = queue.shift();
  if (key) pending.push(getBuf(`${t.ept}/ept-data/${key}.laz`));
};
for (let i = 0; i < 8; i++) fetchNext();
while (pending.length) {
  const buf = await pending.shift();
  fetchNext();
  decode(buf);
  if (++done % 100 === 0) console.log(`${done}/${nodes.length} nodes, ${(total / 1e6).toFixed(1)} M points, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// Adjusted standard GPS time (LAS 1.4) is GPS seconds − 1e9, from
// 1980-01-06 00:00 UTC; leap seconds ignored, a day's precision.
const gpsDate = (s) => new Date(Date.UTC(1980, 0, 6) + (s + 1e9) * 1000).toISOString().slice(0, 10);
const flown = Number.isFinite(gpsMin) ? { first: gpsDate(gpsMin), last: gpsDate(gpsMax) } : null;
const classes = Object.fromEntries([...classCounts].sort((a, b) => a[0] - b[0]));
console.log(`${total} points in the town, ${kept} first returns kept`);
console.log("classes:", classes);
console.log("points' GPS times span", flown);

// ---- 2. Ground model ----------------------------------------------------

const utm = `+proj=utm +zone=${t.utmZone} +ellps=GRS80 +units=m +no_defs`;
const toUtm = proj4("WGS84", utm);
const demFile = readdirSync(join(dlDir, "dem")).find((f) => f.endsWith(".tif") && f.includes(t.project));
const img = await (await fromFile(join(dlDir, "dem", demFile))).getImage();
const [gx0, , , gy1] = img.getBoundingBox();
const [resX, resY] = img.getResolution();
const noData = Number(img.getGDALNoData());
// Window: the UTM box around the grid's corners, plus a margin.
const cornersUtm = [[tw, ts], [te, ts], [tw, tn], [te, tn]].map((p) => toUtm.forward(p));
const ux0 = Math.min(...cornersUtm.map((p) => p[0])) - 5, ux1 = Math.max(...cornersUtm.map((p) => p[0])) + 5;
const uy0 = Math.min(...cornersUtm.map((p) => p[1])) - 5, uy1 = Math.max(...cornersUtm.map((p) => p[1])) + 5;
const win = [
  Math.max(0, Math.floor((ux0 - gx0) / resX)),
  Math.max(0, Math.floor((gy1 - uy1) / -resY)),
  Math.min(img.getWidth(), Math.ceil((ux1 - gx0) / resX)),
  Math.min(img.getHeight(), Math.ceil((gy1 - uy0) / -resY)),
];
const [dem] = await img.readRasters({ window: win });
const dW = win[2] - win[0], dH = win[3] - win[1];
const groundAt = (lon, lat) => {
  const [x, y] = toUtm.forward([lon, lat]);
  const c = Math.floor((x - gx0) / resX) - win[0];
  const r = Math.floor((gy1 - y) / -resY) - win[1];
  if (c < 0 || r < 0 || c >= dW || r >= dH) return NaN;
  const g = dem[r * dW + c];
  return g === noData || g < -1000 ? NaN : g;
};
console.log(`ground model ${demFile}`);

// The cloud's ground points against the ground model: the median gap says
// whether the two share a vertical datum.
const gaps = [];
for (let k = 0; k < GW * GH; k += 97) {
  if (!Number.isFinite(groundPts[k])) continue;
  const r = Math.floor(k / GW), c = k % GW;
  const g = groundAt(tw + (c + 0.5) * CELL_LON, tn - (r + 0.5) * CELL_LAT);
  if (Number.isFinite(g)) gaps.push(groundPts[k] - g);
}
gaps.sort((a, b) => a - b);
const offset = gaps.length ? gaps[gaps.length >> 1] : 0;
console.log(`cloud ground − ground model: median ${offset.toFixed(2)} m over ${gaps.length} cells (p10 ${gaps[Math.floor(gaps.length * 0.1)]?.toFixed(2)}, p90 ${gaps[Math.floor(gaps.length * 0.9)]?.toFixed(2)})`);
// A gap over half a metre is a datum difference (ellipsoid vs NAVD88): take it out.
const zShift = Math.abs(offset) > 0.5 ? offset : 0;

// ---- 3. Tiles -----------------------------------------------------------

const outDir = join(outRoot, town);
mkdirSync(outDir, { recursive: true });
const rows = Math.round(TILE_DEG / CELL_LAT), cols = Math.round(TILE_DEG / CELL_LON);
const tiles = [];
const kindCells = { building: 0, vegetation: 0, other: 0, nodata: 0, all: 0 };
for (let s = ts; s < tn - 1e-9; s += TILE_DEG) {
  for (let w = tw; w < te - 1e-9; w += TILE_DEG) {
    // pngjs takes RGBA in and writes RGB out (colorType 2): alpha is dropped.
    const png = new PNG({ width: cols, height: rows });
    png.data = Buffer.alloc(cols * rows * 4, 0);
    for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
    const r0 = Math.round((tn - (s + TILE_DEG)) / CELL_LAT);
    const c0 = Math.round((w - tw) / CELL_LON);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = (r0 + r) * GW + (c0 + c);
        const o = (r * cols + c) * 4;
        kindCells.all++;
        const g = groundAt(w + (c + 0.5) * CELL_LON, s + TILE_DEG - (r + 0.5) * CELL_LAT);
        if (!Number.isFinite(g)) {
          png.data[o + 1] = KIND.nodata;
          kindCells.nodata++;
          continue;
        }
        // No first return in the cell (water, a dark roof): read as ground.
        const top = surface[k];
        const hag = Number.isFinite(top) ? top - zShift - g : 0;
        const q = Math.max(0, Math.min(254, Math.round(hag * 4)));
        png.data[o] = q;
        const kind = q >= 2 ? surfKind[k] : KIND.none; // under half a metre is ground
        png.data[o + 1] = kind;
        if (kind === KIND.building) kindCells.building++;
        else if (kind === KIND.vegetation) kindCells.vegetation++;
        else if (kind === KIND.other) kindCells.other++;
      }
    }
    const name = `${s.toFixed(2)}_${w.toFixed(2)}.png`;
    writeFileSync(join(outDir, name), PNG.sync.write(png, { colorType: 2 }));
    tiles.push({ s: +s.toFixed(2), w: +w.toFixed(2), file: name });
  }
}
console.log(`${tiles.length} tiles; cells by kind`, kindCells);

const catalog = JSON.parse(readFileSync(join(dlDir, "catalog.json"), "utf8"));
writeFileSync(
  join(outDir, "index.json"),
  JSON.stringify(
    {
      town: t.name,
      project: t.project,
      ept: t.ept,
      cellLat: CELL_LAT,
      cellLon: CELL_LON,
      tileDeg: TILE_DEG,
      metresPerUnit: 0.25,
      kinds: KIND,
      bounds: { s: +ts.toFixed(2), w: +tw.toFixed(2), n: +tn.toFixed(2), e: +te.toFixed(2) },
      pointsGpsTime: flown,
      classes,
      groundCheck: { medianGapM: +offset.toFixed(2), shiftedM: +zShift.toFixed(2), cells: gaps.length },
      kindCells,
      tiles,
      sources: catalog.map((c) => ({ title: c.title, url: c.url, published: c.published, metaUrl: c.metaUrl })),
    },
    null,
    1
  )
);
console.log(`wrote ${outDir}/index.json`);
