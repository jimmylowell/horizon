import type { Feature, FeatureCollection } from "geojson";
import maplibregl, { GeolocateControl, Map as MapLibreMap, Marker, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

import {
  EVENT_KINDS,
  eventTimeAt,
  goldenHourSpan,
  nextEvents,
  obstructedEventTime,
  type EventKind,
  type GoldenHourSpan,
  type SkyEvent,
} from "./astro";
import { destination, flatDistanceM, type LatLon } from "./geo";
import { ringAzimuths } from "./elevation/horizon";
import { clearHeatmap, renderHeatmap, type ScorePoint } from "./render/heatmap";
import { clearSpotMarkers, renderSpotMarkers } from "./render/spots";
import { gridCandidates, gridSpacingM, type Candidate } from "./search/grid";
import { nameSkylinePoints, type SkylineFeature } from "./search/horizonFeature";
import { landcoverAt } from "./search/landcover";
import { fetchPois, type TravelMode } from "./search/pois";
import { buildRoadIndex, roadBandsM } from "./search/roads";
import {
  OPEN_SKY_MAX_DEG,
  opennessDelta,
  score,
  skyOpenness,
  verdict,
  type SkyOpenness,
} from "./search/score";
import type {
  CandidateResult,
  RingRequest,
  SearchRequest,
  WorkerMessage,
} from "./search/worker";

// ---------- state ----------

interface State {
  loc: LatLon;
  kind: EventKind;
  mode: TravelMode;
  radiusKm: number;
  /** YYYY-MM-DD; empty = today ("nice night, where do I go"). Set = planning. */
  date: string;
  events: Partial<Record<EventKind, SkyEvent>>;
  golden: Partial<Record<EventKind, GoldenHourSpan>>;
  searching: boolean;
}

const MODE_DEFAULT_KM: Record<TravelMode, number> = { walk: 2, bike: 8, drive: 25 };

const state: State = {
  loc: { lat: 38.5347, lon: -105.9989 }, // Salida, CO
  kind: "sunset",
  mode: "drive",
  radiusKm: 25,
  date: "",
  events: {},
  golden: {},
  searching: false,
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Search-from time: now for today, local midnight for a planned future date. */
function baseTime(): Date {
  if (!state.date || state.date === todayStr()) return new Date();
  const [y, m, d] = state.date.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0);
}

// Permalink: #lat,lon,kind,mode,radius[,date]
/** True when the page opened on a shared/bookmarked permalink (auto-searches). */
let openedFromHash = false;
function readHash(): void {
  const m = location.hash.slice(1).split(",");
  if (m.length >= 2) {
    const lat = parseFloat(m[0]);
    const lon = parseFloat(m[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      state.loc = { lat, lon };
      openedFromHash = true;
    }
    if (m[2] && (EVENT_KINDS as string[]).includes(m[2])) state.kind = m[2] as EventKind;
    if (m[3] && ["walk", "bike", "drive"].includes(m[3])) state.mode = m[3] as TravelMode;
    const r = parseFloat(m[4]);
    if (Number.isFinite(r)) state.radiusKm = Math.min(40, Math.max(1, r));
    if (m[5] && /^\d{4}-\d{2}-\d{2}$/.test(m[5])) state.date = m[5];
  }
}
function writeHash(): void {
  const date = state.date && state.date !== todayStr() ? `,${state.date}` : "";
  history.replaceState(
    null,
    "",
    `#${state.loc.lat.toFixed(5)},${state.loc.lon.toFixed(5)},${state.kind},${state.mode},${state.radiusKm}${date}`
  );
}

readHash();

// ---------- map ----------

const map = new MapLibreMap({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [state.loc.lon, state.loc.lat],
  zoom: 10,
  attributionControl: { compact: true },
});
let mapReady = false;
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
const geolocate = new GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  showUserLocation: true,
});
map.addControl(geolocate, "top-right");
geolocate.on("geolocate", (pos) => {
  setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude }, true);
});

// Keep MapLibre's corner controls clear of the app chrome: the topbar's height
// (safe-area inset, wrapping) and the phone bottom sheet's height both vary.
const topbarEl = document.getElementById("topbar")!;
const panelEl = document.getElementById("panel")!;
const chromeObserver = new ResizeObserver(() => {
  const root = document.documentElement.style;
  root.setProperty("--topbar-h", `${topbarEl.offsetHeight}px`);
  root.setProperty("--panel-h", `${panelEl.offsetHeight}px`);
});
chromeObserver.observe(topbarEl);
chromeObserver.observe(panelEl);

const originEl = document.createElement("div");
originEl.className = "origin-marker";
originEl.title = "Watch-from area origin (drag to move)";
const originMarker = new Marker({ element: originEl, draggable: true })
  .setLngLat([state.loc.lon, state.loc.lat])
  .addTo(map);
originMarker.on("dragend", () => {
  const ll = originMarker.getLngLat();
  setLocation({ lat: ll.lat, lon: ll.lng }, false);
});

// After a search: clicking inside the searched ring inspects the nearest
// scored point (the popup offers "search from here"); clicking outside, or
// before any search / after Clear, moves the origin.
interface LastSearch {
  centre: LatLon;
  radiusM: number;
  spacingM: number;
  points: ScorePoint[];
}
let lastSearch: LastSearch | null = null;
let inspectPopup: Popup | null = null;

map.on("click", (e) => {
  const click = { lat: e.lngLat.lat, lon: e.lngLat.lng };
  if (lastSearch) {
    const { centre, radiusM, spacingM, points } = lastSearch;
    const distTo = (p: LatLon) => flatDistanceM(click, p);
    if (distTo(centre) <= radiusM * 1.05) {
      let best: ScorePoint | null = null;
      let bestD = spacingM;
      for (const p of points) {
        const d = distTo(p);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) {
        const v = verdict(best.obstructionDeg);
        inspectPopup?.remove();
        inspectPopup = new Popup({ closeButton: false })
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong>${v.label}</strong><br>` +
              `Horizon ${(best.horizonDistM / 1000).toFixed(1)} km away · ${formatAngle(best.obstructionDeg)}<br>` +
              `<a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${best.lat.toFixed(6)},${best.lon.toFixed(6)}">Directions ↗</a>` +
              ` · <a href="#" class="move-here">Search from here</a>`
          )
          .addTo(map);
        inspectPopup
          .getElement()
          .querySelector<HTMLAnchorElement>(".move-here")
          ?.addEventListener("click", (evt) => {
            evt.preventDefault();
            setLocation(click, false);
          });
        drawSightline(best, { lat: best.horizonLat, lon: best.horizonLon });
      }
      return;
    }
  }
  setLocation(click, false);
});

// ---------- azimuth lines (PhotoPills-style: every event at once) ----------

const EVENT_COLORS: Record<EventKind, string> = {
  sunrise: "#f2b400",
  sunset: "#ef7d1a",
  moonrise: "#8fb8f6",
  moonset: "#4d6fd0",
};

/** Ray-march reach; the drawn azimuth lines match it. */
const RAY_REACH_M = 120_000;
/** False when the centre ray ran out at the reach limit without meeting terrain. */
const hitTerrain = (r: CandidateResult) => r.horizonDistM < RAY_REACH_M * 0.99;
const AZIMUTH_LAYERS = ["azimuth-golden", "azimuth-spread", "azimuth-lines"];
/** Vector overlays that must stay readable above the (re-added) score raster. */
const OVERLAY_LAYERS = [...AZIMUTH_LAYERS, "sightline-line", "sightline-point", "sightline-label"];

function azimuthLine(azDeg: number, kind: EventKind, spread: boolean): Feature {
  const end = destination(state.loc, RAY_REACH_M, azDeg);
  return {
    type: "Feature",
    properties: { kind, spread, selected: kind === state.kind },
    geometry: {
      type: "LineString",
      coordinates: [
        [state.loc.lon, state.loc.lat],
        [end.lon, end.lat],
      ],
    },
  };
}

/** Pie-slice from the origin sweeping the shorter arc between two azimuths. */
function azimuthSector(azA: number, azB: number, kind: EventKind): Feature {
  const delta = ((azB - azA + 540) % 360) - 180;
  const steps = Math.max(2, Math.ceil(Math.abs(delta) / 2));
  const ring: [number, number][] = [[state.loc.lon, state.loc.lat]];
  for (let i = 0; i <= steps; i++) {
    const p = destination(state.loc, RAY_REACH_M, azA + (delta * i) / steps);
    ring.push([p.lon, p.lat]);
  }
  ring.push([state.loc.lon, state.loc.lat]);
  return {
    type: "Feature",
    properties: { kind },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

function drawAzimuth(): void {
  // The layers need the style; the load handler re-invokes us.
  if (!map.isStyleLoaded() && !map.getSource("azimuth")) return;

  const lines: Feature[] = [];
  const sectors: Feature[] = [];
  for (const kind of EVENT_KINDS) {
    const ev = state.events[kind];
    if (!ev) continue;
    lines.push(azimuthLine(ev.azimuthDeg, kind, false));
    if (kind === state.kind) {
      // Search wedge: matches the ±spreadDeg the scorer uses.
      lines.push(azimuthLine(ev.azimuthDeg - 8, kind, true));
      lines.push(azimuthLine(ev.azimuthDeg + 8, kind, true));
    }
    const gh = state.golden[kind];
    if (gh) sectors.push(azimuthSector(gh.startAzDeg, gh.endAzDeg, kind));
  }

  const lineData = { type: "FeatureCollection", features: lines } as FeatureCollection;
  const sectorData = { type: "FeatureCollection", features: sectors } as FeatureCollection;
  const lineSrc = map.getSource("azimuth") as maplibregl.GeoJSONSource | undefined;
  if (lineSrc) {
    lineSrc.setData(lineData);
    (map.getSource("azimuth-golden") as maplibregl.GeoJSONSource).setData(sectorData);
    return;
  }

  const lineColor = [
    "match",
    ["get", "kind"],
    "sunrise",
    EVENT_COLORS.sunrise,
    "sunset",
    EVENT_COLORS.sunset,
    "moonrise",
    EVENT_COLORS.moonrise,
    EVENT_COLORS.moonset,
  ] as never;

  map.addSource("azimuth", { type: "geojson", data: lineData });
  map.addSource("azimuth-golden", { type: "geojson", data: sectorData });
  // Golden-hour azimuth swing, under the lines.
  map.addLayer({
    id: "azimuth-golden",
    type: "fill",
    source: "azimuth-golden",
    paint: { "fill-color": "#eda100", "fill-opacity": 0.12 },
  });
  map.addLayer({
    id: "azimuth-spread",
    type: "line",
    source: "azimuth",
    filter: ["get", "spread"],
    paint: {
      "line-color": lineColor,
      "line-width": 1,
      "line-opacity": 0.35,
      "line-dasharray": [2, 2],
    },
  });
  map.addLayer({
    id: "azimuth-lines",
    type: "line",
    source: "azimuth",
    filter: ["!", ["get", "spread"]],
    paint: {
      "line-color": lineColor,
      "line-width": ["case", ["get", "selected"], 2.5, 1.5] as never,
      "line-opacity": ["case", ["get", "selected"], 0.9, 0.55] as never,
    },
  });
}

// ---------- sightline (spot → the skyline point the event happens behind) ----------

function drawSightline(from: LatLon, to: LatLon, name?: string | null): void {
  const color = EVENT_COLORS[state.kind];
  const data: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [from.lon, from.lat],
            [to.lon, to.lat],
          ],
        },
      },
      {
        type: "Feature",
        properties: { name: name ?? "" },
        geometry: { type: "Point", coordinates: [to.lon, to.lat] },
      },
    ],
  };
  const src = map.getSource("sightline") as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
  } else {
    map.addSource("sightline", { type: "geojson", data });
    map.addLayer({
      id: "sightline-line",
      type: "line",
      source: "sightline",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-width": 2, "line-dasharray": [1.5, 1.5], "line-opacity": 0.85 },
    });
    map.addLayer({
      id: "sightline-point",
      type: "circle",
      source: "sightline",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 5,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
    map.addLayer({
      id: "sightline-label",
      type: "symbol",
      source: "sightline",
      filter: ["==", ["geometry-type"], "Point"],
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 12,
        "text-offset": [0, -1.3],
        "text-anchor": "bottom",
        "text-optional": true,
      },
      paint: { "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
    });
  }
  // Track the selected event's color (layers persist across event switches).
  map.setPaintProperty("sightline-line", "line-color", color);
  map.setPaintProperty("sightline-point", "circle-color", color);
  map.setPaintProperty("sightline-label", "text-color", color);
}

function clearSightline(): void {
  const src = map.getSource("sightline") as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData({ type: "FeatureCollection", features: [] });
}

// ---------- UI elements ----------

const eventsNav = document.getElementById("events")!;
const resultsEl = document.getElementById("results")!;
const statusEl = document.getElementById("status")!;
const goBtn = document.getElementById("go") as HTMLButtonElement;
const clearBtn = document.getElementById("clear") as HTMLButtonElement;
const radiusInput = document.getElementById("radius") as HTMLInputElement;
const radiusValue = document.getElementById("radius-value")!;
const modeBtns = [...document.querySelectorAll<HTMLButtonElement>("#modes button")];

/** Toggle-button state, kept in sync for styling and assistive tech. */
function setPressed(btn: HTMLButtonElement, on: boolean): void {
  btn.classList.toggle("active", on);
  btn.setAttribute("aria-pressed", String(on));
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayTimeFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

function eventLabel(kind: EventKind): string {
  return { sunrise: "Sunrise", sunset: "Sunset", moonrise: "Moonrise", moonset: "Moonset" }[kind];
}

function formatAngle(deg: number): string {
  return deg <= 0
    ? `${Math.abs(deg).toFixed(2)}° dip below flat`
    : `${deg.toFixed(2)}° terrain obstruction`;
}

/** Idle status line: when to be there for the selected event's golden hour. */
function showEventStatus(): void {
  if (state.searching) return;
  const gh = state.golden[state.kind];
  statusEl.textContent = gh
    ? `Golden hour ${timeFmt.format(gh.start)}–${timeFmt.format(gh.end)}`
    : "";
}

function renderEventPicker(): void {
  eventsNav.innerHTML = "";
  for (const kind of EVENT_KINDS) {
    const ev = state.events[kind];
    const btn = document.createElement("button");
    setPressed(btn, kind === state.kind);
    const extra =
      ev?.moonIllumination !== undefined ? ` · ${Math.round(ev.moonIllumination * 100)}%` : "";
    btn.innerHTML =
      `<span class="dot" style="background:${EVENT_COLORS[kind]}"></span>${eventLabel(kind)}` +
      `<span class="t">${ev ? dayTimeFmt.format(ev.time) + extra : "—"}</span>`;
    btn.disabled = !ev;
    btn.addEventListener("click", () => {
      if (kind === state.kind) return;
      state.kind = kind;
      clearResults(); // results were scored along the old event's azimuth
      renderEventPicker();
      drawAzimuth();
      showEventStatus();
      writeHash();
    });
    eventsNav.appendChild(btn);
  }
}

function refreshEvents(): void {
  state.events = nextEvents(state.loc.lat, state.loc.lon, baseTime());
  state.golden = {};
  for (const kind of ["sunrise", "sunset"] as EventKind[]) {
    const ev = state.events[kind];
    if (!ev) continue;
    const gh = goldenHourSpan(kind, state.loc.lat, state.loc.lon, ev.time);
    if (gh) state.golden[kind] = gh;
  }
  if (!state.events[state.kind]) {
    const firstAvailable = EVENT_KINDS.find((k) => state.events[k]);
    if (firstAvailable) state.kind = firstAvailable;
  }
  renderEventPicker();
  drawAzimuth();
  showEventStatus();
}

/** Blank slate: drop everything the last search drew and listed. */
function clearResults(): void {
  lastSearch = null;
  inspectPopup?.remove();
  inspectPopup = null;
  clearSpotMarkers();
  clearSightline();
  clearHeatmap(map);
  resultsEl.innerHTML = "";
  clearBtn.hidden = true;
}

clearBtn.addEventListener("click", () => {
  clearResults();
  showEventStatus();
});

function setLocation(loc: LatLon, pan: boolean): void {
  state.loc = loc;
  clearResults(); // results were for the old origin
  originMarker.setLngLat([loc.lon, loc.lat]);
  if (pan) map.flyTo({ center: [loc.lon, loc.lat], zoom: Math.max(map.getZoom(), 10) });
  refreshEvents();
  writeHash();
}

for (const btn of modeBtns) {
  btn.addEventListener("click", () => {
    state.mode = btn.dataset.mode as TravelMode;
    state.radiusKm = MODE_DEFAULT_KM[state.mode];
    radiusInput.value = String(state.radiusKm);
    syncRadiusLabel();
    modeBtns.forEach((b) => setPressed(b, b === btn));
    writeHash();
  });
}
radiusInput.addEventListener("input", () => {
  state.radiusKm = Number(radiusInput.value);
  syncRadiusLabel();
  writeHash();
});
function syncRadiusLabel(): void {
  radiusValue.textContent = `${state.radiusKm} km`;
}

const dateInput = document.getElementById("date") as HTMLInputElement;
dateInput.min = todayStr();
dateInput.addEventListener("change", () => {
  state.date = dateInput.value && dateInput.value !== todayStr() ? dateInput.value : "";
  clearResults();
  refreshEvents();
  writeHash();
});

// Reflect initial (possibly hash-loaded) state into controls.
radiusInput.value = String(state.radiusKm);
syncRadiusLabel();
modeBtns.forEach((b) => setPressed(b, b.dataset.mode === state.mode));
dateInput.value = state.date || todayStr();

// ---------- search ----------

const worker = new Worker(new URL("./search/worker.ts", import.meta.url), { type: "module" });
let requestId = 0;

type SearchReply = Extract<WorkerMessage, { type: "result" }>;
type RingReply = Extract<WorkerMessage, { type: "ringResult" }>;
type ProgressPhase = Extract<WorkerMessage, { type: "progress" }>["phase"];

/**
 * Post a request to the worker and settle on its reply: progress messages go
 * to `onProgress`, the terminal message resolves, and a worker error (in the
 * request or in the script itself) rejects rather than leaving the search
 * hanging with the button disabled.
 */
function askWorker<R extends WorkerMessage>(
  req: SearchRequest | RingRequest,
  onProgress: (phase: ProgressPhase, done: number, total: number) => void
): Promise<R> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("message", onMsg);
      worker.removeEventListener("error", onErr);
    };
    const onMsg = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.requestId !== req.requestId) return;
      if (m.type === "progress") {
        onProgress(m.phase, m.done, m.total);
        return;
      }
      cleanup();
      if (m.type === "error") reject(new Error(`search worker: ${m.message}`));
      else resolve(m as R);
    };
    const onErr = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(`search worker: ${e.message}`));
    };
    worker.addEventListener("message", onMsg);
    worker.addEventListener("error", onErr);
    worker.postMessage(req);
  });
}

function zoomForRadius(radiusM: number): number {
  if (radiusM <= 4000) return 12;
  if (radiusM <= 15_000) return 11;
  return 10;
}

/** Largest ring we fetch building footprints for (Overpass payload ceiling). */
const BUILDINGS_MAX_RADIUS_M = 8000;

// Stage-2 sky ring: a full-circle profile for the ranking finalists only.
// 24 rays on every candidate would be an 8× blowup over the whole field;
// over ~50 finalists it's under a quarter of the stage-1 ray work.
const RING_RAY_COUNT = 24;
const RING_MAX_DIST_M = 30_000;
const RING_POI_FINALISTS = 30;
const RING_GRID_FINALISTS = 20;

interface RankedSpot {
  candidate: Candidate;
  result: CandidateResult;
  score: number;
  rank: number;
  flag?: string;
  /** Named skyline feature the event happens behind; filled in async. */
  skyline?: SkylineFeature | null;
  /** Full-circle sky profile (finalists only; absent if the ring failed). */
  sky?: SkyOpenness;
  skyAngles?: number[];
}

goBtn.addEventListener("click", () => void runSearch());

async function runSearch(): Promise<void> {
  const ev = state.events[state.kind];
  if (!ev || state.searching) return;
  state.searching = true;
  goBtn.disabled = true;
  try {
    await search(ev);
  } catch (err) {
    console.error(err);
    statusEl.textContent = "⚠ Search failed — try again in a moment.";
  } finally {
    state.searching = false;
    goBtn.disabled = false;
  }
}

async function search(ev: SkyEvent): Promise<void> {
  // Results draw onto the basemap; a tap before the style has loaded waits for it.
  if (!mapReady) await new Promise<void>((resolve) => map.once("load", () => resolve()));
  clearResults();
  statusEl.textContent = "Looking up places worth going (OpenStreetMap)…";

  const radiusM = state.radiusKm * 1000;
  const grid = gridCandidates(state.loc, radiusM);
  const { pois, ok: poisOk } = await fetchPois(state.loc, radiusM, state.mode);
  statusEl.textContent = pois.length
    ? `Found ${pois.length} mapped places — fetching terrain…`
    : poisOk
      ? "No mapped places nearby — scoring open terrain…"
      : "⚠ Place lookup (Overpass) unavailable — scoring open terrain only…";

  const candidates: Candidate[] = [...grid, ...pois];
  const req: SearchRequest = {
    type: "search",
    requestId: ++requestId,
    origin: state.loc,
    radiusM,
    azimuthDeg: ev.azimuthDeg,
    spreadDeg: 8,
    maxDistM: RAY_REACH_M,
    zoom: zoomForRadius(radiusM),
    eyeHeightM: 2,
    // Town-scale only: buildings matter angularly only up close, and a
    // drive-scale bbox over a metro is more than Overpass will serve.
    buildings: radiusM <= BUILDINGS_MAX_RADIUS_M,
    candidates: candidates.map((c) => ({ id: c.id, lat: c.lat, lon: c.lon })),
  };

  const { results, buildingCount } = await askWorker<SearchReply>(req, (phase, done, total) => {
    statusEl.textContent =
      phase === "tiles"
        ? `Fetching elevation tiles… ${done}/${total}`
        : `Scoring horizons… ${done}/${total}`;
  });

  await presentResults(candidates, results, ev, radiusM, poisOk, buildingCount, req.requestId);
}

/**
 * Full-circle sky profiles for the finalists (tiles/buildings stay cached).
 * Stage 2 is a refinement: on failure this returns an empty map and the
 * ranking stands on stage-1 scores.
 */
async function fetchSkyRings(
  finalists: { candidate: Candidate }[],
  azimuthDeg: number,
  searchRequestId: number,
  radiusM: number
): Promise<Map<string, number[]>> {
  if (!finalists.length) return new Map();
  const req: RingRequest = {
    type: "ring",
    requestId: ++requestId,
    searchRequestId,
    azimuthDeg,
    rayCount: RING_RAY_COUNT,
    maxDistM: RING_MAX_DIST_M,
    zoom: zoomForRadius(radiusM),
    eyeHeightM: 2,
    candidates: finalists.map((x) => ({
      id: x.candidate.id,
      lat: x.candidate.lat,
      lon: x.candidate.lon,
    })),
  };
  try {
    const reply = await askWorker<RingReply>(req, (phase, done, total) => {
      statusEl.textContent =
        phase === "tiles"
          ? `Checking open sky — fetching tiles… ${done}/${total}`
          : `Checking open sky at the best spots… ${done}/${total}`;
    });
    return new Map(reply.results.map((r) => [r.id, r.angles]));
  } catch (err) {
    console.error(err);
    return new Map();
  }
}

async function presentResults(
  candidates: Candidate[],
  results: CandidateResult[],
  ev: SkyEvent,
  radiusM: number,
  poisOk: boolean,
  buildingCount: number | null,
  searchRequestId: number
): Promise<void> {
  const byId = new Map(results.map((r) => [r.id, r]));
  type Scored = {
    candidate: Candidate;
    result: CandidateResult;
    score: number;
    flags: string[];
    sky?: SkyOpenness;
    skyAngles?: number[];
  };
  const scored: Scored[] = candidates
    .map((c) => ({ candidate: c, result: byId.get(c.id) }))
    .filter((x): x is { candidate: Candidate; result: CandidateResult } => !!x.result)
    .map((x) => ({
      ...x,
      score: score({ obstructionDeg: x.result.obstructionDeg, horizonDistM: x.result.horizonDistM }),
      flags: [],
    }));

  const gridScored = scored.filter((x) => x.candidate.source === "grid");
  const poiScored = scored.filter((x) => x.candidate.source !== "grid");

  // Heatmap shows raw terrain quality (before reachability adjustments),
  // stretched to the local score distribution.
  const heatPoints: ScorePoint[] = gridScored.map((x) => ({
    lat: x.candidate.lat,
    lon: x.candidate.lon,
    score: x.score,
    obstructionDeg: x.result.obstructionDeg,
    horizonDistM: x.result.horizonDistM,
    horizonLat: x.result.horizonLat,
    horizonLon: x.result.horizonLon,
  }));
  const stats = renderHeatmap(map, heatPoints, gridSpacingM(radiusM), state.loc, radiusM);
  lastSearch = {
    centre: state.loc,
    radiusM,
    spacingM: gridSpacingM(radiusM),
    points: heatPoints,
  };
  // Keep the direction lines and sightline readable above the score surface.
  for (const id of OVERLAY_LAYERS) {
    if (map.getLayer(id)) map.moveLayer(id);
  }

  // Reachability reality check (drive/bike): a spot far from any mapped road
  // is a hike, not a stop. Applies to ALL candidates before ranking — a remote
  // 13er tagged natural=peak is exactly what this must catch.
  const roads = buildRoadIndex(map, state.mode);
  const excluded = new Set<Scored>();
  if (roads) {
    const bands = roadBandsM(state.mode);
    for (const x of [...gridScored, ...poiScored]) {
      const d = roads.nearestRoadM(x.candidate);
      if (d === null || d > bands.exclude) {
        excluded.add(x); // not reachable in this travel mode; heatmap still shows it
      } else if (d > bands.flag) {
        x.score -= 0.75;
        x.flags.push(`~${(d / 1000).toFixed(1)} km walk from nearest mapped road`);
      }
    }
  }

  const byPoiRank = (a: Scored, b: Scored) =>
    b.score + 0.4 * b.candidate.weight - (a.score + 0.4 * a.candidate.weight);
  const byScore = (a: Scored, b: Scored) => b.score - a.score;
  const poiFinalists = poiScored
    .filter((x) => !excluded.has(x))
    .sort(byPoiRank)
    .slice(0, RING_POI_FINALISTS);
  const gridFinalists = gridScored
    .filter((x) => !excluded.has(x))
    .sort(byScore)
    .slice(0, RING_GRID_FINALISTS);

  // Stage 2: near mountains the exact sun line being blocked is forgivable —
  // seeing most of the horizon is what makes a spot great. March a full sky
  // ring for the finalists and re-rank on openness before the final pick.
  const rings = await fetchSkyRings(
    [...poiFinalists, ...gridFinalists],
    ev.azimuthDeg,
    searchRequestId,
    radiusM
  );
  const ringAzs = ringAzimuths(ev.azimuthDeg, RING_RAY_COUNT);
  for (const x of [...poiFinalists, ...gridFinalists]) {
    const angles = rings.get(x.candidate.id);
    if (!angles || !angles.length) continue;
    x.skyAngles = angles;
    x.sky = skyOpenness(angles, ringAzs, ev.azimuthDeg);
    x.score += opennessDelta(x.result.obstructionDeg, x.sky.openness);
  }

  // POIs first (real, named places), then best open-terrain grid cells.
  const poiTop = pickSpread(poiFinalists.sort(byPoiRank), 5, 250);
  const gridTop = pickSpread(
    gridFinalists.sort(byScore),
    3,
    Math.max(1200, gridSpacingM(radiusM) * 1.7)
  );

  // Landcover reality-check for raw terrain picks (POIs exempt: a mapped
  // viewpoint inside forest is usually a cleared overlook).
  for (const x of gridTop) {
    const eff = landcoverAt(map, x.candidate);
    if (eff) {
      x.score += eff.scoreDelta;
      if (eff.flag) x.flags.push(eff.flag);
    }
  }
  gridTop.sort((a, b) => b.score - a.score);

  const spots: RankedSpot[] = [...poiTop, ...gridTop].map((x, i) => ({
    candidate: x.candidate,
    result: x.result,
    score: x.score,
    flag: x.flags.join(" · ") || undefined,
    rank: i + 1,
    sky: x.sky,
    skyAngles: x.skyAngles,
  }));

  renderSpotMarkers(
    map,
    spots.map((s) => ({
      lat: s.candidate.lat,
      lon: s.candidate.lon,
      rank: s.rank,
      isPoi: s.candidate.source !== "grid",
    })),
    (rank) => {
      document.getElementById(`spot-${rank}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  );

  statusEl.textContent = spots.length
    ? `${eventLabel(state.kind)} at ${timeFmt.format(ev.time)}, azimuth ${Math.round(ev.azimuthDeg)}°. Top spots within ${state.radiusKm} km:`
    : "No results — try a larger radius.";

  resultsEl.innerHTML = "";
  if (stats) {
    const legend = document.createElement("div");
    legend.id = "legend";
    const note =
      stats.p50 < -1
        ? "Terrain blocks the view everywhere near you — colors compare spots relatively."
        : "Colors compare spots relative to your area.";
    legend.innerHTML = `<div class="bar"></div><div class="labels"><span>worse</span><span>${note}</span><span>better</span></div>`;
    resultsEl.appendChild(legend);
  }
  if (!poisOk) {
    const warn = document.createElement("div");
    warn.className = "warn";
    warn.textContent =
      "⚠ OpenStreetMap place lookup is unavailable right now — results below are raw terrain only (access unverified). Try again in a minute for named places.";
    resultsEl.appendChild(warn);
  }
  if (buildingCount === null) {
    const warn = document.createElement("div");
    warn.className = "warn";
    warn.textContent =
      "⚠ Building data (Overpass) unavailable right now — scores ignore buildings, so streets and blocks look more open than they are.";
    resultsEl.appendChild(warn);
  }
  const cards = spots.map((s) => spotCard(s, ev));
  for (const card of cards) resultsEl.appendChild(card);
  clearBtn.hidden = false;
  void annotateSkylines(spots, cards);
}

/**
 * Fill in what the event happens behind — "behind Methodist Mountain" — for
 * the ranked spots, one batched Overpass query after cards render. Pure
 * decoration: Overpass down or nothing named nearby just leaves cards as-is.
 */
async function annotateSkylines(spots: RankedSpot[], cards: HTMLElement[]): Promise<void> {
  // horizonDistM pinned at the ray limit means the ray never hit real
  // terrain — no feature to name.
  const eligible = spots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => hitTerrain(s.result));
  const names = await nameSkylinePoints(
    eligible.map(({ s }) => ({ lat: s.result.horizonLat, lon: s.result.horizonLon }))
  );
  names.forEach((f, j) => {
    const { s, i } = eligible[j];
    s.skyline = f;
    if (!f || !cards[i].isConnected) return;
    const el = cards[i].querySelector(".skyline");
    if (el) {
      const ele = f.eleM !== undefined ? ` (${Math.round(f.eleM).toLocaleString()} m)` : "";
      el.textContent = ` · behind ${f.name}${ele}`;
    }
  });
}

/** Greedy top-N with a minimum separation so picks don't cluster. */
function pickSpread<T extends { candidate: Candidate }>(
  sorted: T[],
  n: number,
  minSepM: number
): T[] {
  const picked: T[] = [];
  for (const x of sorted) {
    if (picked.length >= n) break;
    const tooClose = picked.some((p) => flatDistanceM(p.candidate, x.candidate) < minSepM);
    if (!tooClose) picked.push(x);
  }
  return picked;
}

/**
 * Compass-rose glyph of the sky ring: one spoke per marched azimuth, north
 * up, open directions bright, blocked ones dim, the event direction in its
 * PhotoPills color.
 */
function skyRingSvg(angles: number[], eventAzimuthDeg: number, openSkyDeg: number): string {
  const size = 30;
  const c = size / 2;
  const spoke = (azDeg: number, r1: number, r2: number): string => {
    const a = (azDeg * Math.PI) / 180;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    return `x1="${(c + r1 * sin).toFixed(1)}" y1="${(c - r1 * cos).toFixed(1)}" x2="${(c + r2 * sin).toFixed(1)}" y2="${(c - r2 * cos).toFixed(1)}"`;
  };
  const spokes = ringAzimuths(eventAzimuthDeg, angles.length)
    .map((az, i) => `<line ${spoke(az, 6, 13)} class="${angles[i] < OPEN_SKY_MAX_DEG ? "open" : "blocked"}"/>`)
    .join("");
  const eventSpoke = `<line ${spoke(eventAzimuthDeg, 3.5, 14.5)} stroke="${EVENT_COLORS[state.kind]}" stroke-width="2" stroke-linecap="round"/>`;
  const label = `${Math.round(openSkyDeg)}° of open horizon (north up)`;
  return `<svg class="skyring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}"><title>${label}</title>${spokes}${eventSpoke}</svg>`;
}

function spotCard(s: RankedSpot, ev: SkyEvent): HTMLElement {
  const c = s.candidate;
  const v = verdict(s.result.obstructionDeg);
  const isPoi = c.source !== "grid";
  const name = c.name ?? (isPoi ? c.label! : "Open terrain");
  const chip = isPoi ? c.label! : "access unverified";

  const localTime = eventTimeAt(state.kind, c.lat, c.lon, ev.time) ?? ev.time;
  const obstructed = obstructedEventTime(state.kind, c.lat, c.lon, localTime, s.result.obstructionDeg);
  const timeNote = obstructed
    ? state.kind.endsWith("set")
      ? ` (drops behind terrain ~${timeFmt.format(obstructed)})`
      : ` (clears terrain ~${timeFmt.format(obstructed)})`
    : "";

  const el = document.createElement("article");
  el.className = "spot-card";
  el.id = `spot-${s.rank}`;
  const skySvg =
    s.sky && s.skyAngles ? skyRingSvg(s.skyAngles, ev.azimuthDeg, s.sky.openSkyDeg) : "";
  const skyNote = s.sky ? ` · ${Math.round(s.sky.openSkyDeg)}° open sky` : "";
  el.innerHTML = `
    <div class="head">
      <span class="rank">${s.rank}</span>
      <span class="name"></span>
      <span class="chip"></span>
      ${skySvg}
    </div>
    <div class="verdict g${v.grade}"></div>
    <div class="detail">
      Horizon ${(s.result.horizonDistM / 1000).toFixed(1)} km away · ${formatAngle(s.result.obstructionDeg)}${skyNote}<span class="skyline"></span><br>
      ${eventLabel(state.kind)} ${timeFmt.format(localTime)}${timeNote} · elevation ${Math.round(s.result.groundM)} m
    </div>
    ${s.flag ? `<div class="flag"></div>` : ""}
    <div class="actions">
      <a target="_blank" rel="noopener"
         href="https://www.google.com/maps/dir/?api=1&destination=${c.lat.toFixed(6)},${c.lon.toFixed(6)}">Directions ↗</a>
    </div>`;
  el.querySelector(".name")!.textContent = name;
  el.querySelector(".chip")!.textContent = chip;
  el.querySelector(".verdict")!.textContent = v.label;
  if (s.flag) el.querySelector(".flag")!.textContent = `⚠ ${s.flag}`;
  el.querySelector(".head")!.addEventListener("click", () => {
    if (hitTerrain(s.result)) {
      // Show the spot AND what it looks toward — frames the skyline ridge.
      drawSightline(
        c,
        { lat: s.result.horizonLat, lon: s.result.horizonLon },
        s.skyline?.name
      );
      const b = new maplibregl.LngLatBounds([c.lon, c.lat], [c.lon, c.lat]);
      b.extend([s.result.horizonLon, s.result.horizonLat]);
      map.fitBounds(b, { padding: 80, maxZoom: 13 });
    } else {
      map.flyTo({ center: [c.lon, c.lat], zoom: Math.max(map.getZoom(), 13) });
    }
  });
  return el;
}

// ---------- boot ----------

// Events don't depend on the map — compute immediately so the picker works
// even while (or if) the basemap is still loading.
refreshEvents();
map.on("load", () => {
  mapReady = true;
  drawAzimuth();
});
// A shared link should land on results, not a blank slate asking for a tap.
// The hash restores only the inputs (results are computed live), so run the
// search the link describes. search() itself waits for the basemap.
if (openedFromHash) void runSearch();
