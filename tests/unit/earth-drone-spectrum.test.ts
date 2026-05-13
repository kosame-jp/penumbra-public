import { describe, expect, it } from "vitest";

import type { AudioFrameParams } from "../../src/core/audio/audio-params";
import {
  EARTH_DRONE_COMPANION_MAX_DETUNE_CENTS,
  EARTH_DRONE_COMPANION_RELATIVE_GAIN,
  deriveEarthAirTurbulence,
  earthDroneCompanionParams,
  earthDroneRootHz,
} from "../../src/core/audio/earth-drone-spectrum";

describe("Earth drone spectrum", () => {
  it("adds a quiet companion sine without changing the root register", () => {
    const sourceFrame = frame({ registerHz: 220 });
    const companion = earthDroneCompanionParams(sourceFrame);
    const rootHz = earthDroneRootHz(sourceFrame);

    expect(rootHz).toBeCloseTo(110, 8);
    expect(Math.abs(companion.detuneCents)).toBeLessThanOrEqual(
      EARTH_DRONE_COMPANION_MAX_DETUNE_CENTS,
    );
    expect(companion.frequencyHz).toBeCloseTo(
      rootHz * 2 ** (companion.detuneCents / 1200),
      8,
    );
    expect(companion.relativeGain01).toBeGreaterThan(0);
    expect(companion.relativeGain01).toBeLessThanOrEqual(EARTH_DRONE_COMPANION_RELATIVE_GAIN);
  });

  it("opens detune under exposed windy terrain and damps it under wet cloudy terrain", () => {
    const exposed = earthDroneCompanionParams(
      frame({
        wind01: 0.95,
        openness01: 0.92,
        surfaceHardness01: 0.9,
        builtTexture01: 0.8,
        surfaceRoughness01: 0.88,
        humidity01: 0.08,
        cloudCover01: 0.05,
        forestRatio01: 0.02,
        waterRatio01: 0.03,
        droneDamping01: 0.04,
        scanlineSpatialChange01: 0.9,
        scanlineSpatialVariance01: 0.84,
        scanlineSpatialSlope01: 0.5,
      }),
    );
    const damped = earthDroneCompanionParams(
      frame({
        wind01: 0,
        openness01: 0.08,
        surfaceHardness01: 0.08,
        builtTexture01: 0,
        surfaceRoughness01: 0.04,
        humidity01: 1,
        cloudCover01: 1,
        forestRatio01: 0.88,
        waterRatio01: 1,
        droneDamping01: 1,
        scanlineSpatialChange01: 0.01,
        scanlineSpatialVariance01: 0.02,
      }),
    );

    expect(Math.abs(exposed.detuneCents)).toBeGreaterThan(55);
    expect(Math.abs(exposed.detuneCents)).toBeLessThanOrEqual(
      EARTH_DRONE_COMPANION_MAX_DETUNE_CENTS,
    );
    expect(exposed.amount01).toBeGreaterThan(damped.amount01);
    expect(Math.abs(damped.detuneCents)).toBeLessThan(4);
    expect(exposed.relativeGain01).toBeGreaterThan(damped.relativeGain01);
  });

  it("uses scanline spatial slope as the physically grounded detune direction", () => {
    const upward = frame({
      wind01: 0.8,
      openness01: 0.8,
      surfaceHardness01: 0.7,
      scanlineSpatialChange01: 0.7,
      scanlineSpatialVariance01: 0.6,
      scanlineSpatialSlope01: 0.5,
    });
    const downward = frame({
      wind01: 0.8,
      openness01: 0.8,
      surfaceHardness01: 0.7,
      scanlineSpatialChange01: 0.7,
      scanlineSpatialVariance01: 0.6,
      scanlineSpatialSlope01: -0.5,
    });
    const upwardCompanion = earthDroneCompanionParams(upward, deriveEarthAirTurbulence(upward));
    const downwardCompanion = earthDroneCompanionParams(
      downward,
      deriveEarthAirTurbulence(downward),
    );

    expect(upwardCompanion.detuneCents).toBeGreaterThan(0);
    expect(upwardCompanion.frequencyHz).toBeGreaterThan(earthDroneRootHz(upward));
    expect(downwardCompanion.detuneCents).toBeLessThan(0);
    expect(downwardCompanion.frequencyHz).toBeLessThan(earthDroneRootHz(downward));
  });
});

function frame(overrides: Partial<AudioFrameParams["earth"]> = {}): AudioFrameParams {
  return {
    utcIso: "2026-05-08T00:00:00.000Z",
    utcEpochMs: Date.parse("2026-05-08T00:00:00.000Z"),
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
