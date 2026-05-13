import { describe, expect, it } from "vitest";

import type { AudioFrameParams } from "../../src/core/audio/audio-params";
import { deriveEarthFormantParams } from "../../src/core/audio/earth-formant";
import { deriveEarthAirTurbulence } from "../../src/core/audio/earth-drone-spectrum";
import { DEFAULT_NIGHTLIGHT_TOPOLOGY } from "../../src/core/fusion/scanline-sample";

describe("Earth layer formant send", () => {
  it("stays silent when muted or outside the active scanline", () => {
    const activeFrame = frame({ musicGain01: 0.8, candidates: 90, voices: 12 });
    const muted = deriveEarthFormantParams(activeFrame, deriveEarthAirTurbulence(activeFrame), { muted: true });
    const inactiveFrame = frame({ active: false, musicGain01: 0.8, candidates: 90, voices: 12 });
    const inactive = deriveEarthFormantParams(inactiveFrame, deriveEarthAirTurbulence(inactiveFrame));

    expect(muted.amount01).toBe(0);
    expect(muted.droneSendGain).toBe(0);
    expect(muted.windSendGain).toBe(0);
    expect(muted.noiseSendGain).toBe(0);
    expect(muted.bands.every((band) => band.gain01 === 0)).toBe(true);
    expect(inactive.amount01).toBe(0);
    expect(inactive.bands.every((band) => band.gain01 === 0)).toBe(true);
  });

  it("uses the wind-only texture as the formant exciter without a separate base-noise lift", () => {
    const currentFrame = frame({ musicGain01: 0.8, candidates: 90, voices: 12 });
    const params = deriveEarthFormantParams(currentFrame, deriveEarthAirTurbulence(currentFrame));

    expect(params.windSendGain).toBeGreaterThan(params.droneSendGain);
    expect(params.windSendGain).toBeGreaterThan(20);
    expect(params.noiseSendGain).toBe(0);
  });

  it("opens gradually with human presence instead of adding an event trigger", () => {
    const quietFrame = frame({ musicGain01: 0, candidates: 0, voices: 0, builtTexture01: 0.02 });
    const busyFrame = frame({ musicGain01: 0.9, candidates: 160, voices: 28, builtTexture01: 0.42 });
    const quiet = deriveEarthFormantParams(quietFrame, deriveEarthAirTurbulence(quietFrame));
    const busy = deriveEarthFormantParams(busyFrame, deriveEarthAirTurbulence(busyFrame));

    expect(quiet.amount01).toBeLessThan(0.02);
    expect(busy.amount01).toBeGreaterThan(quiet.amount01);
    expect(busy.bands.reduce((sum, band) => sum + band.gain01, 0)).toBeGreaterThan(
      quiet.bands.reduce((sum, band) => sum + band.gain01, 0),
    );
  });

  it("keeps formant centers inside broad physical bands", () => {
    const currentFrame = frame({ musicGain01: 0.65, candidates: 72, voices: 10, wind01: 0.8 });
    const params = deriveEarthFormantParams(currentFrame, deriveEarthAirTurbulence(currentFrame));
    const [body, mid, air] = params.bands;

    expect(body?.frequencyHz).toBeGreaterThanOrEqual(190);
    expect(body?.frequencyHz).toBeLessThanOrEqual(820);
    expect(mid?.frequencyHz).toBeGreaterThanOrEqual(620);
    expect(mid?.frequencyHz).toBeLessThanOrEqual(2600);
    expect(air?.frequencyHz).toBeGreaterThanOrEqual(1400);
    expect(air?.frequencyHz).toBeLessThanOrEqual(6200);
  });

  it("makes dry exposed air brighter and wetter cloudy air rounder", () => {
    const dryFrame = frame({
      musicGain01: 0.7,
      candidates: 100,
      voices: 18,
      cloudCover01: 0.08,
      humidity01: 0.12,
      waterRatio01: 0.05,
      forestRatio01: 0.08,
      wind01: 0.86,
      openness01: 0.88,
      surfaceHardness01: 0.72,
    });
    const wetFrame = frame({
      musicGain01: 0.7,
      candidates: 100,
      voices: 18,
      cloudCover01: 0.92,
      humidity01: 0.88,
      waterRatio01: 0.7,
      forestRatio01: 0.52,
      wind01: 0.14,
      openness01: 0.16,
      surfaceHardness01: 0.22,
    });
    const dry = deriveEarthFormantParams(dryFrame, deriveEarthAirTurbulence(dryFrame));
    const wet = deriveEarthFormantParams(wetFrame, deriveEarthAirTurbulence(wetFrame));
    const dryAir = dry.bands.find((band) => band.id === "air");
    const wetAir = wet.bands.find((band) => band.id === "air");

    expect(dryAir?.frequencyHz ?? 0).toBeGreaterThan(wetAir?.frequencyHz ?? 0);
    expect(dryAir?.q ?? 0).toBeGreaterThan(wetAir?.q ?? 0);
  });
});

function frame(
  overrides: {
    readonly active?: boolean;
    readonly musicGain01?: number;
    readonly candidates?: number;
    readonly voices?: number;
    readonly registerHz?: number;
    readonly cloudCover01?: number;
    readonly humidity01?: number;
    readonly wind01?: number;
    readonly precipitation01?: number;
    readonly surfaceHardness01?: number;
    readonly openness01?: number;
    readonly waterRatio01?: number;
    readonly forestRatio01?: number;
    readonly builtTexture01?: number;
  } = {},
): AudioFrameParams {
  const candidates = Array.from({ length: overrides.candidates ?? 0 }, (_, index) => ({
    id: `candidate-${index}`,
    sampleIndex: index,
    cellId: `cell-${index}`,
    latitudeDeg: 0,
    longitudeDeg: index,
    frequencyHz: 220,
    gain01: 0.2,
    scanlineWeight: 0.6,
    nightLightNorm: 0.4,
    registerMidi: 48,
    surfaceHardness01: 0.5,
    openness01: 0.5,
    waterRatio: 0.2,
    forestRatio: 0.1,
    roadDensityNorm: 0,
    buildingDensityNorm: 0,
    nightLightTopology: DEFAULT_NIGHTLIGHT_TOPOLOGY,
    cloudNorm: 0.2,
    humidityNorm: 0.4,
    windNorm: 0.2,
    precipitationNorm: 0,
    temperatureNorm: 0.5,
  }));
  const voices = candidates.slice(0, overrides.voices ?? 0);

  return {
    utcIso: "2026-05-07T00:00:00.000Z",
    utcEpochMs: Date.parse("2026-05-07T00:00:00.000Z"),
    earth: {
      active: overrides.active ?? true,
      gain01: 1,
      registerHz: overrides.registerHz ?? 160,
      brightness01: 0.5,
      cloudCover01: overrides.cloudCover01 ?? 0.32,
      humidity01: overrides.humidity01 ?? 0.45,
      wind01: overrides.wind01 ?? 0.4,
      precipitation01: overrides.precipitation01 ?? 0.08,
      surfaceHardness01: overrides.surfaceHardness01 ?? 0.5,
      openness01: overrides.openness01 ?? 0.5,
      waterRatio01: overrides.waterRatio01 ?? 0.2,
      oceanDepth01: 0.12,
      forestRatio01: overrides.forestRatio01 ?? 0.16,
      builtTexture01: overrides.builtTexture01 ?? 0.1,
      toneGain01: 0.4,
      noiseGain01: 0.08,
      noiseLowpassHz: 1800,
      noiseColor01: 0.5,
      precipitationGrainGain01: 0.01,
      precipitationGrainDensityHz: 1,
      precipitationGrainBrightness01: 0.4,
      surfaceTextureGain01: 0.01,
      surfaceTextureFilterHz: 1200,
      surfaceTextureQ: 1,
      surfaceRoughness01: 0.35,
      airTurbulenceDepth01: 0.35,
      airTurbulenceRateHz: 0.2,
      airTurbulenceSeed01: 0.4,
      droneDispersion01: 0.28,
      droneSpectralTilt01: 0.32,
      droneDamping01: 0.4,
      scanlineSpatialChange01: 0.22,
      scanlineSpatialVariance01: 0.18,
      scanlineSpatialSlope01: 0.04,
    },
    music: {
      active: candidates.length > 0,
      gain01: overrides.musicGain01 ?? 0,
      frequencyHz: 220,
      candidates,
      voices,
    },
    quakes: [],
    debugMeters: {
      earthEnergy01: 0.4,
      musicCandidateCount: candidates.length,
      musicVoiceCount: voices.length,
      musicEnergy01: 0,
      musicMaxGain01: overrides.musicGain01 ?? 0,
      musicMeanGain01: overrides.musicGain01 ?? 0,
      musicPulseEnvelope01: 0,
      precipitationGrainGain01: 0.01,
      precipitationGrainDensityHz: 1,
      surfaceTextureGain01: 0.01,
      surfaceRoughness01: 0.35,
      airTurbulenceDepth01: 0.35,
      airTurbulenceRateHz: 0.2,
      droneDispersion01: 0.28,
      droneSpectralTilt01: 0.32,
      scanlineSpatialChange01: 0.22,
      scanlineSpatialVariance01: 0.18,
      quakeEnergy01: 0,
    },
  };
}
