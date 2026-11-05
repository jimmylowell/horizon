/**
 * Shared Overpass API plumbing: mirror list + a parallel race with one cap.
 *
 * Mirrors are the keyless instances with worldwide data listed on the OSM
 * wiki's "Overpass API" page, *Public Overpass API instances*
 * (https://wiki.openstreetmap.org/wiki/Overpass_API, read 2026-11-04).
 * overpass.kumi.systems was dropped: the wiki lists it as the old name of
 * overpass.private.coffee, so it was the same server twice.
 */

export const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/** Whole-lookup cap: past this the search goes on without OpenStreetMap. */
export const OVERPASS_CAP_MS = 10_000;

/**
 * The wiki asks clients that get 429 (or another refusal) to wait 30 s
 * before asking that server again; a mirror that refused sits out that long.
 */
const BACKOFF_MS = 30_000;
const benchedUntil = new Map<string, number>();

type Fetch = typeof fetch;

/**
 * POST an Overpass QL query to every mirror at once (one request each) and
 * take the first good answer; the rest are aborted. The whole lookup gives up
 * after `capMs`. Returns the parsed JSON, or null when no mirror answered in
 * time — callers treat that as "OpenStreetMap unavailable", not "nothing here".
 */
export async function overpassJson<T>(
  query: string,
  capMs = OVERPASS_CAP_MS,
  fetchImpl: Fetch = fetch,
  now: () => number = Date.now
): Promise<T | null> {
  const body = "data=" + encodeURIComponent(query);
  const t = now();
  let mirrors = OVERPASS_MIRRORS.filter((u) => (benchedUntil.get(u) ?? 0) <= t);
  if (!mirrors.length) mirrors = OVERPASS_MIRRORS; // all benched: try anyway
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), capMs);
  try {
    return await Promise.any(
      mirrors.map(async (url) => {
        const res = await fetchImpl(url, {
          method: "POST",
          body,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: ctrl.signal,
        });
        if (!res.ok) {
          if (res.status === 429 || res.status === 406 || res.status >= 500) {
            benchedUntil.set(url, now() + BACKOFF_MS);
          }
          throw new Error(`${url}: HTTP ${res.status}`);
        }
        return (await res.json()) as T;
      })
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    ctrl.abort(); // cancel the losers
  }
}

/** Test hook: forget which mirrors are sitting out. */
export function resetOverpassBackoff(): void {
  benchedUntil.clear();
}
