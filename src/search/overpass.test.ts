import { beforeEach, describe, expect, it } from "vitest";
import { compileOsmQuery } from "./osm";
import { OVERPASS_MIRRORS, overpassJson, resetOverpassBackoff } from "./overpass";
import { poisFromElements, categoriesForMode, type OverpassElement } from "./pois";
import { roadsFromElements } from "./roads";

type Handler = (url: string, signal: AbortSignal) => Promise<Response>;

function fakeFetch(handler: Handler): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const f = ((url: string, init: RequestInit) => {
    calls.push(url);
    return handler(url, init.signal as AbortSignal);
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

/** Resolves after `ms`, or rejects when aborted. */
function after(ms: number, signal: AbortSignal, value: () => Response): Promise<Response> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(value()), ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
const status = (n: number) => () => new Response("", { status: n });

describe("overpassJson", () => {
  beforeEach(() => resetOverpassBackoff());

  it("asks every mirror at once and takes the first good answer", async () => {
    const [a, b, c] = OVERPASS_MIRRORS;
    const { fetch, calls } = fakeFetch((url, signal) =>
      url === a ? after(5, signal, status(429)) : url === b ? after(30, signal, ok({ from: "b" })) : after(5000, signal, ok({ from: "c" }))
    );
    const t0 = Date.now();
    const json = await overpassJson<{ from: string }>("q", 2000, fetch);
    expect(json).toEqual({ from: "b" });
    expect(Date.now() - t0).toBeLessThan(1000); // did not wait for c
    expect(calls.sort()).toEqual([a, b, c].sort());
  });

  it("gives up at the cap when no mirror answers", async () => {
    const { fetch } = fakeFetch((_u, signal) => after(10_000, signal, ok({})));
    const t0 = Date.now();
    expect(await overpassJson("q", 100, fetch)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("benches a mirror that refused, for the next lookup", async () => {
    const [a] = OVERPASS_MIRRORS;
    const first = fakeFetch((url, signal) => (url === a ? after(1, signal, status(429)) : after(20, signal, ok({}))));
    await overpassJson("q", 500, first.fetch);
    const second = fakeFetch((_u, signal) => after(1, signal, ok({})));
    await overpassJson("q", 500, second.fetch);
    expect(second.calls).not.toContain(a);
  });
});

describe("merged OSM query", () => {
  const salida = { lat: 38.5347, lon: -105.9989 };

  it("asks for roads and places in one request", () => {
    const q = compileOsmQuery(salida, 25_000, "drive");
    expect(q).toContain("out geom qt;");
    expect(q).toContain("out center qt 1200;");
    expect(q).toContain('["tourism"="viewpoint"]');
    expect(q.match(/\[out:json\]/g)).toHaveLength(1);
  });

  it("splits a merged reply into roads and places", () => {
    const elements: OverpassElement[] = [
      {
        type: "way",
        id: 1,
        tags: { highway: "secondary", name: "CR 175" },
        geometry: [
          { lat: 38.53, lon: -106.0 },
          { lat: 38.54, lon: -106.0 },
        ],
      } as OverpassElement,
      { type: "node", id: 2, lat: 38.535, lon: -105.99, tags: { tourism: "viewpoint", name: "S Mountain" } },
      { type: "way", id: 3, center: { lat: 38.536, lon: -105.995 }, tags: { amenity: "parking" } },
    ];
    const roads = roadsFromElements(elements, salida, 25_000, 100);
    const pois = poisFromElements(elements, categoriesForMode("drive"));
    expect(roads.length).toBeGreaterThan(0);
    expect(roads.every((r) => r.source === "road")).toBe(true);
    expect(pois.map((p) => p.source).sort()).toEqual(["parking", "viewpoint"]);
  });
});
