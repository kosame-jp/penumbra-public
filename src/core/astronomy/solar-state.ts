import { createCanonicalUtcState } from "../time/utc-clock";
import { degToRad, normalizeDegrees180, normalizeDegrees360, radToDeg } from "../scanline/geometry";

export interface SolarState {
  readonly utcIso: string;
  readonly julianDay: number;
  readonly solarDeclinationDeg: number;
  readonly equationOfTimeMinutes: number;
  readonly subsolarLongitudeDeg: number;
}

const UNIX_EPOCH_JULIAN_DAY = 2440587.5;
const MILLIS_PER_DAY = 86_400_000;

export function computeSolarState(date: Date): SolarState {
  const utc = createCanonicalUtcState(date);
  const julianDay = utc.epochMs / MILLIS_PER_DAY + UNIX_EPOCH_JULIAN_DAY;
  const julianCentury = (julianDay - 2451545.0) / 36525;

  const geometricMeanLongitude = normalizeDegrees360(
    280.46646 + julianCentury * (36000.76983 + julianCentury * 0.0003032),
  );
  const geometricMeanAnomaly = normalizeDegrees360(
    357.52911 + julianCentury * (35999.05029 - 0.0001537 * julianCentury),
  );
  const eccentricity =
    0.016708634 - julianCentury * (0.000042037 + 0.0000001267 * julianCentury);

  const meanAnomalyRad = degToRad(geometricMeanAnomaly);
  const equationOfCenter =
    Math.sin(meanAnomalyRad) *
      (1.914602 - julianCentury * (0.004817 + 0.000014 * julianCentury)) +
    Math.sin(2 * meanAnomalyRad) * (0.019993 - 0.000101 * julianCentury) +
    Math.sin(3 * meanAnomalyRad) * 0.000289;

  const trueLongitude = geometricMeanLongitude + equationOfCenter;
  const omega = 125.04 - 1934.136 * julianCentury;
  const apparentLongitude =
    trueLongitude - 0.00569 - 0.00478 * Math.sin(degToRad(omega));

  const meanObliquitySeconds =
    21.448 -
    julianCentury *
      (46.815 + julianCentury * (0.00059 - julianCentury * 0.001813));
  const meanObliquityDeg = 23 + (26 + meanObliquitySeconds / 60) / 60;
  const correctedObliquity =
    meanObliquityDeg + 0.00256 * Math.cos(degToRad(omega));

  const solarDeclinationDeg = radToDeg(
    Math.asin(
      Math.sin(degToRad(correctedObliquity)) *
        Math.sin(degToRad(apparentLongitude)),
    ),
  );

  const y = Math.tan(degToRad(correctedObliquity) / 2) ** 2;
  const geometricMeanLongitudeRad = degToRad(geometricMeanLongitude);
  const equationOfTimeMinutes =
    4 *
    radToDeg(
      y * Math.sin(2 * geometricMeanLongitudeRad) -
        2 * eccentricity * Math.sin(meanAnomalyRad) +
        4 *
          eccentricity *
          y *
          Math.sin(meanAnomalyRad) *
          Math.cos(2 * geometricMeanLongitudeRad) -
        0.5 * y ** 2 * Math.sin(4 * geometricMeanLongitudeRad) -
        1.25 * eccentricity ** 2 * Math.sin(2 * meanAnomalyRad),
    );

  const subsolarLongitudeDeg = normalizeDegrees180(
    (720 - utc.utcMinutesOfDay - equationOfTimeMinutes) / 4,
  );

  return {
    utcIso: utc.iso,
    julianDay,
    solarDeclinationDeg,
    equationOfTimeMinutes,
    subsolarLongitudeDeg,
  };
}
