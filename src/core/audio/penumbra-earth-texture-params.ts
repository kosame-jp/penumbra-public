import type { AudioFrameParams } from "./audio-params";
import {
  EARTH_DRONE_PARTIALS,
  deriveEarthAirTurbulence,
  earthDronePartialFrequencyHz,
} from "./earth-drone-spectrum";

export type PenumbraDropletBand = "low" | "mid" | "high";

export interface PenumbraDropletShape {
  readonly pitchSweep: number;
  readonly sweepTimeMs: number;
  readonly dropDecaySeconds: number;
  readonly transient01: number;
}

export interface PenumbraAcousticTarget {
  readonly reverbWet01: number;
  readonly reverbSize: number;
  readonly distance01: number;
  readonly airAbsorbHz: number;
}

export interface PenumbraWaterTextureParams {
  readonly noiseFloorGain01: number;
  readonly dropletDensityHz: number;
  readonly lowDensityHz: number;
  readonly midDensityHz: number;
  readonly highDensityHz: number;
  readonly dropletGain01: number;
  readonly brightness01: number;
  readonly lowLevel01: number;
  readonly midLevel01: number;
  readonly highLevel01: number;
}

export interface PenumbraWindTextureParams {
  readonly bodyLevel01: number;
  readonly midLevel01: number;
  readonly midHighLevel01: number;
  readonly highLevel01: number;
  readonly airLevel01: number;
  readonly dryLevelScale01: number;
  readonly formantSourceScale01: number;
  readonly bodyCenterHz: number;
  readonly midCenterHz: number;
  readonly midHighCenterHz: number;
  readonly highCenterHz: number;
  readonly airCenterHz: number;
  readonly bodyQ: number;
  readonly midQ: number;
  readonly midHighQ: number;
  readonly highQ: number;
  readonly airQ: number;
}

export interface PenumbraRainGranularParams {
  readonly densityHz: number;
  readonly gain01: number;
  readonly brightness01: number;
  readonly grainDurationSeconds: number;
  readonly impact01: number;
  readonly softness01: number;
  readonly shapeVariance01: number;
  readonly playbackRate01: number;
  readonly stereoSpread01: number;
  readonly offsetDrift01: number;
  readonly airAbsorbHz: number;
}

export interface PenumbraEarthTextureParams {
  readonly active: boolean;
  readonly water: PenumbraWaterTextureParams;
  readonly wind: PenumbraWindTextureParams;
  readonly rainGranular: PenumbraRainGranularParams;
  readonly acoustic: PenumbraAcousticTarget;
}

export const PENUMBRA_DROPLET_TARGETS: Record<PenumbraDropletBand, PenumbraDropletShape> = {
  high: {
    pitchSweep: 2,
    sweepTimeMs: 50,
    dropDecaySeconds: 0.04,
    transient01: 0,
  },
  mid: {
    pitchSweep: 1.6,
    sweepTimeMs: 90,
    dropDecaySeconds: 0.15,
    transient01: 0,
  },
  low: {
    pitchSweep: 5,
    sweepTimeMs: 240,
    dropDecaySeconds: 0.4,
    transient01: 0,
  },
};

export const PENUMBRA_DROPLET_BAND_ANCHORS_HZ: Record<PenumbraDropletBand, number> = {
  low: 197,
  mid: 605,
  high: 2974,
};

export const PENUMBRA_DROPLET_BAND_LIMITS_HZ: Record<
  PenumbraDropletBand,
  { readonly minHz: number; readonly maxHz: number }
> = {
  low: { minHz: 36, maxHz: 240 },
  mid: { minHz: 260, maxHz: 1900 },
  high: { minHz: 2200, maxHz: 12000 },
};

const PENUMBRA_DROPLET_PARTIAL_INDICES: Record<PenumbraDropletBand, readonly number[]> = {
  low: [0, 1],
  mid: [1, 2, 3, 4],
  high: [6, 7, 8, 9, 10, 11],
};

export const PENUMBRA_WIND_TEXTURE_DRY_LEVEL_SCALE = 0.34;
export const PENUMBRA_WIND_FORMANT_SOURCE_LEVEL_SCALE = 0.58;

export const PENUMBRA_ACOUSTIC_TARGET: PenumbraAcousticTarget = {
  reverbWet01: 0.9,
  reverbSize: 4.1,
  distance01: 0.45,
  airAbsorbHz: 9000,
};

export function derivePenumbraDropletShapeForFrequency(frequencyHz: number): PenumbraDropletShape {
  const safeFrequency = clampNumber(frequencyHz, 20, 18000);
  if (safeFrequency <= PENUMBRA_DROPLET_BAND_ANCHORS_HZ.mid) {
    return interpolateDropletShape(
      PENUMBRA_DROPLET_TARGETS.low,
      PENUMBRA_DROPLET_TARGETS.mid,
      normalizedLogFrequency(
        safeFrequency,
        PENUMBRA_DROPLET_BAND_ANCHORS_HZ.low,
        PENUMBRA_DROPLET_BAND_ANCHORS_HZ.mid,
      ),
    );
  }

  return interpolateDropletShape(
    PENUMBRA_DROPLET_TARGETS.mid,
    PENUMBRA_DROPLET_TARGETS.high,
    normalizedLogFrequency(
      safeFrequency,
      PENUMBRA_DROPLET_BAND_ANCHORS_HZ.mid,
      PENUMBRA_DROPLET_BAND_ANCHORS_HZ.high,
    ),
  );
}

export function penumbraDropletBandForFrequency(frequencyHz: number): PenumbraDropletBand {
  if (frequencyHz < 250) {
    return "low";
  }
  if (frequencyHz < 2000) {
    return "mid";
  }
  return "high";
}

export function penumbraDropletFrequencyForBand(
  frame: AudioFrameParams,
  band: PenumbraDropletBand,
  grainIndex: number,
  options: { readonly scheduledUtcMs?: number } = {},
): number {
  const airTurbulence = deriveEarthAirTurbulence(frame);
  const partialHz = EARTH_DRONE_PARTIALS.map((partial) =>
    earthDronePartialFrequencyHz(partial, frame, airTurbulence),
  );
  const candidateIndices = PENUMBRA_DROPLET_PARTIAL_INDICES[band];
  const choice01 = dropletPartialChoice01(frame, band, grainIndex, options.scheduledUtcMs);
  const choiceIndex = Math.min(candidateIndices.length - 1, Math.floor(choice01 * candidateIndices.length));
  const candidateIndex = candidateIndices[choiceIndex] ?? 0;
  const sourceHz = partialHz[candidateIndex] ?? PENUMBRA_DROPLET_BAND_ANCHORS_HZ[band];

  return foldFrequencyIntoDropletBand(sourceHz, band);
}

export function derivePenumbraEarthTextureParams(frame: AudioFrameParams): PenumbraEarthTextureParams {
  const precipitationActivity01 = clampNumber(frame.earth.precipitationGrainGain01 / 0.024, 0, 1);
  const waterRatio01 = clampNumber(frame.earth.waterRatio01, 0, 1);
  const oceanDepth01 = clampNumber(frame.earth.oceanDepth01, 0, 1);
  const waterPresence01 = Math.pow(waterRatio01, 0.62);
  const waterBandPresence01 = clampNumber(
    0.18 + Math.pow(waterRatio01, 0.58) * 0.82,
    0,
    1,
  );
  const windPresence01 = clampNumber(
    frame.earth.wind01 * (0.46 + frame.earth.openness01 * 0.32 + frame.earth.surfaceHardness01 * 0.22) +
      frame.earth.airTurbulenceDepth01 * 0.32,
    0,
    1,
  );
  const airAbsorption01 = clampNumber(
    frame.earth.cloudCover01 * 0.3 +
      frame.earth.humidity01 * 0.28 +
      frame.earth.forestRatio01 * 0.22 +
      frame.earth.waterRatio01 * 0.08,
    0,
    1,
  );
  const registerNorm = normalizedLogFrequency(frame.earth.registerHz, 60, 5200);
  const lowBand = clampNumber(1 - registerNorm * 1.35, 0, 1);
  const highBand = clampNumber((registerNorm - 0.48) * 1.75, 0, 1);
  const midBand = clampNumber(1 - Math.abs(registerNorm - 0.48) * 1.85, 0, 1);
  const dropletAudibility = Math.pow(precipitationActivity01, 0.72);
  const turbulence = frame.earth.airTurbulenceDepth01;
  const windFocus = clampNumber(
    frame.earth.surfaceRoughness01 * 0.42 +
      windPresence01 * 0.38 +
      turbulence * 0.14 +
      frame.earth.brightness01 * 0.06,
    0,
    1,
  );
  const windNarrowing = clampNumber(
    windPresence01 * 0.72 +
      frame.earth.surfaceRoughness01 * 0.24 +
      frame.earth.builtTexture01 * 0.12 -
      airAbsorption01 * 0.34,
    0,
    1,
  );
  const airTurbulence = deriveEarthAirTurbulence(frame);
  const partialHz = EARTH_DRONE_PARTIALS.map((partial) =>
    earthDronePartialFrequencyHz(partial, frame, airTurbulence),
  );
  const bodyPartialIndex = windPresence01 + frame.earth.surfaceRoughness01 * 0.6 > waterPresence01 * 1.1 ? 1 : 0;
  const midPartialIndex = windFocus > 0.58 ? 3 : 2;
  const midHighPartialIndex = windFocus + frame.earth.surfaceRoughness01 * 0.35 + turbulence * 0.2 > 0.78 ? 5 : 4;
  const highPartialIndex = frame.earth.wind01 + turbulence + frame.earth.openness01 * 0.4 > 1.15 ? 8 : 6;
  const airPartialIndex =
    frame.earth.wind01 + turbulence * 0.72 + frame.earth.openness01 * 0.52 + windFocus * 0.18 > 1.28 ? 11 : 9;
  const bodyCenterHz = partialHz[bodyPartialIndex] ?? partialHz[0] ?? 110;
  const midCenterHz = partialHz[midPartialIndex] ?? partialHz[2] ?? 440;
  const midHighCenterHz = partialHz[midHighPartialIndex] ?? partialHz[4] ?? 880;
  const highCenterHz = partialHz[highPartialIndex] ?? partialHz[6] ?? 1760;
  const airCenterHz = partialHz[airPartialIndex] ?? partialHz[9] ?? 4400;
  const wetSoftening = clampNumber(waterPresence01 * 0.24 + frame.earth.humidity01 * 0.18, 0, 1);
  const precipitationScatter = clampNumber(
    frame.earth.wind01 * 0.48 + frame.earth.openness01 * 0.32 + frame.earth.surfaceHardness01 * 0.1,
    0,
    1,
  );
  const rainGranularAudibility = Math.sqrt(precipitationActivity01);
  const lowDensityHz = clampNumber(0.065 + oceanDepth01 ** 0.72 * 0.72 + waterPresence01 * 0.06, 0, 1.05);
  const midDensityHz = clampNumber(0.055 + waterPresence01 ** 0.72 * 0.82 + oceanDepth01 * 0.08, 0, 1.15);
  const highDensityHz = clampNumber(
    frame.earth.precipitationGrainDensityHz * (0.35 + precipitationActivity01 * 0.65),
    0,
    32,
  );
  const waterDropletBaseGain01 = frame.earth.gain01 * (0.045 + waterPresence01 * 0.07 + oceanDepth01 * 0.048);
  const rainGranularDensityHz =
    precipitationActivity01 > 0
      ? clampNumber(
          frame.earth.precipitationGrainDensityHz * (1.8 + precipitationActivity01 * 2.2) +
            frame.earth.wind01 * precipitationActivity01 * 10 +
            rainGranularAudibility * 3.2,
          0,
          88,
        )
      : 0;
  const rainGranularGain01 =
    precipitationActivity01 > 0
      ? clampNumber(
          0.006 +
            frame.earth.precipitationGrainGain01 * (0.55 + precipitationActivity01 * 0.7) +
            frame.earth.gain01 *
              (0.052 + precipitationScatter * 0.035 + rainGranularAudibility * 0.018) *
              (1 - airAbsorption01 * 0.22),
          0,
          0.055,
        )
      : 0;
  const rainGranularBrightness01 = clampNumber(
    0.18 +
      frame.earth.precipitationGrainBrightness01 * 0.58 +
      precipitationScatter * 0.18 +
      frame.earth.wind01 * 0.12 -
      airAbsorption01 * 0.2,
    0.08,
    0.86,
  );
  const rainGranularImpact01 = clampNumber(
    precipitationScatter * 0.46 +
      rainGranularBrightness01 * 0.3 +
      frame.earth.wind01 * 0.18 +
      frame.earth.scanlineSpatialChange01 * 0.12 -
      airAbsorption01 * 0.22,
    0,
    1,
  );
  const rainGranularSoftness01 = clampNumber(
    airAbsorption01 * 0.5 +
      frame.earth.humidity01 * 0.18 +
      waterPresence01 * 0.1 +
      frame.earth.forestRatio01 * 0.08 -
      precipitationScatter * 0.14,
    0,
    1,
  );
  const rainGranularShapeVariance01 = clampNumber(
    0.18 +
      frame.earth.wind01 * 0.28 +
      precipitationActivity01 * 0.24 +
      frame.earth.scanlineSpatialChange01 * 0.24 +
      frame.earth.openness01 * 0.12 -
      rainGranularSoftness01 * 0.12,
    0.08,
    0.82,
  );

  return {
    active: frame.earth.active,
    water: {
      noiseFloorGain01: 0,
      dropletDensityHz: lowDensityHz + midDensityHz + highDensityHz,
      lowDensityHz,
      midDensityHz,
      highDensityHz,
      dropletGain01: clampNumber(waterDropletBaseGain01 + frame.earth.precipitationGrainGain01 * 14.5, 0, 0.32),
      brightness01: frame.earth.precipitationGrainBrightness01,
      lowLevel01: clampNumber(
        0.22 + oceanDepth01 * 0.58 + waterPresence01 * 0.18 + dropletAudibility * (0.08 + lowBand * 0.26),
        0,
        1,
      ),
      midLevel01: clampNumber(
        0.12 + waterBandPresence01 * 0.58 + oceanDepth01 * 0.06 + dropletAudibility * (0.16 + midBand * 0.5),
        0,
        1,
      ),
      highLevel01: clampNumber(
        0.04 +
          waterPresence01 * 0.06 +
          dropletAudibility * (0.18 + highBand * 0.82) +
          frame.earth.wind01 * 0.04,
        0,
        1,
      ),
    },
    wind: {
      bodyLevel01: clampNumber(
        frame.earth.noiseGain01 * (0.34 + windPresence01 * 0.82 + waterPresence01 * 0.18) + turbulence * 0.018,
        0,
        0.14,
      ),
      midLevel01: clampNumber(
        frame.earth.noiseGain01 * (0.18 + windPresence01 * 0.68) +
          frame.earth.surfaceTextureGain01 * 1.12 +
          windFocus * 0.018,
        0,
        0.13,
      ),
      midHighLevel01: clampNumber(
        frame.earth.noiseGain01 * (0.13 + windPresence01 * 0.58) +
          frame.earth.surfaceTextureGain01 * 0.82 +
          windFocus * 0.016 +
          turbulence * 0.012,
        0,
        0.105,
      ),
      highLevel01: clampNumber(
        (frame.earth.noiseGain01 * (0.08 + windPresence01 * 0.5) +
          turbulence * 0.034 +
          Math.max(0, frame.earth.noiseColor01 - 0.46) * 0.026) *
          (1 - airAbsorption01 * 0.42),
        0,
        0.1,
      ),
      airLevel01: clampNumber(
        (frame.earth.noiseGain01 * (0.04 + windPresence01 * 0.34) +
          turbulence * 0.026 +
          Math.max(0, frame.earth.noiseColor01 - 0.5) * 0.022 +
          frame.earth.openness01 * windPresence01 * 0.012) *
          (1 - airAbsorption01 * 0.55),
        0,
        0.08,
      ),
      dryLevelScale01: PENUMBRA_WIND_TEXTURE_DRY_LEVEL_SCALE,
      formantSourceScale01: PENUMBRA_WIND_FORMANT_SOURCE_LEVEL_SCALE,
      bodyCenterHz: clampNumber(bodyCenterHz, 45, 900),
      midCenterHz: clampNumber(midCenterHz, 140, 3600),
      midHighCenterHz: clampNumber(midHighCenterHz, 220, 6200),
      highCenterHz: clampNumber(highCenterHz, 500, 9000),
      airCenterHz: clampNumber(airCenterHz, 900, 12000),
      bodyQ: clampNumber(1.8 + windNarrowing * 2.2 - wetSoftening * 0.42, 1.1, 4),
      midQ: clampNumber(5.2 + windNarrowing * 4.7 + frame.earth.surfaceRoughness01 * 0.6 - airAbsorption01 * 1.1, 2.2, 10),
      midHighQ: clampNumber(
        5.4 + windNarrowing * 4.4 + frame.earth.surfaceRoughness01 * 0.7 - airAbsorption01 * 1.2,
        2.6,
        10,
      ),
      highQ: clampNumber(5.8 + windNarrowing * 4.2 + turbulence * 0.9 - airAbsorption01 * 1.3, 2.6, 10),
      airQ: clampNumber(6 + windNarrowing * 4 + turbulence * 1.1 - airAbsorption01 * 1.5, 3, 10),
    },
    rainGranular: {
      densityHz: rainGranularDensityHz,
      gain01: rainGranularGain01,
      brightness01: rainGranularBrightness01,
      grainDurationSeconds: clampNumber(
        0.006 + (1 - rainGranularBrightness01) * 0.009 + frame.earth.humidity01 * 0.005,
        0.008,
        0.031,
      ),
      impact01: rainGranularImpact01,
      softness01: rainGranularSoftness01,
      shapeVariance01: rainGranularShapeVariance01,
      playbackRate01: clampNumber(0.38 + rainGranularBrightness01 * 0.42 + frame.earth.wind01 * 0.18, 0, 1),
      stereoSpread01: clampNumber(0.26 + frame.earth.wind01 * 0.46 + frame.earth.openness01 * 0.22, 0, 1),
      offsetDrift01: clampNumber(
        0.18 + frame.earth.wind01 * 0.42 + frame.earth.scanlineSpatialChange01 * 0.24,
        0,
        1,
      ),
      airAbsorbHz: clampNumber(2600 + rainGranularBrightness01 * 8200 - airAbsorption01 * 2100, 1400, 11000),
    },
    acoustic: PENUMBRA_ACOUSTIC_TARGET,
  };
}

function interpolateDropletShape(
  from: PenumbraDropletShape,
  to: PenumbraDropletShape,
  amount: number,
): PenumbraDropletShape {
  const t = smoothstep(clampNumber(amount, 0, 1));
  return {
    pitchSweep: lerp(from.pitchSweep, to.pitchSweep, t),
    sweepTimeMs: lerp(from.sweepTimeMs, to.sweepTimeMs, t),
    dropDecaySeconds: lerp(from.dropDecaySeconds, to.dropDecaySeconds, t),
    transient01: lerp(from.transient01, to.transient01, t),
  };
}

function normalizedLogFrequency(frequencyHz: number, lowHz: number, highHz: number): number {
  const low = Math.log2(Math.max(1, lowHz));
  const high = Math.log2(Math.max(lowHz + 1, highHz));
  const value = Math.log2(clampNumber(frequencyHz, lowHz, highHz));
  return clampNumber((value - low) / (high - low), 0, 1);
}

function dropletPartialChoice01(
  frame: AudioFrameParams,
  band: PenumbraDropletBand,
  grainIndex: number,
  scheduledUtcMs = frame.utcEpochMs,
): number {
  const canonical = scheduledUtcMs !== frame.utcEpochMs;
  const oceanDepth01 = canonical ? quantize01(frame.earth.oceanDepth01, 0.02) : frame.earth.oceanDepth01;
  const wind01 = canonical ? quantize01(frame.earth.wind01, 0.02) : frame.earth.wind01;
  const waterRatio01 = canonical ? quantize01(frame.earth.waterRatio01, 0.02) : frame.earth.waterRatio01;
  const openness01 = canonical ? quantize01(frame.earth.openness01, 0.02) : frame.earth.openness01;
  const precipitation01 = canonical ? quantize01(frame.earth.precipitation01, 0.02) : frame.earth.precipitation01;
  const turbulenceDepth01 = canonical
    ? quantize01(frame.earth.airTurbulenceDepth01, 0.02)
    : frame.earth.airTurbulenceDepth01;
  const turbulenceSeed01 = canonical
    ? quantize01(frame.earth.airTurbulenceSeed01, 0.02)
    : frame.earth.airTurbulenceSeed01;
  const seed01 = hash01(
    scheduledUtcMs * 0.00013 +
      grainIndex * 23.719 +
      turbulenceSeed01 * 97.31,
  );
  if (band === "low") {
    return clampNumber(
      seed01 * 0.62 +
        (1 - oceanDepth01) * 0.26 +
        wind01 * 0.08,
      0,
      0.999,
    );
  }
  if (band === "mid") {
    return clampNumber(
      seed01 * 0.58 +
        waterRatio01 * 0.12 +
        openness01 * 0.1 +
        wind01 * 0.08 -
        oceanDepth01 * 0.1,
      0,
      0.999,
    );
  }
  return clampNumber(
    seed01 * 0.5 +
      precipitation01 * 0.2 +
      wind01 * 0.15 +
      turbulenceDepth01 * 0.1,
    0,
    0.999,
  );
}

function foldFrequencyIntoDropletBand(frequencyHz: number, band: PenumbraDropletBand): number {
  const limits = PENUMBRA_DROPLET_BAND_LIMITS_HZ[band];
  let foldedHz = clampNumber(frequencyHz, 20, 12000);

  while (foldedHz < limits.minHz) {
    foldedHz *= 2;
  }
  while (foldedHz > limits.maxHz) {
    foldedHz *= 0.5;
  }

  return clampNumber(foldedHz, limits.minHz, limits.maxHz);
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function quantize01(value: number, quantum: number): number {
  return clampNumber(Math.round(clampNumber(value, 0, 1) / quantum) * quantum, 0, 1);
}

function hash01(seed: number): number {
  const sine = Math.sin(seed * 12.9898) * 43758.5453;
  return sine - Math.floor(sine);
}
