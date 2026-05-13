import type { EarthquakeEvent } from "../live-data/quake-store";
import type { ScanlineState } from "../scanline/scanline-state";
import {
  filterActiveQuakes,
  nearestScanlinePointForLatitude,
  quakeAgeMinutes,
} from "../live-data/quake-store";
import { gaussianWeightForLongitudes } from "../scanline/gaussian";
import { clamp } from "../scanline/geometry";

export interface CanonicalQuakeContact {
  readonly event: EarthquakeEvent;
  readonly eventAgeMinutes: number;
  readonly scanlineWeight: number;
  readonly velocity01: number;
  readonly depthDarkness01: number;
}

export function quakesForLatitudeSample(
  quakes: readonly EarthquakeEvent[],
  now: Date,
  scanlineState: ScanlineState,
  latitudeDeg: number,
  latitudeBandDeg: number,
): EarthquakeEvent[] {
  return filterActiveQuakes(quakes, now, scanlineState).filter(
    (quake) => Math.abs(quake.latitudeDeg - latitudeDeg) <= latitudeBandDeg,
  );
}

export function canonicalQuakeContact(
  quake: EarthquakeEvent,
  now: Date,
  scanlineState: ScanlineState,
): CanonicalQuakeContact | undefined {
  const nearestPoint = nearestScanlinePointForLatitude(quake.latitudeDeg, scanlineState);
  if (nearestPoint?.sunriseLongitudeDeg == null) {
    return undefined;
  }

  return {
    event: quake,
    eventAgeMinutes: quakeAgeMinutes(now, quake),
    scanlineWeight: gaussianWeightForLongitudes(
      quake.longitudeDeg,
      nearestPoint.sunriseLongitudeDeg,
      scanlineState.sigmaDeg,
    ),
    velocity01: clamp(quake.magnitude / 10, 0, 1),
    depthDarkness01: clamp(quake.depthKm / 700, 0, 1),
  };
}
