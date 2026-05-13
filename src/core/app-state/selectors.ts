import type { RuntimeSnapshot } from "./runtime-store";

export interface ScaleModeDistributionItem {
  readonly scaleKernelId: string;
  readonly modeId: string;
  readonly count: number;
  readonly fraction01: number;
}

export function activeMusicSampleCount(snapshot: RuntimeSnapshot): number {
  return snapshot.samples.filter((sample) => sample.layers.music.active).length;
}

export function activeQuakeCount(snapshot: RuntimeSnapshot): number {
  return snapshot.samples.reduce((sum, sample) => sum + sample.layers.quakes.length, 0);
}

export function maxNightLightNorm(snapshot: RuntimeSnapshot): number {
  return snapshot.samples.reduce(
    (max, sample) => Math.max(max, sample.nightLightNorm),
    0,
  );
}

export function maxMusicGain(snapshot: RuntimeSnapshot): number {
  return snapshot.samples.reduce(
    (max, sample) => Math.max(max, sample.layers.music.gain01),
    0,
  );
}

export function scaleModeDistribution(
  snapshot: RuntimeSnapshot,
): readonly ScaleModeDistributionItem[] {
  const counts = new Map<string, { scaleKernelId: string; modeId: string; count: number }>();
  let total = 0;

  for (const sample of snapshot.samples) {
    if (!sample.layers.music.active) {
      continue;
    }

    const scaleKernelId = sample.tuning.dominantScaleKernelId ?? "unknown-scale";
    const modeId = sample.tuning.selectedScaleModeId ?? "default";
    const key = `${scaleKernelId}/${modeId}`;
    const current = counts.get(key);
    if (current) {
      current.count += 1;
    } else {
      counts.set(key, { scaleKernelId, modeId, count: 1 });
    }
    total += 1;
  }

  if (total === 0) {
    return [];
  }

  return [...counts.values()]
    .map((item) => ({
      ...item,
      fraction01: item.count / total,
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.scaleKernelId.localeCompare(right.scaleKernelId) ||
        left.modeId.localeCompare(right.modeId),
    );
}
