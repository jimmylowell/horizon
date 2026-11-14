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
- No promise about trees outside Salida: the elevation model is a surface model, so a spot inside forest is penalized and flagged by `data/landcover-rules.json`, not modelled. In Salida the lidar measures them (*Lidar in town*).
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
| USGS 3D Elevation Program: lidar point cloud CO_SanLuisJuanMiguel_2020_D20 and its 1 m bare-ground model, [ScienceBase 608cc5ed…](https://www.sciencebase.gov/catalog/item/608cc5edd34e93746a6fe435), [6217206a…](https://www.sciencebase.gov/catalog/item/6217206ad34ec739b2dbf592) | Height above ground of the highest first return, Salida only | Baked once by `scripts/lidar/`, shipped as `lidar/salida/*.png` | Flown 2019 or 2020 (sources disagree); buildings and trees unlabelled; trees solid | Ground points vs ground model, median gap 0.00 m |
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

## Lidar in town (2026-11-14)

Jimmy, in a session on 2026-11-14: "The Horizon app needs to use LiDAR to be anything useful"; "I like the idea on the skyline strip"; on the street: "maybe I need to walk around, and I've seen some really great sunsets just randomly down the street".

What changes:

1. **Salida is baked once.** `scripts/lidar/fetch.mjs` takes the USGS 1 m bare-ground model and the catalog listing; `scripts/lidar/bake.mjs` reads the point cloud of USGS lidar project CO_SanLuisJuanMiguel_2020_D20 over the bbox −106.01, 38.52, −105.98, 38.54 and writes six 0.01° tiles (1.1 m cells, 2.3 MB in all): height above the bare ground of the highest first return, in quarter metres. The points come from USGS's Entwine copy of the flight on AWS (`usgs-lidar-public/CO_SanLuisJuanMiguel_2_2020`), because rockyweb.usgs.gov, the LAZ files' only host, answered 429 to a script. Noise (classes 7, 18) and wires (13, 14) are dropped: a wire would fill a whole 1 m cell. The tiles ship beside the page as `lidar/salida/`; `VITE_LIDAR_BASE` points the page at another address (R2) instead.
2. **From here marches the lidar in Salida.** Inside the baked area the pin's reading marches the measured surface 1.5 km out at 1.1 m steps, on top of the terrain, instead of OpenStreetMap footprints with guessed heights. A blocker is "a roof or tree", with its measured height and distance. Everywhere else the reading is as before. If the tiles fail to load, the footprints stand in.
3. **The skyline strip.** Under the reading, the skyline from the pin across 50° of bearings (101 rays), centred between the event's bearing and where the path is 4° up, since behind a near roof the sun goes in early and further round. Ridge in dark blue-grey, lidar in green. Over it the sun's or moon's path from two hours before a set (or to two hours after a rise), a dot every ten minutes, a time every half hour, and the disc drawn at the moment its top edge meets the skyline, by the same definition as the reading. A ring marks now when now is on the path. Drawn at the panel's real width, 96 px tall, for 390 px phones.
4. **The pin follows him.** The locate button now tracks: each new fix more than 5 m from the pin moves it, and the reading and the strip with it.

What the data cannot know, said on the page: anything built, cut down or grown since the flight; trees count as solid; nothing is labelled roof or tree, because **the flight does not classify buildings or vegetation**: over downtown its points are class 1 (unclassified, 11,296,712), 2 (ground, 21,104,771), 7 (low noise, 29), 9 (water, 111,664), 17 (bridge deck, 5,903), 18 (high noise, 2) and 20 (7,694), counted by `bake.mjs`. No floors or balconies: no dataset here records them.

The flight's dates disagree. The USGS catalog record for the point-cloud tiles ([ScienceBase item 608cc5ed…](https://www.sciencebase.gov/catalog/item/608cc5edd34e93746a6fe435)) gives start 2019-09-21, end 2019-10-19. The points' own GPS times over downtown, read by `bake.mjs`, span 2020-09-21 to 2020-09-29. Unknown which is right; the page says both.

Checked: the flight's ground points against the 1 m ground model, median gap 0.00 m (10th–90th percentile −0.05 to 0.05 m) over 42,100 cells, so the two share a vertical datum and no shift is applied.

Not done: tiles in R2 (the run that built this could not run `wrangler`); telling roofs from trees, which the flight does not record; another town, which is another bake.

Sources: USGS 3D Elevation Program, lidar point cloud CO_SanLuisJuanMiguel_2020_D20 (catalog via the [TNM Access API](https://tnmaccess.nationalmap.gov/api/v1/docs)), and USGS 1 m DEM tile `USGS_1M_13_x41y427_CO_SanLuisJuanMiguel_2020_D20` ([ScienceBase item 6217206a…](https://www.sciencebase.gov/catalog/item/6217206ad34ec739b2dbf592)); the Entwine copy is listed on the [AWS Open Data registry](https://registry.opendata.aws/usgs-lidar/).

## Eye height and high spots in town

Jimmy, 2026-11-14: "Slider only works"; the question it answers is "best balcony in town"; floors dropped for now; and on its top, "make it 20 feet max". It builds on *Lidar in town*: the heights come from the flight, not from OpenStreetMap tags.

1. **One slider: how high the eye is.** Under the *From here* line, from standing (2 m, the height the page uses everywhere else) to 20 ft (6.1 m), in half-foot steps, read in feet with metres beside them. It measures height above the ground at the pin. Nothing records floor heights, so it never says "second floor". The permalink carries it as `,eye=<ft>`; absent means standing, so every older link opens the same.
2. **From here and the skyline strip use it.** Both march from the slider's height. A higher eye lowers every obstruction near the pin. In Salida the line also says what the lidar has under the pin: above a roof or tree lower than the eye, or inside one taller than it, with a hint to move the pin beside the wall. *Find spots* stays at standing height.
3. **In Salida, building faces are coloured by how late the sun stays at that height.** Inside the baked lidar area and within 400 m of the pin, every OpenStreetMap footprint edge whose outward side looks within 90° of the event is sampled every 4 m, 1.5 m outside the wall, at the slider's height. A sample counts only where the lidar 1.5 m inside the wall reaches the eye, so the spot is beside a measured wall, not in the air. Each sample marches the lidar and terrain toward the event (`src/search/highspots.ts`); a face takes its best sample. The colours break at skyline angles of 1°, 2°, 3° and 5°, and the key shows each break as the time the sun meets it, by the page's one sun definition. Shown only above standing height and only toward the sun or moon, not *Away*.
4. **The best three are listed.** Re-read with the same ±8° fan as *From here*, no two within 40 m: "West face of *name* (OSM `name`, else house number and street, else *a building*), 15 ft up: sun until ~4:41, +12 min over the street here", the street figure being the same spot at standing height. Tapping one moves the pin there. **It names a spot on a building's face, never a balcony**, and says so: no source here records balconies, windows or whether anyone can stand there.

Not done: floors or floor heights; balconies, windows or roof access; telling roofs from trees, which the flight does not record (a footprint's wall height is read from the lidar just inside it, so an overhanging tree there counts as wall); anywhere outside the baked area; scoring the whole town at once, which would ask Overpass for the town's every footprint (a 6 km square was 5.7 MB and 38 s, measured in `src/search/buildings.ts`).

Sources: heights from the USGS flight in *Lidar in town*; footprints, names and addresses from OpenStreetMap contributors, ODbL. The 2 m standing eye, the 400 m reach, the 4 m and 1.5 m spacings and the colour breaks are choices, not sourced numbers. The 20 ft top is Jimmy's.

How Jimmy will know it is right: from a window or a deck he knows in Salida, with the slider at that height, the *From here* time matches when the sun actually goes, to within a few minutes, and the top card names a face he would agree is a good spot.

## How Jimmy will know it is right

Standing somewhere he knows around Salida, the "from here" time matches when the sun actually drops behind the ridge, to within a few minutes.
