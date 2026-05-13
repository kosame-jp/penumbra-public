import { gaussianWeight } from "../scanline/gaussian";
import { clamp } from "../scanline/geometry";
import { haversineDistanceKm } from "../static-data/worldgrid-loader";
import type {
  KernelFamily,
  TuningKernel,
  TuningKernelMode,
  TuningKernelSet,
} from "../static-data/kernels-loader";
import { midiToHz } from "./register";

export interface KernelWeightResult {
  readonly gridKernelWeights: Record<string, number>;
  readonly scaleKernelWeights: Record<string, number>;
  readonly dominantGridKernelId?: string;
  readonly dominantScaleKernelId?: string;
  readonly selectedScaleModeId?: string;
}

export interface TuningModeSelectionContext {
  readonly cellId?: string;
  readonly utcIso?: string;
  readonly nightLightTopology?: {
    readonly neighborMean01: number;
    readonly neighborMax01: number;
    readonly neighborLitCount01: number;
    readonly isolation01: number;
    readonly continuity01: number;
    readonly edge01: number;
  };
  readonly surfaceHardness01?: number;
  readonly openness01?: number;
  readonly waterRatio?: number;
  readonly forestRatio?: number;
  readonly roadDensityNorm?: number;
  readonly buildingDensityNorm?: number;
  readonly atmosphericWetnessNorm?: number;
  readonly humidityNorm?: number;
  readonly cloudNorm?: number;
  readonly windNorm?: number;
  readonly precipitationNorm?: number;
  readonly temperatureNorm?: number;
}

export interface TuningModeAtmosphere {
  readonly source: "gfs-forecast-artifact";
  readonly cloudNorm: number;
  readonly atmosphericWetnessNorm: number;
  readonly precipitationNorm: number;
}

export function tuningWeightsAt(
  latitudeDeg: number,
  longitudeDeg: number,
  kernelSet: TuningKernelSet,
  modeContext?: TuningModeSelectionContext,
): KernelWeightResult {
  const gridKernelWeights = normalizeKernelFamily(
    latitudeDeg,
    longitudeDeg,
    kernelSet.kernels,
    "grid",
  );
  const scaleKernelWeights = normalizeKernelFamily(
    latitudeDeg,
    longitudeDeg,
    kernelSet.kernels,
    "scale",
  );

  return withSelectedScaleMode(
    {
      gridKernelWeights,
      scaleKernelWeights,
      dominantGridKernelId: dominantKernelId(gridKernelWeights),
      dominantScaleKernelId: dominantKernelId(scaleKernelWeights),
    },
    kernelSet,
    modeContext,
  );
}

export function frequencyHzForTuningRegister(
  registerMidi: number,
  weights: KernelWeightResult,
  kernelSet: TuningKernelSet,
  keyCenterMidi?: number,
  modeContext?: TuningModeSelectionContext,
): number {
  const intervals = allowedIntervalsCents(weights, kernelSet, modeContext);
  if (keyCenterMidi != null) {
    return midiToHz(nearestKeyCenteredMidi(registerMidi, keyCenterMidi, intervals));
  }

  const octaveBaseMidi = Math.floor(registerMidi / 12) * 12;
  const centsInOctave = (registerMidi - octaveBaseMidi) * 100;
  const nearestInterval = nearestCents(centsInOctave, intervals);

  return midiToHz(octaveBaseMidi + nearestInterval / 100);
}

export function allowedIntervalsCents(
  weights: KernelWeightResult,
  kernelSet: TuningKernelSet,
  modeContext?: TuningModeSelectionContext,
): readonly number[] {
  const selectedWeights = withSelectedScaleMode(weights, kernelSet, modeContext);
  const scaleIntervals = scaleIntervalsForKernel(
    selectedWeights.dominantScaleKernelId,
    kernelSet,
    selectedWeights.selectedScaleModeId,
  );
  const gridIntervals = gridIntervalsForKernel(weights.dominantGridKernelId, kernelSet);
  if (scaleIntervals.length > 0 && gridIntervals.length > 0) {
    return projectIntervalsOntoGrid(scaleIntervals, gridIntervals);
  }

  if (scaleIntervals.length > 0) {
    return normalizeIntervals(scaleIntervals);
  }

  return gridIntervals.length > 0
    ? gridIntervals
    : [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100];
}

export function withSelectedScaleMode(
  weights: KernelWeightResult,
  kernelSet: TuningKernelSet,
  modeContext?: TuningModeSelectionContext,
): KernelWeightResult {
  if (!weights.dominantScaleKernelId || weights.selectedScaleModeId !== undefined) {
    return weights;
  }

  const selectedMode =
    modeContext === undefined
      ? firstScaleMode(weights.dominantScaleKernelId, kernelSet)
      : selectScaleMode(weights.dominantScaleKernelId, kernelSet, modeContext);
  if (!selectedMode) {
    return weights;
  }

  return {
    ...weights,
    selectedScaleModeId: selectedMode.id,
  };
}

function firstScaleMode(
  kernelId: string,
  kernelSet: TuningKernelSet,
): TuningKernelMode | undefined {
  const kernel = kernelSet.kernels.find((candidate) => candidate.id === kernelId);
  return kernel?.modes?.[0];
}

function normalizeKernelFamily(
  latitudeDeg: number,
  longitudeDeg: number,
  kernels: readonly TuningKernel[],
  family: KernelFamily,
): Record<string, number> {
  const rawWeights = kernels
    .filter((kernel) => kernel.family === family)
    .map((kernel) => {
      const distanceKm = haversineDistanceKm(
        latitudeDeg,
        longitudeDeg,
        kernel.centroid.latDeg,
        kernel.centroid.lonDeg,
      );
      return {
        id: kernel.id,
        weight: gaussianWeight(distanceKm, kernel.sigmaKm),
      };
    });

  const total = rawWeights.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) {
    return Object.fromEntries(rawWeights.map((item) => [item.id, 0]));
  }

  return Object.fromEntries(rawWeights.map((item) => [item.id, item.weight / total]));
}

function dominantKernelId(weights: Record<string, number>): string | undefined {
  let dominant: { id: string; weight: number } | undefined;

  for (const [id, weight] of Object.entries(weights)) {
    if (!dominant || weight > dominant.weight) {
      dominant = { id, weight };
    }
  }

  return dominant?.id;
}

function gridIntervalsForKernel(
  kernelId: string | undefined,
  kernelSet: TuningKernelSet,
): readonly number[] {
  if (!kernelId) {
    return [];
  }

  const kernel = kernelSet.kernels.find((candidate) => candidate.id === kernelId);
  return normalizeIntervals(kernel?.intervalCents ?? kernel?.modes?.[0]?.intervalCents ?? []);
}

function scaleIntervalsForKernel(
  kernelId: string | undefined,
  kernelSet: TuningKernelSet,
  modeId?: string,
): readonly number[] {
  if (!kernelId) {
    return [];
  }

  const kernel = kernelSet.kernels.find((candidate) => candidate.id === kernelId);
  const selectedMode =
    modeId === undefined ? undefined : kernel?.modes?.find((mode) => mode.id === modeId);
  return normalizeIntervals(
    selectedMode?.intervalCents ??
      kernel?.modes?.[0]?.intervalCents ??
      kernel?.intervalCents ??
      [],
  );
}

function selectScaleMode(
  kernelId: string,
  kernelSet: TuningKernelSet,
  context: TuningModeSelectionContext | undefined,
): TuningKernelMode | undefined {
  const kernel = kernelSet.kernels.find((candidate) => candidate.id === kernelId);
  const modes = kernel?.modes;
  if (!modes || modes.length === 0) {
    return undefined;
  }
  if (modes.length === 1) {
    return modes[0];
  }

  const target = modeSelectionTarget(context);
  let selected = modes[0];
  let selectedScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < modes.length; index += 1) {
    const mode = modes[index];
    const metrics = modeMetrics(mode, modes, index);
    const tieBreak = hash01(`${target.seed}:mode:${kernelId}:${mode.id}`) * 0.055;
    const score =
      (1 - Math.abs(metrics.density01 - target.density01)) * 0.44 +
      (1 - Math.abs(metrics.registerBias01 - target.registerBias01)) * 0.22 +
      (1 - Math.abs(metrics.position01 - target.position01)) * 0.26 +
      tieBreak;

    if (score > selectedScore) {
      selected = mode;
      selectedScore = score;
    }
  }

  return selected;
}

function modeSelectionTarget(context: TuningModeSelectionContext | undefined): {
  readonly density01: number;
  readonly registerBias01: number;
  readonly position01: number;
  readonly seed: string;
} {
  const topology = context?.nightLightTopology;
  const built01 = average([
    context?.roadDensityNorm ?? 0,
    context?.buildingDensityNorm ?? 0,
    topology?.neighborMean01 ?? 0,
    topology?.neighborLitCount01 ?? 0,
  ]);
  const continuity01 = topology?.continuity01 ?? 0;
  const isolation01 = topology?.isolation01 ?? 0;
  const edge01 = topology?.edge01 ?? 0;
  const openness01 = context?.openness01 ?? 0;
  const hardness01 = context?.surfaceHardness01 ?? 0;
  const wind01 = context?.windNorm ?? 0;
  const precipitation01 = context?.precipitationNorm ?? 0;
  const wetness01 = context?.atmosphericWetnessNorm ?? context?.humidityNorm ?? 0;
  const cloud01 = context?.cloudNorm ?? 0;
  const water01 = context?.waterRatio ?? 0;
  const forest01 = context?.forestRatio ?? 0;
  const temperature01 = context?.temperatureNorm ?? 0.5;
  const utcWeek = utcWeekIndex(context?.utcIso);
  const season = utcSeasonSine(context?.utcIso);
  const seed = `${context?.cellId ?? "unknown"}:week:${utcWeek}`;
  const weeklyNudge = hashSigned(`${seed}:scale-mode`) * 0.055;

  const openEnergy01 = clamp(
    built01 * 0.28 +
      continuity01 * 0.22 +
      openness01 * 0.14 +
      hardness01 * 0.12 +
      wind01 * 0.16 +
      precipitation01 * 0.08,
    0,
    1,
  );
  const damping01 = clamp(
    isolation01 * 0.26 +
      water01 * 0.19 +
      forest01 * 0.18 +
      wetness01 * 0.16 +
      cloud01 * 0.14 +
      (1 - temperature01) * 0.07,
    0,
    1,
  );

  return {
    density01: clamp(0.42 + openEnergy01 * 0.48 - damping01 * 0.36, 0, 1),
    registerBias01: clamp(
      0.5 +
        (openness01 - forest01) * 0.15 +
        (hardness01 - water01) * 0.12 +
        wind01 * 0.08 -
        wetness01 * 0.08,
      0,
      1,
    ),
    position01: clamp(
      0.5 +
        edge01 * 0.12 +
        continuity01 * 0.1 -
        isolation01 * 0.16 +
        season * 0.055 +
        weeklyNudge,
      0,
      1,
    ),
    seed,
  };
}

function modeMetrics(
  mode: TuningKernelMode,
  modes: readonly TuningKernelMode[],
  index: number,
): { readonly density01: number; readonly registerBias01: number; readonly position01: number } {
  const intervalCounts = modes.map(
    (candidate) => normalizeIntervals(candidate.intervalCents).length,
  );
  const minCount = Math.min(...intervalCounts);
  const maxCount = Math.max(...intervalCounts);
  const intervals = normalizeIntervals(mode.intervalCents);
  const density01 =
    maxCount === minCount ? 0.5 : (intervals.length - minCount) / (maxCount - minCount);
  const meanInterval = intervals.length === 0 ? 0 : average(intervals);

  return {
    density01: clamp(density01, 0, 1),
    registerBias01: clamp(meanInterval / 1100, 0, 1),
    position01: modes.length <= 1 ? 0.5 : index / (modes.length - 1),
  };
}

function projectIntervalsOntoGrid(
  scaleIntervals: readonly number[],
  gridIntervals: readonly number[],
): readonly number[] {
  const normalizedGrid = normalizeIntervals(gridIntervals);
  if (normalizedGrid.length === 0) {
    return normalizeIntervals(scaleIntervals);
  }

  return normalizeIntervals(
    scaleIntervals.map((interval) =>
      nearestCentsCircular(normalizeInterval(interval), normalizedGrid),
    ),
  );
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function utcWeekIndex(utcIso: string | undefined): number {
  if (!utcIso) {
    return 0;
  }

  const timestamp = Date.parse(utcIso);
  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  return Math.floor(timestamp / (7 * 86_400_000));
}

function utcSeasonSine(utcIso: string | undefined): number {
  if (!utcIso) {
    return 0;
  }

  const timestamp = Date.parse(utcIso);
  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  const date = new Date(timestamp);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = (timestamp - yearStart) / 86_400_000;
  return Math.sin((dayOfYear / 365.2425) * Math.PI * 2);
}

function hash01(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function hashSigned(input: string): number {
  return hash01(input) * 2 - 1;
}

function normalizeIntervals(intervals: readonly number[]): readonly number[] {
  const seen = new Set<number>();
  const normalized: number[] = [];

  for (const interval of intervals) {
    const normalizedInterval = normalizeInterval(interval);
    if (seen.has(normalizedInterval)) {
      continue;
    }
    seen.add(normalizedInterval);
    normalized.push(normalizedInterval);
  }

  return normalized.sort((left, right) => left - right);
}

function normalizeInterval(interval: number): number {
  return ((interval % 1200) + 1200) % 1200;
}

function nearestCents(cents: number, intervals: readonly number[]): number {
  return intervals.reduce((nearest, candidate) => {
    const nearestDistance = Math.abs(nearest - cents);
    const candidateDistance = Math.abs(candidate - cents);
    return candidateDistance < nearestDistance ? candidate : nearest;
  }, intervals[0] ?? 0);
}

function nearestCentsCircular(cents: number, intervals: readonly number[]): number {
  return intervals.reduce((nearest, candidate) => {
    const nearestDistance = circularCentsDistance(nearest, cents);
    const candidateDistance = circularCentsDistance(candidate, cents);
    return candidateDistance < nearestDistance ? candidate : nearest;
  }, intervals[0] ?? 0);
}

function circularCentsDistance(left: number, right: number): number {
  const distance = Math.abs(left - right);
  return Math.min(distance, 1200 - distance);
}

function nearestKeyCenteredMidi(
  registerMidi: number,
  keyCenterMidi: number,
  intervals: readonly number[],
): number {
  let nearestMidi = registerMidi;
  let nearestDistance = Number.POSITIVE_INFINITY;
  const safeIntervals = intervals.length > 0 ? intervals : [0];

  for (const intervalCents of safeIntervals) {
    const pitchClassMidi = keyCenterMidi + intervalCents / 100;
    const nearestOctave = Math.round((registerMidi - pitchClassMidi) / 12);
    for (const octaveOffset of [-1, 0, 1]) {
      const candidateMidi = pitchClassMidi + (nearestOctave + octaveOffset) * 12;
      const distance = Math.abs(candidateMidi - registerMidi);
      if (distance < nearestDistance) {
        nearestMidi = candidateMidi;
        nearestDistance = distance;
      }
    }
  }

  return nearestMidi;
}
