export const DEFAULT_LATITUDE_STEP_DEG = 5;

export function createLatitudeSamples(stepDeg = DEFAULT_LATITUDE_STEP_DEG): number[] {
  if (stepDeg <= 0 || stepDeg > 180) {
    throw new Error("Latitude sample step must be in the range (0, 180].");
  }

  const samples: number[] = [];
  for (let latitude = -90; latitude <= 90 + Number.EPSILON; latitude += stepDeg) {
    samples.push(Number(latitude.toFixed(6)));
  }
  return samples;
}
