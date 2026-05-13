export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeDegrees360(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function normalizeDegrees180(degrees: number): number {
  const normalized = normalizeDegrees360(degrees + 180) - 180;
  return normalized === -180 ? 180 : normalized;
}

export function signedLongitudeOffsetDeg(longitudeDeg: number, centerLongitudeDeg: number): number {
  return normalizeDegrees180(longitudeDeg - centerLongitudeDeg);
}

export function absoluteLongitudeDistanceDeg(
  longitudeDeg: number,
  centerLongitudeDeg: number,
): number {
  return Math.abs(signedLongitudeOffsetDeg(longitudeDeg, centerLongitudeDeg));
}
