# Handoff

**Favicon** (2026-11-07): `favicon.ico`, `favicon.svg` and `apple-touch-icon.png` sit in `public/` (Vite copies it into `dist/`) and every page links them; a new page links the same three before it goes live. Live check: `curl -s -o /dev/null -w '%{content_type}' https://horizon.myjimmycloud.com/favicon.ico` must print an image type (Pages answers a missing file with the home page, so a 200 alone proves nothing).

**Hosting (2026-11-06):** the site is on Cloudflare Pages, project `horizon`,
address `horizon-abl.pages.dev`; horizon.myjimmycloud.com is a proxied CNAME to
it. `public/CNAME` is gone and `deploy.yml` only installs, tests and builds, so
**a merge goes live only by** `npm ci && npm run build`, then
`wrangler pages deploy dist --project-name horizon --branch main`. GitHub
Pages is still switched on in the repo's Settings as the way back (one DNS
change to `jimmylowell.github.io`, DNS-only); turning it off is Jimmy's.
`README.md` lines 81–84 still describe GitHub Pages and are his to change.

**State:** the pin's readout now counts buildings, from Jimmy's note of
2026-11-06 after trying it in Salida ("footprints would be the best").
Design in `docs/design.md`, *In town: footprints first* (that file came in
from PR #1, which this branch supersedes). In short:

- *From here* shows the terrain answer at once, then marches OpenStreetMap
  footprints within 600 m toward the event and replaces it when a building is
  the skyline ("Behind a building ~4:17 PM … a building 16 m away"), outlines
  that building and eases the map in to zoom 16. Only the corridor is fetched
  (`fetchBuildingsBox`, worker `probeBuildings`), reused while the next pin's
  corridor fits inside.
- *Find spots* sits behind a fold, closed on open; a permalink reruns the
  search only with `,find` at the end (written after a search).
- The footer is one line, *© OpenStreetMap · sources and how times are worked
  out*; MapLibre's attribution strip is folded to its ⓘ.
- Checked at 390 px in Salida at sunset, 2026-11-06, with a real Overpass
  answer replayed (Overpass was timing out live that night): Riverside Park
  side of E St, behind a building at 4:17; the Moonlight brewpub pin, no
  building in the way, ridge at 4:35. `npm test` (62) and `npm run build` pass.

**Source link** (2026-11-10, branch `reckon/todo-4d67842b`): the credits line
under *sources and how times are worked out* links the source on GitHub and
says MIT; the repo has the `LICENSE`. **Not merged on purpose:** the repo is
still private, so the link would 404 for a visitor. It merges and deploys
once Jimmy says yes to making the repo public (a line in his queue).

**Next:** Jimmy tries it in town this week: tap a few spots along F Street at
sunset and say whether the building times match what he sees.

**Decided:** 600 m reach for the readout (a 4 m building is 0.2° up at 600 m
from eye height; bigger boxes were 2.5–5.7 MB and 38 s+ from Overpass).
Heights stay blunt (tag, levels × 3 m, else 4 m). One sun definition
everywhere (top edge, refraction), as before.

**Open:** the fan is aimed at the open event's bearing; behind a near building
the sun is much higher and further south when it goes behind it, so a tall
building's time is rougher than a ridge's. Aiming the fan where the sun meets
the skyline would need a second march. Whether the 4 m default reads right in
Salida's one-storey downtown. Overpass reliability: when every mirror fails the
line says buildings were not checked.

**Mirrors:** the three keyless worldwide instances on the OSM wiki's
*Overpass API* page (overpass-api.de, maps.mail.ru, overpass.private.coffee).
A mirror that answers 429, 406 or 5xx sits out 30 s, as the wiki asks.
