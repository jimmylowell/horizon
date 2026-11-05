/**
 * Roads and places in one Overpass request. The roadside sample and the
 * mapped places used to be two lookups, each walking the mirror list in turn;
 * now one merged query races the mirrors once, under one cap.
 */

import type { LatLon } from "../geo";
import type { Candidate } from "./grid";
import { overpassJson } from "./overpass";
import {
  categoriesForMode,
  POI_OUT,
  poiBBox,
  poisFromElements,
  poiUnionClause,
  type OverpassElement,
  type TravelMode,
} from "./pois";
import { roadQueryClause, roadsFromElements } from "./roads";

export interface OsmFetchResult {
  roads: Candidate[];
  pois: Candidate[];
  /** false when no mirror answered in time (distinct from "nothing mapped here"). */
  ok: boolean;
}

/** The merged query: roads out with geometry, then places out as centres. */
export function compileOsmQuery(centre: LatLon, radiusM: number, mode: TravelMode): string {
  const cats = categoriesForMode(mode);
  const lines = ["[out:json][timeout:10];", roadQueryClause(centre, radiusM, mode), "out geom qt;"];
  if (cats.length) lines.push(poiUnionClause(cats, poiBBox(centre, radiusM)), POI_OUT);
  return lines.join("\n");
}

export async function fetchOsmCandidates(
  centre: LatLon,
  radiusM: number,
  mode: TravelMode,
  maxRoads: number
): Promise<OsmFetchResult> {
  const json = await overpassJson<{ elements: OverpassElement[] }>(compileOsmQuery(centre, radiusM, mode));
  if (!json) return { roads: [], pois: [], ok: false };
  return {
    roads: roadsFromElements(json.elements, centre, radiusM, maxRoads),
    pois: poisFromElements(json.elements, categoriesForMode(mode)),
    ok: true,
  };
}
