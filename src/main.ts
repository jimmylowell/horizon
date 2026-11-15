/**
 * Horizon: the skyline from the pin, the app (docs/design.md, *Skyline
 * first*). On top, the reading and the skyline all the way round, dragged or
 * turned with the compass; under it the map, coloured by how late the sun
 * stays; the setup (event, date, eye height) is a sheet over the map.
 */
import type { FeatureCollection } from "geojson";
import maplibregl, { GeolocateControl, Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

import { EVENT_KINDS, bodyPosition, nextEvents, obstructionEffect, type EventKind, type SkyEvent } from "./astro";
import { flatDistanceM, type LatLon } from "./geo";
import { repairBasemapStyle } from "./render/basemap";
import { clearHeatmap, renderHeatmap, type ScorePoint } from "./render/heatmap";
import { circleAzimuths, pathMeets, rayIndex, relDeg, renderSkylineView, type CircleSkyline, type PathPoint, type SkyPath } from "./render/view";
import { fetchBuildingsBox, type BuildingGrid, type Box } from "./search/buildings";
import { nameSkylinePoints } from "./search/horizonFeature";
import { lidarTownAt } from "./search/lidar";
import { EPT_ROOT, findFlight, type FlightRow } from "./search/flights";
import type { StreamProgress } from "./search/stream";
import { footprintHolding } from "./search/blocker";
import type { OverlayPoint, SkylineResult, WorkerMessage, WorkerRequest } from "./search/worker";

// ---------- state ----------

interface State {
  loc: LatLon;
  kind: EventKind;
  /** YYYY-MM-DD; empty = today. */
  date: string;
  events: Partial<Record<EventKind, SkyEvent>>;
  /** Eye height above the ground at the pin, feet; 6.5 is standing (2 m). Top 20 ft is Jimmy's. */
  eyeFt: number;
  /** Kept only so old links write back the same: `#lat,lon,kind,mode,radius`. */
  mode: string;
  radius: string;
  /** Lidar streamed from USGS (`,stream` in the link) rather than the baked tiles; outside a baked town, streamed whenever a flight covers the pin. */
  stream: boolean;
}

const EYE_MIN_FT = 6.5;
const EYE_MAX_FT = 20;
const FT_M = 0.3048;
const eyeM = () => (state.eyeFt <= EYE_MIN_FT ? 2 : state.eyeFt * FT_M);
const eyeLabel = () => (state.eyeFt <= EYE_MIN_FT ? "standing (2 m)" : `${state.eyeFt} ft (${(state.eyeFt * FT_M).toFixed(1)} m)`);

const state: State = {
  loc: { lat: 38.5347, lon: -105.9989 }, // Salida, CO
  kind: "sunset",
  date: "",
  events: {},
  eyeFt: EYE_MIN_FT,
  mode: "walk",
  radius: "1",
  stream: false,
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function baseTime(): Date {
  if (!state.date || state.date === todayStr()) return new Date();
  const [y, m, d] = state.date.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0);
}

// Permalink: #lat,lon,kind,mode,radius[,date][,eye=<ft>]. Older links may
// carry ,away or ,find: they open the same pin and event, toward the sun.
let openedFromHash = false;
function readHash(): void {
  const m = location.hash.slice(1).split(",");
  if (m.length < 2) return;
  const lat = parseFloat(m[0]);
  const lon = parseFloat(m[1]);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    state.loc = { lat, lon };
    openedFromHash = true;
  }
  if (m[2] && (EVENT_KINDS as string[]).includes(m[2])) state.kind = m[2] as EventKind;
  if (m[3] && /^(walk|bike|drive)$/.test(m[3])) state.mode = m[3];
  if (m[4] && /^\d+(\.\d+)?$/.test(m[4])) state.radius = m[4];
  if (m[5] && /^\d{4}-\d{2}-\d{2}$/.test(m[5])) state.date = m[5];
  const eye = m.slice(5).map((x) => /^eye=(\d+(?:\.\d+)?)$/.exec(x)).find((x) => x);
  if (m.slice(5).includes("stream")) state.stream = true;
  if (eye) state.eyeFt = Math.min(EYE_MAX_FT, Math.max(EYE_MIN_FT, Math.round(parseFloat(eye[1]) * 2) / 2));
}
function writeHash(): void {
  const date = state.date && state.date !== todayStr() ? `,${state.date}` : "";
  const eye = state.eyeFt > EYE_MIN_FT ? `,eye=${state.eyeFt}` : "";
  const stream = state.stream && lidarTownAt(state.loc) ? ",stream" : "";
  history.replaceState(null, "", `#${state.loc.lat.toFixed(5)},${state.loc.lon.toFixed(5)},${state.kind},${state.mode},${state.radius}${date}${eye}${stream}`);
}
readHash();

// ---------- elements ----------

const $ = (id: string) => document.getElementById(id)!;
const readingEl = $("reading");
const stripEl = $("strip");
const blockerEl = $("blocker");
const toEventBtn = $("to-event") as HTMLButtonElement;
const compassBtn = $("compass") as HTMLButtonElement;
const setupEl = $("setup");
const setupOpenBtn = $("setup-open") as HTMLButtonElement;
const setupSum = $("setup-sum");
const eventsNav = $("events");
const dateInput = $("date") as HTMLInputElement;
const eyeInput = $("eye") as HTMLInputElement;
const eyeOut = $("eye-out");
const keyEl = $("overlay-key");
const streamEl = $("stream");

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const EVENT_COLORS: Record<EventKind, string> = { sunrise: "#f2b400", sunset: "#ef7d1a", moonrise: "#8fb8f6", moonset: "#4d6fd0" };
const PATH_COLOURS: Record<EventKind, string> = { sunrise: "#f0a020", sunset: "#f0a020", moonrise: "#9fb4ff", moonset: "#9fb4ff" };
const LABEL: Record<EventKind, string> = { sunrise: "Sunrise", sunset: "Sunset", moonrise: "Moonrise", moonset: "Moonset" };
const escapeHtml = (t: string) =>
  t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const rising = () => state.kind.endsWith("rise");

// ---------- map ----------

const map = new MapLibreMap({
  container: "map",
  center: [state.loc.lon, state.loc.lat],
  zoom: lidarTownAt(state.loc) ? 15 : 12,
  attributionControl: { compact: true },
});
map.setStyle("https://tiles.openfreemap.org/styles/liberty", { transformStyle: repairBasemapStyle });
let mapReady = false;
const whenMapReady = () => (mapReady ? Promise.resolve() : new Promise<void>((r) => map.once("load", () => r())));
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
const geolocate = new GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  showUserLocation: true,
  trackUserLocation: true, // walking: the pin follows each new fix
});
map.addControl(geolocate, "top-right");
let firstFix = true;
geolocate.on("geolocate", (pos) => {
  const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
  if (!firstFix && flatDistanceM(loc, state.loc) < 5) return; // GPS wander, not a step
  setLocation(loc, firstFix);
  firstFix = false;
});
geolocate.on("trackuserlocationend", () => (firstFix = true));

const pinEl = document.createElement("div");
pinEl.className = "origin-marker";
pinEl.title = "Where you stand (drag to move)";
const pin = new Marker({ element: pinEl, draggable: true }).setLngLat([state.loc.lon, state.loc.lat]).addTo(map);
pin.on("dragend", () => {
  const ll = pin.getLngLat();
  setLocation({ lat: ll.lat, lon: ll.lng }, false);
});
map.on("click", (e) => setLocation({ lat: e.lngLat.lat, lon: e.lngLat.lng }, false));

function geo(id: string, data: FeatureCollection, add: () => void): void {
  if (!mapReady) return;
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(data);
  else {
    map.addSource(id, { type: "geojson", data });
    add();
  }
}
const empty: FeatureCollection = { type: "FeatureCollection", features: [] };

/** The line from the pin to what is in the way, and its outline when it is a building. */
function drawBlocker(to: LatLon | null, label: string, ring: LatLon[] | null): void {
  const colour = EVENT_COLORS[state.kind];
  geo(
    "blocker",
    to
      ? {
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[state.loc.lon, state.loc.lat], [to.lon, to.lat]] } },
            { type: "Feature", properties: { name: label }, geometry: { type: "Point", coordinates: [to.lon, to.lat] } },
          ],
        }
      : empty,
    () => {
      map.addLayer({ id: "blocker-line", type: "line", source: "blocker", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-width": 2, "line-dasharray": [1.5, 1.5] } });
      map.addLayer({ id: "blocker-point", type: "circle", source: "blocker", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      map.addLayer({
        id: "blocker-label",
        type: "symbol",
        source: "blocker",
        filter: ["==", ["geometry-type"], "Point"],
        layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, -1.3], "text-anchor": "bottom", "text-optional": true },
        paint: { "text-halo-color": "#fff", "text-halo-width": 1.5 },
      });
    }
  );
  geo(
    "blocker-building",
    ring
      ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]].map((p) => [p.lon, p.lat])] } }] }
      : empty,
    () => {
      map.addLayer({ id: "blocker-building-fill", type: "fill", source: "blocker-building", paint: { "fill-opacity": 0.35 } });
      map.addLayer({ id: "blocker-building-line", type: "line", source: "blocker-building", paint: { "line-width": 2.5 } });
    }
  );
  if (!mapReady) return;
  map.setPaintProperty("blocker-line", "line-color", colour);
  map.setPaintProperty("blocker-point", "circle-color", colour);
  map.setPaintProperty("blocker-label", "text-color", colour);
  map.setPaintProperty("blocker-building-fill", "fill-color", colour);
  map.setPaintProperty("blocker-building-line", "line-color", colour);
}

// ---------- worker ----------

const worker = new Worker(new URL("./search/worker.ts", import.meta.url), { type: "module" });
let requestId = 0;
const LIDAR_BASE = new URL((import.meta as { env?: { VITE_LIDAR_BASE?: string } }).env?.VITE_LIDAR_BASE ?? "lidar/", document.baseURI).href;

function askWorker<T extends WorkerMessage["type"]>(req: WorkerRequest): Promise<Extract<WorkerMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const done = () => {
      worker.removeEventListener("message", onMsg);
      worker.removeEventListener("error", onErr);
    };
    const onMsg = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.requestId !== req.requestId || m.type === "progress") return;
      done();
      if (m.type === "error") reject(new Error(`worker: ${m.message}`));
      else resolve(m as Extract<WorkerMessage, { type: T }>);
    };
    const onErr = (e: ErrorEvent) => {
      done();
      reject(new Error(`worker: ${e.message}`));
    };
    worker.addEventListener("message", onMsg);
    worker.addEventListener("error", onErr);
    worker.postMessage(req);
  });
}

const ZOOM = 11;
/** Toward the event the ridge is read this far out; the rest of the circle, BEHIND_M. */
const EVENT_REACH_M = 120_000;
const BEHIND_M = 30_000;
const EVENT_SIDE_DEG = 30;

// ---------- the sky path ----------

/** The whole day's arc of the body above the horizon around the event, every minute. */
function dayPath(ev: SkyEvent, loc: LatLon): SkyPath {
  const up = ev.kind.endsWith("rise");
  const from = up ? -60 : -16 * 60;
  const to = up ? 16 * 60 : 30;
  const t0 = Math.floor(ev.time.getTime() / 60_000) * 60_000;
  const points: PathPoint[] = [];
  for (let m = from; m <= to; m++) {
    const time = new Date(t0 + m * 60_000);
    const p = bodyPosition(ev.kind, loc.lat, loc.lon, time);
    // Keep the arc that is up, and the stretch just under the horizon either side.
    if (p.altDeg < -3) {
      if (up ? points.length > 0 : m > 0) break;
      continue;
    }
    points.push({ time, ...p });
  }
  return { points, rising: up };
}

/** The meeting moment to the second: bisect between the minute before and the minute it is found. */
function refineMeet(sky: CircleSkyline, path: SkyPath, idx: number): PathPoint {
  const pts = path.points;
  const a = pts[Math.max(0, idx - 1)];
  const b = pts[idx];
  let lo = +a.time;
  let hi = +b.time;
  let best = b;
  const sky0 = (p: PathPoint) => {
    const f = ((p.azDeg % 360) + 360) % 360;
    const i = Math.floor(f * 2) % sky.angles.length;
    const t = f * 2 - Math.floor(f * 2);
    return sky.angles[i] + (sky.angles[(i + 1) % sky.angles.length] - sky.angles[i]) * t;
  };
  for (let k = 0; k < 8; k++) {
    const mid = new Date((lo + hi) / 2);
    const p = { time: mid, ...bodyPosition(state.kind, state.loc.lat, state.loc.lon, mid) };
    const above = p.altDeg + p.radiusDeg > sky0(p);
    // Setting: above means not yet; rising: above means already.
    if (path.rising ? above : !above) {
      hi = +mid;
      best = p;
    } else lo = +mid;
  }
  return best;
}

// ---------- the view ----------

interface Skyline extends CircleSkyline {
  r: SkylineResult;
  loc: LatLon;
  reachM: number[];
}
let sky: Skyline | null = null;
let path: SkyPath | null = null;
let meet: { point: PathPoint; unknown: boolean } | null = null;
let facing = 0;
let picked: number | null = null;
/** OpenStreetMap's name for what the path meets, once asked. */
let meetName: string | null = null;
let skySeq = 0;
const FOV_DEG = 70;

function viewHeight(): number {
  return Math.round(Math.max(170, Math.min(340, window.innerHeight * 0.36)));
}

function drawView(): void {
  const ev = state.events[state.kind];
  if (!sky || !path || !ev) return;
  const W = Math.max(280, Math.round(stripEl.clientWidth || 360));
  stripEl.innerHTML =
    renderSkylineView(sky, path, {
      width: W,
      height: viewHeight(),
      centreDeg: facing,
      fovDeg: FOV_DEG,
      colour: PATH_COLOURS[state.kind],
      fmt: (d) => timeFmt.format(d),
      meet: meet && !meet.unknown ? meet.point : null,
      picked,
      now: new Date(),
    }) +
    `<div class="strip-key">${sky.r.lidar ? `<span class="k ridge"></span>ridge <span class="k lidar"></span>roofs and trees, USGS lidar${streaming() ? `, streamed to ${live.reachM} m` : ""}` : streaming() ? `<span class="k ridge"></span>ridge · lidar on its way` : flight ? `<span class="k ridge"></span>ridge · no lidar here` : lidarTownAt(sky.loc) ? `<span class="k ridge"></span>ridge · lidar didn't load` : `<span class="k ridge"></span>ridge · no roofs or trees outside Salida`} · drag to look round, tap to name</div>`;
}

function renderReading(note?: string): void {
  const ev = state.events[state.kind];
  if (!ev) {
    readingEl.innerHTML = `<span class="main">No ${LABEL[state.kind].toLowerCase()} in the next day here.</span>`;
    return;
  }
  const flat = timeFmt.format(ev.time);
  const moon = ev.moonIllumination !== undefined ? ` · ${Math.round(ev.moonIllumination * 100)}% lit` : "";
  if (note || !sky) {
    readingEl.innerHTML = `<span class="main">${LABEL[state.kind]} ${flat}${moon}</span> <span class="sub">${escapeHtml(note ?? "")}</span>`;
    return;
  }
  if (!meet) {
    readingEl.innerHTML = `<span class="main g4">Open horizon: ${LABEL[state.kind].toLowerCase()} ${flat}</span><span class="sub">${moon}</span>`;
    return;
  }
  if (meet.unknown) {
    readingEl.innerHTML = `<span class="main gu">Terrain didn't load toward the ${LABEL[state.kind].toLowerCase()}</span> <span class="sub">flat ${flat}</span>`;
    return;
  }
  const t = meet.point.time;
  const mins = Math.round((rising() ? +t - +ev.time : +ev.time - +t) / 60_000);
  const i = rayIndex(meet.point.azDeg);
  const what = meetName ? escapeHtml(meetName) : sky.what[i] === "lidar" ? "a roof or tree" : "the ridge";
  const word = rising() ? "Over" : "Behind";
  const delta = mins > 0 ? ` (${rising() ? "+" : "−"}${mins} min)` : "";
  const grade = mins <= 5 ? "g4" : mins <= 15 ? "g3" : mins <= 30 ? "g1" : "g0";
  readingEl.innerHTML = `<span class="main ${grade}">${word} ${what} ~${timeFmt.format(t)}${delta}</span> <span class="sub">flat ${flat}${moon}</span>`;
}

async function readSkyline(soft = false): Promise<void> {
  const ev = state.events[state.kind];
  const seq = ++skySeq;
  if (!soft) {
    sky = null;
    meet = null;
    meetName = null;
    picked = null;
    blockerEl.textContent = "";
    drawBlocker(null, "", null);
  }
  if (!ev) {
    stripEl.innerHTML = "";
    renderReading();
    return;
  }
  const loc = state.loc;
  path = dayPath(ev, loc);
  if (!soft) {
    renderReading(lidarTownAt(loc) ? "Reading the skyline: ridge, roofs and trees…" : "Reading the skyline…");
    stripEl.innerHTML = `<div class="strip-wait" style="height:${viewHeight()}px"></div>`;
  }
  const azimuths = circleAzimuths();
  // The event side reaches far; behind, a shorter reach keeps the tiles few.
  const centre = meetGuess(path, ev);
  const reachM = azimuths.map((az) => (Math.abs(relDeg(az, centre)) <= EVENT_SIDE_DEG ? EVENT_REACH_M : BEHIND_M));
  try {
    const reply = await askWorker<"skylineResult">({
      type: "skyline",
      requestId: ++requestId,
      point: loc,
      azimuths,
      maxDistM: EVENT_REACH_M,
      reachM,
      zoom: ZOOM,
      eyeHeightM: eyeM(),
      lidarBase: LIDAR_BASE,
      stream: streaming() && live.reachM > 0,
    });
    if (seq !== skySeq) return;
    if (streaming() && live.reachM > 0) mark(`skyline ${live.reachM} m`);
    sky = { angles: reply.result.angles, what: reply.result.what, r: reply.result, loc, reachM };
    const m = pathMeets(sky, path);
    meet = m ? { point: m.unknown ? m.point : refineMeet(sky, path, m.index), unknown: m.unknown } : null;
    facing = meet ? meet.point.azDeg : ev.azimuthDeg;
    renderReading();
    drawView();
    if (meet && !meet.unknown && !soft) void nameAt(meet.point.azDeg, true);
  } catch (err) {
    console.error(err);
    if (seq === skySeq) renderReading("The terrain didn't load. Move the pin to try again.");
  }
}

/** Where to aim the far-reaching rays before the skyline is known: the path 3° up, halfway to the flat bearing. */
function meetGuess(p: SkyPath, ev: SkyEvent): number {
  if (!p.points.length) return ev.azimuthDeg;
  const near = p.points.reduce((b, q) => (Math.abs(q.altDeg - 3) < Math.abs(b.altDeg - 3) ? q : b));
  return ev.azimuthDeg + relDeg(near.azDeg, ev.azimuthDeg) / 2;
}

// ---------- what is in the way ----------

const boxes: { box: Box; grid: Promise<BuildingGrid | null> }[] = [];
const BOX_M = 60;

function buildingsAround(p: LatLon): Promise<BuildingGrid | null> {
  const inside = boxes.find((b) => p.lat > b.box.s + 1e-4 && p.lat < b.box.n - 1e-4 && p.lon > b.box.w + 1e-4 && p.lon < b.box.e - 1e-4);
  if (inside) return inside.grid;
  const dLat = BOX_M / 111_320;
  const dLon = BOX_M / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  const box = { s: p.lat - dLat, n: p.lat + dLat, w: p.lon - dLon, e: p.lon + dLon };
  const entry = { box, grid: fetchBuildingsBox(box, 15_000) };
  boxes.push(entry);
  void entry.grid.then((g) => {
    if (!g) boxes.splice(boxes.indexOf(entry), 1); // a failed ask is tried again next tap
  });
  return entry.grid;
}

let nameSeq = 0;
async function nameAt(azDeg: number, atMeet: boolean): Promise<void> {
  if (!sky) return;
  const seq = ++nameSeq;
  const s = sky;
  const i = rayIndex(azDeg);
  const angle = s.angles[i];
  const to = { lat: s.r.lat[i], lon: s.r.lon[i] };
  const dist = s.r.distM[i];
  const distText = dist < 1000 ? `${Math.round(dist)} m away` : `${(dist / 1000).toFixed(dist < 10_000 ? 1 : 0)} km away`;
  const lead = atMeet ? `${rising() ? "Over" : "Behind"}:` : `At ${Math.round(azDeg)}°:`;
  if (!Number.isFinite(angle)) {
    blockerEl.innerHTML = `${lead} unknown, the terrain there didn't load.`;
    drawBlocker(null, "", null);
    return;
  }
  const say = (what: string, extra: string, ring: LatLon[] | null, mapLabel: string) => {
    if (seq !== nameSeq) return;
    if (atMeet && mapLabel && s === sky) {
      meetName = mapLabel; // the reading names it too
      renderReading();
    }
    blockerEl.innerHTML = `<b>${lead}</b> ${escapeHtml(what)} · ${extra}`;
    drawBlocker(to, mapLabel, ring);
  };
  if (s.what[i] === "lidar") {
    const h = s.r.heightM[i];
    const extra = `${Math.round(h)} m tall on the lidar, ${distText}`;
    say("asking OpenStreetMap what this is…", extra, null, "");
    const grid = await buildingsAround(to);
    if (!grid) return say("a roof or tree (OpenStreetMap didn't answer)", extra, null, "");
    const f = footprintHolding(grid.footprints, to, 1.5);
    if (f) say(f.label ?? "a building", extra, f.ring, f.label ?? "a building");
    else say("a tree or something unmapped", `${extra} · no building outline there in OpenStreetMap`, null, "");
    return;
  }
  if (dist >= s.reachM[i] * 0.99) {
    if (seq === nameSeq) {
      blockerEl.innerHTML = `<b>${lead}</b> nothing: open to the reach of the terrain read here.`;
      drawBlocker(null, "", null);
    }
    return;
  }
  const extra = `${angle.toFixed(1)}° up, ${distText}`;
  say("the ridge", extra, null, "");
  try {
    const [feature] = await nameSkylinePoints([to]);
    if (feature) {
      const ele = feature.eleM !== undefined ? ` (${Math.round(feature.eleM).toLocaleString()} m)` : "";
      say(`${feature.name}${ele}`, extra, null, feature.name);
    }
  } catch (err) {
    console.error(err); // the ridge stands without its name
  }
}

// Drag to look round; a tap names what is there.
let drag: { x: number; facing: number; moved: boolean } | null = null;
stripEl.addEventListener("pointerdown", (e) => {
  if (!sky) return;
  drag = { x: e.clientX, facing, moved: false };
  stripEl.setPointerCapture(e.pointerId);
});
stripEl.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (Math.abs(dx) > 6) drag.moved = true;
  if (!drag.moved) return;
  stopCompass();
  facing = (((drag.facing - (dx / stripEl.clientWidth) * FOV_DEG) % 360) + 360) % 360;
  requestAnimationFrame(drawView);
});
stripEl.addEventListener("pointerup", (e) => {
  if (!drag) return;
  const tap = !drag.moved;
  drag = null;
  if (!tap || !sky) return;
  const svg = stripEl.querySelector("svg");
  if (!svg) return;
  const r = svg.getBoundingClientRect();
  const az = (((facing + ((e.clientX - r.left) / r.width - 0.5) * FOV_DEG) % 360) + 360) % 360;
  picked = az;
  drawView();
  void nameAt(az, false);
});
stripEl.addEventListener("pointercancel", () => (drag = null));

toEventBtn.addEventListener("click", () => {
  const ev = state.events[state.kind];
  if (!ev) return;
  stopCompass();
  facing = meet ? meet.point.azDeg : ev.azimuthDeg;
  picked = null;
  drawView();
  if (meet && !meet.unknown) void nameAt(meet.point.azDeg, true);
});

// ---------- compass ----------

type OrientationWithCompass = DeviceOrientationEvent & { webkitCompassHeading?: number };
let following = false;
let gotHeading = false;
function onOrientation(e: Event): void {
  const o = e as OrientationWithCompass;
  let heading: number | null = null;
  if (typeof o.webkitCompassHeading === "number") heading = o.webkitCompassHeading;
  else if (o.absolute && o.alpha !== null) heading = 360 - o.alpha;
  if (heading === null) return;
  gotHeading = true;
  const screenAngle = screen.orientation?.angle ?? 0;
  facing = (((heading + screenAngle) % 360) + 360) % 360;
  requestAnimationFrame(drawView);
}
function stopCompass(): void {
  if (!following) return;
  following = false;
  window.removeEventListener("deviceorientationabsolute", onOrientation);
  window.removeEventListener("deviceorientation", onOrientation);
  compassBtn.setAttribute("aria-pressed", "false");
  compassBtn.textContent = "Compass";
}
compassBtn.addEventListener("click", async () => {
  if (following) return stopCompass();
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
  if (!DOE) {
    compassBtn.textContent = "No compass here";
    return;
  }
  if (typeof DOE.requestPermission === "function") {
    try {
      if ((await DOE.requestPermission()) !== "granted") {
        compassBtn.textContent = "Compass not allowed";
        return;
      }
    } catch {
      compassBtn.textContent = "Compass not allowed";
      return;
    }
  }
  following = true;
  gotHeading = false;
  compassBtn.setAttribute("aria-pressed", "true");
  compassBtn.textContent = "Following compass";
  window.addEventListener("deviceorientationabsolute", onOrientation);
  window.addEventListener("deviceorientation", onOrientation);
  setTimeout(() => {
    if (following && !gotHeading) {
      stopCompass();
      compassBtn.textContent = "No heading: drag";
    }
  }, 2500);
});

// ---------- the colour overlay ----------

let overlaySeq = 0;
async function readOverlay(): Promise<void> {
  const ev = state.events[state.kind];
  const seq = ++overlaySeq;
  keyEl.hidden = true;
  if (!ev) {
    if (mapReady) clearHeatmap(map);
    return;
  }
  const loc = state.loc;
  const town = !!lidarTownAt(loc);
  // Streamed: the circle is only as wide as the lidar that has arrived, so
  // no ground is coloured that the stream has not reached.
  const streamed = streaming();
  if (streamed && live.reachM === 0) {
    if (mapReady) clearHeatmap(map);
    return;
  }
  const radiusM = streamed ? live.reachM : town ? 400 : 3000;
  const rings = streamed ? Math.max(4, Math.round(radiusM / 20)) : town ? 20 : 15;
  let reply;
  try {
    reply = await askWorker<"overlayResult">({
      type: "overlay",
      requestId: ++requestId,
      point: loc,
      radiusM,
      rings,
      azimuthDeg: meet && !meet.unknown ? meet.point.azDeg : ev.azimuthDeg,
      spreadDeg: 8,
      maxDistM: EVENT_REACH_M,
      zoom: ZOOM,
      eyeHeightM: eyeM(),
      lidarBase: LIDAR_BASE,
      stream: streamed,
    });
  } catch (err) {
    console.error(err);
    return;
  }
  if (seq !== overlaySeq) return;
  if (streamed) mark(`overlay ${radiusM} m`);
  await whenMapReady();
  if (seq !== overlaySeq) return;
  const known = reply.points.filter((p: OverlayPoint) => !p.noData && Number.isFinite(p.obstructionDeg));
  const points: ScorePoint[] = known.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    score: -p.obstructionDeg, // a lower skyline is a later set, an earlier rise
    obstructionDeg: p.obstructionDeg,
    horizonDistM: 0,
    horizonLat: p.lat,
    horizonLon: p.lon,
  }));
  const stats = renderHeatmap(map, points, radiusM / rings, loc, radiusM);
  if (!stats) return;
  // The key in clock times, by the page's one definition; an angle no
  // time can be read for (above the day's path) says so rather than guessing.
  const at = (score: number) => {
    const t = obstructionEffect(ev.kind, loc.lat, loc.lon, ev.time, -score).time;
    return t ? timeFmt.format(t) : "—";
  };
  const body = ev.kind.startsWith("sun") ? "sun" : "moon";
  const word = rising() ? "clears" : "stays until";
  keyEl.innerHTML = `<span class="bar"></span> ${body} ${word} <b class="lo">${at(stats.p5)}</b> · ${at(stats.p50)} · <b class="hi">${at(stats.p95)}</b>`;
  keyEl.hidden = false;
}

// ---------- setup ----------

function renderEvents(): void {
  eventsNav.innerHTML = "";
  for (const kind of EVENT_KINDS) {
    const ev = state.events[kind];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.toggle("active", kind === state.kind);
    btn.setAttribute("aria-pressed", String(kind === state.kind));
    const sameDay = ev && ev.time.toDateString() === baseTime().toDateString();
    const lit = ev?.moonIllumination !== undefined ? ` · ${Math.round(ev.moonIllumination * 100)}%` : "";
    btn.innerHTML = `<span class="dot" style="background:${EVENT_COLORS[kind]}"></span>${LABEL[kind]}<span class="t">${ev ? (sameDay ? timeFmt : dayTimeFmt).format(ev.time) + lit : "—"}</span>`;
    btn.disabled = !ev;
    btn.addEventListener("click", () => {
      if (kind === state.kind) return;
      state.kind = kind;
      renderEvents();
      refresh();
      writeHash();
    });
    eventsNav.appendChild(btn);
  }
}

function renderSummary(): void {
  const day = state.date && state.date !== todayStr() ? dateFmt.format(baseTime()) : "Today";
  const eye = state.eyeFt > EYE_MIN_FT ? ` · ${state.eyeFt} ft` : "";
  setupSum.textContent = `${LABEL[state.kind]} · ${day}${eye}`;
  toEventBtn.textContent = `Face the ${LABEL[state.kind].toLowerCase()}`;
}

function openSetup(open: boolean): void {
  setupEl.hidden = !open;
  setupOpenBtn.setAttribute("aria-expanded", String(open));
}
setupOpenBtn.addEventListener("click", () => openSetup(setupEl.hidden));
$("setup-close").addEventListener("click", () => openSetup(false));
$("locate").addEventListener("click", () => geolocate.trigger());

dateInput.min = todayStr();
dateInput.value = state.date || todayStr();
dateInput.addEventListener("change", () => {
  state.date = dateInput.value && dateInput.value !== todayStr() ? dateInput.value : "";
  refreshEvents();
  writeHash();
});

eyeInput.min = String(EYE_MIN_FT);
eyeInput.max = String(EYE_MAX_FT);
eyeInput.value = String(state.eyeFt);
eyeOut.textContent = eyeLabel();
let eyeTimer = 0;
eyeInput.addEventListener("input", () => {
  state.eyeFt = parseFloat(eyeInput.value);
  eyeOut.textContent = eyeLabel();
  renderSummary();
  writeHash();
  clearTimeout(eyeTimer);
  eyeTimer = window.setTimeout(refresh, 350);
});

// ---------- flow ----------

async function refresh(): Promise<void> {
  renderSummary();
  await readSkyline();
  void readOverlay(); // aimed where the path meets the skyline, so after it
}

// ---------- lidar streamed from USGS (docs/design.md, *Lidar from USGS, live*) ----------

let flights: Promise<FlightRow[]> | null = null;
/** The flight covering the pin, once looked up; null = none, or not looked up yet. */
let flight: string | null = null;
let flightLoc: LatLon | null = null;
const live: StreamProgress & { id: number } = { id: 0, reachM: 0, files: 0, totalFiles: 0, bytes: 0, points: 0, ms: 0, done: false, stopped: false };
/** Timings for the measurements, from the pin going down: also on `window.__stream`. */
let marks: { what: string; ms: number; mb: number }[] = [];
let streamT0 = 0;
function mark(what: string): void {
  marks.push({ what, ms: Math.round(performance.now() - streamT0), mb: +(live.bytes / 1e6).toFixed(1) });
  (window as unknown as { __stream: unknown }).__stream = { flight, marks, live: { ...live } };
}
const streaming = () => !!flight && (state.stream || !lidarTownAt(state.loc));

function renderStream(): void {
  const town = lidarTownAt(state.loc);
  const sw = town
    ? `<span class="seg"><button type="button" data-src="baked" aria-pressed="${!state.stream}">Baked</button><button type="button" data-src="stream" aria-pressed="${state.stream}">Streamed</button></span> `
    : "";
  let body = "";
  if (flightLoc !== state.loc) body = "Looking up which USGS flight covers here…";
  else if (!flight) body = town ? "" : "No USGS lidar flight covers here: ridge only.";
  else if (!streaming()) body = `${escapeHtml(town!.name)} baked tiles`;
  else {
    const mb = (live.bytes / 1e6).toFixed(1);
    const s = (live.ms / 1000).toFixed(0);
    const left = live.done ? (live.stopped ? "stopped" : "done") : "";
    body = `USGS ${escapeHtml(flight)}: ${live.reachM ? `${live.reachM} m round` : "first points"} · ${mb} MB · ${s} s ${left}`;
    if (!live.done) body += ` <button type="button" id="stream-stop">Stop</button>`;
  }
  streamEl.innerHTML = sw + `<span class="txt">${body}</span>`;
}
streamEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  if (b.id === "stream-stop") {
    worker.postMessage({ type: "streamStop", requestId: ++requestId } satisfies WorkerRequest);
    return;
  }
  const want = b.dataset.src === "stream";
  if (want === state.stream) return;
  state.stream = want;
  writeHash();
  void startLidar();
});

/** Find the flight for the pin and, when streaming, start it; the skyline and circle redraw as each ring lands. */
async function startLidar(): Promise<void> {
  const loc = state.loc;
  worker.postMessage({ type: "streamStop", requestId: ++requestId } satisfies WorkerRequest);
  Object.assign(live, { id: ++requestId, reachM: 0, files: 0, totalFiles: 0, bytes: 0, points: 0, ms: 0, done: false, stopped: false });
  marks = [];
  streamT0 = performance.now();
  if (flightLoc !== loc) {
    flight = null;
    renderStream();
    flights ??= fetch(new URL("flights.json", document.baseURI)).then((r) => r.json()).then((j) => j.rows as FlightRow[]);
    let found = null;
    try {
      found = await findFlight(await flights, loc);
    } catch (err) {
      console.error(err);
    }
    if (loc !== state.loc) return;
    flight = found?.name ?? null;
    flightLoc = loc;
    mark("flight found");
  }
  renderStream();
  if (!streaming()) {
    void refresh();
    return;
  }
  const id = live.id;
  void refresh(); // terrain first; the lidar joins it ring by ring
  worker.postMessage({ type: "stream", requestId: id, point: loc, eptUrl: EPT_ROOT + flight } satisfies WorkerRequest);
}
worker.addEventListener("message", (e: MessageEvent<WorkerMessage>) => {
  const m = e.data;
  if (m.type !== "streamProgress" || m.requestId !== live.id) return;
  const grew = m.progress.reachM > live.reachM;
  Object.assign(live, m.progress);
  renderStream();
  if (grew) {
    mark(`${live.reachM} m loaded`);
    void readSkyline(true).then(() => readOverlay());
    if (sky) drawView();
  } else if (live.done) mark("done");
});

function refreshEvents(): void {
  state.events = nextEvents(state.loc.lat, state.loc.lon, baseTime());
  if (!state.events[state.kind]) {
    const first = EVENT_KINDS.find((k) => state.events[k]);
    if (first) state.kind = first;
  }
  renderEvents();
  if (flightLoc === state.loc) void refresh();
  else void startLidar();
}

function setLocation(loc: LatLon, pan: boolean): void {
  state.loc = loc;
  pin.setLngLat([loc.lon, loc.lat]);
  if (pan) map.flyTo({ center: [loc.lon, loc.lat], zoom: Math.max(map.getZoom(), lidarTownAt(loc) ? 15 : 12) });
  refreshEvents();
  writeHash();
}

window.addEventListener("resize", () => requestAnimationFrame(drawView));

map.on("load", () => {
  mapReady = true;
  // The compact attribution opens expanded over a phone map: fold it to its ⓘ;
  // the OpenStreetMap credit stays on screen in the sources line.
  document.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show")?.classList.remove("maplibregl-compact-show");
  document.querySelector(".maplibregl-ctrl-attrib")?.removeAttribute("open");
  void readOverlay();
});

refreshEvents();
writeHash();
if (!openedFromHash) openSetup(true);
