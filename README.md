# Horizon

Find the best spot near you to watch the sun or moon rise and set — worldwide,
FOSS end-to-end, no backend.

Two uses, same tool: "it's a nice night — where should I go right now?" and
basic planning ("where do I watch next week's full moonrise?") via the date
picker; the URL hash carries location, event, mode, radius, and date for sharing.

The premise: the best views have the most distance between you and the horizon.
Horizon ray-marches open elevation data along the event's azimuth to find where
the terrain opens up, ranks real places from OpenStreetMap you can actually go
(viewpoints, peaks, picnic sites, trailheads, parking), and hands you a
directions link.

## How it works

Everything runs in the browser — the app is a static site:

- **Elevation:** [Terrarium terrain tiles](https://registry.opendata.aws/terrain-tiles/)
  from AWS Open Data (~30 m global DEM, no API key). A Web Worker decodes tiles
  and ray-marches the terrain along the event azimuth (±8°), with earth
  curvature and standard atmospheric refraction folded in.
- **Buildings:** on town-scale searches (≤ 8 km radius), OSM building
  footprints are rasterized into a 4 m height grid and marched as near-field
  blockers on top of the terrain. Most footprints carry no height tag, so the
  model is blunt on purpose: `height` if tagged, else `building:levels` × 3 m,
  else assume one story (~4 m) — enough to block a low sun from street level.
  That resolves city blocks: solid where buildings stand, open down street
  canyons.
- **Astronomy:** [astronomy-engine](https://github.com/cosinekitty/astronomy)
  computes rise/set times and azimuths for sun and moon, per location, offline.
- **Places:** the Overpass API supplies OSM points of interest. Categories live
  in [data/poi-catalog.json](data/poi-catalog.json) — no OSM tags are hard-coded;
  edit the JSON to add categories.
- **Landcover sanity check:** the DEM is a surface model, so a spot *inside*
  forest reads as standing on the canopy. Rules in
  [data/landcover-rules.json](data/landcover-rules.json) penalize/flag forested
  raw-terrain picks using the basemap's landcover layer.
- **Map:** [MapLibre GL](https://maplibre.org/) on
  [OpenFreeMap](https://openfreemap.org/) (OSM) tiles.

Results render as a diverging score heatmap over your travel ring (red =
blocked, blue = elevated above the horizon) plus ranked spots — mapped places
first, best open terrain after (flagged "access unverified").

## Develop

```sh
npm install
npm run dev    # local dev server
npm test       # unit tests (horizon math, tile decoding)
npm run build  # typecheck + production build to dist/

# optional: pre-download terrain tiles for fast local dev (dev server serves
# them at /terrain-cache/; the app falls back to AWS for anything missing)
node scripts/fetch-terrain.mjs                       # Chaffee County, CO default
node scripts/fetch-terrain.mjs 37.6 -107.6 39.7 -104.5 10 11 12  # any bbox/zooms
```

## Deploy

`dist/` is plain static output and deploys anywhere. The live site,
[horizon.myjimmycloud.com](https://horizon.myjimmycloud.com), is GitHub Pages:
every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
(typecheck, tests, build, publish). `public/CNAME` carries the custom domain;
DNS is a `CNAME horizon → jimmylowell.github.io` at the domain's DNS host.

## Data credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
Terrain tiles by Mapzen/AWS Open Data, composited from SRTM (NASA), USGS 3DEP &
GMTED, ETOPO1 (NOAA), and other open sources. POI queries via Overpass API.
