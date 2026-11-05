/**
 * The one small line under the verdict (docs/salida-test.md, fix item 4).
 *
 * On a 390 px phone the colour legend and up to two warning boxes pushed the
 * first spot card below the fold. They are folded into one line of short
 * phrases; tapping it opens the full sentences, which say the same things as
 * the old boxes did.
 */

export interface NotesInput {
  /** The heatmap is drawn, so the colours need a key. */
  heatmap: boolean;
  /** Median score is clearly negative: the terrain blocks the view all round. */
  terrainBlocksAll: boolean;
  /** Where the roads-and-places lookup stands. */
  osm: "pending" | "ok" | "failed";
  /** At least one candidate came from a mapped road. */
  roadsIn: boolean;
  /** Building footprints were wanted (walk/bike) and did not arrive. */
  buildingsMissing: boolean;
}

export interface NotesLine {
  /** Short phrases for the folded line, in reading order. */
  short: string[];
  /** The full sentences shown when the line is opened. */
  full: string[];
  /** Something in it means the spots are less reliable than usual. */
  warn: boolean;
}

export function resultNotes(n: NotesInput): NotesLine {
  const short: string[] = [];
  const full: string[] = [];
  if (n.heatmap) {
    short.push("map: worse → better here");
    full.push(
      n.terrainBlocksAll
        ? "Terrain blocks some of the view everywhere near you, so the map colours compare spots with each other, not with a flat horizon: red is worse, blue is better."
        : "The map colours compare spots with each other in this area: red is worse, blue is better."
    );
  }
  let warn = false;

  if (n.osm === "pending") {
    short.push("adding roads…");
    full.push("Best by terrain so far; roads and named places from OpenStreetMap are still on their way.");
  } else if (n.osm === "failed") {
    short.push("⚠ terrain only, OSM down");
    full.push(
      "OpenStreetMap isn't answering right now, so spots are by terrain alone and nobody has checked you can get there. Try again in a minute for roadside spots and named places."
    );
    warn = true;
  } else if (!n.roadsIn) {
    short.push("no roads to stop on");
    full.push("No mapped roads you can stop on in this ring, so spots are by terrain alone.");
  }

  if (n.buildingsMissing) {
    short.push("⚠ buildings ignored");
    full.push(
      "Building data isn't available right now, so scores ignore buildings and streets look more open than they are."
    );
    warn = true;
  }

  return { short, full, warn };
}
