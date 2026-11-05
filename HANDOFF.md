# Handoff

**State:** Tested 2026-11-04 in headless Chrome at phone width, Salida and
Denver. *From here* works; *Find spots* waits ~70 s on Overpass (429/502 and
two dead mirrors), then ranks unverified grid cells. Phone layout hides the
event chips and the first result. Findings and fix list: `docs/salida-test.md`.
No code changed.

**Next:** fix list item 1 and 2 (race Overpass mirrors with a ~10 s cap; show
terrain-only spots without waiting for roads). Done when a Salida search shows
spots in under 15 s with Overpass blocked.

**Decided:** fix list before fixes (Jimmy asked for the list first).

**Open:** whether v2 (in the same doc) is the direction; the refraction
coefficient *k* ≈ 0.13 in `src/geo.ts` still has no source.
