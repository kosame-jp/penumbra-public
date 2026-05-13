import { describe, expect, it } from "vitest";

import {
  DEFAULT_NIGHTLIGHT_TOPOLOGY,
  type CanonicalScanlineSample,
} from "../../src/core/fusion/scanline-sample";
import { PENUMBRA_VISUAL_PALETTE } from "../../src/core/visual-palette";
import {
  deriveVisualSampleParams,
  nightSideHumanPresenceVisibility01,
  terrainColorForRegisterMidi,
  terrainHeight01ForCell,
  terrainRadiusForCell,
} from "../../src/core/visual/visual-params";
import type { WorldGridCell } from "../../src/core/static-data/worldgrid-loader";
import { terrainColorForCell } from "../../src/core/static-data/terrain-color";

describe("visual parameter derivation", () => {
  it("keeps clouds local to active scanline samples", () => {
    const cloudyButOutOfReach = sample({
      scanlineWeight: 0,
      cloudCoverPct: 100,
    });

    expect(deriveVisualSampleParams(cloudyButOutOfReach).cloudOpacity01).toBe(0);
  });

  it("keeps constant human presence on the night side and hides it under sunlight", () => {
    expect(nightSideHumanPresenceVisibility01(-0.2)).toBe(1);
    expect(nightSideHumanPresenceVisibility01(0.2)).toBe(0);
    expect(nightSideHumanPresenceVisibility01(0)).toBeGreaterThan(0);
    expect(nightSideHumanPresenceVisibility01(0)).toBeLessThan(1);
  });

  it("renders low magnitude earthquake contacts without threshold filtering", () => {
    const lowMagnitudeContact = sample({
      quakeMagnitude: 0.1,
    });

    const params = deriveVisualSampleParams(lowMagnitudeContact);
    expect(params.quakePointAlpha01).toBeGreaterThan(0);
    expect(params.quakePointScale).toBeGreaterThan(0);
  });

  it("fades earthquake contacts across the 81 minute window", () => {
    const freshContact = deriveVisualSampleParams(
      sample({
        quakeMagnitude: 4,
        quakeEventTimeUtc: "2026-04-29T23:55:00.000Z",
      }),
    );
    const expiringContact = deriveVisualSampleParams(
      sample({
        quakeMagnitude: 4,
        quakeEventTimeUtc: "2026-04-29T22:42:00.000Z",
      }),
    );
    const expiredContact = deriveVisualSampleParams(
      sample({
        quakeMagnitude: 4,
        quakeEventTimeUtc: "2026-04-29T22:38:00.000Z",
      }),
    );

    expect(freshContact.quakePointAlpha01).toBeGreaterThan(expiringContact.quakePointAlpha01);
    expect(freshContact.quakePointScale).toBeGreaterThan(expiringContact.quakePointScale);
    expect(expiringContact.quakePointAlpha01).toBeLessThan(0.02);
    expect(expiredContact.quakePointAlpha01).toBe(0);
    expect(expiredContact.quakePointScale).toBe(0);
  });

  it("aligns terrain colors to elevation register bands", () => {
    expect(terrainColorForRegisterMidi(30)).toBe(
      PENUMBRA_VISUAL_PALETTE.terrain.register.deepOcean,
    );
    expect(terrainColorForRegisterMidi(50)).toBe(
      PENUMBRA_VISUAL_PALETTE.terrain.register.lowLand,
    );
    expect(terrainColorForRegisterMidi(90)).toBe(
      PENUMBRA_VISUAL_PALETTE.terrain.register.highLand,
    );
  });

  it("quantizes ocean terrain colors from bathymetry", () => {
    const shallowOcean = worldCell({ elevationM: 0, bathymetryM: -120, landClass: "ocean" });
    const midOcean = worldCell({ elevationM: 0, bathymetryM: -4300, landClass: "ocean" });
    const deepOcean = worldCell({ elevationM: 0, bathymetryM: -8600, landClass: "ocean" });

    expect(terrainColorForCell(shallowOcean)).toBe(
      PENUMBRA_VISUAL_PALETTE.terrain.oceanDepthBands[0],
    );
    expect(terrainColorForCell(midOcean)).not.toBe(terrainColorForCell(shallowOcean));
    expect(terrainColorForCell(deepOcean)).toBe(
      PENUMBRA_VISUAL_PALETTE.terrain.oceanDepthBands.at(-1),
    );
  });

  it("exaggerates land elevation and ocean depth from physical terrain values", () => {
    const plain = worldCell({ elevationM: 30, bathymetryM: 0, landClass: "land" });
    const mountain = worldCell({ elevationM: 6500, bathymetryM: 0, landClass: "land" });
    const deepOcean = worldCell({ elevationM: 0, bathymetryM: -9600, landClass: "ocean" });

    expect(terrainRadiusForCell(mountain)).toBeGreaterThan(terrainRadiusForCell(plain));
    expect(terrainRadiusForCell(deepOcean)).toBeGreaterThan(terrainRadiusForCell(plain));
  });

  it("encodes terrain height around sea level for shader normal relief", () => {
    const seaLevel = worldCell({ elevationM: 0, bathymetryM: 0, landClass: "land" });
    const mountain = worldCell({ elevationM: 6500, bathymetryM: 0, landClass: "land" });
    const deepOcean = worldCell({ elevationM: 0, bathymetryM: -9600, landClass: "ocean" });

    expect(terrainHeight01ForCell(seaLevel)).toBeCloseTo(0.5, 6);
    expect(terrainHeight01ForCell(mountain)).toBeGreaterThan(terrainHeight01ForCell(seaLevel));
    expect(terrainHeight01ForCell(deepOcean)).toBeLessThan(terrainHeight01ForCell(seaLevel));
  });
});

interface SampleOptions {
  readonly scanlineWeight?: number;
  readonly cloudCoverPct?: number;
  readonly nightLightNorm?: number;
  readonly musicActive?: boolean;
  readonly quakeMagnitude?: number;
  readonly quakeEventTimeUtc?: string;
}

function sample(options: SampleOptions): CanonicalScanlineSample {
  return {
    latitudeDeg: 0,
    longitudeDeg: 0,
    scanlineWeight: options.scanlineWeight ?? 1,
    utcIso: "2026-04-30T00:00:00.000Z",
    cellId: "test-cell",
    effectiveElevationM: 0,
    registerMidi: 48,
    nightLightNorm: options.nightLightNorm ?? 0,
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
      cloudCoverPct: options.cloudCoverPct ?? 0,
      relativeHumidityPct: 60,
      windSpeedMps: 2,
      precipitationMm: 0,
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
        brightness01: 0.7,
      },
      music: {
        active: options.musicActive ?? false,
        gain01: options.musicActive ? 0.5 : 0,
        frequencyHz: 261.6255653005986,
      },
      quakes:
        options.quakeMagnitude == null
          ? []
          : [
              {
                id: "quake",
                provider: "test",
                eventTimeUtc: options.quakeEventTimeUtc ?? "2026-04-29T23:30:00.000Z",
                updatedTimeUtc: options.quakeEventTimeUtc ?? "2026-04-29T23:30:00.000Z",
                latitudeDeg: 0,
                longitudeDeg: 0,
                depthKm: 120,
                magnitude: options.quakeMagnitude,
              },
            ],
    },
  };
}

function worldCell(
  overrides: Pick<WorldGridCell, "elevationM" | "bathymetryM" | "landClass">,
): WorldGridCell {
  return {
    id: "cell",
    latCenterDeg: 0,
    lonCenterDeg: 0,
    terrainClass: "fixture",
    roadLengthKm: 0,
    buildingCount: 0,
    waterRatio: overrides.landClass === "ocean" ? 1 : 0,
    forestRatio: 0,
    nightLightMean: 0,
    surfaceHardness01: 0.5,
    openness01: 0.5,
    ...overrides,
  };
}
