import { describe, expect, it } from "vitest";

import type { AudioFrameParams } from "../../src/core/audio/audio-params";
import { penumbraDropletFrequencyForBand } from "../../src/core/audio/penumbra-earth-texture-params";

describe("water droplet pitch", () => {
  it("anchors high-droplet partial choice to scheduled UTC instead of render-frame UTC", () => {
    const scheduledUtcMs = Date.parse("2026-05-10T00:00:00.250Z");
    const first = penumbraDropletFrequencyForBand(
      frame({ utcEpochMs: scheduledUtcMs - 220 }),
      "high",
      0x12345678,
      { scheduledUtcMs },
    );
    const second = penumbraDropletFrequencyForBand(
      frame({ utcEpochMs: scheduledUtcMs + 220 }),
      "high",
      0x12345678,
      { scheduledUtcMs },
    );

    expect(second).toBe(first);
  });
});

function frame(overrides: Partial<AudioFrameParams> = {}): AudioFrameParams {
  const utcEpochMs = overrides.utcEpochMs ?? Date.parse("2026-05-10T00:00:00.000Z");
  return {
    utcIso: new Date(utcEpochMs).toISOString(),
    utcEpochMs,
    earth: {
      active: true,
      gain01: 0.4,
      registerHz: 72,
      brightness01: 0.5,
      cloudCover01: 0.34,
      humidity01: 0.52,
      wind01: 0.47,
      precipitation01: 0.62,
      surfaceHardness01: 0.38,
      openness01: 0.42,
      waterRatio01: 0.68,
      oceanDepth01: 0.57,
      forestRatio01: 0.2,
      builtTexture01: 0.12,
      toneGain01: 0.2,
      noiseGain01: 0.1,
      noiseLowpassHz: 2600,
      noiseColor01: 0.45,
      precipitationGrainGain01: 0.012,
      precipitationGrainDensityHz: 3.2,
      precipitationGrainBrightness01: 0.55,
      surfaceTextureGain01: 0.02,
      surfaceTextureFilterHz: 1200,
      surfaceTextureQ: 3,
      surfaceRoughness01: 0.32,
      airTurbulenceDepth01: 0.44,
      airTurbulenceRateHz: 0.18,
      airTurbulenceSeed01: 0.37,
      droneDispersion01: 0.26,
      droneSpectralTilt01: 0.36,
      droneDamping01: 0.3,
      scanlineSpatialChange01: 0.22,
      scanlineSpatialVariance01: 0.18,
      scanlineSpatialSlope01: 0.08,
    },
    music: {
      active: false,
      gain01: 0,
      frequencyHz: 0,
      candidates: [],
      voices: [],
    },
    quakes: [],
    debugMeters: {
      earthEnergy01: 0,
      musicCandidateCount: 0,
      musicVoiceCount: 0,
      musicEnergy01: 0,
      musicMaxGain01: 0,
      musicMeanGain01: 0,
      musicPulseEnvelope01: 0,
      precipitationGrainGain01: 0,
      precipitationGrainDensityHz: 0,
      surfaceTextureGain01: 0,
      surfaceRoughness01: 0,
      airTurbulenceDepth01: 0,
      airTurbulenceRateHz: 0,
      droneDispersion01: 0,
      droneSpectralTilt01: 0,
      scanlineSpatialChange01: 0,
      scanlineSpatialVariance01: 0,
      quakeEnergy01: 0,
    },
    ...overrides,
  };
}
