import { describe, expect, it } from "vitest";

import type { PenumbraWaterTextureParams } from "../../src/core/audio/penumbra-earth-texture-params";
import type { PrecipitationBandField } from "../../src/core/fusion/precipitation-band";
import {
  DEFAULT_NIGHTLIGHT_TOPOLOGY,
  type CanonicalScanlineSample,
} from "../../src/core/fusion/scanline-sample";
import {
  precipitationVisualParticles,
  type PrecipitationVisualParticle,
} from "../../src/core/visual/precipitation-visual";

describe("precipitation visual event field", () => {
  it("does not render rain particles without real precipitation cells", () => {
    expect(
      precipitationVisualParticles({
        samples: [sample({ precipitationMm: 0 })],
        epochMs: Date.parse("2026-05-07T00:00:00.000Z"),
        water: waterTexture(),
      }),
    ).toEqual([]);
  });

  it("uses a deterministic UTC event field for rain particles", () => {
    const input = {
      samples: [
        sample({ cellId: "dry", latitudeDeg: 4, longitudeDeg: 12, precipitationMm: 0 }),
        sample({ cellId: "rain", latitudeDeg: 8, longitudeDeg: 22, precipitationMm: 3.2 }),
      ],
      epochMs: Date.parse("2026-05-07T00:00:00.500Z"),
      water: waterTexture({ highDensityHz: 18 }),
    };

    const first = precipitationVisualParticles(input);
    const second = precipitationVisualParticles(input);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((particle) => Math.abs(particle.latitudeDeg - 8) < 1.2)).toBe(true);
    expect(first.every((particle) => Math.abs(particle.longitudeDeg - 22) < 1.4)).toBe(true);
  });

  it("advances particles with UTC rather than a fixed visual loop", () => {
    const samples = [sample({ precipitationMm: 4.2 })];
    const water = waterTexture({ highDensityHz: 24 });
    const now = Date.parse("2026-05-07T00:00:00.500Z");

    expect(
      precipitationVisualParticles({ samples, epochMs: now, water }),
    ).not.toEqual(
      precipitationVisualParticles({ samples, epochMs: now + 180, water }),
    );
  });

  it("keeps visual rain tails after the high droplet has ended", () => {
    const water = waterTexture({ highDensityHz: 1.5, brightness01: 0.58, highLevel01: 0.72 });
    const start = Date.parse("2026-05-07T00:00:00.000Z");
    let particles: PrecipitationVisualParticle[] = [];
    for (let offsetMs = 0; offsetMs <= 12_000 && particles.length === 0; offsetMs += 100) {
      particles = precipitationVisualParticles({
        samples: [sample({ precipitationMm: 4.2 })],
        epochMs: start + offsetMs,
        water,
      });
    }

    expect(particles.length).toBeGreaterThan(0);
    expect(particles.some((particle) => particle.age01 > 0)).toBe(true);
  });

  it("renders actual scheduled high droplet events when provided", () => {
    const epochMs = Date.parse("2026-05-07T00:00:04.000Z");
    const particles = precipitationVisualParticles({
      samples: [sample({ precipitationMm: 4.2 })],
      epochMs,
      water: waterTexture({ highDensityHz: 0.12 }),
      highDropletEvents: [
        { scheduledUtcMs: epochMs - 240, randomSeed: 0x12345678, velocity01: 0.62 },
      ],
    });

    expect(particles).toHaveLength(1);
    expect(particles[0]?.age01).toBeGreaterThan(0);
  });

  it("does not draw future high droplet events before the audible event time", () => {
    const epochMs = Date.parse("2026-05-07T00:00:04.000Z");
    const particles = precipitationVisualParticles({
      samples: [sample({ precipitationMm: 4.2 })],
      epochMs,
      water: waterTexture({ highDensityHz: 12 }),
      highDropletEvents: [
        { scheduledUtcMs: epochMs + 80, randomSeed: 0x12345678, velocity01: 0.62 },
      ],
    });

    expect(particles).toEqual([]);
  });

  it("keeps an already scheduled high droplet visible even if current density has fallen", () => {
    const epochMs = Date.parse("2026-05-07T00:00:04.000Z");
    const particles = precipitationVisualParticles({
      samples: [sample({ precipitationMm: 4.2 })],
      epochMs,
      water: waterTexture({ highDensityHz: 0, dropletGain01: 0, highLevel01: 0 }),
      highDropletEvents: [
        { scheduledUtcMs: epochMs - 240, randomSeed: 0x12345678, velocity01: 0.62 },
      ],
    });

    expect(particles).toHaveLength(1);
  });

  it("keeps low-density visual rain stable when source density jitters slightly", () => {
    const start = Date.parse("2026-05-07T00:00:00.000Z");
    const samples = [sample({ precipitationMm: 4.2 })];
    let epochMs = start;
    let baseParticles: PrecipitationVisualParticle[] = [];
    for (let offsetMs = 0; offsetMs <= 120_000 && baseParticles.length === 0; offsetMs += 100) {
      epochMs = start + offsetMs;
      baseParticles = precipitationVisualParticles({
        samples,
        epochMs,
        water: waterTexture({ highDensityHz: 0.12 }),
      });
    }

    const jitteredParticles = precipitationVisualParticles({
      samples,
      epochMs,
      water: waterTexture({ highDensityHz: 0.121 }),
    });

    expect(baseParticles.length).toBeGreaterThan(0);
    expect(jitteredParticles.length).toBe(baseParticles.length);
    expect(jitteredParticles[0]?.latitudeDeg).toBeCloseTo(baseParticles[0]?.latitudeDeg ?? 0);
    expect(jitteredParticles[0]?.longitudeDeg).toBeCloseTo(baseParticles[0]?.longitudeDeg ?? 0);
  });

  it("can assign rain particles to precipitation atlas band cells wider than the centerline sample", () => {
    const particles = precipitationVisualParticles({
      samples: [sample({ precipitationMm: 0 })],
      epochMs: Date.parse("2026-05-07T00:00:00.500Z"),
      water: waterTexture({ highDensityHz: 20 }),
      precipitationBand: precipitationBand(),
    });

    expect(particles.length).toBeGreaterThan(0);
    expect(particles.every((particle) => Math.abs(particle.latitudeDeg - 12) < 1.2)).toBe(true);
    expect(particles.every((particle) => Math.abs(particle.longitudeDeg - 35) < 1.6)).toBe(true);
  });

  it("keeps precipitation atlas rain events as deterministic visual trails", () => {
    const input = {
      samples: [sample({ precipitationMm: 0 })],
      epochMs: Date.parse("2026-05-07T00:00:00.500Z"),
      water: waterTexture({ highDensityHz: 40 }),
      precipitationBand: precipitationBand({
        samples: [
          { id: "a", latitudeDeg: 10, longitudeDeg: 34, precipitation01: 0.72, scanlineWeight: 0.8 },
          { id: "b", latitudeDeg: 11, longitudeDeg: 35, precipitation01: 0.76, scanlineWeight: 0.78 },
          { id: "c", latitudeDeg: 46, longitudeDeg: -20, precipitation01: 0.8, scanlineWeight: 0.7 },
        ],
      }),
    };

    const first = precipitationVisualParticles(input);
    const second = precipitationVisualParticles(input);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(2);
    expect(first.length).toBeLessThanOrEqual(192);
    expect(
      new Set(first.map((particle) => `${particle.latitudeDeg.toFixed(4)}:${particle.longitudeDeg.toFixed(4)}`)).size,
    ).toBeGreaterThan(2);
  });
});

function waterTexture(overrides: Partial<PenumbraWaterTextureParams> = {}): PenumbraWaterTextureParams {
  return {
    noiseFloorGain01: overrides.noiseFloorGain01 ?? 0,
    dropletDensityHz: overrides.dropletDensityHz ?? 13.12,
    lowDensityHz: overrides.lowDensityHz ?? 0.62,
    midDensityHz: overrides.midDensityHz ?? 0.5,
    highDensityHz: overrides.highDensityHz ?? 12,
    dropletGain01: overrides.dropletGain01 ?? 0.026,
    brightness01: overrides.brightness01 ?? 0.58,
    lowLevel01: overrides.lowLevel01 ?? 0.52,
    midLevel01: overrides.midLevel01 ?? 0.5,
    highLevel01: overrides.highLevel01 ?? 0.72,
  };
}

function precipitationBand(overrides: Partial<PrecipitationBandField> = {}): PrecipitationBandField {
  return {
    active: true,
    source: "cloud-atlas-precipitation",
    activity01: 0.12,
    coverage01: 0.2,
    intensity01: 0.6,
    maxPrecipitation01: 0.82,
    sampleCount: 3,
    rainySampleCount: 1,
    frameMix01: 0.25,
    leftValidAtUtc: "2026-05-07T00:00:00.000Z",
    rightValidAtUtc: "2026-05-07T03:00:00.000Z",
    samples: [
      {
        id: "precip:12:35",
        latitudeDeg: 12,
        longitudeDeg: 35,
        precipitation01: 0.82,
        scanlineWeight: 0.62,
      },
    ],
    ...overrides,
  };
}

function sample(overrides: {
  readonly cellId?: string;
  readonly latitudeDeg?: number;
  readonly longitudeDeg?: number;
  readonly scanlineWeight?: number;
  readonly precipitationMm?: number;
} = {}): CanonicalScanlineSample {
  return {
    latitudeDeg: overrides.latitudeDeg ?? 0,
    longitudeDeg: overrides.longitudeDeg ?? 0,
    scanlineWeight: overrides.scanlineWeight ?? 1,
    utcIso: "2026-05-07T00:00:00.000Z",
    cellId: overrides.cellId ?? "rain-cell",
    effectiveElevationM: 0,
    registerMidi: 48,
    nightLightNorm: 0,
    surfaceHardness01: 0.5,
    openness01: 0.5,
    waterRatio: 0.2,
    forestRatio: 0.1,
    roadDensityNorm: 0,
    buildingDensityNorm: 0,
    nightLightTopology: DEFAULT_NIGHTLIGHT_TOPOLOGY,
    spatialChange01: 0,
    spatialSlope01: 0,
    weather: {
      cloudCoverPct: 40,
      relativeHumidityPct: 70,
      windSpeedMps: 3,
      precipitationMm: overrides.precipitationMm ?? 1.8,
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
        active: true,
        brightness01: 0.6,
      },
      music: {
        active: false,
        gain01: 0,
        frequencyHz: 261.6255653005986,
      },
      quakes: [],
    },
  };
}
