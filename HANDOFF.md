# Handoff

**Hosting:** Cloudflare Pages, project `horizon`, address `horizon-abl.pages.dev`; horizon.myjimmycloud.com is a proxied CNAME to it. A merge goes live only by `npm ci && npm run build`, then `wrangler pages deploy dist --project-name horizon --branch main`. GitHub Pages is still switched on in the repo's Settings as the way back; turning it off is Jimmy's. `README.md` lines 81–84 still describe GitHub Pages and are his to change.

**Favicon:** `favicon.ico`, `favicon.svg` and `apple-touch-icon.png` in `public/`, linked from every page. Live check: `curl -s -o /dev/null -w '%{content_type}' https://horizon.myjimmycloud.com/favicon.ico` must print an image type.

**State:** branch `reckon/588` (on PR #7, which is on PR #8): *Skyline first*, design in `docs/design.md`. The page is the skyline from the pin all the way round (drag, or the Compass button), the reading taken from it, what is in the way named from OpenStreetMap on a tap or at the meeting point, the map under it coloured by how late the sun stays, and a Setup sheet (event, date, eye height). Away, Find spots and the best-faces cards are gone from the page. Checked at 390 × 844 in headless Firefox with the Salida lidar and a saved real Overpass answer (Overpass did not answer from this host): by Safeway's east wall the reading is "Behind Safeway ~2:01 PM". `npm test` 77 pass, `npm run build` passes.

**Next:** Jimmy tries the demo on his phone in Salida: turning with Compass, the roofs and ridge on the strip line up with what he sees, and a tapped roof names the building he is looking at.

**Decided:** the reading comes from the strip's skyline and path, so the two never disagree. Toward the event the ridge is read 120 km out, the rest of the circle 30 km (tile count). The view is 70° wide. Overlay: Salida 400 m at 20 m spacing over the lidar, skipping points inside a roof or tree; elsewhere 3 km of terrain. Outside Salida no footprints are counted (their heights were guesses). Old links with `,away` or `,find` open the same pin and event.

**Open:** the code behind the removed features (`search/away.ts`, `verdict.ts`, `roads.ts`, `pois.ts`, `osm.ts`, `score.ts`, `highspots.ts`, `render/notes.ts`, `spots.ts`, the worker's search, ring and high-spots requests) is no longer reached from the page; delete it once he has said yes to this direction. The overlay is speckled in town, since most street points sit beside a wall; whether a coarser grid reads better is open. The compass has not been tried on a real phone. Lidar tiles still ship beside the page (no R2 yet).
