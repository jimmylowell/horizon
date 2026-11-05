# Salida test, 2026-11-04: what breaks, and a proposed v2

Jimmy, 2026-11-04: "This needs a lot of work. Was not functional here in Salida."
No code changed on this branch; this is the fix list.

## How it was tested

The production build (`npm run build`, `vite preview`) driven by headless
Chrome (puppeteer, SwiftShader WebGL) at phone size, 390 × 844, scale 2, on
2026-11-04 at about 22:40 MST. Six runs: Salida opened cold, Salida via the
locate button, Salida *Find spots* (drive, 25 km), Salida walk 2 km sunrise
permalink, Denver drive 25 km permalink, Denver via the locate button.
`npm test` (22 tests) and `npm run build` both pass.

## What works

- The map, the sun/moon chips and the azimuth lines load in under 10 s.
- **From here** works in both towns with no network but terrain tiles:
  Salida sunset "Behind the ridge ~4:34 PM · az 246° (−25 min) · ridge 3.7°,
  21 km away"; Denver "Behind the ridge ~4:37 PM (−16 min) · ridge 2.0°,
  57 km away". The geolocate button moves the pin and re-reads.
- Terrain tiles (AWS) answer with CORS; no tile failed in any run.

## What breaks, worst first

1. **Find spots hangs for over a minute, then gives up on roads.** In every
   search the status sat on "Looking up roads and places (OpenStreetMap)…" for
   68–75 s, then fell back to "⚠ Road lookup (Overpass) unavailable".
   `overpass-api.de` answered 429 (rate limit) or 502; the two fallback
   mirrors (`overpass.kumi.systems`, `overpass.private.coffee`) did not answer
   at all within 15 s from this host. `overpassJson()` in
   `src/search/overpass.ts` tries the mirrors **one after another with a 25 s
   timeout each**, and the road and place lookups both do it, so the worst
   case is about 75 s before anything happens. On a phone at the roadside
   that reads as broken. Whether a phone in Salida sees the same 429 cannot
   be known from here; the design makes it likely whenever the public
   Overpass server is busy, which is often.
2. **The fallback answers are not usable.** With no roads, the ranking is raw
   grid cells marked "access unverified", several "~2 km walk from nearest
   mapped road", and no named places. For Salida drive the best of them
   gains **+2 to +7 minutes** over the town pin, so the tool's real answer is
   "nothing nearby is much better", buried under two red warnings.
3. **Salida's sunset is blocked from everywhere low.** The Sawatch Range sits
   3–4° above the horizon at 16–25 km along the November sunset line, so every
   valley spot loses 18–25 minutes. What would help is height (the hills
   around town), and the score does not lead there: the top picks were at
   2,163–2,265 m, about the town's own height, one at 2,859 m. Worth checking
   with real roads before blaming the score.
4. **The phone layout hides the answer.** The topbar does not fit 390 px: the
   Sunset chip is cut off and Moonrise/Moonset are off-screen with no sign they
   exist. After a search the bottom sheet grows to 439 of 844 px; the map
   shrinks to a strip and the first result card starts at the very bottom,
   under two warning boxes. See the screenshots on the review page.
5. **The legend contradicts itself in Denver.** It says "Terrain blocks the
   view everywhere near you" while every listed spot has "360° open sky"; the
   Front Range 75 km away takes 1° off the sunset everywhere. True, but the
   wording reads like failure. *(2026-11-05: settled by the item 4 fold. The
   sentence now says "Terrain blocks some of the view everywhere near you" and
   sits behind the tap; Denver drive 25 km at 390 px reads verdict "Nowhere
   within 25 km sees this sunset more than 6 minutes longer; go higher" over
   cards at −10 to −12 min, no contradiction left. No change made.)*
6. **Scoring is slow on a phone-class CPU.** Salida walk 2 km: 37 s on
   "Scoring horizons…" for 491 points (SwiftShader, so slower than a real
   phone, but the order of magnitude is worth measuring on one).
7. **Missing terrain reads as sea level.** `TileCache.sampleElevation()`
   returns 0 m for a tile that failed to load. At 2,100 m in Salida a missing
   tile is a 2 km-deep hole, which makes rays look clear and spots look
   better than they are. It did not happen in this test, but a flaky phone
   connection would trigger it silently.
8. **The refraction figure is uncited.** `src/geo.ts` uses *k* ≈ 0.13 for the
   effective earth radius. It needs a published source (Wikipedia preferred,
   per the workspace rule) or a cited replacement value.
9. Minor: after a search started from the button, the URL hash is empty
   (the permalink is not written), and MapLibre logs "Expected value to be of
   type number, but found null" three times on Denver loads (a style
   expression with a missing value).

## Fix list, in order

1. **Overpass:** race the mirrors instead of queuing them, and cap the whole
   lookup at ~10 s; combine the road and place queries into one, lighter request
   (smaller bbox, an output limit). Replace dead mirrors with ones listed on the
   OSM wiki's *Overpass API* page, checked at build time.
2. **Never block the screen on Overpass:** score terrain first and show the
   heatmap and best-by-terrain spots as soon as tiles are in; add roads and
   places when (if) they arrive, and re-rank.
3. **Lead with the verdict:** *(done 2026-11-04, `src/search/verdict.ts`;
   the cut is 7 min, since this test read +2 to +7 as "nothing much better")*
   when nothing beats the pin by more than ~5
   minutes, say so in one line ("Nowhere within 25 km sees this sunset
   more than 7 minutes longer; go higher") instead of eight near-identical cards.
4. **Phone layout:** *(done 2026-11-05: under 760 px the topbar is two rows,
   all four event chips in equal columns, the weekday shown only when the
   event is on another day; the colour key and every warning fold into one
   small line under the verdict, tap to open, `src/render/notes.ts`; the
   status line is dropped under a verdict. Salida drive 25 km at 390 × 844:
   verdict and card 1 fully visible without scrolling. The drag-up sheet was
   not needed for that and is not built)* topbar on two rows or an event
   dropdown; bottom sheet collapsed to the verdict and first card, drag up
   for the rest; warnings folded into one small line.
5. **Missing tile = no data, not 0 m:** *(done 2026-11-05: a tile that fails
   to load samples as NaN; a ray across it is `noData`, its angle a minimum;
   a sky-ring direction across it never counts as open; a spot standing on one
   is dropped. Cards with a gap say "or earlier (−6 min or more)" in grey
   italics with a warning line, rank after every spot with full data, and
   show no "vs here" gain; the heatmap leaves those cells out; the folded line
   says "⚠ terrain gaps"; From here says "or more" too, and a pin on a failed
   tile says terrain didn't load. No verdict while an unknown spot's minimum
   could still beat the 7-min cut. Salida drive 25 km at 390 px with tile
   10/209/393 refused: four known cards, then four unknown; before the fix the
   unknown ones, at −6 to −18 min, would have led the list. Fixing it showed a
   second bug: the probe's tile prefetch swept every 15 km with a 500 m pad
   and skipped the tiles in between, which read as 0 m, so From here in
   Denver under-read the Front Range; the sweep is now at most half a tile)*
   mark the ray as unknown and say so.
6. **Cite or replace the refraction coefficient** (`src/geo.ts`). *(done
   2026-11-05: replaced with the cited value. Wikipedia's
   [Horizon](https://en.wikipedia.org/wiki/Horizon#Simple_method%E2%80%94Young)
   (*Effect of atmospheric refraction*, *Simple method—Young*, citing A. T.
   Young's "Distance to the Horizon", SDSU) gives an effective radius
   R′ = 7/6 R for visible light, i.e. *k* = 1/7 ≈ 0.143; the same page gives
   4/3 R for radar, which is not our case. *Atmospheric refraction* and
   *Line-of-sight propagation* give the formula or the radio figure only.
   From here, same day, before and after: Salida sunset "Behind the ridge
   ~4:34 PM (−25 min), ridge 3.7°, 21 km" both times; Denver "~4:37 PM
   (−16 min), ridge 2.0°, 57 km" both times. The change drops a 57 km ridge
   by about 3 m, under 0.01°, so no minute moves)*
7. Write the hash after every search; fix the null style expression.
8. Measure scoring time on a real phone before optimising it.

## Proposed v2

One screen, one question: **"When will I see it from here, and where should I
go instead?"**

- **From here first**, as now; it already works and is the part people use.
- **"Go instead" as a short list of three**, terrain-only, appearing in
  seconds, with the minutes gained as the headline number. Roads and named
  places are enrichment, never a gate.
- **A "go higher" hint** for valley towns: the nearest reachable point whose
  horizon along the event line drops below the ridge, by elevation gain.
- **Offline-friendly in the mountains:** the Chaffee County terrain bundle
  that `scripts/fetch-terrain.mjs` already builds for dev could ship as a
  prebuilt cache for the home area, so Salida works on one bar of signal.
- Not in v2: buildings (town-scale, Overpass-heavy), landcover penalties.

What would show it is right: Jimmy opens it in Salida on his phone, gets the
from-here time in under 5 s and a "go instead" answer in under 15 s, and the
answer matches what he sees from that spot.
