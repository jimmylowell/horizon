/**
 * Landcover check at candidate spots, driven by data/landcover-rules.json.
 * The DEM is a surface model: a candidate inside forest reads as standing on
 * the canopy. We sample the basemap's already-loaded vector landcover layer
 * (no extra API call) and apply the data-file rules. Best effort: if the
 * style has no matching layer or tiles aren't loaded, nothing changes.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import rules from "../../data/landcover-rules.json";
import type { LatLon } from "../geo";

export interface LandcoverEffect {
  scoreDelta: number;
  flag?: string;
}

export function landcoverAt(map: MapLibreMap, at: LatLon): LandcoverEffect | null {
  const point = map.project([at.lon, at.lat]);
  let features;
  try {
    features = map.queryRenderedFeatures(point);
  } catch {
    return null;
  }
  for (const f of features) {
    if (f.sourceLayer !== rules.sourceLayer) continue;
    const cls = (f.properties?.class ?? f.properties?.subclass) as string | undefined;
    if (!cls) continue;
    const effect = (rules.classes as Record<string, LandcoverEffect>)[cls];
    if (effect) return effect;
  }
  return null;
}
