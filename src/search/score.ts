/** Scoring: how good is a spot for watching a rise/set on its horizon? */

import { DEG } from "../geo";

export interface ScoreInput {
  /** Mean obstruction angle toward the event, degrees (negative = dip). */
  obstructionDeg: number;
  /** Distance to the horizon feature, metres. */
  horizonDistM: number;
}

/**
 * Higher is better. Primary term: degrees of clear sky relative to a flat
 * horizon (negative obstruction = you're above the surroundings). Secondary:
 * a gentle bonus for a farther horizon (more distance between you and it).
 */
export function score(input: ScoreInput): number {
  const distKm = Math.max(0.5, input.horizonDistM / 1000);
  return -input.obstructionDeg + 0.25 * Math.log10(distKm / 5);
}

/** A ring direction counts as open sky below this obstruction angle. */
export const OPEN_SKY_MAX_DEG = 1.5;

export interface SkyOpenness {
  /** Weighted open fraction 0..1 (cosine lobe toward the event azimuth). */
  openness: number;
  /** Unweighted open arc, 0..360 — the honest number to show the user. */
  openSkyDeg: number;
}

/**
 * How much of the whole sky a spot actually sees. The show fills the sky —
 * afterglow and lit clouds sunward, alpenglow and the earth-shadow band
 * behind you — so the sunward half weighs most but the anti-solar side
 * never drops to zero.
 */
export function skyOpenness(
  ringAngles: number[],
  ringAzimuthsDeg: number[],
  eventAzimuthDeg: number
): SkyOpenness {
  let wSum = 0;
  let wOpen = 0;
  let openCount = 0;
  for (let i = 0; i < ringAngles.length; i++) {
    const w = 0.65 + 0.35 * Math.cos((ringAzimuthsDeg[i] - eventAzimuthDeg) * DEG);
    wSum += w;
    if (ringAngles[i] < OPEN_SKY_MAX_DEG) {
      wOpen += w;
      openCount++;
    }
  }
  return {
    openness: wSum > 0 ? wOpen / wSum : 0,
    openSkyDeg: ringAngles.length ? (360 * openCount) / ringAngles.length : 0,
  };
}

/**
 * Stage-2 refinement, added onto a stage-1 score so earlier penalties
 * survive: softens the sun-line obstruction weight from 1.0 to 0.6 (near
 * mountains an imperfect set line is forgivable) and swings ±1.5 on
 * openness — being hemmed in on three sides costs as much as forest canopy.
 */
export function opennessDelta(obstructionDeg: number, openness: number): number {
  return 0.4 * obstructionDeg + 3.0 * (openness - 0.5);
}

export interface Verdict {
  label: string;
  /** 0 worst .. 4 best, for styling. */
  grade: 0 | 1 | 2 | 3 | 4;
}

export function verdict(obstructionDeg: number): Verdict {
  if (obstructionDeg <= -0.3) return { label: "Panoramic — you're above the horizon", grade: 4 };
  if (obstructionDeg <= 0.15) return { label: "Wide open", grade: 3 };
  if (obstructionDeg <= 0.75) return { label: "Slightly obstructed", grade: 2 };
  if (obstructionDeg <= 2) return { label: "Obstructed — event cut short", grade: 1 };
  return { label: "Blocked by terrain", grade: 0 };
}
