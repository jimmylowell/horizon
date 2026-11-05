# Handoff

**State:** Fix list items 1 to 5 of `docs/salida-test.md` are done on this
branch (PR #2), and finding 5 (the Denver legend) is settled by the item 4
fold with no change. *Find spots* scores terrain first and shows spots in
about 4 s whether Overpass answers or not; a verdict line leads when nothing
gains more than 7 min; under 760 px the chips sit on their own row and the
legend and warnings fold into one tappable line. Item 5, 2026-11-05: a
terrain tile that fails to load is no data, not 0 m. `sampleElevation()`
returns NaN for it, a ray across it is `noData` (its angle a minimum), a
sky-ring direction across it never counts as open, and a spot standing on it
is dropped. Cards with a gap read "or earlier (−6 min or more)" in grey
italics with a warning line, rank after every spot with full data, show no
"vs here" gain, and are left off the heatmap; the folded line says
"⚠ terrain gaps"; no verdict while an unknown spot could still beat the cut.
The same fix exposed the probe's tile prefetch skipping tiles between 15 km
sweep points (they read as 0 m, so *From here* under-read distant ranges);
the sweep is now at most half a tile with a matching pad. `npm test` (48) and
`npm run build` pass. Item 6, 2026-11-05: the effective earth radius in
`src/geo.ts` is now 7/6 R (*k* = 1/7), cited in the code to Wikipedia's
*Horizon* (§ Simple method—Young); it was an uncited *k* ≈ 0.13. *From here*
reads the same before and after, Salida −25 min and Denver −16 min.

**Next:** item 7, the URL hash after a button search and the null style
expression. When PR #1 (`docs/design.md`) merges, its "One uncited number"
paragraph under the data sources is stale: replace it with one line saying
the radius is 7/6 R per Wikipedia's *Horizon*, *Simple method—Young*. It is
not on this branch, so it could not be edited here without a conflict.

**Decided:** the verdict cut is 7 min, not the doc's "~5": the Salida test
called +2 to +7 "nothing nearby is much better", and Jimmy's own example line
names 7. The drag-up bottom sheet in item 4 was not built: folding the notes
was enough to put card 1 above the fold. A spot across missing terrain is
ranked last rather than dropped: it may well be the best one, and the card
says what is not known. A terrarium tile that 404s over the ocean would now
read as unknown rather than sea level; AWS terrarium covers the oceans with
bathymetry, so that should not happen. Refraction uses the cited 7/6 R
rather than keeping 0.13 with a citation: no Wikipedia page gives 0.13, and
the switch moves no minute in Salida or Denver.

**Mirrors:** the three keyless worldwide instances on the OSM wiki's
*Overpass API* page (overpass-api.de, maps.mail.ru, overpass.private.coffee);
overpass.kumi.systems was dropped because the wiki lists it as private.coffee's
old name. A mirror that answers 429, 406 or 5xx sits out 30 s, as the wiki asks.

**Open:** whether v2 is the direction. Racing three mirrors sends each lookup
to three operators; if that reads as rude, race two and keep the main one as
the fallback.
