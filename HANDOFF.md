# Handoff

**State:** Fix list items 1 to 4 of `docs/salida-test.md` are done on this
branch (PR #2). *Find spots* scores terrain first and shows spots in about
4 s whether Overpass answers or not (mirrors raced, one merged query, 10 s
cap); when no spot gains more than 7 min over the pin, one verdict line leads
and three cards follow. Item 4, the phone layout: under 760 px the topbar is
two rows, brand and date, then all four event chips in equal columns (the
weekday shows only when the event is on another day than the one planned);
the colour key and the OpenStreetMap and building warnings fold into one
small line under the verdict, tap to open the full sentences
(`src/render/notes.ts`); the status line is dropped under a verdict, since
the verdict already names the event and radius. Measured 2026-11-05, Salida
drive 25 km at 390 × 844, headless Chrome: verdict and card 1 fully visible
without scrolling (card 1 ends 10 px above the sheet's edge), no chip
clipped. `npm test` (38) and `npm run build` pass.

**Next:** item 5, the legend wording in Denver (the full sentence under the
folded line now says "Terrain blocks some of the view everywhere near you",
which may already be enough; check in Denver), then item 7 (missing tile
read as 0 m).

**Decided:** the verdict cut is 7 min, not the doc's "~5": the Salida test
called +2 to +7 "nothing nearby is much better", and Jimmy's own example line
names 7. The drag-up bottom sheet in item 4 was not built: folding the notes
was enough to put card 1 above the fold, and a drag gesture is more code to
keep working than it gains.

**Mirrors:** the three keyless worldwide instances on the OSM wiki's
*Overpass API* page (overpass-api.de, maps.mail.ru, overpass.private.coffee);
overpass.kumi.systems was dropped because the wiki lists it as private.coffee's
old name. A mirror that answers 429, 406 or 5xx sits out 30 s, as the wiki asks.

**Open:** whether v2 is the direction; the refraction coefficient *k* ≈ 0.13
in `src/geo.ts` still has no source. Racing three mirrors sends each lookup to
three operators; the wiki's main instance asks for no parallel scripts from one
client, which this is not, but if it reads as rude, race two and keep the main
one as the fallback.
