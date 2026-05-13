import { computeSolarState, type SolarState } from "../astronomy/solar-state";
import { equatorSunriseLongitude, sunriseLongitudeAtLatitude } from "../astronomy/terminator";
import type { TerminatorPoint } from "../astronomy/terminator";
import { createCanonicalUtcState, type CanonicalUtcState } from "../time/utc-clock";
import { DEFAULT_SCANLINE_SIGMA_DEG } from "./gaussian";
import { createLatitudeSamples, DEFAULT_LATITUDE_STEP_DEG } from "./latitude-sampler";
import { activeReachDeg } from "./reach";

export interface ScanlineState {
  readonly utc: CanonicalUtcState;
  readonly solar: SolarState;
  readonly sigmaDeg: number;
  readonly activeReachDeg: number;
  readonly latitudeStepDeg: number;
  readonly equatorLongitudeDeg: number;
  readonly points: readonly TerminatorPoint[];
}

export interface ScanlineStateOptions {
  readonly sigmaDeg?: number;
  readonly latitudeStepDeg?: number;
}

export function createScanlineState(date: Date, options: ScanlineStateOptions = {}): ScanlineState {
  const sigmaDeg = options.sigmaDeg ?? DEFAULT_SCANLINE_SIGMA_DEG;
  const latitudeStepDeg = options.latitudeStepDeg ?? DEFAULT_LATITUDE_STEP_DEG;
  const solar = computeSolarState(date);
  const latitudes = createLatitudeSamples(latitudeStepDeg);
  const points = latitudes.map((latitude) => sunriseLongitudeAtLatitude(latitude, solar));

  return {
    utc: createCanonicalUtcState(date),
    solar,
    sigmaDeg,
    activeReachDeg: activeReachDeg(sigmaDeg),
    latitudeStepDeg,
    equatorLongitudeDeg: equatorSunriseLongitude(solar),
    points,
  };
}
