export interface MusicLayerParams {
  readonly active: boolean;
  readonly gain01: number;
  readonly frequencyHz: number;
}

export function musicLayerParams(
  nightLightNorm: number,
  scanlineWeight: number,
  frequencyHz: number,
): MusicLayerParams {
  const gain01 = nightLightNorm * scanlineWeight;
  return {
    active: gain01 > 0,
    gain01,
    frequencyHz,
  };
}
