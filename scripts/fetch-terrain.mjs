#!/usr/bin/env node
/**
 * Pre-download terrarium elevation tiles into terrain-cache/ for offline-ish,
 * fast local dev. The dev server serves them at /terrain-cache/{z}/{x}/{y}.png
 * and the app tries that path before AWS (dev builds only).
 *
 * Usage: node scripts/fetch-terrain.mjs [south west north east] [zooms]
 * Default: Chaffee County, CO + a 120 km ray corridor east/west, z10–12.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2).map(Number);
const [south, west, north, east] =
  args.length >= 4 ? args : [37.6, -107.6, 39.7, -104.5];
const zooms = args.length >= 5 ? args.slice(4) : [10, 11, 12];

const outRoot = path.join(process.cwd(), "terrain-cache");
const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) =>
  Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);

const jobs = [];
for (const z of zooms) {
  const x0 = lonToX(west, z);
  const x1 = lonToX(east, z);
  const y0 = latToY(north, z);
  const y1 = latToY(south, z);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push({ z, x, y });
}
console.log(`bbox ${south},${west} → ${north},${east}, zooms ${zooms.join(",")}: ${jobs.length} tiles`);

let done = 0;
let skipped = 0;
let failed = 0;
async function worker() {
  for (;;) {
    const j = jobs.shift();
    if (!j) return;
    const dir = path.join(outRoot, String(j.z), String(j.x));
    const file = path.join(dir, `${j.y}.png`);
    try {
      await access(file);
      skipped++;
    } catch {
      try {
        const res = await fetch(
          `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${j.z}/${j.x}/${j.y}.png`
        );
        if (!res.ok) throw new Error(String(res.status));
        await mkdir(dir, { recursive: true });
        await writeFile(file, Buffer.from(await res.arrayBuffer()));
        done++;
      } catch (e) {
        failed++;
        console.error(`fail ${j.z}/${j.x}/${j.y}: ${e.message}`);
      }
    }
    const total = done + skipped + failed;
    if (total % 200 === 0) console.log(`${total} processed (${done} new, ${skipped} cached)`);
  }
}
await Promise.all(Array.from({ length: 16 }, worker));
console.log(`done: ${done} downloaded, ${skipped} already cached, ${failed} failed`);
