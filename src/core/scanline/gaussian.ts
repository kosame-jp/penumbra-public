import { signedLongitudeOffsetDeg } from "./geometry";

export const DEFAULT_SCANLINE_SIGMA_DEG = 7;
export const DEFAULT_REACH_SIGMA_MULTIPLE = 3;

export function gaussianWeight(offsetDeg: number, sigmaDeg = DEFAULT_SCANLINE_SIGMA_DEG): number {
  if (sigmaDeg <= 0) {
    throw new Error("Scanline sigma must be greater than zero.");
  }

  return Math.exp(-(offsetDeg ** 2) / (2 * sigmaDeg ** 2));
}

export function gaussianWeightForLongitudes(
  longitudeDeg: number,
  centerLongitudeDeg: number,
  sigmaDeg = DEFAULT_SCANLINE_SIGMA_DEG,
): number {
  return gaussianWeight(signedLongitudeOffsetDeg(longitudeDeg, centerLongitudeDeg), sigmaDeg);
}
