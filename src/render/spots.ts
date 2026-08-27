/** Ranked spot markers (numbered) on the map. */

import { Marker, type Map as MapLibreMap } from "maplibre-gl";

export interface SpotMarkerInput {
  lat: number;
  lon: number;
  rank: number;
  isPoi: boolean;
}

let markers: Marker[] = [];

export function renderSpotMarkers(
  map: MapLibreMap,
  spots: SpotMarkerInput[],
  onClick: (rank: number) => void
): void {
  clearSpotMarkers();
  for (const s of spots) {
    const el = document.createElement("div");
    el.className = `spot-marker${s.isPoi ? " poi" : ""}`;
    el.textContent = String(s.rank);
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(s.rank);
    });
    markers.push(new Marker({ element: el, anchor: "center" }).setLngLat([s.lon, s.lat]).addTo(map));
  }
}

export function clearSpotMarkers(): void {
  for (const m of markers) m.remove();
  markers = [];
}
