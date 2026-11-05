/**
 * The one-line answer above the spot cards (docs/salida-test.md, fix item 3).
 *
 * In a valley town every nearby spot can lose nearly as much of the event to
 * the ridge as the pin does; eight near-identical cards then hide the real
 * answer, "nowhere close is much better". When the best spot gains no more
 * than VERDICT_MARGIN_MIN over here, say so in one line and show fewer cards.
 */

/**
 * Gains at or below this many minutes are not worth the trip. The Salida test
 * (2026-11-04) found the best valley spots at +2 to +7 min over the town pin
 * and read that as "nothing nearby is much better", so 7 is the cut.
 */
export const VERDICT_MARGIN_MIN = 7;
/** Cards shown under a verdict line. */
export const VERDICT_MAX_CARDS = 3;
/** Here loses at most this much: already about as good as it gets. */
const HERE_OPEN_MIN = 2;

export type EventKind = "sunrise" | "sunset" | "moonrise" | "moonset";

export interface VerdictInput {
  kind: EventKind;
  radiusKm: number;
  /** Minutes of the event the pin loses to terrain. */
  hereLostMin: number;
  /** Minutes the best ranked spot gains over the pin (may be ≤ 0). */
  bestGainMin: number;
}

export interface Verdict {
  text: string;
  /** "stay": here is already open; "higher": the valley blocks everything near. */
  kind: "stay" | "higher";
}

/** The verdict line, or null when some spot is worth the trip. */
export function verdict(v: VerdictInput): Verdict | null {
  if (v.bestGainMin > VERDICT_MARGIN_MIN) return null;
  const within = `within ${formatKm(v.radiusKm)} km`;
  if (v.hereLostMin <= HERE_OPEN_MIN) {
    return { kind: "stay", text: `Here is about as good as it gets ${within} — stay put.` };
  }
  const rising = v.kind.endsWith("rise");
  const how = rising ? "sooner" : "longer";
  const gain = Math.max(0, Math.round(v.bestGainMin));
  const amount =
    gain <= 0
      ? `${how} than here`
      : `more than ${gain} minute${gain === 1 ? "" : "s"} ${how}`;
  return { kind: "higher", text: `Nowhere ${within} sees this ${v.kind} ${amount}; go higher.` };
}

function formatKm(km: number): string {
  return Number.isInteger(km) ? String(km) : km.toFixed(1);
}
