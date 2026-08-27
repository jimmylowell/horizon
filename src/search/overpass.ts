/** Shared Overpass API plumbing: mirror list + fetch-with-fallback. */

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/**
 * POST an Overpass QL query, trying mirrors in order.
 * Returns the parsed JSON, or null when every mirror failed.
 */
export async function overpassJson<T>(query: string, timeoutMs = 25_000): Promise<T | null> {
  const body = "data=" + encodeURIComponent(query);
  for (const url of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      // try next mirror
    }
  }
  return null;
}
