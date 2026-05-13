import { absoluteLongitudeDistanceDeg } from "./geometry";
import { DEFAULT_REACH_SIGMA_MULTIPLE, DEFAULT_SCANLINE_SIGMA_DEG } from "./gaussian";

export function activeReachDeg(
  sigmaDeg = DEFAULT_SCANLINE_SIGMA_DEG,
  reachSigmaMultiple = DEFAULT_REACH_SIGMA_MULTIPLE,
): number {
  return sigmaDeg * reachSigmaMultiple;
}

export function isWithinActiveReach(
  longitudeDeg: number,
  centerLongitudeDeg: number,
  sigmaDeg = DEFAULT_SCANLINE_SIGMA_DEG,
  reachSigmaMultiple = DEFAULT_REACH_SIGMA_MULTIPLE,
): boolean {
  return absoluteLongitudeDistanceDeg(longitudeDeg, centerLongitudeDeg) <= activeReachDeg(sigmaDeg, reachSigmaMultiple);
}
