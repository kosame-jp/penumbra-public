import type { CanonicalScanlineSample } from "../fusion/scanline-sample";
import { effectiveElevationM, registerMidiForElevation } from "../fusion/register";
import { QUAKE_WINDOW_MINUTES } from "../live-data/quake-store";
import { clamp } from "../scanline/geometry";
import type { WorldGridCell } from "../static-data/worldgrid-loader";
import { PENUMBRA_VISUAL_PALETTE } from "../visual-palette";

export interface VisualSampleParams {
  readonly cloudOpacity01: number;
  readonly precipitationNorm01: number;
  readonly precipitationParticleCount: number;
  readonly quakePointAlpha01: number;
  readonly quakePointScale: number;
}

export const HUMAN_PRESENCE_NIGHT_FADE_START = -0.035;
export const HUMAN_PRESENCE_NIGHT_FADE_END = 0.05;

export function deriveVisualSampleParams(sample: CanonicalScanlineSample): VisualSampleParams {
  const cloudNorm = clamp(sample.weather.cloudCoverPct / 100, 0, 1);
  const precipitationNorm01 = clamp(sample.weather.precipitationMm / 8, 0, 1);
  const nowMs = Date.parse(sample.utcIso);
  const quakeContactStrength01 = Math.max(
    0,
    ...sample.layers.quakes.map((quake) =>
      quakeVisualStrength01(nowMs, quake.eventTimeUtc, quake.magnitude),
    ),
  );

  return {
    cloudOpacity01: clamp(cloudNorm * sample.scanlineWeight, 0, 0.72),
    precipitationNorm01: precipitationNorm01 * sample.scanlineWeight,
    precipitationParticleCount: Math.ceil(precipitationNorm01 * sample.scanlineWeight * 10),
    quakePointAlpha01: clamp(quakeContactStrength01 * (0.22 + sample.scanlineWeight * 0.46), 0, 0.68),
    quakePointScale: quakeContactStrength01 > 0 ? 0.009 + quakeContactStrength01 * 0.024 : 0,
  };
}

export function nightSideHumanPresenceVisibility01(sunlight01: number): number {
  return 1 - smoothstep(HUMAN_PRESENCE_NIGHT_FADE_START, HUMAN_PRESENCE_NIGHT_FADE_END, sunlight01);
}

function quakeVisualStrength01(nowMs: number, eventTimeUtc: string, magnitude: number): number {
  const eventMs = Date.parse(eventTimeUtc);
  const ageMinutes = (nowMs - eventMs) / 60000;

  if (!Number.isFinite(ageMinutes) || ageMinutes < 0 || ageMinutes > QUAKE_WINDOW_MINUTES) {
    return 0;
  }

  const ageNorm = clamp(ageMinutes / QUAKE_WINDOW_MINUTES, 0, 1);
  const ageFade01 = 1 - smoothstep(0.22, 1, ageNorm);
  const magnitudeEnergy01 = 0.35 + clamp(magnitude / 8, 0, 1) * 0.65;
  return clamp(ageFade01 * magnitudeEnergy01, 0, 1);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function terrainRegisterColorForCell(cell: WorldGridCell): string {
  return terrainColorForRegisterMidi(registerMidiForElevation(effectiveElevationM(cell)));
}

export function terrainColorForRegisterMidi(registerMidi: number): string {
  if (registerMidi < 36) {
    return PENUMBRA_VISUAL_PALETTE.terrain.register.deepOcean;
  }

  if (registerMidi < 48) {
    return PENUMBRA_VISUAL_PALETTE.terrain.register.shallowOcean;
  }

  if (registerMidi < 60) {
    return PENUMBRA_VISUAL_PALETTE.terrain.register.lowLand;
  }

  if (registerMidi < 72) {
    return PENUMBRA_VISUAL_PALETTE.terrain.register.upland;
  }

  if (registerMidi < 84) {
    return PENUMBRA_VISUAL_PALETTE.terrain.register.mountain;
  }

  if (registerMidi < 96) {
    return PENUMBRA_VISUAL_PALETTE.terrain.register.highLand;
  }

  return PENUMBRA_VISUAL_PALETTE.terrain.register.ice;
}

export function terrainRadiusForCell(cell: WorldGridCell): number {
  const elevationM = effectiveElevationM(cell);
  const normalizedMagnitude =
    elevationM < 0
      ? clamp(Math.abs(elevationM) / 10_994, 0, 1)
      : clamp(elevationM / 8_849, 0, 1);

  return 1.012 + normalizedMagnitude * (elevationM < 0 ? 0.055 : 0.14);
}

export function terrainHeight01ForCell(cell: WorldGridCell): number {
  const elevationM = effectiveElevationM(cell);

  if (elevationM < 0) {
    return 0.5 - Math.sqrt(clamp(Math.abs(elevationM) / 10_994, 0, 1)) * 0.42;
  }

  return 0.5 + Math.sqrt(clamp(elevationM / 8_849, 0, 1)) * 0.5;
}
