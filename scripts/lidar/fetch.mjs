// Download the USGS 1 m bare-ground model for one town, and list the lidar
// point-cloud tiles over it, from the USGS National Map catalog (TNM Access API).
//
//   node scripts/lidar/fetch.mjs <town> <outDir>
//
// The towns are in scripts/lidar/towns.json: a bounding box and the one
// lidar project to take tiles from. Files already on disk at the catalog's
// size are skipped, so a rerun only fetches what is missing.

import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const API = "https://tnmaccess.nationalmap.gov/api/v1/products";

const [town, outDir] = process.argv.slice(2);
if (!town || !outDir) {
  console.error("usage: node scripts/lidar/fetch.mjs <town> <outDir>");
  process.exit(2);
}
const towns = JSON.parse(readFileSync(new URL("./towns.json", import.meta.url), "utf8"));
const t = towns[town];
if (!t) throw new Error(`no town ${town} in towns.json`);

async function catalog(dataset) {
  const q = new URLSearchParams({ bbox: t.bbox.join(","), datasets: dataset, max: "200" });
  const res = await fetch(`${API}?${q}`);
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const json = await res.json();
  return json.items.filter((i) => i.title.includes(t.project));
}

async function download(item, dir) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, basename(new URL(item.downloadURL).pathname));
  if (existsSync(path) && statSync(path).size === item.sizeInBytes) return path;
  // rockyweb answers 429 to a few files at once; the same files sit on
  // USGS's S3 bucket under StagedProducts, which does not.
  const urls = [
    item.downloadURL.replace("https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/", "https://prd-tnm.s3.amazonaws.com/StagedProducts/"),
    item.downloadURL,
  ];
  let res;
  for (let attempt = 0; attempt < 6; attempt++) {
    res = await fetch(urls[attempt % 2]);
    if (res.ok && res.body) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  if (!res.ok || !res.body) throw new Error(`${item.downloadURL}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
  console.log(`got ${basename(path)} (${(statSync(path).size / 1e6).toFixed(1)} MB)`);
  return path;
}

const lpc = await catalog("Lidar Point Cloud (LPC)");
const dem = await catalog("Digital Elevation Model (DEM) 1 meter");
console.log(`${lpc.length} point-cloud tiles, ${dem.length} 1 m ground tiles for ${t.project}`);

// Only the ground model is downloaded. The point-cloud tiles are listed for
// the record, but rockyweb.usgs.gov, their one host, answers 429 to a
// script; bake.mjs reads the same flight from USGS's Entwine copy on AWS
// (towns.json, "ept") instead, and only the nodes over the town.
for (const i of dem) await download(i, join(outDir, "dem"));

// Keep what the catalog said, for the sources page and the manifest.
writeFileSync(
  join(outDir, "catalog.json"),
  JSON.stringify(
    [...lpc, ...dem].map((i) => ({
      title: i.title,
      url: i.downloadURL,
      bytes: i.sizeInBytes,
      published: i.publicationDate,
      metaUrl: i.metaUrl,
    })),
    null,
    2
  )
);
