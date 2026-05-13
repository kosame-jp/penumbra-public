import { describe, expect, it } from "vitest";

import type { AudioFrameParams } from "../../src/core/audio/audio-params";
import {
  EARTH_DRONE_AUDIBLE_HARMONIC_GAIN_SCALE,
  EARTH_DRONE_PARTIALS,
  EARTH_DRONE_SECOND_PARTIAL_GAIN_SCALE,
  deriveEarthAirTurbulence,
  earthDronePartialFrequencyHz,
  earthDronePartialGainRaw,
} from "../../src/core/audio/earth-drone-spectrum";
import {
  derivePenumbraDropletShapeForFrequency,
  derivePenumbraEarthTextureParams,
  PENUMBRA_ACOUSTIC_TARGET,
  PENUMBRA_DROPLET_BAND_LIMITS_HZ,
  PENUMBRA_DROPLET_TARGETS,
  PENUMBRA_WIND_FORMANT_SOURCE_LEVEL_SCALE,
  PENUMBRA_WIND_TEXTURE_DRY_LEVEL_SCALE,
  penumbraDropletFrequencyForBand,
  type PenumbraDropletBand,
} from "../../src/core/audio/penumbra-earth-texture-params";
import {
  createPenumbraEarthTextureContinuousMessage,
  createPenumbraRainGranularMessage,
  createPenumbraWaterDropletMessage,
} from "../../src/core/audio/penumbra-earth-texture-worklet-events";

describe("PENUMBRA earth texture AudioWorklet parameters", () => {
  it("keeps the user-tuned droplet and acoustic targets as the baseline", () => {
    expect(PENUMBRA_DROPLET_TARGETS.high).toEqual({
      pitchSweep: 2,
      sweepTimeMs: 50,
      dropDecaySeconds: 0.04,
      transient01: 0,
    });
    expect(PENUMBRA_DROPLET_TARGETS.mid).toEqual({
      pitchSweep: 1.6,
      sweepTimeMs: 90,
      dropDecaySeconds: 0.15,
      transient01: 0,
    });
    expect(PENUMBRA_DROPLET_TARGETS.low).toEqual({
      pitchSweep: 5,
      sweepTimeMs: 240,
      dropDecaySeconds: 0.4,
      transient01: 0,
    });
    expect(PENUMBRA_ACOUSTIC_TARGET).toEqual({
      reverbWet01: 0.9,
      reverbSize: 4.1,
      distance01: 0.45,
      airAbsorbHz: 9000,
    });
  });

  it("keeps the second earth drone partial at the current subdued gain", () => {
    const secondPartial = EARTH_DRONE_PARTIALS.find((partial) => partial.integerRatio === 2);

    expect(EARTH_DRONE_SECOND_PARTIAL_GAIN_SCALE).toBe(0.5);
    expect(secondPartial?.baseGain01).toBeCloseTo(0.17, 8);
  });

  it("keeps drone harmonic machinery available while auditioning fundamental-only output", () => {
    const sourceFrame = frame({
      registerHz: 220,
      droneDispersion01: 0.75,
      droneSpectralTilt01: 0.72,
      airTurbulenceDepth01: 0.45,
    });
    const airTurbulence = deriveEarthAirTurbulence(sourceFrame);
    const fundamental = EARTH_DRONE_PARTIALS.find((partial) => partial.integerRatio === 1);
    const harmonic = EARTH_DRONE_PARTIALS.find((partial) => partial.integerRatio === 3);

    expect(EARTH_DRONE_AUDIBLE_HARMONIC_GAIN_SCALE).toBe(0);
    expect(EARTH_DRONE_PARTIALS.map((partial) => partial.integerRatio)).toEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      8,
      10,
      12,
      15,
      18,
      24,
    ]);
    expect(fundamental && earthDronePartialGainRaw(fundamental, sourceFrame, airTurbulence)).toBeGreaterThan(0);
    expect(harmonic && earthDronePartialFrequencyHz(harmonic, sourceFrame, airTurbulence)).toBeGreaterThan(
      sourceFrame.earth.registerHz,
    );
    expect(harmonic && earthDronePartialGainRaw(harmonic, sourceFrame, airTurbulence)).toBe(0);
  });

  it("auto-follows frequency with slower lower droplets and faster higher droplets", () => {
    const low = derivePenumbraDropletShapeForFrequency(90);
    const mid = derivePenumbraDropletShapeForFrequency(900);
    const high = derivePenumbraDropletShapeForFrequency(6400);

    expect(low.pitchSweep).toBeGreaterThan(mid.pitchSweep);
    expect(low.sweepTimeMs).toBeGreaterThan(mid.sweepTimeMs);
    expect(low.dropDecaySeconds).toBeGreaterThan(mid.dropDecaySeconds);
    expect(high.sweepTimeMs).toBeLessThan(low.sweepTimeMs);
    expect(high.dropDecaySeconds).toBeLessThan(mid.dropDecaySeconds);
    expect(high.transient01).toBe(0);
  });

  it("derives continuous texture controls from earth data without an internal fBm driver", () => {
    const calm = derivePenumbraEarthTextureParams(frame());
    const rainyWind = derivePenumbraEarthTextureParams(
      frame({
        precipitationGrainDensityHz: 22,
        precipitationGrainGain01: 0.018,
        precipitationGrainBrightness01: 0.72,
        airTurbulenceDepth01: 0.8,
        surfaceTextureGain01: 0.02,
        noiseGain01: 0.08,
      }),
    );

    expect(rainyWind.water.dropletDensityHz).toBeGreaterThan(calm.water.dropletDensityHz);
    expect(rainyWind.water.highDensityHz).toBeGreaterThan(calm.water.highDensityHz);
    expect(rainyWind.water.dropletGain01).toBeGreaterThan(calm.water.dropletGain01);
    expect(rainyWind.water.dropletGain01).toBeGreaterThan(0.24);
    expect(rainyWind.water.noiseFloorGain01).toBe(0);
    expect(rainyWind.water.midLevel01).toBeGreaterThan(calm.water.midLevel01);
    expect(rainyWind.water.highLevel01).toBeGreaterThan(calm.water.highLevel01);
    expect(rainyWind.wind.midHighLevel01).toBeGreaterThan(calm.wind.midHighLevel01);
    expect(rainyWind.wind.highLevel01).toBeGreaterThan(calm.wind.highLevel01);
    expect(rainyWind.wind.airLevel01).toBeGreaterThan(calm.wind.airLevel01);
    expect(calm.rainGranular.densityHz).toBe(0);
    expect(rainyWind.rainGranular.densityHz).toBeGreaterThan(40);
    expect(rainyWind.rainGranular.gain01).toBeGreaterThan(0.02);
    expect(rainyWind.acoustic).toEqual(PENUMBRA_ACOUSTIC_TARGET);
  });

  it("keeps dry wind lower than the wind-only formant excitation path", () => {
    const exposed = derivePenumbraEarthTextureParams(
      frame({
        noiseGain01: 0.18,
        surfaceTextureGain01: 0.05,
        wind01: 0.95,
        openness01: 0.95,
        surfaceHardness01: 0.9,
        surfaceRoughness01: 0.9,
        cloudCover01: 0,
        humidity01: 0.08,
        forestRatio01: 0,
        waterRatio01: 0.05,
        airTurbulenceDepth01: 0.86,
      }),
    );

    expect(PENUMBRA_WIND_TEXTURE_DRY_LEVEL_SCALE).toBeCloseTo(0.34, 8);
    expect(PENUMBRA_WIND_FORMANT_SOURCE_LEVEL_SCALE).toBeCloseTo(0.58, 8);
    expect(exposed.wind.dryLevelScale01).toBe(PENUMBRA_WIND_TEXTURE_DRY_LEVEL_SCALE);
    expect(exposed.wind.formantSourceScale01).toBe(PENUMBRA_WIND_FORMANT_SOURCE_LEVEL_SCALE);
    expect(exposed.wind.dryLevelScale01).toBeLessThan(exposed.wind.formantSourceScale01);
    expect(exposed.wind.bodyLevel01).toBeLessThanOrEqual(0.14);
    expect(exposed.wind.midLevel01).toBeLessThanOrEqual(0.13);
    expect(exposed.wind.midHighLevel01).toBeLessThanOrEqual(0.105);
    expect(exposed.wind.highLevel01).toBeLessThanOrEqual(0.1);
    expect(exposed.wind.airLevel01).toBeLessThanOrEqual(0.08);
  });

  it("keeps production water floor muted while preserving water-shaped droplet bands", () => {
    const dryLand = derivePenumbraEarthTextureParams(
      frame({
        waterRatio01: 0,
        precipitationGrainDensityHz: 0,
        precipitationGrainGain01: 0,
      }),
    );
    const dryOcean = derivePenumbraEarthTextureParams(
      frame({
        waterRatio01: 0.92,
        precipitationGrainDensityHz: 0,
        precipitationGrainGain01: 0,
      }),
    );

    expect(dryLand.water.noiseFloorGain01).toBe(0);
    expect(dryOcean.water.noiseFloorGain01).toBe(0);
    expect(dryOcean.water.lowLevel01).toBeGreaterThan(dryLand.water.lowLevel01);
    expect(dryOcean.water.lowDensityHz).toBeGreaterThan(dryLand.water.lowDensityHz);
    expect(dryOcean.water.midDensityHz).toBeGreaterThan(dryLand.water.midDensityHz);
    expect(dryOcean.water.highDensityHz).toBe(0);
    expect(dryOcean.water.dropletDensityHz).toBeGreaterThan(0.1);
  });

  it("lets trace precipitation enter the high droplet band continuously", () => {
    const dry = derivePenumbraEarthTextureParams(
      frame({
        precipitationGrainDensityHz: 0,
        precipitationGrainGain01: 0,
      }),
    );
    const traceRain = derivePenumbraEarthTextureParams(
      frame({
        precipitationGrainDensityHz: 0.65,
        precipitationGrainGain01: 0.0002,
        precipitationGrainBrightness01: 0.18,
      }),
    );
    const strongerRain = derivePenumbraEarthTextureParams(
      frame({
        precipitationGrainDensityHz: 4.5,
        precipitationGrainGain01: 0.003,
        precipitationGrainBrightness01: 0.35,
      }),
    );

    expect(dry.water.highDensityHz).toBe(0);
    expect(dry.rainGranular.densityHz).toBe(0);
    expect(traceRain.water.highDensityHz).toBeGreaterThan(0.05);
    expect(traceRain.water.highDensityHz).toBeLessThan(strongerRain.water.highDensityHz);
    expect(traceRain.rainGranular.densityHz).toBeGreaterThan(0.2);
    expect(traceRain.rainGranular.densityHz).toBeLessThan(strongerRain.rainGranular.densityHz);
    expect(traceRain.rainGranular.gain01).toBeGreaterThan(0);
    expect(traceRain.rainGranular.gain01).toBeLessThan(strongerRain.rainGranular.gain01);
    expect(traceRain.rainGranular.densityHz).toBeGreaterThan(1);
    expect(traceRain.rainGranular.gain01).toBeGreaterThan(0.012);
    expect(strongerRain.rainGranular.gain01).toBeGreaterThan(0.018);
    expect(strongerRain.rainGranular.gain01).toBeLessThan(traceRain.rainGranular.gain01 * 1.5);
    expect(traceRain.water.dropletGain01).toBeGreaterThan(dry.water.dropletGain01);
    expect(traceRain.water.dropletGain01).toBeLessThan(strongerRain.water.dropletGain01);
  });

  it("derives rain granular envelope shape from exposed versus absorbed rain fields", () => {
    const absorbed = derivePenumbraEarthTextureParams(
      frame({
        precipitationGrainDensityHz: 8,
        precipitationGrainGain01: 0.008,
        precipitationGrainBrightness01: 0.18,
        wind01: 0.05,
        openness01: 0.1,
        surfaceHardness01: 0.12,
        cloudCover01: 0.95,
        humidity01: 0.95,
        forestRatio01: 0.8,
        waterRatio01: 0.72,
      }),
    );
    const exposed = derivePenumbraEarthTextureParams(
      frame({
        precipitationGrainDensityHz: 8,
        precipitationGrainGain01: 0.008,
        precipitationGrainBrightness01: 0.68,
        wind01: 0.92,
        openness01: 0.92,
        surfaceHardness01: 0.88,
        cloudCover01: 0.02,
        humidity01: 0.18,
        forestRatio01: 0,
        waterRatio01: 0.08,
        scanlineSpatialChange01: 0.38,
      }),
    );

    expect(exposed.rainGranular.impact01).toBeGreaterThan(absorbed.rainGranular.impact01 + 0.3);
    expect(absorbed.rainGranular.softness01).toBeGreaterThan(exposed.rainGranular.softness01 + 0.2);
    expect(exposed.rainGranular.shapeVariance01).toBeGreaterThan(absorbed.rainGranular.shapeVariance01);
  });

  it("drives low water density from ocean depth and mid water density from scanline water ratio", () => {
    const shallowWater = derivePenumbraEarthTextureParams(
      frame({
        waterRatio01: 0.88,
        oceanDepth01: 0.08,
        precipitationGrainDensityHz: 0,
        precipitationGrainGain01: 0,
      }),
    );
    const deepWater = derivePenumbraEarthTextureParams(
      frame({
        waterRatio01: 0.88,
        oceanDepth01: 0.82,
        precipitationGrainDensityHz: 0,
        precipitationGrainGain01: 0,
      }),
    );
    const dryLand = derivePenumbraEarthTextureParams(
      frame({
        waterRatio01: 0,
        oceanDepth01: 0,
        precipitationGrainDensityHz: 0,
        precipitationGrainGain01: 0,
      }),
    );

    expect(deepWater.water.lowDensityHz).toBeGreaterThan(shallowWater.water.lowDensityHz);
    expect(shallowWater.water.midDensityHz).toBeGreaterThan(dryLand.water.midDensityHz);
    expect(dryLand.water.lowDensityHz).toBeGreaterThan(0.05);
  });

  it("makes wind bands follow the current earth drone partial register", () => {
    const lowRegister = derivePenumbraEarthTextureParams(
      frame({
        registerHz: 110,
        wind01: 0.9,
        airTurbulenceDepth01: 0.7,
        airTurbulenceRateHz: 0.4,
      }),
    );
    const highRegister = derivePenumbraEarthTextureParams(
      frame({
        registerHz: 440,
        wind01: 0.9,
        airTurbulenceDepth01: 0.7,
        airTurbulenceRateHz: 0.4,
      }),
    );

    expect(lowRegister.wind.bodyCenterHz).toBeLessThan(lowRegister.wind.midCenterHz);
    expect(lowRegister.wind.midCenterHz).toBeLessThan(lowRegister.wind.midHighCenterHz);
    expect(lowRegister.wind.midHighCenterHz).toBeLessThan(lowRegister.wind.highCenterHz);
    expect(lowRegister.wind.highCenterHz).toBeLessThan(lowRegister.wind.airCenterHz);
    expect(highRegister.wind.bodyCenterHz).toBeGreaterThan(lowRegister.wind.bodyCenterHz * 2.5);
    expect(highRegister.wind.midCenterHz).toBeGreaterThan(lowRegister.wind.midCenterHz * 2.5);
    expect(highRegister.wind.midHighCenterHz).toBeGreaterThan(lowRegister.wind.midHighCenterHz * 2.5);
  });

  it("snaps wind centers to current earth drone partials instead of interpolating between them", () => {
    const sourceFrame = frame({
      registerHz: 220,
      wind01: 0.7,
      openness01: 0.65,
      surfaceRoughness01: 0.42,
      airTurbulenceDepth01: 0.3,
    });
    const params = derivePenumbraEarthTextureParams(sourceFrame);
    const airTurbulence = deriveEarthAirTurbulence(sourceFrame);
    const partials = EARTH_DRONE_PARTIALS.map((partial) =>
      earthDronePartialFrequencyHz(partial, sourceFrame, airTurbulence),
    );

    expect(partials.some((partialHz) => params.wind.bodyCenterHz === partialHz)).toBe(true);
    expect(partials.some((partialHz) => params.wind.midCenterHz === partialHz)).toBe(true);
    expect(partials.some((partialHz) => params.wind.midHighCenterHz === partialHz)).toBe(true);
    expect(partials.some((partialHz) => params.wind.highCenterHz === partialHz)).toBe(true);
    expect(partials.some((partialHz) => params.wind.airCenterHz === partialHz)).toBe(true);
  });

  it("snaps water droplet pitches to octave-folded earth drone partials", () => {
    const sourceFrame = frame({
      registerHz: 220,
      waterRatio01: 0.8,
      oceanDepth01: 0.45,
      precipitation01: 0.7,
      wind01: 0.62,
      airTurbulenceDepth01: 0.35,
    });
    const airTurbulence = deriveEarthAirTurbulence(sourceFrame);
    const partials = EARTH_DRONE_PARTIALS.map((partial) =>
      earthDronePartialFrequencyHz(partial, sourceFrame, airTurbulence),
    );
    const low = penumbraDropletFrequencyForBand(sourceFrame, "low", 11);
    const mid = penumbraDropletFrequencyForBand(sourceFrame, "mid", 12);
    const high = penumbraDropletFrequencyForBand(sourceFrame, "high", 13);

    expect(low).toBeGreaterThanOrEqual(PENUMBRA_DROPLET_BAND_LIMITS_HZ.low.minHz);
    expect(low).toBeLessThanOrEqual(PENUMBRA_DROPLET_BAND_LIMITS_HZ.low.maxHz);
    expect(mid).toBeGreaterThanOrEqual(PENUMBRA_DROPLET_BAND_LIMITS_HZ.mid.minHz);
    expect(mid).toBeLessThanOrEqual(PENUMBRA_DROPLET_BAND_LIMITS_HZ.mid.maxHz);
    expect(high).toBeGreaterThanOrEqual(PENUMBRA_DROPLET_BAND_LIMITS_HZ.high.minHz);
    expect(high).toBeLessThanOrEqual(PENUMBRA_DROPLET_BAND_LIMITS_HZ.high.maxHz);
    expect(isFoldedDropletPartial(low, partials, "low")).toBe(true);
    expect(isFoldedDropletPartial(mid, partials, "mid")).toBe(true);
    expect(isFoldedDropletPartial(high, partials, "high")).toBe(true);
  });

  it("narrows wind resonance bands when wind is exposed and keeps them broad under absorption", () => {
    const normal = derivePenumbraEarthTextureParams(frame());
    const absorbed = derivePenumbraEarthTextureParams(
      frame({
        wind01: 0.9,
        openness01: 0.1,
        surfaceHardness01: 0.1,
        surfaceRoughness01: 0.08,
        cloudCover01: 1,
        humidity01: 0.95,
        forestRatio01: 0.9,
      }),
    );
    const exposed = derivePenumbraEarthTextureParams(
      frame({
        wind01: 0.9,
        openness01: 0.95,
        surfaceHardness01: 0.9,
        surfaceRoughness01: 0.82,
        cloudCover01: 0,
        humidity01: 0.25,
        forestRatio01: 0,
      }),
    );

    expect(exposed.wind.bodyQ).toBeGreaterThan(absorbed.wind.bodyQ);
    expect(exposed.wind.midQ).toBeGreaterThan(absorbed.wind.midQ + 2);
    expect(exposed.wind.midHighQ).toBeGreaterThan(absorbed.wind.midHighQ + 2);
    expect(exposed.wind.highQ).toBeGreaterThan(absorbed.wind.highQ + 2);
    expect(exposed.wind.airQ).toBeGreaterThan(absorbed.wind.airQ + 2);
    expect(absorbed.wind.midQ).toBeGreaterThan(4);
    expect(absorbed.wind.midHighQ).toBeGreaterThan(4);
    expect(absorbed.wind.highQ).toBeGreaterThan(4);
    expect(absorbed.wind.airQ).toBeGreaterThan(4);
    expect(normal.wind.midQ).toBeGreaterThan(5);
    expect(normal.wind.midHighQ).toBeGreaterThan(5);
    expect(normal.wind.highQ).toBeGreaterThan(5);
    expect(normal.wind.airQ).toBeGreaterThan(5);
    expect(exposed.wind.midQ).toBeLessThanOrEqual(10);
    expect(exposed.wind.midHighQ).toBeLessThanOrEqual(10);
    expect(exposed.wind.highQ).toBeLessThanOrEqual(10);
    expect(exposed.wind.airQ).toBeLessThanOrEqual(10);
  });

  it("serializes the Worklet messages with cloneable parameter data only", () => {
    const params = derivePenumbraEarthTextureParams(
      frame({
        precipitationGrainDensityHz: 12,
        precipitationGrainGain01: 0.012,
      }),
    );
    const continuousMessage = createPenumbraEarthTextureContinuousMessage(params);
    const dropletMessage = createPenumbraWaterDropletMessage({
      startTimeSeconds: 4.25,
      randomSeed: 67890,
      frequencyHz: 120,
      velocity01: 0.8,
      band: "low",
    });
    const rainMessage = createPenumbraRainGranularMessage({
      startTimeSeconds: 4.5,
      randomSeed: 112233,
      bufferIndex: 2,
      offset01: 0.42,
      durationSeconds: 0.06,
      playbackRate: 1.1,
      velocity01: 0.7,
      pan01: -0.3,
      lowpassHz: 7200,
      attackRatio: 0.22,
      attackCurve: 0.9,
      decayCurve: 3.2,
    });

    expect(continuousMessage.type).toBe("set-continuous");
    expect(dropletMessage).toMatchObject({
      type: "water-droplet",
      startTimeSeconds: 4.25,
      randomSeed: 67890,
      frequencyHz: 120,
      velocity01: 0.8,
      band: "low",
      pitchSweep: 5,
      sweepTimeSeconds: 0.24,
      decaySeconds: 0.4,
      transient01: 0,
    });
    expect(() => structuredClone(continuousMessage)).not.toThrow();
    expect(() => structuredClone(dropletMessage)).not.toThrow();
    expect(() => structuredClone(rainMessage)).not.toThrow();
    expect(rainMessage).toMatchObject({
      type: "rain-grain",
      bufferIndex: 2,
      offset01: 0.42,
      playbackRate: 1.1,
      pan01: -0.3,
      attackRatio: 0.22,
      attackCurve: 0.9,
      decayCurve: 3.2,
    });
  });
});

function frame(overrides: Partial<AudioFrameParams["earth"]> = {}): AudioFrameParams {
  return {
    utcIso: "2026-05-02T00:00:00.000Z",
    utcEpochMs: Date.parse("2026-05-02T00:00:00.000Z"),
    earth: {
      active: true,
      gain01: 0.2,
      registerHz: 220,
      brightness01: 0.4,
      cloudCover01: 0.2,
      humidity01: 0.6,
      wind01: 0.12,
      precipitation01: 0,
      surfaceHardness01: 0.5,
      openness01: 0.5,
      waterRatio01: 0.2,
      oceanDepth01: 0,
      forestRatio01: 0.1,
      builtTexture01: 0,
      toneGain01: 0.12,
      noiseGain01: 0.035,
      noiseLowpassHz: 3200,
      noiseColor01: 0.52,
      precipitationGrainGain01: 0,
      precipitationGrainDensityHz: 0,
      precipitationGrainBrightness01: 0,
      surfaceTextureGain01: 0.006,
      surfaceTextureFilterHz: 880,
      surfaceTextureQ: 0.8,
      surfaceRoughness01: 0.32,
      airTurbulenceDepth01: 0,
      airTurbulenceRateHz: 0,
      airTurbulenceSeed01: 0.2,
      droneDispersion01: 0.3,
      droneSpectralTilt01: 0.4,
      droneDamping01: 0.25,
      scanlineSpatialChange01: 0,
      scanlineSpatialVariance01: 0,
      scanlineSpatialSlope01: 0,
      ...overrides,
    },
    music: {
      active: false,
      gain01: 0,
      frequencyHz: 220,
      candidates: [],
      voices: [],
    },
    quakes: [],
    debugMeters: {
      earthEnergy01: 0.5,
      musicCandidateCount: 0,
      musicVoiceCount: 0,
      musicEnergy01: 0,
      musicMaxGain01: 0,
      musicMeanGain01: 0,
      musicPulseEnvelope01: 0,
      precipitationGrainGain01: overrides.precipitationGrainGain01 ?? 0,
      precipitationGrainDensityHz: overrides.precipitationGrainDensityHz ?? 0,
      surfaceTextureGain01: overrides.surfaceTextureGain01 ?? 0.006,
      surfaceRoughness01: overrides.surfaceRoughness01 ?? 0.32,
      airTurbulenceDepth01: overrides.airTurbulenceDepth01 ?? 0,
      airTurbulenceRateHz: overrides.airTurbulenceRateHz ?? 0,
      droneDispersion01: overrides.droneDispersion01 ?? 0.3,
      droneSpectralTilt01: overrides.droneSpectralTilt01 ?? 0.4,
      scanlineSpatialChange01: overrides.scanlineSpatialChange01 ?? 0,
      scanlineSpatialVariance01: overrides.scanlineSpatialVariance01 ?? 0,
      quakeEnergy01: 0,
    },
  };
}

function isFoldedDropletPartial(
  frequencyHz: number,
  partials: readonly number[],
  band: PenumbraDropletBand,
): boolean {
  const candidates = dropletPartialCandidatesForTest(partials, band);

  return candidates.some(
    (partialHz) => Math.abs(frequencyHz - foldFrequencyForTest(partialHz, band)) < 0.000001,
  );
}

function dropletPartialCandidatesForTest(
  partials: readonly number[],
  band: PenumbraDropletBand,
): readonly number[] {
  if (band === "low") {
    return partials.slice(0, 2);
  }
  if (band === "mid") {
    return partials.slice(1, 5);
  }
  return partials.slice(6, 12);
}

function foldFrequencyForTest(frequencyHz: number, band: PenumbraDropletBand): number {
  const limits = PENUMBRA_DROPLET_BAND_LIMITS_HZ[band];
  let foldedHz = Math.max(20, Math.min(12000, frequencyHz));

  while (foldedHz < limits.minHz) {
    foldedHz *= 2;
  }
  while (foldedHz > limits.maxHz) {
    foldedHz *= 0.5;
  }

  return Math.max(limits.minHz, Math.min(limits.maxHz, foldedHz));
}
