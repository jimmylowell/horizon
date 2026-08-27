/**
 * Score surface as a smooth interpolated raster (IDW over the candidate grid)
 * rendered to a canvas and draped on the map as an image source — no dots.
 *
 * Color: diverging pair (red = worse, blue = better, neutral gray between),
 * stretched to the LOCAL score distribution (p5 / median / p95). In mountain
 * terrain everything is "obstructed" in absolute terms; what matters is which
 * reachable spot is better than the rest, so the ramp always spends its range
 * on the area actually being searched.
 */

import type { ImageSource, Map as MapLibreMap } from "maplibre-gl";
import { DEG, type LatLon } from "../geo";

export interface ScorePoint {
  lat: number;
  lon: number;
  score: number;
  obstructionDeg: number;
  horizonDistM: number;
  /** Point on the skyline the event happens behind (for the sightline overlay). */
  horizonLat: number;
  horizonLon: number;
}

const SOURCE = "horizon-heat";
const LAYER = "horizon-heat-layer";
const SIZE = 480;

// Diverging stops at normalized t = 0 … 1 (worse → better).
const STOPS: [number, [number, number, number]][] = [
  [0.0, [169, 47, 47]], // #a92f2f
  [0.25, [227, 73, 72]], // #e34948
  [0.5, [240, 239, 236]], // #f0efec neutral
  [0.75, [109, 167, 236]], // #6da7ec
  [1.0, [16, 66, 129]], // #104281
];

function buildLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < STOPS.length - 2 && t > STOPS[k + 1][0]) k++;
    const [t0, c0] = STOPS[k];
    const [t1, c1] = STOPS[k + 1];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * f;
  }
  return lut;
}
const LUT = buildLut();

function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (idx - lo);
}

export interface HeatmapStats {
  p5: number;
  p50: number;
  p95: number;
}

export function renderHeatmap(
  map: MapLibreMap,
  points: ScorePoint[],
  spacingM: number,
  centre: LatLon,
  radiusM: number
): HeatmapStats | null {
  if (points.length === 0) return null;

  const sorted = points.map((p) => p.score).sort((a, b) => a - b);
  let p5 = percentile(sorted, 0.05);
  let p50 = percentile(sorted, 0.5);
  let p95 = percentile(sorted, 0.95);
  // Degenerate (flat plains): keep a minimum stretch so noise isn't amplified.
  if (p95 - p5 < 0.3) {
    p5 = p50 - 0.25;
    p95 = p50 + 0.25;
  }

  const cosLat = Math.cos(centre.lat * DEG);
  const spanM = radiusM * 1.08;
  const dLat = spanM / 111_320;
  const dLon = spanM / (111_320 * cosLat);
  const west = centre.lon - dLon;
  const east = centre.lon + dLon;
  const north = centre.lat + dLat;
  const south = centre.lat - dLat;

  // Candidate points in raster pixel space + coarse spatial hash.
  const pxPerM = SIZE / (2 * spanM);
  const px = new Float32Array(points.length);
  const py = new Float32Array(points.length);
  const pv = new Float32Array(points.length);
  const cell = Math.max(4, spacingM * pxPerM);
  const hash = new Map<number, number[]>();
  const hashKey = (cx: number, cy: number) => cy * 4096 + cx;
  for (let i = 0; i < points.length; i++) {
    px[i] = ((points[i].lon - west) / (east - west)) * SIZE;
    py[i] = ((north - points[i].lat) / (north - south)) * SIZE;
    pv[i] = points[i].score;
    const key = hashKey(Math.floor(px[i] / cell), Math.floor(py[i] / cell));
    let arr = hash.get(key);
    if (!arr) hash.set(key, (arr = []));
    arr.push(i);
  }

  const searchPx = spacingM * 2.8 * pxPerM;
  const softPx2 = (0.35 * spacingM * pxPerM) ** 2;
  const searchCells = Math.ceil(searchPx / cell);
  const radiusPx = radiusM * pxPerM;
  const featherPx = radiusPx * 0.08;
  const cx0 = SIZE / 2;
  const cy0 = SIZE / 2;

  const img = new ImageData(SIZE, SIZE);
  const data = img.data;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const rC = Math.hypot(x - cx0, y - cy0);
      if (rC > radiusPx + featherPx) continue;

      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      let sumW = 0;
      let sumV = 0;
      for (let dy = -searchCells; dy <= searchCells; dy++) {
        for (let dx = -searchCells; dx <= searchCells; dx++) {
          const arr = hash.get(hashKey(gx + dx, gy + dy));
          if (!arr) continue;
          for (const i of arr) {
            const d2 = (px[i] - x) ** 2 + (py[i] - y) ** 2;
            if (d2 > searchPx * searchPx) continue;
            const w = 1 / (d2 + softPx2);
            sumW += w;
            sumV += w * pv[i];
          }
        }
      }
      if (sumW === 0) continue;

      const v = sumV / sumW;
      // Piecewise-linear percentile stretch: p5→0, p50→0.5, p95→1.
      const t =
        v <= p50
          ? 0.5 * Math.min(1, Math.max(0, (v - p5) / (p50 - p5 || 1)))
          : 0.5 + 0.5 * Math.min(1, Math.max(0, (v - p50) / (p95 - p50 || 1)));
      const li = Math.round(t * 255) * 3;
      const o = (y * SIZE + x) * 4;
      const feather = Math.min(1, Math.max(0, (radiusPx + featherPx - rC) / featherPx));
      data[o] = LUT[li];
      data[o + 1] = LUT[li + 1];
      data[o + 2] = LUT[li + 2];
      data[o + 3] = Math.round(150 * feather);
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.getContext("2d")!.putImageData(img, 0, 0);
  const url = canvas.toDataURL("image/png");
  const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];

  const existing = map.getSource(SOURCE) as ImageSource | undefined;
  if (existing) {
    existing.updateImage({ url, coordinates });
  } else {
    map.addSource(SOURCE, { type: "image", url, coordinates });
  }
  if (!map.getLayer(LAYER)) {
    map.addLayer({
      id: LAYER,
      type: "raster",
      source: SOURCE,
      paint: { "raster-opacity": 0.85, "raster-resampling": "linear" },
    });
  }
  return { p5, p50, p95 };
}

export function clearHeatmap(map: MapLibreMap): void {
  if (map.getLayer(LAYER)) map.removeLayer(LAYER);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
}
