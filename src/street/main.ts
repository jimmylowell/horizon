/**
 * The Street View screen (docs/design.md, *Street View*): three locked
 * Street View frames, the terrain skyline from the camera's spot, and the
 * day's sun and moon paths drawn over them. No map on this screen: Google
 * Maps Platform Terms 3.2.3(e).
 */
import "./street.css";

import { circleAzimuths, skyAt, type CircleSkyline } from "../render/view";
import type { SkylineResult, WorkerMessage, WorkerRequest } from "../search/worker";
import { computeDay, type Crossing, type Day } from "./day";
import { embedUrl, frameHeadings, frameLayout, frameOn, project, zoomFor, type Layout } from "./geometry";

// ---------- Google, the little of it used ----------

interface LatLngLike { lat(): number; lng(): number }
interface PanoData {
  location: { pano: string; latLng: LatLngLike };
  links?: { heading: number; pano: string }[];
  imageDate?: string;
}
interface StreetViewService {
  getPanorama(req: object): Promise<{ data: PanoData }>;
}
declare global {
  interface Window {
    google?: { maps: { StreetViewService: new () => StreetViewService } };
    __streetStart?: () => void;
    /** For checks: what the screen worked out. */
    __street?: unknown;
  }
}

// ---------- state ----------

const EYE_M = 2.5;
const RADIUS_M = 600;
const REACH_M = 120_000;
const ZOOM = 12;

const $ = (id: string) => document.getElementById(id)!;
const pad = (n: number) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const minuteNow = () => new Date().getHours() * 60 + new Date().getMinutes();

const S = {
  lat: 38.51748,
  lon: -106.07596,
  date: todayStr(),
  minute: minuteNow(),
  heading: 0,
  pano: null as string | null,
  sky: null as CircleSkyline | null,
  day: null as Day | null,
  picked: null as Crossing | null,
};

const qs = new URLSearchParams(location.search);
const backHash = qs.get("back");
(function readHash() {
  const h = location.hash.slice(1).split(",");
  if (h.length >= 2 && Number.isFinite(parseFloat(h[0])) && Number.isFinite(parseFloat(h[1]))) {
    S.lat = parseFloat(h[0]);
    S.lon = parseFloat(h[1]);
  }
  if (/^\d{4}-\d\d-\d\d$/.test(h[2] || "") && h[2] !== todayStr()) {
    S.date = h[2];
    S.minute = 12 * 60;
  }
})();
const writeHash = () =>
  history.replaceState(null, "", `${location.pathname}${location.search}#${S.lat.toFixed(5)},${S.lon.toFixed(5)},${S.date}`);
($("back") as HTMLAnchorElement).href = `./#${backHash ?? `${S.lat.toFixed(5)},${S.lon.toFixed(5)}`}`;

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const hourFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric" });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const tAt = (m: number) => new Date((S.day?.start ?? 0) + m * 60_000);
const escapeHtml = (t: string) =>
  t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ---------- the skyline, from Horizon's own worker ----------

const worker = new Worker(new URL("../search/worker.ts", import.meta.url), { type: "module" });
let requestId = 0;
function readSkyline(lat: number, lon: number): Promise<SkylineResult> {
  const req: WorkerRequest = {
    type: "skyline",
    requestId: ++requestId,
    point: { lat, lon },
    azimuths: circleAzimuths(),
    maxDistM: REACH_M,
    zoom: ZOOM,
    eyeHeightM: EYE_M,
  };
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.requestId !== req.requestId || m.type === "progress") return;
      worker.removeEventListener("message", onMsg);
      if (m.type === "skylineResult") resolve(m.result);
      else reject(new Error(m.type === "error" ? m.message : m.type));
    };
    worker.addEventListener("message", onMsg);
    worker.postMessage(req);
  });
}

// ---------- the picture ----------

const pic = $("pic");
const cv = $("ov") as HTMLCanvasElement;
const cx = cv.getContext("2d")!;
const layers = [...pic.querySelectorAll<HTMLDivElement>(".layer")];
let L: Layout = frameLayout(360, 300);
/** What the photo on screen was loaded for. */
const shown = { heading: 0, angle: 0, ready: false };

for (const l of layers) {
  for (let i = 0; i < 3; i++) {
    const facet = l.appendChild(Object.assign(document.createElement("div"), { className: "facet" }));
    const f = facet.appendChild(document.createElement("iframe"));
    f.referrerPolicy = "no-referrer-when-downgrade";
    f.title = "Google Street View";
    f.loading = "eager";
    f.tabIndex = -1;
  }
}

function layout(): void {
  const aw = document.documentElement.clientWidth;
  const used = $("chips").offsetHeight + $("bar").offsetHeight + $("cap").offsetHeight;
  L = frameLayout(aw, window.innerHeight - used);
  pic.style.width = `${L.width}px`;
  pic.style.height = `${L.height}px`;
  pic.querySelectorAll<HTMLDivElement>(".facet").forEach((d, i) => {
    d.style.left = `${(i % 3) * L.frameW}px`;
    d.style.width = `${L.frameW}px`;
    d.style.height = `${L.height}px`;
    const f = d.firstChild as HTMLIFrameElement;
    f.style.width = `${L.iframeW}px`;
    f.style.height = `${L.iframeH}px`;
    f.style.left = `${-((L.iframeW - 640) / 2) * L.scale}px`;
    f.style.transform = `scale(${L.scale})`;
  });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(L.width * dpr);
  const h = Math.round(L.height * dpr);
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

let front = 0;
let token = 0;
function showPhoto(): void {
  if (!S.pano) return;
  const my = ++token;
  const back = layers[1 - front];
  const heading = S.heading;
  const angle = L.angleDeg;
  const zoom = zoomFor(angle);
  const heads = frameHeadings(heading, angle);
  let left = 3;
  back.querySelectorAll("iframe").forEach((f, i) => {
    f.onload = () => {
      if (--left) return;
      // The embed paints a moment after its load event.
      setTimeout(() => {
        if (my !== token) return;
        back.classList.add("front");
        layers[front].classList.remove("front");
        front = 1 - front;
        Object.assign(shown, { heading, angle, ready: true });
        redraw();
      }, 800);
    };
    f.src = embedUrl({ pano: S.pano!, lat: S.lat, lon: S.lon, heading: heads[i], pitch: 0, zoom });
  });
}

const COL = { sun: "#ffb300", moon: "#cfe3ff" };
const P = (az: number, alt: number) => (shown.angle === L.angleDeg ? project(L, shown.heading, az, alt) : null);
const inView = (q: [number, number] | null): q is [number, number] => !!q && q[1] > -150 && q[1] < L.height + 150;

function label(t: string, x: number, y: number, o: { align?: CanvasTextAlign; color?: string; bold?: boolean; size?: number }): void {
  cx.font = `${o.bold ? "700 " : ""}${o.size ?? 12.5}px system-ui, sans-serif`;
  cx.textAlign = o.align ?? "left";
  cx.textBaseline = "middle";
  cx.lineJoin = "round";
  cx.lineWidth = 3.5;
  cx.strokeStyle = "rgba(0,0,0,.8)";
  if (o.align === "center") {
    const tw = cx.measureText(t).width / 2 + 4;
    x = Math.max(tw, Math.min(L.width - tw, x));
  }
  cx.strokeText(t, x, y);
  cx.fillStyle = o.color ?? "#fff";
  cx.fillText(t, x, y);
}

function draw(): void {
  layout();
  cx.clearRect(0, 0, L.width, L.height);
  if (!S.sky || !shown.ready) return;
  const n = S.sky.angles.length;
  const step = 360 / n;
  for (const [w, c] of [[4.5, "rgba(0,0,0,.45)"], [2, "#ff3cc8"]] as const) {
    cx.beginPath();
    let pen = false;
    for (let i = 0; i <= n; i++) {
      const a = S.sky.angles[i % n];
      const q = Number.isFinite(a) ? P(i * step, a) : null;
      if (inView(q)) {
        if (pen) cx.lineTo(q[0], q[1]);
        else cx.moveTo(q[0], q[1]);
        pen = true;
      } else pen = false;
    }
    cx.lineWidth = w;
    cx.strokeStyle = c;
    cx.lineJoin = "round";
    cx.setLineDash([]);
    cx.stroke();
  }
  const day = S.day;
  if (!day) return;
  for (const key of ["sun", "moon"] as const) {
    const b = day[key];
    for (const above of [0, 1]) {
      cx.beginPath();
      let pen = false;
      for (let m = 0; m <= 1440; m += 2) {
        const mine = b.up[m] === above || (m >= 2 && b.up[m - 2] === above);
        const q = mine ? P(b.az[m], b.alt[m]) : null;
        if (inView(q)) {
          if (pen) cx.lineTo(q[0], q[1]);
          else cx.moveTo(q[0], q[1]);
          pen = true;
        } else pen = false;
      }
      cx.lineWidth = above ? 2.5 : 1.5;
      cx.strokeStyle = COL[key];
      cx.globalAlpha = above ? 1 : 0.45;
      cx.setLineDash(above ? [] : [4, 5]);
      cx.stroke();
    }
    cx.globalAlpha = 1;
    cx.setLineDash([]);
    for (let m = 0; m <= 1440; m += 60) {
      const q = P(b.az[m], b.alt[m]);
      if (!inView(q)) continue;
      cx.beginPath();
      cx.arc(q[0], q[1], 3.2, 0, 7);
      cx.fillStyle = COL[key];
      cx.globalAlpha = b.up[m] ? 1 : 0.5;
      cx.fill();
      cx.globalAlpha = 1;
      const near = day.crossings.some((c) => c.body === key && Math.abs(+c.time - +tAt(m)) < 25 * 60_000);
      if (b.up[m] && !near) label(hourFmt.format(tAt(m)), q[0] + (key === "sun" ? 9 : -9), q[1], { align: key === "sun" ? "left" : "right", color: COL[key] });
    }
  }
  for (const c of day.crossings) {
    const q = P(c.azDeg, skyAt(S.sky, c.azDeg));
    if (!inView(q)) continue;
    const on = S.picked === c;
    cx.beginPath();
    cx.arc(q[0], q[1], on ? 7 : 5, 0, 7);
    cx.lineWidth = 2;
    cx.strokeStyle = "#fff";
    cx.stroke();
    const dy = (c.kind === "up" ? 20 : -20) * (c.body === "sun" ? 1 : -1);
    label(`${c.body === "sun" ? "☀" : "☾"} ${c.kind} ${timeFmt.format(c.time)}`, q[0], q[1] + dy, { align: "center", bold: true, size: on ? 15 : 13.5 });
  }
  for (const key of ["sun", "moon"] as const) {
    const b = day[key];
    const m = S.minute;
    const q = P(b.az[m], b.alt[m]);
    if (!inView(q)) continue;
    const r = Math.max(4, b.radius[m] * (Math.PI / 180) * L.focal);
    if (b.up[m]) {
      const g = cx.createRadialGradient(q[0], q[1], r, q[0], q[1], r * 5);
      g.addColorStop(0, key === "sun" ? "rgba(255,200,60,.55)" : "rgba(220,235,255,.4)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      cx.fillStyle = g;
      cx.beginPath();
      cx.arc(q[0], q[1], r * 5, 0, 7);
      cx.fill();
      cx.beginPath();
      cx.arc(q[0], q[1], r, 0, 7);
      cx.fillStyle = key === "sun" ? "#ffd54a" : "#f4f8ff";
      cx.fill();
    } else {
      cx.beginPath();
      cx.arc(q[0], q[1], r, 0, 7);
      cx.setLineDash([3, 3]);
      cx.lineWidth = 1.5;
      cx.strokeStyle = COL[key];
      cx.stroke();
      cx.setLineDash([]);
    }
  }
}
let raf = 0;
const redraw = () => {
  if (!raf)
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
};

// ---------- controls ----------

function deltaText(c: Crossing): string {
  if (c.deltaMin === null) return c.kind === "up" ? "over the skyline" : "behind the skyline";
  if (c.deltaMin <= 0) return "same as flat horizon";
  return `${c.deltaMin} min ${c.kind === "up" ? "late" : "early"}`;
}

function renderChips(): void {
  const el = $("chips");
  el.innerHTML = "";
  if (S.day && !S.day.crossings.length) {
    el.innerHTML = '<span class="chip"><small>No sun or moon crossing of the skyline this day</small></span>';
  }
  for (const c of S.day?.crossings ?? []) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (S.picked === c ? " on" : "");
    b.setAttribute("aria-pressed", String(S.picked === c));
    b.innerHTML = `<b><span class="${c.body === "sun" ? "s" : "m"}">${c.body === "sun" ? "☀" : "☾"}</span> ${c.body} ${c.kind} ${timeFmt.format(c.time)}</b><small>${deltaText(c)}</small>`;
    b.onclick = () => pick(c);
    el.append(b);
  }
  el.querySelector(".on")?.scrollIntoView({ inline: "center", block: "nearest" });
}

function face(c: Crossing | null): void {
  if (c) S.heading = frameOn(c.azDeg, c.pathDir, L.angleDeg);
  showPhoto();
}

function pick(c: Crossing): void {
  S.picked = c;
  if (S.day) S.minute = Math.max(0, Math.min(1439, Math.round((+c.time - S.day.start) / 60_000)));
  ($("slider") as HTMLInputElement).value = String(S.minute);
  renderClock();
  renderChips();
  face(c);
  redraw();
}

function renderClock(): void {
  $("clock").textContent = S.day ? timeFmt.format(tAt(S.minute)) : "";
}

let msgT = 0;
function msg(html: string, ms = 0): void {
  $("msg").innerHTML = html;
  clearTimeout(msgT);
  if (ms) msgT = window.setTimeout(() => ($("msg").innerHTML = ""), ms);
}

const slider = $("slider") as HTMLInputElement;
const dateInput = $("date") as HTMLInputElement;
slider.addEventListener("input", () => {
  S.minute = +slider.value;
  renderClock();
  redraw();
});
dateInput.addEventListener("change", () => {
  if (!dateInput.value) return;
  S.date = dateInput.value;
  writeHash();
  recompute(false);
});
$("now").addEventListener("click", () => {
  S.date = todayStr();
  S.minute = minuteNow();
  dateInput.value = S.date;
  slider.value = String(S.minute);
  writeHash();
  recompute(false);
});
const info = $("info");
$("what").addEventListener("click", () => {
  info.hidden = !info.hidden;
  $("what").setAttribute("aria-expanded", String(!info.hidden));
});
$("close").addEventListener("click", () => {
  info.hidden = true;
  $("what").setAttribute("aria-expanded", "false");
});
let lastAngle = 0;
window.addEventListener("resize", () => {
  layout();
  if (lastAngle && lastAngle !== L.angleDeg) face(S.picked);
  lastAngle = L.angleDeg;
  redraw();
});

// ---------- the flow ----------

let svc: StreetViewService;
const NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function setSteps(links: PanoData["links"]): void {
  const el = $("steps");
  el.innerHTML = "";
  for (const l of links ?? []) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `Step ${NAMES[Math.round((((l.heading % 360) + 360) % 360) / 45) % 8]}`;
    b.onclick = () => void lookup({ pano: l.pano });
    el.append(b);
  }
}

function monthOf(imageDate?: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(imageDate ?? "");
  return m ? monthFmt.format(new Date(+m[1], +m[2] - 1, 1)) : "";
}

async function lookup(req: { pano?: string }): Promise<void> {
  msg("Finding Street View…");
  let data: PanoData;
  try {
    const ask = req.pano ? { pano: req.pano } : { location: { lat: S.lat, lng: S.lon }, radius: RADIUS_M, preference: "nearest", sources: ["google"] };
    data = (await svc.getPanorama(ask)).data;
  } catch {
    const back = ($("back") as HTMLAnchorElement).href;
    msg(`No Street View within ${RADIUS_M} m of this spot.<br><a href="${escapeHtml(back)}">Back to the skyline strip</a>`);
    $("chips").innerHTML = "";
    return;
  }
  const l = data.location;
  shown.ready = false;
  S.pano = l.pano;
  S.lat = l.latLng.lat();
  S.lon = l.latLng.lng();
  const month = monthOf(data.imageDate);
  const link = `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(S.pano)}&heading=${Math.round(S.heading)}`;
  $("cap").innerHTML = `Google Street View${month ? `, ${escapeHtml(month)}` : ""} · <a target="_blank" rel="noopener" href="${link}">open in Google Maps</a>`;
  writeHash();
  setSteps(data.links);
  await recompute(true);
}

let job = 0;
async function recompute(moved: boolean): Promise<void> {
  const my = ++job;
  if (moved || !S.sky) {
    msg("Reading the terrain…");
    const t0 = performance.now();
    let r: SkylineResult;
    try {
      r = await readSkyline(S.lat, S.lon);
    } catch (err) {
      console.error(err);
      if (my === job) msg("The terrain didn't load. Try Step, or Back.");
      return;
    }
    if (my !== job) return;
    S.sky = { angles: r.angles, what: r.what };
    (window.__street as object | undefined) ??= {};
    Object.assign(window.__street as object, { skylineMs: Math.round(performance.now() - t0) });
  }
  S.day = computeDay(S.lat, S.lon, S.date, S.sky!);
  msg("");
  const prev = S.picked;
  const cs = S.day.crossings;
  const nowT = +tAt(S.minute);
  S.picked = (prev && cs.find((c) => c.body === prev.body && c.kind === prev.kind)) || cs.find((c) => +c.time >= nowT) || cs[0] || null;
  window.__street = {
    ...(window.__street as object),
    lat: S.lat,
    lon: S.lon,
    pano: S.pano,
    date: S.date,
    crossings: cs.map((c) => ({ body: c.body, kind: c.kind, time: c.time.toISOString(), local: timeFmt.format(c.time), azDeg: c.azDeg, deltaMin: c.deltaMin })),
  };
  renderChips();
  renderClock();
  lastAngle = L.angleDeg;
  face(S.picked);
  redraw();
}

window.__streetStart = () => {
  svc = new window.google!.maps.StreetViewService();
  void lookup({});
};

dateInput.value = S.date;
slider.value = String(S.minute);
layout();
const s = document.createElement("script");
s.async = true;
// No key: Google's development mode. The free Maps Embed key comes with the go-live step.
s.src = "https://maps.googleapis.com/maps/api/js?v=weekly&loading=async&callback=__streetStart";
s.onerror = () => msg("Google Street View didn't load.");
document.head.append(s);
