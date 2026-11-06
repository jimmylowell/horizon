import type { Feature, FeatureCollection } from "geojson";
import maplibregl, { GeolocateControl, Map as MapLibreMap, Marker, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

import {
  EVENT_KINDS,
  azimuthAtTime,
  eventTimeAt,
  goldenHourSpan,
  nextEvents,
  obstructionEffect,
  type EventKind,
  type GoldenHourSpan,
  type ObstructionEffect,
  type SkyEvent,
} from "./astro";
import { destination, flatDistanceM, type LatLon } from "./geo";
import { ringAzimuths } from "./elevation/horizon";
import { repairBasemapStyle } from "./render/basemap";
import { clearHeatmap, renderHeatmap, type ScorePoint } from "./render/heatmap";
import { clearSpotMarkers, renderSpotMarkers } from "./render/spots";
import { gridCandidates, gridSpacingM, type Candidate } from "./search/grid";
import { nameSkylinePoints, type SkylineFeature } from "./search/horizonFeature";
import { landcoverAt } from "./search/landcover";
import { verdict, VERDICT_MARGIN_MIN, VERDICT_MAX_CARDS } from "./search/verdict";
import { resultNotes } from "./render/notes";
import { noDataFlag, spotReading } from "./search/reading";
import { AWAY_SPREAD_DEG, awayAzimuth, awayGainVsHere, awayReading, canFaceAway } from "./search/away";
import { fetchOsmCandidates } from "./search/osm";
import type { TravelMode } from "./search/pois";
import { buildRoadIndex, roadBandsM } from "./search/roads";
import {
  OPEN_SKY_MAX_DEG,
  lostGrade,
  opennessDelta,
  score,
  skyOpenness,
  type SkyOpenness,
} from "./search/score";
import type {
  CandidateResult,
  ProbeRequest,
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
  /** Which sky the search is for: toward the sun, or the sky opposite it (sun events only). */
  facing: "sun" | "away";
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
  facing: "sun",
};

/** True when the search looks at the sky opposite the sun (src/search/away.ts). */
function facingAway(): boolean {
  return state.facing === "away" && canFaceAway(state.kind);
}
/** Bearing the rays are marched along: the event, or straight opposite it. */
function lookAzimuth(ev: SkyEvent): number {
  return facingAway() ? awayAzimuth(ev.azimuthDeg) : ev.azimuthDeg;
}
/** Half-width of the fan: ±8° on the event line, ±30° over the sky opposite. */
function lookSpread(): number {
  return facingAway() ? AWAY_SPREAD_DEG : 8;
}

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

// Permalink: #lat,lon,kind,mode,radius[,date][,away]
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
    if (m.slice(5).includes("away")) state.facing = "away";
  }
}
function writeHash(): void {
  const date = state.date && state.date !== todayStr() ? `,${state.date}` : "";
  history.replaceState(
    null,
    "",
    `#${state.loc.lat.toFixed(5)},${state.loc.lon.toFixed(5)},${state.kind},${state.mode},${state.radiusKm}${date}${facingAway() ? ",away" : ""}`
  );
}

readHash();

// ---------- map ----------

const map = new MapLibreMap({
  container: "map",
  center: [state.loc.lon, state.loc.lat],
  zoom: 10,
  attributionControl: { compact: true },
});
// Set after construction so the fetched style can be repaired before it is
// committed (render/basemap.ts: null-safe number filters).
map.setStyle("https://tiles.openfreemap.org/styles/liberty", { transformStyle: repairBasemapStyle });
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
  ev: SkyEvent;
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
        const ev = lastSearch.ev;
        const eff = obstructionEffect(ev.kind, best.lat, best.lon, ev.time, best.obstructionDeg);
        const v = facingAway() ? awayReading(best.obstructionDeg, false) : effectLabel(ev.kind, eff);
        const gain = gainVsHere(eff);
        inspectPopup?.remove();
        inspectPopup = new Popup({ closeButton: false })
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong class="g${v.grade}">${v.label}</strong>${gain ? ` <span class="gain ${gain.cls}">${gain.text}</span>` : ""}<br>` +
              `Ridge ${formatAngle(best.obstructionDeg)}, ${(best.horizonDistM / 1000).toFixed(1)} km away<br>` +
              `<a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${best.lat.toFixed(6)},${best.lon.toFixed(6)}">Directions ↗</a>` +
              ` · <a href="#" class="move-here">Check from here</a>`
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
const hitTerrain = (r: { horizonDistM: number }) => r.horizonDistM < RAY_REACH_M * 0.99;
const AZIMUTH_LAYERS = ["azimuth-golden", "azimuth-spread", "azimuth-lines"];
/** Two sightlines: the origin's own ("here") and the selected spot's. */
const SIGHTLINE_KEYS = ["here-sightline", "sightline"] as const;
type SightlineKey = (typeof SIGHTLINE_KEYS)[number];
/** Vector overlays that must stay readable above the (re-added) score raster. */
const OVERLAY_LAYERS = [
  ...AZIMUTH_LAYERS,
  ...SIGHTLINE_KEYS.flatMap((k) => [`${k}-line`, `${k}-point`, `${k}-label`]),
];

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
      // Search wedge: matches the ±spreadDeg the scorer uses, toward the
      // event or, facing away, over the sky opposite it.
      const az = lookAzimuth(ev);
      if (facingAway()) lines.push(azimuthLine(az, kind, false));
      lines.push(azimuthLine(az - lookSpread(), kind, true));
      lines.push(azimuthLine(az + lookSpread(), kind, true));
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

function drawSightline(
  from: LatLon,
  to: LatLon,
  name?: string | null,
  key: SightlineKey = "sightline"
): void {
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
  const src = map.getSource(key) as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
  } else {
    map.addSource(key, { type: "geojson", data });
    map.addLayer({
      id: `${key}-line`,
      type: "line",
      source: key,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-width": 2, "line-dasharray": [1.5, 1.5], "line-opacity": 0.85 },
    });
    map.addLayer({
      id: `${key}-point`,
      type: "circle",
      source: key,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 5,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
    map.addLayer({
      id: `${key}-label`,
      type: "symbol",
      source: key,
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
  map.setPaintProperty(`${key}-line`, "line-color", color);
  map.setPaintProperty(`${key}-point`, "circle-color", color);
  map.setPaintProperty(`${key}-label`, "text-color", color);
}

function clearSightline(key: SightlineKey = "sightline"): void {
  const src = map.getSource(key) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData({ type: "FeatureCollection", features: [] });
}

// ---------- UI elements ----------

const eventsNav = document.getElementById("events")!;
const hereEl = document.getElementById("here")!;
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
    ? `${Math.abs(deg).toFixed(1)}° below flat (you're above it)`
    : `${deg.toFixed(1)}° above flat`;
}

/**
 * The verdict, in the unit that matters: minutes of the rise/set lost to the
 * ridge. "Blocked by terrain" at 3° is nonsense for a moonrise — the show is
 * the moon clearing the ridge, 20 minutes late.
 */
function effectLabel(
  kind: EventKind,
  eff: ObstructionEffect,
  noData = false
): { label: string; grade: number | "u" } {
  // Missing terrain toward the event is "unknown", never "open" (salida-test.md, finding 7).
  return spotReading({
    kind,
    lostMin: eff.lostMin,
    whenText: eff.time ? timeFmt.format(eff.time) : null,
    noData,
  });
}

/** Minutes a spot gains over the origin, when the origin's own readout is known. */
function gainVsHere(eff: ObstructionEffect, noData = false): { text: string; cls: string; min: number } | null {
  // A gain against missing terrain, on either side, would be made up.
  if (!here || here.kind !== state.kind || noData || here.noData) return null;
  if (facingAway()) return null; // compared in degrees instead (awayGainVsHere)
  const min = here.effect.lostMin - eff.lostMin;
  if (min > 0) return { text: `+${min} min vs here`, cls: "good", min };
  if (min < 0) return { text: `${min} min vs here`, cls: "bad", min };
  return { text: "same as here", cls: "same", min };
}

function renderEventPicker(): void {
  eventsNav.innerHTML = "";
  for (const kind of EVENT_KINDS) {
    const ev = state.events[kind];
    const btn = document.createElement("button");
    setPressed(btn, kind === state.kind);
    const extra =
      ev?.moonIllumination !== undefined ? ` · ${Math.round(ev.moonIllumination * 100)}%` : "";
    // The weekday only when the event falls on another day than the one being
    // planned (a moonrise often does), so four chips fit a phone's width.
    const sameDay = ev && ev.time.toDateString() === baseTime().toDateString();
    const when = ev ? (sameDay ? timeFmt : dayTimeFmt).format(ev.time) : "";
    btn.innerHTML =
      `<span class="dot" style="background:${EVENT_COLORS[kind]}"></span>${eventLabel(kind)}` +
      `<span class="t">${ev ? when + extra : "—"}</span>`;
    if (ev) btn.title = dayTimeFmt.format(ev.time) + extra;
    btn.disabled = !ev;
    btn.addEventListener("click", () => {
      if (kind === state.kind) return;
      state.kind = kind;
      clearResults(); // results were scored along the old event's azimuth
      renderEventPicker();
      renderFacing();
      drawAzimuth();
      void probeHere();
      writeHash();
    });
    eventsNav.appendChild(btn);
  }
}

/** Sun / Away toggle: shown for sun events only; the choice is kept across event changes. */
const facingEl = document.getElementById("facing")!;
const facingBtns = [...facingEl.querySelectorAll<HTMLButtonElement>("button")];
function renderFacing(): void {
  facingEl.hidden = !canFaceAway(state.kind);
  for (const b of facingBtns) setPressed(b, b.dataset.facing === (facingAway() ? "away" : "sun"));
}
for (const b of facingBtns) {
  b.addEventListener("click", () => {
    const f = b.dataset.facing === "away" ? "away" : "sun";
    if (f === state.facing) return;
    state.facing = f;
    clearResults(); // results were scored along the other direction
    renderFacing();
    drawAzimuth();
    void probeHere();
    writeHash();
  });
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
  renderFacing();
  drawAzimuth();
  void probeHere();
}

/** Blank slate: drop everything the last search drew and listed. */
/** Bumped by every search and every clear, so a late OSM answer can tell it is stale. */
let searchSeq = 0;

function clearResults(): void {
  searchSeq++;
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
  statusEl.textContent = "";
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
type ProbeReply = Extract<WorkerMessage, { type: "probeResult" }>;
type ProgressPhase = Extract<WorkerMessage, { type: "progress" }>["phase"];

/**
 * Post a request to the worker and settle on its reply: progress messages go
 * to `onProgress`, the terminal message resolves, and a worker error (in the
 * request or in the script itself) rejects rather than leaving the search
 * hanging with the button disabled.
 */
function askWorker<R extends WorkerMessage>(
  req: SearchRequest | RingRequest | ProbeRequest,
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
/** Roadside samples per search (stage-1 ray budget). */
const ROAD_MAX_CANDIDATES = 1500;
/** DEM zoom for the single-point probe (few tiles, good detail). */
const PROBE_ZOOM = 11;

// Stage-2 sky ring: a full-circle profile for the ranking finalists only.
// 24 rays on every candidate would be an 8× blowup over the whole field;
// over ~40 finalists it's a fraction of the stage-1 ray work.
const RING_RAY_COUNT = 24;
const RING_MAX_DIST_M = 30_000;
const RING_FINALISTS = 40;
const TOP_SPOTS = 8;

// ---------- from here ----------
//
// The question you actually have when you're already somewhere: when does it
// come over the ridge from *this* spot? One ray-march, no search, no Overpass.

interface HereResult extends Omit<CandidateResult, "id"> {
  kind: EventKind;
  loc: LatLon;
  effect: ObstructionEffect;
  skyline?: SkylineFeature | null;
}
let here: HereResult | null = null;
let hereRequest = 0;
/** Pending probe, so a search can wait for the origin's readout before ranking against it. */
let herePromise: Promise<void> = Promise.resolve();

function probeHere(): Promise<void> {
  herePromise = doProbeHere();
  return herePromise;
}

async function doProbeHere(): Promise<void> {
  const ev = state.events[state.kind];
  here = null;
  clearSightline("here-sightline");
  if (!ev) {
    renderHere();
    return;
  }
  const id = ++requestId;
  hereRequest = id;
  const loc = state.loc;
  renderHere("Reading the terrain from here…");
  try {
    const req: ProbeRequest = {
      type: "probe",
      requestId: id,
      point: loc,
      azimuthDeg: lookAzimuth(ev),
      spreadDeg: lookSpread(),
      maxDistM: RAY_REACH_M,
      zoom: PROBE_ZOOM,
      eyeHeightM: 2,
    };
    const reply = await askWorker<ProbeReply>(req, () => {});
    if (hereRequest !== id) return; // superseded by a newer pin/event
    const r = reply.result;
    if (!Number.isFinite(r.groundM)) {
      // The tile under the pin did not load: nothing is known here.
      renderHere("Terrain didn't load here — try again in a moment.");
      return;
    }
    here = {
      ...r,
      kind: ev.kind,
      loc,
      effect: obstructionEffect(ev.kind, loc.lat, loc.lon, ev.time, r.obstructionDeg),
    };
    renderHere();
    // The ridge's name is decoration from Overpass: name it in the
    // background, so a search waiting on this readout never waits on OSM.
    void nameHereSkyline(id, loc, r);
  } catch (err) {
    console.error(err);
    if (hereRequest === id) renderHere("Terrain data unavailable right now.");
  }
}

async function nameHereSkyline(id: number, loc: LatLon, r: Omit<CandidateResult, "id">): Promise<void> {
  try {
    if (!here || !hitTerrain(r)) return;
    if (!mapReady) await new Promise<void>((resolve) => map.once("load", () => resolve()));
    if (hereRequest !== id) return;
    drawSightline(loc, { lat: r.horizonLat, lon: r.horizonLon }, null, "here-sightline");
    const [feature] = await nameSkylinePoints([{ lat: r.horizonLat, lon: r.horizonLon }]);
    if (hereRequest !== id || !feature || !here) return;
    here.skyline = feature;
    renderHere();
    drawSightline(loc, { lat: r.horizonLat, lon: r.horizonLon }, feature.name, "here-sightline");
  } catch (err) {
    console.error(err); // the readout stands without the ridge's name
  }
}

function renderHere(note?: string): void {
  const ev = state.events[state.kind];
  if (!ev) {
    hereEl.hidden = true;
    return;
  }
  hereEl.hidden = false;
  const t = timeFmt.format(ev.time);
  const moon = ev.moonIllumination !== undefined ? ` · ${Math.round(ev.moonIllumination * 100)}% lit` : "";
  const gh = state.golden[state.kind];
  const golden = gh ? ` · golden hour ${timeFmt.format(gh.start)}–${timeFmt.format(gh.end)}` : "";
  const facts = `${eventLabel(state.kind)} ${t} · az ${Math.round(ev.azimuthDeg)}°${moon}`;

  if (!here) {
    hereEl.innerHTML = `<div class="here-main"></div><div class="here-sub"></div>`;
    hereEl.querySelector(".here-main")!.textContent = facts;
    hereEl.querySelector(".here-sub")!.textContent = (note ?? "") + (note ? "" : golden.slice(3));
    return;
  }

  const rising = state.kind.endsWith("rise");
  const { effect } = here;
  let main: string;
  if (effect.time) {
    const az = Math.round(azimuthAtTime(state.kind, here.loc.lat, here.loc.lon, effect.time));
    main = rising
      ? `Over the ridge ~${timeFmt.format(effect.time)} · az ${az}° (+${effect.lostMin} min)`
      : `Behind the ridge ~${timeFmt.format(effect.time)} · az ${az}° (−${effect.lostMin} min)`;
  } else {
    main = `Open horizon — full ${rising ? "rise" : "set"} at ${t}`;
  }
  if (here.noData) {
    // Part of the line toward the event did not load: a minimum, not a reading.
    main = spotReading({
      kind: state.kind,
      lostMin: effect.lostMin,
      whenText: effect.time ? timeFmt.format(effect.time) : null,
      noData: true,
    }).label;
  }
  const ridge = hitTerrain(here)
    ? ` · ridge ${formatAngle(here.obstructionDeg)}, ${(here.horizonDistM / 1000).toFixed(0)} km away`
    : " · no terrain on the horizon";
  const behind = here.skyline
    ? ` · behind ${here.skyline.name}${here.skyline.eleM !== undefined ? ` (${Math.round(here.skyline.eleM).toLocaleString()} m)` : ""}`
    : "";
  let grade: number | "u" = here.noData ? "u" : lostGrade(effect.lostMin);
  if (facingAway()) {
    // Opposite the sun the minutes don't apply: the reading is how low the sky goes.
    const r = awayReading(here.obstructionDeg, here.noData);
    main = r.label;
    grade = r.grade;
  }
  hereEl.innerHTML = `<div class="here-main g${grade}"></div><div class="here-sub"></div>`;
  hereEl.querySelector(".here-main")!.textContent = main;
  hereEl.querySelector(".here-sub")!.textContent = `${facts}${ridge}${behind}${golden}`;
}

// ---------- find spots ----------

interface RankedSpot {
  candidate: Candidate;
  result: CandidateResult;
  score: number;
  rank: number;
  flag?: string;
  effect: ObstructionEffect;
  localTime: Date;
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
  // Every search leaves its permalink, including one on the opening inputs,
  // which no control change has written yet.
  writeHash();
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
  const seq = searchSeq;
  statusEl.textContent = "Fetching elevation tiles…";

  // Terrain first, OpenStreetMap alongside: the grid is scored and shown as
  // soon as tiles are in; roads and places (one capped Overpass lookup) are
  // scored and merged in when they arrive. Overpass never holds the screen.
  const radiusM = state.radiusKm * 1000;
  const grid = gridCandidates(state.loc, radiusM);
  const osmPromise = fetchOsmCandidates(state.loc, radiusM, state.mode, ROAD_MAX_CANDIDATES);
  const progress = (phase: ProgressPhase, done: number, total: number) => {
    statusEl.textContent =
      phase === "tiles" ? `Fetching elevation tiles… ${done}/${total}` : `Scoring horizons… ${done}/${total}`;
  };
  const base = {
    type: "search" as const,
    origin: state.loc,
    radiusM,
    azimuthDeg: lookAzimuth(ev),
    spreadDeg: lookSpread(),
    maxDistM: RAY_REACH_M,
    zoom: zoomForRadius(radiusM),
    eyeHeightM: 2,
  };
  const gridReq: SearchRequest = {
    ...base,
    requestId: ++requestId,
    // Town-scale only: buildings matter angularly only up close, and a
    // drive-scale bbox over a metro is more than Overpass will serve.
    buildings: radiusM <= BUILDINGS_MAX_RADIUS_M,
    candidates: grid.map((c) => ({ id: c.id, lat: c.lat, lon: c.lon })),
  };
  const gridReply = await askWorker<SearchReply>(gridReq, progress);
  if (seq !== searchSeq) return;
  const buildingCount = gridReply.buildingCount;
  await presentResults(grid, gridReply.results, ev, radiusM, "pending", buildingCount, gridReq.requestId);

  const osm = await osmPromise;
  if (seq !== searchSeq) return; // cleared or superseded meanwhile
  const extra: Candidate[] = [...osm.roads, ...osm.pois];
  if (!osm.ok || !extra.length) {
    await presentResults(grid, gridReply.results, ev, radiusM, osm.ok ? "ok" : "failed", buildingCount, gridReq.requestId);
    return;
  }
  statusEl.textContent = `Adding ${osm.roads.length} roadside points and ${osm.pois.length} mapped places…`;
  const osmReq: SearchRequest = {
    ...base,
    requestId: ++requestId,
    buildings: false,
    reuseObstaclesOf: gridReq.requestId,
    candidates: extra.map((c) => ({ id: c.id, lat: c.lat, lon: c.lon })),
  };
  const osmReply = await askWorker<SearchReply>(osmReq, progress);
  if (seq !== searchSeq) return;
  await presentResults(
    [...grid, ...extra],
    [...gridReply.results, ...osmReply.results],
    ev,
    radiusM,
    "ok",
    buildingCount,
    gridReq.requestId
  );
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
  /** OpenStreetMap roads and places: still coming, merged in, or unavailable. */
  osm: "pending" | "ok" | "failed",
  buildingCount: number | null,
  searchRequestId: number
): Promise<void> {
  const seq = searchSeq;
  const byId = new Map(results.map((r) => [r.id, r]));
  type Scored = {
    candidate: Candidate;
    result: CandidateResult;
    score: number;
    flags: string[];
    sky?: SkyOpenness;
    skyAngles?: number[];
  };
  // Missing terrain (a tile that failed to load) is unknown, not clear:
  // a spot standing on a gap is dropped, one looking across a gap is
  // flagged and ranked after every spot with full data (salida-test.md, finding 7).
  const terrainMissing = results.some((r) => r.noData);
  const scored: Scored[] = candidates
    .map((c) => ({ candidate: c, result: byId.get(c.id) }))
    .filter(
      (x): x is { candidate: Candidate; result: CandidateResult } =>
        !!x.result && Number.isFinite(x.result.groundM)
    )
    .map((x) => ({
      ...x,
      score: score({ obstructionDeg: x.result.obstructionDeg, horizonDistM: x.result.horizonDistM }),
      flags: x.result.noData ? [noDataFlag(ev.kind)] : [],
    }));

  const gridScored = scored.filter((x) => x.candidate.source === "grid");
  const roadScored = scored.filter((x) => x.candidate.source === "road");
  const poiScored = scored.filter((x) => x.candidate.source !== "grid" && x.candidate.source !== "road");

  // Heatmap shows raw terrain quality over the whole ring (grid), stretched
  // to the local score distribution.
  // Cells looking across missing terrain are left off: a colour there would be a guess.
  const heatPoints: ScorePoint[] = gridScored.filter((x) => !x.result.noData).map((x) => ({
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
    ev,
  };
  // Keep the direction lines and sightlines readable above the score surface.
  for (const id of OVERLAY_LAYERS) {
    if (map.getLayer(id)) map.moveLayer(id);
  }

  // Ranking pool: roadside samples are on a road by construction. Without
  // them (Overpass slow, down, or nothing mapped) fall back to raw grid
  // cells, honestly flagged.
  const roadsIn = roadScored.length > 0;
  const terrainPool = roadsIn ? roadScored : gridScored;

  // Reachability reality check for everything NOT sampled from a road: a
  // remote 13er tagged natural=peak is exactly what this must catch.
  const roads = buildRoadIndex(map, state.mode);
  const excluded = new Set<Scored>();
  if (roads) {
    const bands = roadBandsM(state.mode);
    for (const x of [...poiScored, ...(roadsIn ? [] : gridScored)]) {
      const d = roads.nearestRoadM(x.candidate);
      if (d === null || d > bands.exclude) {
        excluded.add(x); // not reachable in this travel mode; heatmap still shows it
      } else if (d > bands.flag) {
        x.score -= 0.75;
        x.flags.push(`~${(d / 1000).toFixed(1)} km walk from nearest mapped road`);
      }
    }
  }

  // One merged ranking. Mapped places get a small nudge (a signed viewpoint
  // beats an anonymous shoulder with the same sky); unverified grid cells a
  // small penalty.
  // Driving: an unpaved track with the same view loses the tie to a paved
  // pull-off (a moonrise from a bar shouldn't route you up a jeep road).
  const trackPenalty = state.mode === "drive" ? 0.4 : 0;
  const bonus = (x: Scored) =>
    x.candidate.source === "road"
      ? x.candidate.roadClass === "track"
        ? -trackPenalty
        : 0
      : x.candidate.source === "grid"
        ? -0.25
        : 0.5 * x.candidate.weight;
  const byRank = (a: Scored, b: Scored) =>
    Number(a.result.noData) - Number(b.result.noData) || b.score + bonus(b) - (a.score + bonus(a));
  const finalists = [...terrainPool, ...poiScored]
    .filter((x) => !excluded.has(x))
    .sort(byRank)
    .slice(0, RING_FINALISTS);

  // Stage 2: near mountains the exact sun line being blocked is forgivable —
  // seeing most of the horizon is what makes a spot great. March a full sky
  // ring for the finalists and re-rank on openness before the final pick.
  const rings = await fetchSkyRings(finalists, ev.azimuthDeg, searchRequestId, radiusM);
  const ringAzs = ringAzimuths(ev.azimuthDeg, RING_RAY_COUNT);
  for (const x of finalists) {
    const angles = rings.get(x.candidate.id);
    if (!angles || !angles.length) continue;
    x.skyAngles = angles;
    x.sky = skyOpenness(angles, ringAzs, ev.azimuthDeg);
    x.score += opennessDelta(x.result.obstructionDeg, x.sky.openness);
  }

  // Landcover reality-check for terrain picks (POIs exempt: a mapped
  // viewpoint inside forest is usually a cleared overlook).
  for (const x of finalists) {
    if (x.candidate.source !== "road" && x.candidate.source !== "grid") continue;
    const eff = landcoverAt(map, x.candidate);
    if (eff) {
      x.score += eff.scoreDelta;
      if (eff.flag) x.flags.push(eff.flag);
    }
    if (x.candidate.roadClass === "track") x.flags.push("unpaved track — check it's passable");
  }

  const top = pickSpread(finalists.sort(byRank), TOP_SPOTS, Math.max(800, radiusM / 15));

  // Rank against where you are: the search waits for the origin's readout.
  await herePromise.catch(() => {});
  if (seq !== searchSeq) return; // cleared while the sky rings ran

  const ranked: RankedSpot[] = top.map((x, i) => {
    const c = x.candidate;
    const localTime = eventTimeAt(ev.kind, c.lat, c.lon, ev.time) ?? ev.time;
    return {
      candidate: c,
      result: x.result,
      score: x.score,
      flag: x.flags.join(" · ") || undefined,
      rank: i + 1,
      sky: x.sky,
      skyAngles: x.skyAngles,
      localTime,
      effect: obstructionEffect(ev.kind, c.lat, c.lon, localTime, x.result.obstructionDeg),
    };
  });

  // Lead with the verdict: when nothing in the ring is worth the trip, one
  // line says so and only a few cards follow (docs/salida-test.md, item 3).
  // Only spots with full terrain data count toward the verdict. A spot
  // across missing terrain loses at least what it shows, so if even that
  // minimum could beat the cut, "nowhere is better" would be a guess: no verdict,
  // and every card shows.
  const known = ranked.filter((s) => !s.result.noData);
  const unknownMightWin =
    !!here && ranked.some((s) => s.result.noData && here!.effect.lostMin - s.effect.lostMin > VERDICT_MARGIN_MIN);
  // The verdict is in minutes of the event, which facing away has none of.
  const answer =
    !facingAway() && here && here.kind === ev.kind && !here.noData && known.length && !unknownMightWin
      ? verdict({
          kind: ev.kind,
          radiusKm: state.radiusKm,
          hereLostMin: here.effect.lostMin,
          bestGainMin: Math.max(...known.map((s) => here!.effect.lostMin - s.effect.lostMin)),
        })
      : null;
  const spots = answer ? ranked.slice(0, VERDICT_MAX_CARDS) : ranked;

  renderSpotMarkers(
    map,
    spots.map((s) => ({
      lat: s.candidate.lat,
      lon: s.candidate.lon,
      rank: s.rank,
      isPoi: s.candidate.source !== "grid" && s.candidate.source !== "road",
    })),
    (rank) => {
      document.getElementById(`spot-${rank}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  );

  // Under a verdict the status line would only repeat it (event, radius) and
  // cost card 1 its place above the fold on a phone.
  statusEl.textContent = answer
    ? ""
    : spots.length && facingAway()
    ? `Facing away, az ${Math.round(lookAzimuth(ev))}° ±${AWAY_SPREAD_DEG}°. Lowest skies:`
    : spots.length
    ? `${eventLabel(ev.kind)} ${timeFmt.format(ev.time)}, az ${Math.round(ev.azimuthDeg)}°. Best spots within ${state.radiusKm} km:`
    : "No results — try a larger radius.";

  resultsEl.innerHTML = "";
  if (answer) {
    const line = document.createElement("div");
    line.id = "verdict";
    line.className = `verdict-line ${answer.kind}`;
    line.textContent = answer.text;
    resultsEl.appendChild(line);
  }
  // The colour key and any warnings fold into one small line under the
  // verdict, so card 1 stays above the fold on a phone (salida-test.md, item 4).
  // Tapping the line opens the full sentences.
  const notes = resultNotes({
    heatmap: !!stats,
    terrainBlocksAll: !!stats && stats.p50 < -1,
    osm,
    roadsIn,
    buildingsMissing: buildingCount === null,
    terrainMissing,
  });
  if (notes.short.length) {
    const fine = document.createElement("details");
    fine.id = "notes";
    fine.className = "fine";
    const summary = document.createElement("summary");
    if (stats) {
      const bar = document.createElement("span");
      bar.className = "bar";
      bar.setAttribute("aria-hidden", "true");
      summary.appendChild(bar);
    }
    notes.short.forEach((phrase, i) => {
      if (i) summary.appendChild(document.createTextNode(" · "));
      const span = document.createElement("span");
      if (phrase.startsWith("⚠")) span.className = "w";
      span.textContent = phrase;
      summary.appendChild(span);
    });
    fine.appendChild(summary);
    for (const sentence of notes.full) {
      const p = document.createElement("p");
      p.textContent = sentence;
      fine.appendChild(p);
    }
    resultsEl.appendChild(fine);
  }
  const cards = spots.map((s) => spotCard(s));
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

/** Same named road at most this many times in the list. */
const MAX_PER_ROAD = 2;

/**
 * Greedy top-N with a minimum separation so picks don't cluster, and a cap
 * per named road so one good track doesn't fill the list.
 */
function pickSpread<T extends { candidate: Candidate }>(
  sorted: T[],
  n: number,
  minSepM: number
): T[] {
  const picked: T[] = [];
  const perRoad = new Map<string, number>();
  for (const x of sorted) {
    if (picked.length >= n) break;
    const tooClose = picked.some((p) => flatDistanceM(p.candidate, x.candidate) < minSepM);
    if (tooClose) continue;
    const road = x.candidate.source === "road" ? x.candidate.name : undefined;
    if (road) {
      const used = perRoad.get(road) ?? 0;
      if (used >= MAX_PER_ROAD) continue;
      perRoad.set(road, used + 1);
    }
    picked.push(x);
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

function spotCard(s: RankedSpot): HTMLElement {
  const c = s.candidate;
  const kind = lastSearch?.ev.kind ?? state.kind;
  const isRoad = c.source === "road";
  const isPoi = !isRoad && c.source !== "grid";
  const name = c.name ?? (isRoad ? "Roadside" : isPoi ? c.label! : "Open terrain");
  const chip = isPoi || isRoad ? c.label! : "access unverified";
  const away = facingAway();
  const v = away ? awayReading(s.result.obstructionDeg, s.result.noData) : effectLabel(kind, s.effect, s.result.noData);
  const gain = away
    ? here && here.kind === kind && !here.noData
      ? awayGainVsHere(s.result.obstructionDeg, here.obstructionDeg, s.result.noData)
      : null
    : gainVsHere(s.effect, s.result.noData);

  const el = document.createElement("article");
  el.className = "spot-card";
  el.id = `spot-${s.rank}`;
  const skySvg =
    s.sky && s.skyAngles ? skyRingSvg(s.skyAngles, lastSearch?.ev.azimuthDeg ?? 0, s.sky.openSkyDeg) : "";
  const skyNote = s.sky ? ` · ${Math.round(s.sky.openSkyDeg)}° open sky` : "";
  const ridge = hitTerrain(s.result)
    ? `Ridge ${formatAngle(s.result.obstructionDeg)}, ${(s.result.horizonDistM / 1000).toFixed(1)} km away`
    : "No terrain on the horizon";
  el.innerHTML = `
    <div class="head">
      <span class="rank">${s.rank}</span>
      <span class="name"></span>
      <span class="chip"></span>
      ${skySvg}
    </div>
    <div class="verdict g${v.grade}"><span class="label"></span>${gain ? ` <span class="gain ${gain.cls}"></span>` : ""}</div>
    <div class="detail">
      ${ridge}${skyNote}<span class="skyline"></span><br>
      ${eventLabel(kind)} ${timeFmt.format(s.localTime)} · elevation ${Math.round(s.result.groundM)} m
    </div>
    ${s.flag ? `<div class="flag"></div>` : ""}
    <div class="actions">
      <a target="_blank" rel="noopener"
         href="https://www.google.com/maps/dir/?api=1&destination=${c.lat.toFixed(6)},${c.lon.toFixed(6)}">Directions ↗</a>
    </div>`;
  el.querySelector(".name")!.textContent = name;
  el.querySelector(".chip")!.textContent = chip;
  el.querySelector(".verdict .label")!.textContent = v.label;
  if (gain) el.querySelector(".verdict .gain")!.textContent = gain.text;
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
