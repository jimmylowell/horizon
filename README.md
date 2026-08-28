# Horizon

Find the best spot near you to watch the sun or moon rise and set — worldwide,
FOSS end-to-end, no backend.

Two uses, same tool: "it's a nice night — where should I go right now?" and
basic planning ("where do I watch next week's full moonrise?") via the date
picker; the URL hash carries location, event, mode, radius, and date for sharing.

Two questions, in this order:

1. **From here** — drop the pin where you are (or anywhere) and Horizon
   ray-marches the terrain toward the event and tells you what it means in
   minutes: *"Over the ridge ~7:53 PM · az 106° (+20 min)"*, with the sightline
   to the ridge and its name when OSM has one. No search needed.
2. **Find spots** — sample points along the roads you can actually stop on
   (plus mapped viewpoints, peaks, picnic sites, trailheads, parking), score
   every one the same way, and rank them as *minutes gained vs. where you
   are*. If nothing in the ring beats your spot, it says so.

The premise: the best views have the most distance between you and the horizon,
and a few degrees of ridge is not "blocked" — it's a rise that's late or a set
that's early, and that number is the verdict.

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
- **Roads:** the Overpass API supplies OSM ways you can stop on (motorway/trunk
  excluded; residential only at town scale; `access=private|no` skipped),
  densified into candidates every ~120–600 m depending on the ring and thinned
  to a ray budget. "Open terrain" picks are therefore roadside by construction.
  Tracks are flagged as unpaved.
- **Places:** the Overpass API supplies OSM points of interest. Categories live
  in [data/poi-catalog.json](data/poi-catalog.json) — no OSM tags are hard-coded;
  edit the JSON to add categories. Places far from any mapped road (a remote
  peak) are dropped in bike/drive modes.
- **Landcover sanity check:** the DEM is a surface model, so a spot *inside*
  forest reads as standing on the canopy. Rules in
  [data/landcover-rules.json](data/landcover-rules.json) penalize/flag forested
  raw-terrain picks using the basemap's landcover layer.
- **Map:** [MapLibre GL](https://maplibre.org/) on
  [OpenFreeMap](https://openfreemap.org/) (OSM) tiles.

Results render as a diverging score heatmap over your travel ring (red =
blocked, blue = elevated above the horizon) plus ranked spots in one merged
list — roadside points and mapped places together, each with the time the body
clears (or drops behind) the ridge and its gain in minutes over your pin. If
the road lookup is down, raw grid cells stand in, flagged "access unverified".

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
