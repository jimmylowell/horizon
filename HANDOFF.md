# Handoff

**Hosting:** Cloudflare Pages, project `horizon`, address `horizon-abl.pages.dev`; horizon.myjimmycloud.com is a proxied CNAME to it. A merge goes live only by `npm ci && npm run build`, then `wrangler pages deploy dist --project-name horizon --branch main`. GitHub Pages is still switched on in the repo's Settings as the way back; turning it off is Jimmy's. `README.md` lines 81–84 still describe GitHub Pages and are his to change.

**Favicon:** `favicon.ico`, `favicon.svg` and `apple-touch-icon.png` in `public/`, linked from every page. Live check: `curl -s -o /dev/null -w '%{content_type}' https://horizon.myjimmycloud.com/favicon.ico` must print an image type.

**State:** `main` is live: a place search in Setup's Where row (type a name and press Find, or paste coordinates; names from Photon, one request per Find, `src/search/place.ts`, *Place search* in `docs/design.md`; with Photon unreachable, Find says the search didn't answer and the rest of the page works), terrain read fine near the pin and coarser far out (*Loading faster*), Salida lidar and the skyline strip, the eye-height slider to 20 ft, skyline first, and lidar streamed from USGS (`docs/design.md`). The Salida bake is committed in `public/lidar/salida/` (2.3 MB, seven files) and ships with the page; rebuild it with `scripts/lidar/README.md`. Colours meet the contrast floor: chosen chip #2262b0 light / #1964be dark, muted grey #74726d light / #898781 dark, and the sources line is 24 px tall.

**Street View screen (branch `reckon/1071`, not on `main`):** `street.html`, opened by *Street View* in the view bar; *Street View* in `docs/design.md`. Kept off `main` until the free Maps Embed key is in: Google's credit line is partly cut by the crop, and the panorama lookup runs keyless in Google's development mode. Merging it is the step after the key.

**Next:** Jimmy picks from *Proposed: what comes next* in `docs/design.md` (roads coloured by when it clears, the circle past 600 m, baking the valley, map layers). Nothing there is built.

**Decided:** rings 75/150/300/600 m; nodes down to ~1.4 m point spacing; ground from the flight's own class-2 points (no bare-ground model when streaming); the circle colours only completed rings. The Salida tiles stay on Pages, not R2: they are small and read whole, and the one R2 bucket is sprawl's.

**Open:** Denver downtown reads "Behind the ridge ~3:41 PM (−63 min)", unchecked. A few tall streamed bars at 150 m vanish by 600 m, probably the ground estimate firming up. The removed features' code is still in the tree; the compass is untried on a real phone. Text is 12 px, with 10 px chip times (accessibility audit; a look change, not made).
