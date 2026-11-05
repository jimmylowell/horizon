/**
 * What a spot's card says about the event: open, behind the ridge, or
 * unknown because terrain toward it did not load (docs/salida-test.md,
 * finding 7, fix item 5).
 *
 * A gap in the terrain can only hide a blocker, never remove one, so a spot
 * with missing data is never called open: the minutes lost are a minimum.
 */

import { lostGrade } from "./score";
import type { EventKind } from "./verdict";

export interface ReadingInput {
  kind: EventKind;
  /** Minutes of the event lost to known terrain. */
  lostMin: number;
  /** Formatted time the body clears / goes behind the ridge; null if the known terrain leaves it open. */
  whenText: string | null;
  /** The event rays crossed missing terrain. */
  noData: boolean;
}

export interface Reading {
  label: string;
  /** Styling grade 4 best … 0 worst, or "u" for unknown. */
  grade: 0 | 1 | 2 | 3 | 4 | "u";
  unknown: boolean;
}

export function spotReading(r: ReadingInput): Reading {
  const rising = r.kind.endsWith("rise");
  if (r.noData) {
    if (!r.whenText) {
      return { label: `Unknown: terrain didn't load toward the ${r.kind}`, grade: "u", unknown: true };
    }
    return {
      label: rising
        ? `Clears the ridge ~${r.whenText} or later (+${r.lostMin} min or more)`
        : `Behind the ridge ~${r.whenText} or earlier (−${r.lostMin} min or more)`,
      grade: "u",
      unknown: true,
    };
  }
  if (!r.whenText) return { label: `Open horizon — full ${rising ? "rise" : "set"}`, grade: 4, unknown: false };
  const lost = `${rising ? "+" : "−"}${r.lostMin} min`;
  return {
    label: rising ? `Clears the ridge ~${r.whenText} (${lost})` : `Behind the ridge ~${r.whenText} (${lost})`,
    grade: lostGrade(r.lostMin),
    unknown: false,
  };
}

/** The warning line on a card whose event rays crossed missing terrain. */
export function noDataFlag(kind: EventKind): string {
  return `Terrain didn't load along part of the ${kind} line, so this spot may be more blocked than shown`;
}
