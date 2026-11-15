# Handoff

**Hosting:** Cloudflare Pages, project `horizon`, address `horizon-abl.pages.dev`; horizon.myjimmycloud.com is a proxied CNAME to it. A merge goes live only by `npm ci && npm run build`, then `wrangler pages deploy dist --project-name horizon --branch main`. GitHub Pages is still switched on in the repo's Settings as the way back; turning it off is Jimmy's. `README.md` lines 81–84 still describe GitHub Pages and are his to change.

**Favicon:** `favicon.ico`, `favicon.svg` and `apple-touch-icon.png` in `public/`, linked from every page. Live check: `curl -s -o /dev/null -w '%{content_type}' https://horizon.myjimmycloud.com/favicon.ico` must print an image type.

**State:** branch `reckon/590` (on PR #9, on #7, on #8): *Lidar from USGS, live*, design and measurements in `docs/design.md`. Any pin a USGS flight covers streams that flight's points from the `usgs-lidar-public` bucket in the browser (`src/search/stream.ts`, laz-perf in the worker), ring by ring to 600 m; the skyline and reading are worked again and the colour circle widens as each ring lands, with a Stop button. In Salida a Baked · Streamed switch compares the two (`,stream` in the link). The flight is found in `public/flights.json` (`src/search/flights.ts`, baked by `scripts/lidar/flights.mjs`). Salida, Fast 4G, 390 px: 150 m in ~26 s / 8.8 MB, 600 m in ~59 s / 38.3 MB. `npm test` 82 pass, `npm run build` passes.

**Next:** Jimmy opens the demo on his phone and says whether the wait is worth it, and whether streaming should stay a choice or go.

**Decided:** rings 75/150/300/600 m; nodes down to ~1.4 m point spacing; ground from the flight's own class-2 points (no bare-ground model when streaming); the circle colours only completed rings.

**Open:** Denver downtown reads "Behind the ridge ~3:41 PM (−63 min)", unchecked. A few tall streamed bars at 150 m vanish by 600 m, probably the ground estimate firming up. Everything listed under Open for PR #9 still stands (removed features' code, compass on a real phone, tiles not in R2).
