# Handoff

**State:** PR #2 (this branch) carries the Salida test and its fix list,
items 1 to 7 done (details in `docs/salida-test.md`), and round two from
Jimmy's answer of 2026-11-05:

- **One sun definition.** Rise and set, open or behind a ridge, are the
  moment the top edge of the disc, seen through the air, meets the horizon
  line (`centreAltitudeForTopEdge` in `src/astro.ts`). Before, the ridge time
  tracked the disc's centre with no refraction (`SearchAltitude`), which ran
  2 to 4 min early against the open `SearchRiseSet` time. The page says how
  times are worked out, citing Wikipedia's *Sunset*.
- **Away mode.** A *Sun / Away* toggle (sun events only; `,away` at the end of
  the permalink) marches ±30° straight opposite the sun and grades a spot by
  how low that sky goes, against the Belt of Venus band, 10–20° up
  (Wikipedia, *Belt of Venus*). Logic and tests in `src/search/away.ts`.
- Tested at 390 px from Riverside Park and the top of Tenderfoot Hill, both
  modes, table in `docs/salida-test.md`. `npm test` (61) and `npm run build`
  pass.

**Next:** Jimmy's evenings in Salida: check from Tenderfoot Hill that the
ridge opposite the sunset sits about 7° up and the belt shows above it; time
scoring on his phone (fix list item 8). When PR #1 (`docs/design.md`)
merges, replace its stale "One uncited number" paragraph with one line: the
radius is 7/6 R per Wikipedia's *Horizon*, *Simple method—Young*.

**Decided:** one definition everywhere, the published one, rather than
centre-on-horizon: the minutes a spot gains are then terrain alone. Sea-level
standard atmosphere, as the library's rise/set uses for an observer at 0 m;
not corrected for Salida's thinner air. Away has no minutes verdict: its unit
is degrees of sky, compared with here. The verdict cut is 7 min; a spot across
missing terrain is ranked last, not dropped; refraction for terrain is 7/6 R.

**Open:** the ridge is sampled at the open event's bearing (±8° fan), while
behind a high ridge the sun goes down a few degrees further along its path;
aiming the fan at the bearing where the sun meets the ridge would need a
second march. Away averages three rays over 60°; a finer fan may read better.
Whether v2 is the direction. Racing three Overpass mirrors.

**Mirrors:** the three keyless worldwide instances on the OSM wiki's
*Overpass API* page (overpass-api.de, maps.mail.ru, overpass.private.coffee).
A mirror that answers 429, 406 or 5xx sits out 30 s, as the wiki asks.
