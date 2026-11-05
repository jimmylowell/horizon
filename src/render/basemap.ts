/**
 * Small repairs to the OpenFreeMap basemap style, applied as it loads.
 *
 * The style's highway-shield layers filter on `["<=", ["get", "ref_length"], 6]`.
 * A road with no `ref` has no `ref_length`, so the comparison sees null, and
 * MapLibre logs "Expected value to be of type number, but found null instead"
 * (three times on a Denver load). The style already guards its `boundary_3`
 * layer with `["==", ["typeof", ["get", "admin_level"]], "number"]`; this adds
 * the same guard to every ordering comparison between a feature property and a
 * number. A feature without the property fails the filter, which is what the
 * style means: no ref, no shield.
 */
import type { StyleSpecification } from "maplibre-gl";

const ORDERING = new Set(["<", "<=", ">", ">="]);

function isGet(x: unknown): x is ["get", string] {
  return Array.isArray(x) && x.length === 2 && x[0] === "get" && typeof x[1] === "string";
}

/** Guard every `[op, ["get", k], n]` (or `[op, n, ["get", k]]`) in a filter expression. */
export function guardNumberComparisons(expr: unknown): unknown {
  if (!Array.isArray(expr)) return expr;
  const [op, a, b] = expr;
  if (typeof op === "string" && ORDERING.has(op) && expr.length === 3) {
    const get = isGet(a) && typeof b === "number" ? a : isGet(b) && typeof a === "number" ? b : null;
    if (get) return ["all", ["==", ["typeof", get], "number"], expr];
  }
  return expr.map((x, i) => (i === 0 ? x : guardNumberComparisons(x)));
}

/** `transformStyle` for `map.setStyle`: the fetched style with its filters guarded. */
export function repairBasemapStyle(_prev: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification {
  return {
    ...next,
    layers: next.layers.map((l) =>
      "filter" in l && l.filter ? ({ ...l, filter: guardNumberComparisons(l.filter) } as typeof l) : l
    ),
  };
}
