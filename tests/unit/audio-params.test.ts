import { describe, expect, it } from "vitest";

import {
  deriveAudioFrameParams,
  HUMAN_LAYER_OUTPUT_GAIN,
  MASTER_OUTPUT_GAIN,
} from "../../src/core/audio/audio-params";
import {
  DEFAULT_NIGHTLIGHT_TOPOLOGY,
  type CanonicalScanlineSample,
} from "../../src/core/fusion/scanline-sample";
import { midiToHz } from "../../src/core/fusion/register";

describe("audio parameter derivation", () => {
  it("keeps the earth layer active with no human nightlight", () => {
    const frame = deriveAudioFrameParams([
      sample({
        nightLightNorm: 0,
        musicActive: false,
        musicGain: 0,
        registerMidi: 32,
      }),
    ]);

    expect(frame.earth.active).toBe(true);
    expect(frame.earth.gain01).toBeGreaterThan(0);
    expect(frame.earth.toneGain01).toBeGreaterThan(0);
    expect(frame.earth.noiseGain01).toBeGreaterThan(0);
    expect(frame.earth.surfaceTextureGain01).toBeGreaterThan(0);
    expect(frame.earth.precipitationGrainDensityHz).toBe(0);
    expect(frame.earth.precipitationGrainGain01).toBe(0);
    expect(frame.music.active).toBe(false);
    expect(frame.music.gain01).toBe(0);
  });

  it("keeps earth sounding under dense cloud while cloud cover dulls the noise band", () => {
    const clear = deriveAudioFrameParams([
      sample({
        cloudCoverPct: 0,
        relativeHumidityPct: 35,
        windSpeedMps: 2,
      }),
    ]);
    const cloudy = deriveAudioFrameParams([
      sample({
        cloudCoverPct: 100,
        relativeHumidityPct: 85,
        windSpeedMps: 2,
      }),
    ]);

    expect(cloudy.earth.active).toBe(true);
    expect(cloudy.earth.toneGain01).toBeGreaterThan(0);
    expect(cloudy.earth.noiseLowpassHz).toBeLessThan(clear.earth.noiseLowpassHz);
    expect(cloudy.earth.noiseColor01).toBeLessThan(clear.earth.noiseColor01);
  });

  it("raises earth texture noise from wind and precipitation without changing register", () => {
    const calm = deriveAudioFrameParams([
      sample({
        windSpeedMps: 0,
        precipitationMm: 0,
        registerMidi: 48,
      }),
    ]);
    const weathered = deriveAudioFrameParams([
      sample({
        windSpeedMps: 14,
        precipitationMm: 5,
        registerMidi: 48,
      }),
    ]);

    expect(weathered.earth.noiseGain01).toBeGreaterThan(calm.earth.noiseGain01);
    expect(weathered.earth.precipitationGrainDensityHz).toBeGreaterThan(calm.earth.precipitationGrainDensityHz);
    expect(weathered.earth.precipitationGrainGain01).toBeGreaterThan(calm.earth.precipitationGrainGain01);
    expect(weathered.earth.registerHz).toBeCloseTo(calm.earth.registerHz, 8);
  });

  it("can derive precipitation texture from a wider atlas band without changing the centerline weather sample", () => {
    const centerlineDry = deriveAudioFrameParams([
      sample({
        precipitationMm: 0,
        registerMidi: 48,
      }),
    ]);
    const bandRain = deriveAudioFrameParams(
      [
        sample({
          precipitationMm: 0,
          registerMidi: 48,
        }),
      ],
      { precipitationOverride01: 0.42 },
    );

    expect(centerlineDry.earth.precipitation01).toBe(0);
    expect(bandRain.earth.precipitation01).toBeCloseTo(0.42, 8);
    expect(bandRain.earth.precipitationGrainDensityHz).toBeGreaterThan(
      centerlineDry.earth.precipitationGrainDensityHz,
    );
    expect(bandRain.earth.registerHz).toBeCloseTo(centerlineDry.earth.registerHz, 8);
  });

  it("exposes scanline-averaged earth texture drivers without local-time state", () => {
    const frame = deriveAudioFrameParams([
      sample({
        cloudCoverPct: 40,
        relativeHumidityPct: 75,
        windSpeedMps: 9,
        precipitationMm: 2,
        surfaceHardness01: 0.7,
        openness01: 0.8,
        waterRatio: 0.6,
        forestRatio: 0.25,
        roadDensityNorm: 0.4,
        buildingDensityNorm: 0.6,
      }),
    ]);

    expect(frame.earth.cloudCover01).toBeCloseTo(0.4, 8);
    expect(frame.earth.humidity01).toBeCloseTo(0.75, 8);
    expect(frame.earth.wind01).toBeCloseTo(0.5, 8);
    expect(frame.earth.precipitation01).toBeCloseTo(0.25, 8);
    expect(frame.earth.waterRatio01).toBeCloseTo(0.6, 8);
    expect(frame.earth.forestRatio01).toBeCloseTo(0.25, 8);
    expect(frame.earth.builtTexture01).toBeCloseTo(0.51, 8);
  });

  it("keeps base weather noise behind the drone while retaining light precipitation grains", () => {
    const neutral = deriveAudioFrameParams([sample({})]);
    const traceDrizzle = deriveAudioFrameParams([
      sample({
        precipitationMm: 0.01,
        cloudCoverPct: 20,
        relativeHumidityPct: 60,
        windSpeedMps: 2,
      }),
    ]);
    const lightDrizzle = deriveAudioFrameParams([
      sample({
        precipitationMm: 0.05,
        cloudCoverPct: 20,
        relativeHumidityPct: 60,
        windSpeedMps: 2,
      }),
    ]);

    expect(neutral.earth.noiseGain01).toBeLessThan(neutral.earth.toneGain01 * 0.35);
    expect(neutral.earth.precipitationGrainDensityHz).toBe(0);
    expect(traceDrizzle.earth.precipitationGrainDensityHz).toBeGreaterThan(0);
    expect(traceDrizzle.earth.precipitationGrainDensityHz).toBeLessThan(
      lightDrizzle.earth.precipitationGrainDensityHz,
    );
    expect(traceDrizzle.earth.precipitationGrainGain01).toBeGreaterThan(0);
    expect(traceDrizzle.earth.precipitationGrainGain01).toBeLessThan(
      lightDrizzle.earth.precipitationGrainGain01,
    );
    expect(lightDrizzle.earth.precipitationGrainDensityHz).toBeGreaterThan(1.5);
    expect(lightDrizzle.earth.precipitationGrainGain01).toBeGreaterThan(0.0004);
  });

  it("derives precipitation grain brightness from weather absorption and air scatter", () => {
    const clearOpenRain = deriveAudioFrameParams([
      sample({
        precipitationMm: 6,
        cloudCoverPct: 0,
        relativeHumidityPct: 25,
        windSpeedMps: 12,
        openness01: 0.9,
        surfaceHardness01: 0.8,
        forestRatio: 0,
      }),
    ]);
    const absorbedRain = deriveAudioFrameParams([
      sample({
        precipitationMm: 6,
        cloudCoverPct: 100,
        relativeHumidityPct: 95,
        windSpeedMps: 0,
        openness01: 0.05,
        surfaceHardness01: 0.1,
        forestRatio: 1,
      }),
    ]);

    expect(clearOpenRain.earth.precipitationGrainDensityHz).toBeCloseTo(
      absorbedRain.earth.precipitationGrainDensityHz,
      8,
    );
    expect(clearOpenRain.earth.precipitationGrainGain01).toBeGreaterThan(
      absorbedRain.earth.precipitationGrainGain01,
    );
    expect(clearOpenRain.earth.precipitationGrainBrightness01).toBeGreaterThan(
      absorbedRain.earth.precipitationGrainBrightness01,
    );
  });

  it("defaults the earth noise color near pink and tilts it from weather and terrain", () => {
    const neutral = deriveAudioFrameParams([sample({})]);
    const brightOpen = deriveAudioFrameParams([
      sample({
        cloudCoverPct: 0,
        relativeHumidityPct: 25,
        windSpeedMps: 16,
        precipitationMm: 1,
        openness01: 0.95,
        surfaceHardness01: 0.9,
        forestRatio: 0,
      }),
    ]);
    const absorbedForest = deriveAudioFrameParams([
      sample({
        cloudCoverPct: 100,
        relativeHumidityPct: 95,
        windSpeedMps: 0,
        openness01: 0.05,
        surfaceHardness01: 0.1,
        forestRatio: 1,
      }),
    ]);

    expect(neutral.earth.noiseColor01).toBeGreaterThan(0.36);
    expect(neutral.earth.noiseColor01).toBeLessThan(0.5);
    expect(brightOpen.earth.noiseColor01).toBeGreaterThan(neutral.earth.noiseColor01);
    expect(brightOpen.earth.noiseColor01).toBeGreaterThan(0.62);
    expect(absorbedForest.earth.noiseColor01).toBeLessThan(neutral.earth.noiseColor01);
    expect(absorbedForest.earth.noiseColor01).toBeLessThan(0.25);
  });

  it("derives earth surface texture from hard open ground and smooths water or forest", () => {
    const rough = deriveAudioFrameParams([
      sample({
        cloudCoverPct: 0,
        relativeHumidityPct: 25,
        windSpeedMps: 8,
        surfaceHardness01: 0.95,
        openness01: 0.9,
        waterRatio: 0,
        forestRatio: 0,
        roadDensityNorm: 0.8,
        buildingDensityNorm: 0.9,
      }),
    ]);
    const smooth = deriveAudioFrameParams([
      sample({
        cloudCoverPct: 80,
        relativeHumidityPct: 95,
        windSpeedMps: 0,
        surfaceHardness01: 0.05,
        openness01: 0.2,
        waterRatio: 1,
        forestRatio: 0.8,
        roadDensityNorm: 0,
        buildingDensityNorm: 0,
      }),
    ]);

    expect(rough.earth.surfaceRoughness01).toBeGreaterThan(smooth.earth.surfaceRoughness01);
    expect(rough.earth.surfaceTextureGain01).toBeGreaterThan(smooth.earth.surfaceTextureGain01);
    expect(rough.earth.surfaceTextureGain01).toBeGreaterThan(0.012);
    expect(smooth.earth.surfaceTextureGain01).toBeLessThan(0.008);
    expect(rough.earth.surfaceTextureFilterHz).toBeGreaterThan(smooth.earth.surfaceTextureFilterHz);
    expect(rough.earth.surfaceTextureQ).toBeGreaterThan(smooth.earth.surfaceTextureQ);
    expect(rough.earth.surfaceTextureQ).toBeGreaterThan(1.6);
    expect(smooth.earth.surfaceTextureQ).toBeLessThan(0.4);
  });

  it("derives ocean depth from effective bathymetry for water droplet density mapping", () => {
    const land = deriveAudioFrameParams([
      sample({
        effectiveElevationM: 120,
        waterRatio: 0.05,
      }),
    ]);
    const deepOcean = deriveAudioFrameParams([
      sample({
        effectiveElevationM: -6200,
        waterRatio: 1,
      }),
    ]);

    expect(land.earth.oceanDepth01).toBe(0);
    expect(deepOcean.earth.oceanDepth01).toBeGreaterThan(0.5);
  });

  it("narrows earth surface texture bandwidth in strong wind", () => {
    const calmHardGround = deriveAudioFrameParams([
      sample({
        cloudCoverPct: 0,
        relativeHumidityPct: 25,
        windSpeedMps: 0,
        surfaceHardness01: 0.95,
        openness01: 0.9,
        waterRatio: 0,
        forestRatio: 0,
        roadDensityNorm: 0.8,
        buildingDensityNorm: 0.9,
      }),
    ]);
    const windyHardGround = deriveAudioFrameParams([
      sample({
        cloudCoverPct: 0,
        relativeHumidityPct: 25,
        windSpeedMps: 16,
        surfaceHardness01: 0.95,
        openness01: 0.9,
        waterRatio: 0,
        forestRatio: 0,
        roadDensityNorm: 0.8,
        buildingDensityNorm: 0.9,
      }),
    ]);

    expect(windyHardGround.earth.surfaceTextureQ).toBeGreaterThan(
      calmHardGround.earth.surfaceTextureQ + 1,
    );
    expect(windyHardGround.earth.surfaceTextureQ).toBeGreaterThan(2.4);
    expect(windyHardGround.earth.surfaceTextureFilterHz).toBeGreaterThan(
      calmHardGround.earth.surfaceTextureFilterHz,
    );
  });

  it("derives wind-driven air turbulence without adding it under calm or absorbed conditions", () => {
    const calm = deriveAudioFrameParams([
      sample({
        windSpeedMps: 0,
        openness01: 0.9,
        surfaceHardness01: 0.8,
      }),
    ]);
    const windyOpen = deriveAudioFrameParams([
      sample({
        cloudCoverPct: 0,
        relativeHumidityPct: 25,
        windSpeedMps: 16,
        openness01: 0.95,
        surfaceHardness01: 0.9,
        forestRatio: 0,
        waterRatio: 0,
      }),
    ]);
    const windyAbsorbed = deriveAudioFrameParams([
      sample({
        cloudCoverPct: 100,
        relativeHumidityPct: 95,
        windSpeedMps: 16,
        openness01: 0.95,
        surfaceHardness01: 0.9,
        forestRatio: 1,
        waterRatio: 0.7,
      }),
    ]);

    expect(calm.earth.airTurbulenceDepth01).toBe(0);
    expect(calm.earth.airTurbulenceRateHz).toBe(0);
    expect(windyOpen.earth.airTurbulenceDepth01).toBeGreaterThan(0.9);
    expect(windyOpen.earth.airTurbulenceRateHz).toBeGreaterThan(0.5);
    expect(windyOpen.earth.airTurbulenceSeed01).toBeGreaterThanOrEqual(0);
    expect(windyOpen.earth.airTurbulenceSeed01).toBeLessThanOrEqual(1);
    expect(windyAbsorbed.earth.airTurbulenceDepth01).toBeLessThan(
      windyOpen.earth.airTurbulenceDepth01,
    );
    expect(windyAbsorbed.earth.airTurbulenceDepth01).toBeGreaterThan(0.6);
  });

  it("derives earth drone dispersion from exposed terrain and damps it under wet clouds", () => {
    const exposed = deriveAudioFrameParams([
      sample({
        cloudCoverPct: 0,
        relativeHumidityPct: 25,
        windSpeedMps: 14,
        precipitationMm: 1,
        surfaceHardness01: 0.95,
        openness01: 0.9,
        waterRatio: 0,
        forestRatio: 0,
        roadDensityNorm: 0.8,
        buildingDensityNorm: 0.9,
      }),
    ]);
    const absorbed = deriveAudioFrameParams([
      sample({
        cloudCoverPct: 100,
        relativeHumidityPct: 95,
        windSpeedMps: 1,
        precipitationMm: 0,
        surfaceHardness01: 0.1,
        openness01: 0.1,
        waterRatio: 0.9,
        forestRatio: 0.9,
        roadDensityNorm: 0,
        buildingDensityNorm: 0,
      }),
    ]);

    expect(exposed.earth.droneDispersion01).toBeGreaterThan(absorbed.earth.droneDispersion01);
    expect(exposed.earth.droneDispersion01).toBeGreaterThan(0.58);
    expect(exposed.earth.droneSpectralTilt01).toBeGreaterThan(absorbed.earth.droneSpectralTilt01);
    expect(exposed.earth.droneSpectralTilt01).toBeGreaterThan(0.7);
    expect(absorbed.earth.droneDamping01).toBeGreaterThan(exposed.earth.droneDamping01);
  });

  it("folds scanline spatial change into earth motion without page-local randomness", () => {
    const smoothLine = deriveAudioFrameParams([
      sample({ latitudeDeg: -5, registerMidi: 48, spatialChange01: 0, spatialSlope01: 0 }),
      sample({ latitudeDeg: 0, registerMidi: 48, spatialChange01: 0, spatialSlope01: 0 }),
      sample({ latitudeDeg: 5, registerMidi: 48, spatialChange01: 0, spatialSlope01: 0 }),
    ]);
    const changingLine = deriveAudioFrameParams([
      sample({
        latitudeDeg: -5,
        registerMidi: 36,
        waterRatio: 1,
        surfaceHardness01: 0.05,
        spatialChange01: 0.75,
        spatialSlope01: -0.35,
      }),
      sample({
        latitudeDeg: 0,
        registerMidi: 60,
        waterRatio: 0,
        surfaceHardness01: 0.95,
        buildingDensityNorm: 0.9,
        spatialChange01: 0.85,
        spatialSlope01: 0.45,
      }),
      sample({
        latitudeDeg: 5,
        registerMidi: 72,
        waterRatio: 0.2,
        surfaceHardness01: 0.5,
        windSpeedMps: 14,
        spatialChange01: 0.65,
        spatialSlope01: 0.2,
      }),
    ]);

    expect(smoothLine.earth.scanlineSpatialChange01).toBe(0);
    expect(smoothLine.earth.scanlineSpatialVariance01).toBeCloseTo(0, 12);
    expect(changingLine.earth.scanlineSpatialChange01).toBeGreaterThan(0.7);
    expect(changingLine.earth.scanlineSpatialVariance01).toBeGreaterThan(0.2);
    expect(changingLine.earth.droneDispersion01).toBeGreaterThan(smoothLine.earth.droneDispersion01);
    expect(changingLine.debugMeters.scanlineSpatialChange01).toBeCloseTo(
      changingLine.earth.scanlineSpatialChange01,
      8,
    );
  });

  it("drives human musical layer from nightlight gain and elevation register", () => {
    const lowland = sample({
      nightLightNorm: 0.8,
      musicActive: true,
      musicGain: 0.6,
      registerMidi: 48,
    });
    const highland = sample({
      nightLightNorm: 0.8,
      musicActive: true,
      musicGain: 0.6,
      registerMidi: 72,
    });

    expect(deriveAudioFrameParams([highland]).music.frequencyHz).toBeGreaterThan(
      deriveAudioFrameParams([lowland]).music.frequencyHz,
    );
    expect(deriveAudioFrameParams([lowland]).music.voices).toHaveLength(1);
  });

  it("exposes a post-master music pulse envelope estimate for debug monitoring", () => {
    const frame = deriveAudioFrameParams([
      sample({
        nightLightNorm: 1,
        musicActive: true,
        musicGain: 0.6,
        registerMidi: 48,
      }),
    ]);

    expect(frame.debugMeters.musicPulseEnvelope01).toBeCloseTo(
      frame.music.gain01 * HUMAN_LAYER_OUTPUT_GAIN * MASTER_OUTPUT_GAIN,
      8,
    );
  });

  it("summarizes human music from capped voice candidates", () => {
    const frame = deriveAudioFrameParams(
      Array.from({ length: 14 }, (_, index) =>
        sample({
          nightLightNorm: 1,
          musicActive: true,
          musicGain: 1 - index * 0.02,
          musicFrequencyHz: 220 + index,
        }),
      ),
    );

    expect(frame.music.voices).toHaveLength(12);
    expect(frame.music.candidates).toHaveLength(14);
    expect(frame.debugMeters.musicCandidateCount).toBe(14);
    expect(frame.debugMeters.musicVoiceCount).toBe(12);
    expect(frame.debugMeters.musicMaxGain01).toBeCloseTo(1, 8);
  });

  it("keeps earth parameters on earth samples when nightlight contacts are added", () => {
    const centerlineEarth = sample({
      registerMidi: 48,
      earthActive: true,
      musicActive: false,
      musicGain: 0,
    });
    const musicContact = sample({
      registerMidi: 84,
      earthActive: false,
      musicActive: true,
      musicGain: 0.7,
      musicFrequencyHz: 520,
    });
    const frame = deriveAudioFrameParams([centerlineEarth, musicContact]);

    expect(frame.earth.registerHz).toBeCloseTo(midiToHz(48), 8);
    expect(frame.music.active).toBe(true);
    expect(frame.music.frequencyHz).toBeCloseTo(520, 8);
  });

  it("uses the canonical music-layer frequency instead of ignoring tuning selection", () => {
    const tuned = sample({
      nightLightNorm: 0.8,
      musicActive: true,
      musicGain: 0.6,
      registerMidi: 60,
      musicFrequencyHz: 300,
    });

    expect(deriveAudioFrameParams([tuned]).music.frequencyHz).toBeCloseTo(300, 8);
  });

  it("activates quake hits without muting other layers", () => {
    const withQuake = sample({
      nightLightNorm: 0.8,
      musicActive: true,
      musicGain: 0.5,
      registerMidi: 55,
      quakeMagnitude: 0.1,
    });
    const frame = deriveAudioFrameParams([withQuake]);

    expect(frame.earth.gain01).toBeGreaterThan(0);
    expect(frame.music.gain01).toBeGreaterThan(0);
    expect(frame.quakes).toHaveLength(1);
    expect(frame.quakes[0]?.gain01).toBeGreaterThan(0);
    expect(frame.quakes[0]?.eventTimeUtc).toBe("2026-04-29T23:30:00.000Z");
    expect(frame.quakes[0]?.magnitude).toBe(0.1);
    expect(frame.quakes[0]?.scanlineWeight).toBe(1);
  });

  it("does not use latitude as a direct pitch source", () => {
    const south = sample({ latitudeDeg: -60, registerMidi: 60, musicActive: true, musicGain: 0.5 });
    const north = sample({ latitudeDeg: 60, registerMidi: 60, musicActive: true, musicGain: 0.5 });

    expect(deriveAudioFrameParams([south]).music.frequencyHz).toBeCloseTo(
      deriveAudioFrameParams([north]).music.frequencyHz,
      8,
    );
  });
});

interface SampleOptions {
  readonly latitudeDeg?: number;
  readonly nightLightNorm?: number;
  readonly musicActive?: boolean;
  readonly musicGain?: number;
  readonly musicFrequencyHz?: number;
  readonly registerMidi?: number;
  readonly effectiveElevationM?: number;
  readonly earthActive?: boolean;
  readonly quakeMagnitude?: number;
  readonly cloudCoverPct?: number;
  readonly relativeHumidityPct?: number;
  readonly windSpeedMps?: number;
  readonly precipitationMm?: number;
  readonly surfaceHardness01?: number;
  readonly openness01?: number;
  readonly waterRatio?: number;
  readonly forestRatio?: number;
  readonly roadDensityNorm?: number;
  readonly buildingDensityNorm?: number;
  readonly spatialChange01?: number;
  readonly spatialSlope01?: number;
}

function sample(options: SampleOptions): CanonicalScanlineSample {
  return {
    latitudeDeg: options.latitudeDeg ?? 0,
    longitudeDeg: 0,
    scanlineWeight: 1,
    utcIso: "2026-04-30T00:00:00.000Z",
    cellId: "test-cell",
    effectiveElevationM: options.effectiveElevationM ?? 0,
    registerMidi: options.registerMidi ?? 48,
    nightLightNorm: options.nightLightNorm ?? 0,
    surfaceHardness01: options.surfaceHardness01 ?? 0.5,
    openness01: options.openness01 ?? 0.5,
    waterRatio: options.waterRatio ?? 0.2,
    forestRatio: options.forestRatio ?? 0.1,
    roadDensityNorm: options.roadDensityNorm ?? 0,
    buildingDensityNorm: options.buildingDensityNorm ?? 0,
    nightLightTopology: DEFAULT_NIGHTLIGHT_TOPOLOGY,
    spatialChange01: options.spatialChange01 ?? 0,
    spatialSlope01: options.spatialSlope01 ?? 0,
    weather: {
      cloudCoverPct: options.cloudCoverPct ?? 20,
      relativeHumidityPct: options.relativeHumidityPct ?? 60,
      windSpeedMps: options.windSpeedMps ?? 2,
      precipitationMm: options.precipitationMm ?? 0,
      temperatureC: 18,
      pressureHpa: 1012,
    },
    tuning: {
      gridKernelWeights: { "12tet": 1 },
      scaleKernelWeights: { "church_modes": 1 },
      dominantGridKernelId: "12tet",
      dominantScaleKernelId: "church_modes",
    },
    layers: {
      earth: {
        active: options.earthActive ?? true,
        brightness01: options.earthActive === false ? 0 : 0.7,
      },
      music: {
        active: options.musicActive ?? false,
        gain01: options.musicGain ?? 0,
        frequencyHz: options.musicFrequencyHz ?? midiToHz(options.registerMidi ?? 48),
      },
      quakes:
        options.quakeMagnitude == null
          ? []
          : [
              {
                id: "quake",
                provider: "test",
                eventTimeUtc: "2026-04-29T23:30:00.000Z",
                updatedTimeUtc: "2026-04-29T23:30:00.000Z",
                latitudeDeg: options.latitudeDeg ?? 0,
                longitudeDeg: 0,
                depthKm: 120,
                magnitude: options.quakeMagnitude,
              },
            ],
    },
  };
}
