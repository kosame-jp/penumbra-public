import { degToRad, normalizeDegrees180, radToDeg } from "../scanline/geometry";
import type { SolarState } from "./solar-state";

export interface TerminatorPoint {
  readonly latitudeDeg: number;
  readonly sunriseLongitudeDeg: number | null;
  readonly polarState: "normal" | "polar_day" | "polar_night";
}

export function sunriseLongitudeAtLatitude(
  latitudeDeg: number,
  solarState: SolarState,
): TerminatorPoint {
  const latitudeRad = degToRad(latitudeDeg);
  const declinationRad = degToRad(solarState.solarDeclinationDeg);
  const hourAngleArgument = -Math.tan(latitudeRad) * Math.tan(declinationRad);

  if (hourAngleArgument < -1) {
    return {
      latitudeDeg,
      sunriseLongitudeDeg: null,
      polarState: "polar_day",
    };
  }

  if (hourAngleArgument > 1) {
    return {
      latitudeDeg,
      sunriseLongitudeDeg: null,
      polarState: "polar_night",
    };
  }

  const sunriseHourAngleDeg = radToDeg(Math.acos(hourAngleArgument));
  return {
    latitudeDeg,
    sunriseLongitudeDeg: normalizeDegrees180(
      solarState.subsolarLongitudeDeg - sunriseHourAngleDeg,
    ),
    polarState: "normal",
  };
}

export function equatorSunriseLongitude(solarState: SolarState): number {
  return sunriseLongitudeAtLatitude(0, solarState).sunriseLongitudeDeg ?? 0;
}
