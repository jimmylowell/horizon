# Horizon: design

**Written after the fact (2026-11-04), from the code as it stands on `main`, for Jimmy's pushback.** Horizon was built before the design-first method, so this note describes what exists rather than what was planned. Where the code and this note disagree, the code is right and this note is wrong; say so and it gets fixed. From here on, a feature goes into this file before it goes into code.

## The first screen

A full-page map centred on Salida, CO (`src/main.ts`, the `state` default), with a draggable pin, the line toward tonight's sunset drawn from it, and a bottom panel with Walk / Bike / Drive, a radius slider and **Find spots**. A top bar holds the date and the event picker (sunrise, sunset, moonrise, moonset).

**The one action:** put the pin where you are (drag it, or the locate button) and read the "from here" line: when the sun or moon actually clears or drops behind the ridge, in minutes against the flat-horizon time. **Find spots** is the second action, and a shared link (`#lat,lon,kind,mode,radius[,date]`) runs it on open.

## Who it is for

Someone outside on a nice evening asking "where should I go right now to watch it?", and someone planning ahead ("where do I watch next week's full moonrise?") with the date picker. In the first five seconds they see a map of where they are and the direction the event happens in.

## The three things it does

1. **From here:** ray-marches the terrain from the pin toward the event (±8°) and says what the ridge does to it, e.g. *"Over the ridge ~7:53 PM · az 106° (+20 min)"*, with the sightline to the ridge and its name when OpenStreetMap has one.
2. **Find spots:** samples points along roads you can stop on, plus mapped viewpoints, peaks, picnic sites, trailheads and parking, inside the travel ring; scores every one the same way and ranks them by minutes gained over the pin. If nothing beats the pin, it says so.
3. **Shows the whole ring at once:** a diverging heatmap over the travel radius (red blocked, blue above the horizon), so the ranked list has a picture behind it.

## What it does not do

- No backend, no account, no API key: everything runs in the browser against public services.
- No weather or cloud forecast; it answers "can I see the horizon", not "will it be clear".
- No routing; each spot has a *Directions* link out to Google Maps.
- No promise about trees: the elevation model is a surface model, so a spot inside forest is penalized and flagged by `data/landcover-rules.json`, not modelled.
- Buildings only at town scale (radius ≤ 8 km), and bluntly: tagged height, else levels × 3 m, else one storey of about 4 m (`src/search/buildings.ts`).
- Motorways and trunk roads are not candidates; private roads are skipped (`src/search/roads.ts`).

## What it looks like

The map fills the page; the controls sit in a top bar and a bottom sheet on a phone (`src/style.css`). Basemap is OpenFreeMap's *Liberty* style. No reference site was named when it was built; Jimmy may want to name one.

## Roadmap

Not written at build time, and nothing in the repo records one. **Open for Jimmy:** what v2 is, if anything. The finish line agreed 2026-11-04 is: live (it is), this note, and a place on the myjimmycloud.com front page.

## What one record looks like

The unit everything is built from is one scored candidate: a point, the obstruction toward the event, and how far away the skyline is (`Candidate` in `src/search/grid.ts`, `CandidateResult` in `src/search/worker.ts`).

```yaml
id: r1834                 # "g…" grid cell, "r…" roadside sample, or a POI id
source: road              # grid | road | a category id from data/poi-catalog.json
name: County Road 000     # OSM name, when there is one
lat: 38.5381
lon: -105.9862
roadClass: tertiary       # OSM highway class, roadside samples only
obstructionDeg: 1.4       # skyline angle above the flat horizon toward the event
horizonDistM: 18400       # distance to the point the event happens behind
groundM: 2241             # ground elevation at the candidate
```

The values above are illustrative, not a real result.

## Data sources

All fetched live by the browser; nothing is baked into the repo except the three small JSON rule files in `data/`.

| Source (author, link, licence) | What we use | How fetched | Known limits | Checked against |
|---|---|---|---|---|
| Terrain Tiles, Mapzen / AWS Open Data, [registry.opendata.aws/terrain-tiles](https://registry.opendata.aws/terrain-tiles/), composited from SRTM, USGS 3DEP, GMTED, ETOPO1 and others (attribution per the registry page) | Terrarium-encoded elevation PNGs | `s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (`src/elevation/tiles.ts`); optional local cache from `scripts/fetch-terrain.mjs` | A surface model: tree canopy and roofs read as ground. README calls it ~30 m global; not checked here against the registry page | Unit tests in `src/elevation/horizon.test.ts` check the decoding and the march, not the data |
| OpenStreetMap contributors, [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright), ODbL | Roads, points of interest, building footprints, skyline names | [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API), three public mirrors in turn (`src/search/overpass.ts`) | Coverage varies; most buildings carry no height. If Overpass is down, grid cells stand in, flagged "access unverified" | `src/search/roads.test.ts`, `buildings.test.ts` |
| [astronomy-engine](https://github.com/cosinekitty/astronomy), Don Cross, MIT | Rise and set times and azimuths for sun and moon | npm package, runs offline in the browser (`src/astro.ts`) | — | Not checked against a published almanac in this repo |
| [OpenFreeMap](https://openfreemap.org/), OSM data | Basemap tiles and the landcover layer the forest check reads | `tiles.openfreemap.org/styles/liberty` | — | — |
| [MapLibre GL JS](https://maplibre.org/), BSD-3-Clause | The map | npm package | — | — |

**The refraction radius** in `src/geo.ts` is 7/6 of the earth's radius, per Wikipedia's [Horizon](https://en.wikipedia.org/wiki/Horizon), *Effect of atmospheric refraction* (the code cites it since PR #2).

## In town: footprints first (2026-11-06)

Jimmy, on Reckon 2026-11-06 01:38:12, after trying it in Salida: "The footer notecraft is taking up too much space in the map. It's very hard to read and the searching for locations function is not very useful right now. I think it should just use terrain and or building footprints in town building. Footprints would be the best".

What changes:

1. **From here counts buildings.** The pin's readout marches the OpenStreetMap building footprints within 600 m of the pin, toward the event, on top of the terrain, the same blunt heights *Find spots* already used at town scale (tagged height, else levels × 3 m, else 4 m; `src/search/buildings.ts`). The terrain answer shows at once; the footprint answer replaces it a moment later, when Overpass has answered. When a building is what the sun goes behind, the line says so ("Behind a building 60 m away ~4:31 PM") and the map outlines that building in the event's colour. If Overpass fails, the terrain answer stands and the line says buildings were not checked.
2. **Moving the pin is the search.** In town you tap the map, or drag the pin, and read the line; only the corridor toward the event is fetched (600 m out, the fan's width, 250 m spare on every side; from eye height a one-storey building is 0.2° up at 600 m, a 12 m one about 1°, and past that the terrain is almost always the higher skyline), and the next pin reuses it while its own corridor fits inside, so a few taps along a street cost one fetch. Bigger boxes were tried first and were too slow: from overpass-api.de on 2026-11-06, a 6 km square of Salida was 5.7 MB in 38 s, and a 2 km corridor 2.5 MB and still loading at 40 s.
3. **Find spots goes behind a fold**, *Find a better spot nearby*, closed on open. Its controls (walk, bike, drive, the radius, the button) are unchanged inside it. A shared link opens the pin and its readout; it runs the search only if it was copied after one (`,find` at the end).
4. **The footer is one line**, *© OpenStreetMap · sources and how times are worked out*, which opens to the method and the full credits. The map's own attribution strip, which opened across the bottom of a phone map, is folded to its ⓘ; the OpenStreetMap credit stays on screen in that one line, as its [copyright page](https://www.openstreetmap.org/copyright) asks.
5. **A building in the way is shown.** It is outlined in the event's colour, and if the map is zoomed out past 15 it eases in to 16 on the pin, since the basemap draws buildings only from 13 and they are only readable closer.

Not done: drawing every footprint (the basemap already draws buildings from zoom 13, OpenFreeMap *Liberty* layer `building`); a 3D view; trees, which no open source maps by height here.

Sources: building footprints and tags, OpenStreetMap contributors, ODbL, via the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API); the one-storey default is a choice, not a sourced number, and the code says so.

## How Jimmy will know it is right

Standing somewhere he knows around Salida, the "from here" time matches when the sun actually drops behind the ridge, to within a few minutes.
