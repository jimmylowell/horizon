# Handoff

**State:** Fix list items 1 and 2 of `docs/salida-test.md` are done on this
branch. *Find spots* scores the terrain grid first and shows spots as soon as
tiles are in; roads and places come from one merged Overpass query sent to all
three keyless worldwide mirrors at once, capped at 10 s for the whole lookup,
and merge in when they arrive. The *From here* ridge name no longer holds up
the search. Building footprints (walk/bike, town scale) are capped at 12 s.
Measured 2026-11-04, Salida drive 25 km, phone size, headless Chrome: first
spots at 4.5 s with Overpass refused, 4.0 s with it hanging (done 13.3 s),
4.8 s with it answering (a made-up test road set, since no mirror answered
from this host that night). `npm test` (27) and `npm run build` pass.

Item 3 is done too: when no spot gains more than 7 min over the pin, one line
leads the list ("Nowhere within 25 km sees this sunset more than 7 minutes
longer; go higher.", or "stay put" when the pin is already open) and only three
cards follow. Salida drive 25 km at 390 px, Overpass hanging: the line sits
above the first card. `npm test` (32) and `npm run build` pass.

**Next:** fix list item 4, the phone layout (topbar chips cut off; legend and
warning push the first card below the fold, see the verdict screenshots).

**Decided:** the verdict cut is 7 min, not the doc's "~5": the Salida test
called +2 to +7 "nothing nearby is much better", and Jimmy's own example line
names 7.

 mirrors are the three keyless worldwide instances on the OSM wiki's
*Overpass API* page (overpass-api.de, maps.mail.ru, overpass.private.coffee);
overpass.kumi.systems was dropped because the wiki lists it as private.coffee's
old name. A mirror that answers 429, 406 or 5xx sits out 30 s, as the wiki asks.

**Open:** whether v2 is the direction; the refraction coefficient *k* ≈ 0.13
in `src/geo.ts` still has no source. Racing three mirrors sends each lookup to
three operators; the wiki's main instance asks for no parallel scripts from one
client, which this is not, but if it reads as rude, race two and keep the main
one as the fallback.
