# Horizon: design

**Written after the fact (2026-11-04), from the code as it stands on `main`, for Jimmy's pushback.** Horizon was built before the design-first method, so this note describes what exists rather than what was planned. Where the code and this note disagree, the code is right and this note is wrong; say so and it gets fixed. From here on, a feature goes into this file before it goes into code.

## The first screen

The skyline from the pin, large, at the top, with the reading over it; under it the map of Salida, CO (`src/main.ts`, the `state` default) with a draggable pin and the colour overlay. **Setup** holds the event, the date and the eye height (*Skyline first*).

**The one action:** put the pin where you are (drag it, or the locate button) and read the strip: when the sun or moon clears or drops behind the skyline, and what it is. A shared link (`#lat,lon,kind,mode,radius[,date][,eye=<ft>]`) opens the same pin and event.

## Who it is for

Someone outside on a nice evening asking "where should I go right now to watch it?", and someone planning ahead ("where do I watch next week's full moonrise?") with the date picker. In the first five seconds they see a map of where they are and the direction the event happens in.

## The three things it does

1. **The reading:** ray-marches the terrain (and in Salida the lidar) from the pin toward the event (±8°) and says what the skyline does to it, e.g. *"Behind the ridge ~4:35 PM (−26 min)"*.
2. **The skyline strip:** the whole circle of skyline from the pin, dragged round or turned with the compass, with the sun's or moon's path over it, and what is in the way named from OpenStreetMap.
3. **The colour overlay:** the map round the pin coloured by how late the sun stays, so a better spot a block away shows without asking.

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
| USGS 3D Elevation Program lidar on AWS, [registry.opendata.aws/usgs-lidar](https://registry.opendata.aws/usgs-lidar/), Entwine copies by Hobu; flight index from [hobuinc/usgs-lidar](https://github.com/hobuinc/usgs-lidar) | Points of the flight over the pin, streamed (*Lidar from USGS, live*) | Browser fetch from `s3-us-west-2.amazonaws.com/usgs-lidar-public/<flight>/`, unpacked with laz-perf in the worker | Ground from the flight's own ground points; 600 m round the pin; 9 MB to 150 m, 38 MB to 600 m in Salida | Same pin, baked and streamed side by side: same reading, Behind the ridge ~4:26 PM |
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

1. **Salida is baked once.** `scripts/lidar/fetch.mjs` takes the USGS 1 m bare-ground model and the catalog listing; `scripts/lidar/bake.mjs` reads the point cloud of USGS lidar project CO_SanLuisJuanMiguel_2020_D20 over the bbox −106.01, 38.52, −105.98, 38.54 and writes six 0.01° tiles (1.1 m cells, 2.3 MB in all): height above the bare ground of the highest first return, in quarter metres. The points come from USGS's Entwine copy of the flight on AWS (`usgs-lidar-public/CO_SanLuisJuanMiguel_2_2020`), because rockyweb.usgs.gov, the LAZ files' only host, answered 429 to a script. Noise (classes 7, 18) and wires (13, 14) are dropped: a wire would fill a whole 1 m cell. The tiles are committed in `public/lidar/salida/` and ship with the page on Cloudflare Pages: 2.3 MB in seven files, far under Pages' 25 MiB per-file cap, and read whole, so Pages' lack of byte ranges (the reason sprawl's tiles are in R2) does not matter here. `VITE_LIDAR_BASE` points the page at another address instead, should a bigger bake need R2.
2. **From here marches the lidar in Salida.** Inside the baked area the pin's reading marches the measured surface 1.5 km out at 1.1 m steps, on top of the terrain, instead of OpenStreetMap footprints with guessed heights. A blocker is "a roof or tree", with its measured height and distance. Everywhere else the reading is as before. If the tiles fail to load, the footprints stand in.
3. **The skyline strip.** Under the reading, the skyline from the pin across 50° of bearings (101 rays), centred between the event's bearing and where the path is 4° up, since behind a near roof the sun goes in early and further round. Ridge in dark blue-grey, lidar in green. Over it the sun's or moon's path from two hours before a set (or to two hours after a rise), a dot every ten minutes, a time every half hour, and the disc drawn at the moment its top edge meets the skyline, by the same definition as the reading. A ring marks now when now is on the path. Drawn at the panel's real width, 96 px tall, for 390 px phones.
4. **The pin follows him.** The locate button now tracks: each new fix more than 5 m from the pin moves it, and the reading and the strip with it.

What the data cannot know, said on the page: anything built, cut down or grown since the flight; trees count as solid; nothing is labelled roof or tree, because **the flight does not classify buildings or vegetation**: over downtown its points are class 1 (unclassified, 11,296,712), 2 (ground, 21,104,771), 7 (low noise, 29), 9 (water, 111,664), 17 (bridge deck, 5,903), 18 (high noise, 2) and 20 (7,694), counted by `bake.mjs`. No floors or balconies: no dataset here records them.

The flight's dates disagree. The USGS catalog record for the point-cloud tiles ([ScienceBase item 608cc5ed…](https://www.sciencebase.gov/catalog/item/608cc5edd34e93746a6fe435)) gives start 2019-09-21, end 2019-10-19. The points' own GPS times over downtown, read by `bake.mjs`, span 2020-09-21 to 2020-09-29. Unknown which is right; the page says both.

Checked: the flight's ground points against the 1 m ground model, median gap 0.00 m (10th–90th percentile −0.05 to 0.05 m) over 42,100 cells, so the two share a vertical datum and no shift is applied.

Not done: telling roofs from trees, which the flight does not record; another town, which is another bake.

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

## Skyline first

Jimmy, 2026-11-14, after trying the lidar and eye-height demos: "The skyline strip is awesome. Get rid of most of the other stuff and except for a setup screen. The away button I don't think makes sense. Just do a bunch of cleanup on the UI, but the skyline ridge view is awesome, and I'd really like to even be able to look around at it if possible. It'd be interesting to identify what is blocking the way, possibly using OpenStreetMap. And I'd also like to revisit the gradient overlay as something that happens automatically instead of the find a better spot."

The page becomes two things: **the skyline view**, which is the app, and **the setup**, which says where you stand and what you are watching for.

### Before and after, 390 px

Before (the eye-height demo, PR #7):

```
┌────────────── 390 ──────────────┐
│ Horizon [date] Sunrise Sunset … │  topbar, two rows
│                                 │
│            map + pin            │
│                                 │
├─────────────────────────────────┤
│ Behind the ridge ~4:35 PM …     │  reading
│ Sunset 5:01 · az 247° · ridge … │  one long sub-line
│ Eye ━━━━○━━━━ standing          │
│ [strip, 96 px, ±25° only]       │
│ High spots… three cards…        │
│ [Sun|Away]  Tap the map…        │
│ ▸ Find a better spot nearby     │
│ © OSM · sources…                │
└─────────────────────────────────┘
```

After:

```
┌────────────── 390 ──────────────┐
│ Behind the ridge ~4:35 PM −26m  │  the reading, one line
│ ┌─────────────────────────────┐ │
│ │      ☀ path, dots 10 min    │ │
│ │  ▁▂▃▅▆▇█▇▆▅ ridge  ▇▇ roofs │ │  the strip, ~45% of the
│ │ SW    240°    W    260°  NW │ │  screen, dragged round
│ └─────────────────────────────┘ │  the whole circle
│ Behind: 128 F St · 9 m, 40 m    │  what is in the way
│ [⟲ event] [compass]   ⚙ Setup   │
├─────────────────────────────────┤
│   map: pin, colour overlay,     │
│   the thing in the way outlined │
│ © OSM · sources…                │
└─────────────────────────────────┘
```

**Setup** opens as a sheet over the map: the event (sunrise, sunset, moonrise, moonset, with their times), the date, and the eye height. Where is the map itself: tap it or drag the pin, or the locate button to follow you. Closing the sheet puts the view back. The map stays on screen under the strip because the overlay and the thing in the way are drawn on it; it is the "where" of the setup.

### What goes

- **Away**, entirely (the toggle, its reading, `,away` in links: an old link with it opens toward the sun).
- **Find a better spot nearby**: the fold, its walk/bike/drive and radius controls, its cards, verdict and ranked spots. The colour overlay takes its place. Old links with `,find` open the pin and ignore it.
- **The best-faces cards** and the coloured building faces of *Eye height and high spots in town*. The eye height itself stays, in the setup.
- The long sub-line under the reading (azimuth, golden hour, "measured by USGS lidar" and so on). What stays is one reading line, the strip, what is in the way, and the sources line.

### The strip, looked around

1. **The whole circle.** The skyline is marched on 720 bearings, every half degree. Toward the event, ±30° of the path, the rays run 120 km as now; the rest of the circle runs 30 km, the reach the old sky ring used, because fetching terrain tiles 120 km out in every direction is about ten times as many tiles for ridges that sit far below the near ones.
2. **The view is 70° wide** at a time, about what a phone's camera sees across, and opens centred on where the sun or moon meets the skyline. Drag sideways to turn; a button brings it back to the event.
3. **Compass points** N, NE, E … along the bottom, and the bearing every 10°.
4. **The sun's or moon's path is drawn wherever it is in view**, the whole day's arc above the horizon, not only the stretch near the event, with a dot every ten minutes and a time every half hour, and the disc at the moment it meets the skyline, as before.
5. **Following the compass.** On a phone that gives a heading (iOS `webkitCompassHeading`, others `deviceorientationabsolute`), a *Compass* button turns the strip as he turns. iOS asks permission on the tap. Where no heading comes, the button says so and drag stays.

### What is in the way

Tap the strip at a bearing, and without a tap the bearing where the path meets the skyline. The page reads the ray on that bearing and names what forms the skyline there:

- **Lidar** (Salida): the OpenStreetMap building whose outline holds the lidar point that tops the skyline, by its `name`, else house number and street, else "a building"; with its measured height and distance. Where no outline holds it, **"a tree or something unmapped"**, never a guess. Footprints are asked of Overpass for a 120 m square round the point and kept, so taps nearby cost nothing. When the thing at the meeting point is named, the reading uses the name too ("Behind Safeway ~2:01 PM").
- **Terrain**: the named peak or ridge from OpenStreetMap as now (`nameSkylinePoints`), else "the ridge", with its distance.
- On the map: the line from the pin to that point, and the building's outline when there is one.

The flight does not label roofs or trees (*Lidar in town*), so "a tree" is said only as "a tree or something unmapped": what we know is that no outline is there.

### The colour overlay, without a button

Once the pin is down, the map round it colours itself by how late the sun stays (setting) or how early it clears (rising), from the pin's eye height:

- In Salida, inside the lidar, 400 m round the pin, a point every 20 m, each marched over the lidar and the terrain on three rays (the event's bearing ±8°, like the reading).
- Elsewhere, 3 km round the pin, terrain only, 15 rings.
- Coloured blue for later (or earlier rising) than the middle of the area, red for sooner, with the key in times: the 5th, middle and 95th percentile read back as clock times by the page's one sun definition.
- It reruns when the pin, the event, the date or the eye height changes. Points where the lidar under them is as tall as the eye (inside a roof or a tree) are left out, since nobody stands there.
- The reading and the strip come from the strip's own skyline and path, so the two always agree; outside Salida no OpenStreetMap footprints are counted any more, since their heights were guesses.

Not done: a 3D view; telling roofs from trees, which the flight does not record; buildings outside Salida in the overlay (Overpass for a 3 km square is too slow, *In town*).

Sources: as in *Lidar in town* and *In town*; heading from the browser's [DeviceOrientationEvent](https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent) (MDN). The 70° view, the 30 km reach behind, the 400 m and 3 km overlay sizes and the 20 m spacing are choices, not sourced numbers.

How Jimmy will know it is right: standing on F Street, turning with the phone, the strip turns with him and the roofs and ridge on it line up with what he sees; tapping the roof the sun will drop behind names the building he is looking at.

## Lidar from USGS, live

Jimmy, in a session on 2026-11-14: "if I wanted to do this countrywide, could the user's client just stream from USGS to do the calculations?" and then "I am curious to try. As download progresses from point the circle with gradient can grow. I have this idea of it kind of growing wider to find a spot, and the gradient should be labeled as far as time of sun or moon going behind."

A trial, built on *Skyline first*. What changes:

1. **Any pin a flight covers gets lidar.** The page looks the pin up in `flights.json`, finds the USGS flight over it, and streams that flight's points straight from the USGS lidar bucket on AWS (`usgs-lidar-public`, Entwine/EPT layout; it answers any site with `Access-Control-Allow-Origin: *`, no key). Outside Salida this is automatic; in Salida a **Baked · Streamed** switch under the strip picks one, so the two can be compared (`,stream` in the link).
2. **Outward and coarse first.** The worker walks the flight's EPT hierarchy round the pin and fetches its nodes in four rings, 75, 150, 300 and 600 m; inside each ring the coarse nodes come first, then the fine, nearest first, down to the depth whose points are about 1.4 m apart (depth 10 for Salida's flight). Six downloads run at once; each node is unpacked in the worker with [laz-perf](https://github.com/hobuinc/laz-perf) (Apache-2.0, WebAssembly) and folded into a 1.1 m grid, 1.24 km across, centred on the pin (`src/search/stream.ts`).
3. **The same surface as the bake**, from the points alone: the highest first return per cell, noise (7, 18) and wire (13, 14) dropped. The ground is the flight's own ground points (class 2): the lowest in the 4.4 m cell, or failing that the lowest of the 17.6 m cells round it, out to three cells. The bake uses the USGS 1 m bare-ground model instead; streaming has no such model to hand.
4. **The circle grows.** As each ring completes, the skyline strip and the reading are worked again over the sharper grid, and the colour overlay is redrawn as a circle exactly as wide as the completed ring: 75, 150, 300, then 600 m. Ground the stream has not reached is not coloured. It widens on its own until 600 m or until he taps **Stop**; a new pin stops the last stream. Past the ring, rays read terrain only.
5. **The key is in clock times**, as in *Skyline first*: when the sun or moon goes behind the skyline at that spot (or comes out, for a rise), low, middle and high.

### Which flight covers a spot

`public/flights.json` (164 KB, 2,284 flights) is baked by `scripts/lidar/flights.mjs` from Hobu's boundary file of the bucket, [hobuinc/usgs-lidar](https://github.com/hobuinc/usgs-lidar) `boundaries/resources.geojson` (8.8 MB, last updated 2026-11-14 when fetched), cut down to each flight's name, box and year. For a pin the page takes the boxes that hold it, newest year first, and for each fetches that flight's `ept.json` and root hierarchy file and checks the node over the pin holds points; the first that does is streamed. A box is coarser than the flight's outline, so the check is what decides. The index goes stale as flights are added; rerunning the script refreshes it.

**How much of the country.** Unioned in an equal-area projection (EPSG:6933), the flights' outlines cover 7.03 million km², of which 6.94 million km² falls in the box of the lower 48 (125–66° W, 24–50° N). The lower 48 are 8,080,464 km² (Wikipedia, [Contiguous United States](https://en.wikipedia.org/wiki/Contiguous_United_States)), so about 86% by area. Outlines include water and any land over the borders inside that box, so this is an upper figure; it says nothing of a flight's age, density, or whether it labels buildings (Salida's does not).

### Measured, 2026-11-15

Headless Chrome at 390 × 844, pin on F Street (38.53470, −105.99370), sunset. "Throttled" is Puppeteer's *Fast 4G* preset: 1.01 MB/s down, 165 ms latency (its `PredefinedNetworkConditions`), which also slowed the worker's downloads (17 s became 57 s). Times are from the pin going down unless marked.

| | Unthrottled | Throttled (Fast 4G) |
|---|---|---|
| Flight found | 1.8 s | 1.7 s |
| 75 m loaded | 7.2 s, 4.8 MB | 19.7 s, 4.8 MB |
| 150 m loaded / skyline drawn | 8.5 s / 11.1 s, 8.8 MB | 25.8 s / 29.7 s, 8.8 MB |
| 300 m loaded | 13.5 s, 18.4 MB | 39.3 s, 18.4 MB |
| 600 m loaded | 19.6 s, 38.3 MB, 147 files, 6.3 M points | 58.8 s, 38.3 MB |
| Baked tiles instead: first lidar skyline, from opening the page | about 10 s | 22.5 s (2.3 MB of tiles) |

Denver, downtown (39.74860, −104.99950), unthrottled: flight CO_DRCOG_2_2020 found in 0.5 s, 150 m loaded in 4.9 s with 7.9 MB, 300 m in 7.9 s with 12.3 MB. Its reading, "Behind the ridge ~3:41 PM (−63 min)", is not yet checked: among the towers the blocker is likely a building, and the label may come from the Salida-only naming. Open.

**Is it worth it.** On a good phone connection the first useful answer, 150 m round, takes about half a minute and 9 MB; the full 600 m about a minute and 38 MB, against 2.3 MB for the whole baked town. Fine for a look from where he stands, and it works anywhere a flight covers with nothing baked; too heavy to be the default on a phone data plan, and too slow for walking with the pin following him. The bake stays the better answer for a town he uses often.

Not done: the reading's ground from the 1 m bare-ground model (only the bake has it); a set reach other than 600 m; keeping a stream when the pin moves a few metres (it starts again).

## Loading faster

Jimmy, in a session on 2026-11-24, after a moonrise at Herks Werks in Poncha Springs: "functionality seems great but needs to load quicker."

**Terrain detail by distance.** The skyline and the colour circle read terrain at zoom 12 (about 30 m pixels) out to 8 km, zoom 10 to 40 km, and zoom 8 beyond (`src/elevation/ladder.ts`). Every ray used to read zoom 11 all the way out, and the far ridges were most of the download. A ridge 40 km away is a fraction of a degree whether it is read from 30 m or 500 m pixels. On 2,100 sight lines from roads round Salida toward the 2026-11-24 moonrise, compared with zoom 12 all the way out, the median change was 0.000°, 99% were within 0.18°, and the worst was 0.25° (about a minute and a half of moonrise). Near the pin the terrain is finer than at zoom 11.

Measured 2026-11-24, headless Chrome at 390 × 844, 12 Mbit/s down and 60 ms latency, cache off, moonrise:

| Pin | First answer, zoom 11 → ladder | Terrain downloaded | Full 600 m lidar | Reading |
|---|---|---|---|---|
| Herks Werks, Poncha Springs (38.51748, −106.07600), streamed lidar | 15.6 s → 5.4 s | 21.6 MB → 4.5 MB | 30.8 s → 24.3 s (28.5 MB either way) | ~4:54 → ~4:53 PM, +17 min |
| F Street, Salida (38.53470, −105.99890), baked lidar | 15.3 s → 8.7 s | 15.6 MB → 4.0 MB | — | ~6:24 → ~6:23 PM, +107 min |

The lidar is now most of what a pin downloads outside Salida. Starting the stream only once the terrain skyline is in would take at most a second off the first answer at this speed and delay the lidar by as much, so it is not done.

## Proposed: what comes next

Ideas from the same session, for Jimmy's pushback. None is built.

His words: "Searching only along roards/paths seems best for choosing spot, but our search method is slow." "can we show the terrain/lidar on the map as well somehow? options for other details/layers?" "i'm also curious about expanding the heatmap from 600m efficiently." "what would baking this for chaffee county or around salida look like? that would just calculate the rise/set times for moon+sun givin the date and use lidar scans?"

### Roads coloured by when it clears

Instead of a ranked list, the roads themselves are coloured blue (clears early) to red (late), with the same key as the circle. The roads come from the map's own tiles, not Overpass: OpenFreeMap's `transportation` layer carries each road's `class`, `surface` and `access` (checked 2026-11-24 on nine zoom-14 tiles round CR 140, 53 KB in all), and the phone already has those tiles. Overpass was the 70-second wait in the Salida test. Reading roads out of the map's tiles is an idea from [hippomaps](https://github.com/cdutsov/hippomaps) (GPL-3.0: the idea only, no code). The session ran this offline over 7,865 points on roads within 28 km of Salida for that night's moonrise. Its best paved public spot, CR 140 at US 50 (38.53970, −106.13446), read 4:46; the app read 4:47 there.

### The circle past 600 m

The lidar is what stops it at 600 m: 28 MB to there, and four times the area for each doubling of the radius. Past it, two ways that cost little:

1. **Terrain only beyond the lidar.** Keep 0–600 m as it is, then carry on to 3 km on terrain alone at a coarser spacing (60–100 m), drawn so it is plain that trees and roofs are not counted there.
2. **Share the far ridge.** Seen from points a few hundred metres apart, ridges 5 km and more away are almost the same. Each point of the circle marches only its first 5 km and takes the rest from a few shared far rays. A 5 km ray took 0.14 ms against 0.50 ms for 150 km, so the circle would score about 3½ times faster.

### Baking the valley

Two bakes; neither bakes times. Times depend on the date and the skyline does not. With a spot's skyline in hand, any date, sun or moon, rise or set, is worked out in the browser in a moment by astronomy-engine, as now.

1. **The lidar, baked wider.** The Salida bake is the measured height of roofs and trees in 1 m cells: 2.3 MB for about 6 km² (0.02° × 0.03°), roughly 0.4 MB a km² in town and likely more in forest. Bake it for the valley floor from Buena Vista to Poncha Springs, and a pin reads the few tiles round it, about 1–2 MB, instead of streaming 28 MB. The same scripts do it (`scripts/lidar/`), run once per area. `flights.json` has six USGS flights whose boxes overlap Chaffee County (2010 to 2020). Boxes are coarser than the flights' outlines, so which flight covers which part gets checked when baking.
2. **The skyline, baked for every road point.** For points every 10 m along the roads, store the skyline round the whole circle: 360 bearings, one byte each in 0.1° steps. The 28 km circle round Salida holds about 2,000 km of road, so about 200,000 points and 72 MB before compression. Neighbouring points along a road look nearly the same, so it should pack several times smaller, in tiles fetched by area. The browser then colours every road for any date without marching a single ray, which makes *Roads coloured by when it clears* instant. At about 0.4 ms a ray the bake is roughly 8 hours of one core: a night on the XPS.

**Limits of both bakes:** the lidar was flown in 2020 (trees grow, buildings go up); the eye height is fixed at bake time (bake two heights, or bake at 1.7 m and march only the slider's difference live); a bake goes stale until it is run again. **Hosting:** Pages takes files up to 25 MiB, and the valley bakes would be many small tiles, so Pages may do; R2 is the fallback. Where they go, and whether any of it costs money, is an approval before anything is built.

### Layers on the map

- **Relief shading** from the terrain tiles the page already downloads: MapLibre draws it from a `raster-dem` source with `encoding: "terrarium"`.
- **Contour lines** from the same tiles, drawn in the browser by a small plugin.
- **3D tilt** with the terrain raised, looking toward the event from the pin.
- **Trees and roofs as a layer:** the height grid the lidar already builds, painted green by height in the circle, so the tree in the way shows on the map.
- **Where it clears on the ridge:** the point on the skyline where the body appears, with the sightline to it (partly there now, *What is in the way*).
- **Public land** (BLM and Forest Service), so the best spot is somewhere he may stand.
- **Aerial photos** from USGS (public domain), to check the trees at a spot.

**Open for Jimmy:** which of these first, and whether the bakes go ahead. The session's pick, not his: roads coloured by when it clears, then the lidar baked for the valley.

## How Jimmy will know it is right

Standing somewhere he knows around Salida, the "from here" time matches when the sun actually drops behind the ridge, to within a few minutes.
