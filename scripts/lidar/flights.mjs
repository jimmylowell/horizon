// The flight index the page looks a pin up in (docs/design.md, *Lidar from
// USGS, live*): one row per flight in the USGS lidar bucket on AWS, its name,
// its box and its year, from Hobu's boundary file of the bucket
// (https://github.com/hobuinc/usgs-lidar, boundaries/resources.geojson, 8.8 MB:
// too big for a phone, so it is cut down to boxes here).
//
//   node scripts/lidar/flights.mjs [resources.geojson] > public/flights.json
//
// With no file it fetches the current one. The page checks each box that
// holds the pin against that flight's own EPT index before streaming, so a
// box that holds the pin but not the flight costs a small fetch, not a wrong answer.

import { readFileSync } from "node:fs";

const SRC = "https://raw.githubusercontent.com/hobu/usgs-lidar/master/boundaries/resources.geojson";
const gj = process.argv[2]
  ? JSON.parse(readFileSync(process.argv[2], "utf8"))
  : await (await fetch(SRC)).json();

const round = (v) => Math.round(v * 1e4) / 1e4;
const rows = [];
for (const f of gj.features) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < w) w = c[0];
      if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1];
      if (c[1] > n) n = c[1];
    } else c.forEach(walk);
  };
  walk(f.geometry.coordinates);
  const name = f.properties.name;
  const years = name.match(/(?:19|20)\d\d/g);
  rows.push([name, round(w - 1e-4), round(s - 1e-4), round(e + 1e-4), round(n + 1e-4), years ? Number(years[years.length - 1]) : 0]);
}
process.stdout.write(JSON.stringify({ source: SRC, flights: rows.length, rows }) + "\n");
