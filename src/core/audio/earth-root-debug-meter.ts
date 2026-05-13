export interface EarthRootDebugMeterPoint {
  readonly x: number;
  readonly y: number;
}

export interface EarthRootDebugMeterSnapshot {
  readonly rootHz: number;
  readonly active: boolean;
  readonly rmsDb: number;
  readonly peak01: number;
  readonly displayGain: number;
  readonly stereoWidth01: number;
  readonly points: readonly EarthRootDebugMeterPoint[];
}

export function createEarthRootDebugMeterSnapshotFromTimeDomain(input: {
  readonly rootHz: number;
  readonly left: ArrayLike<number>;
  readonly right: ArrayLike<number>;
  readonly displayGain?: number;
  readonly pointCount?: number;
}): EarthRootDebugMeterSnapshot {
  const sampleCount = Math.min(input.left.length, input.right.length);
  if (sampleCount <= 0) {
    return emptyEarthRootDebugMeterSnapshot(input.rootHz);
  }

  const requestedPointCount = input.pointCount ?? 128;
  const pointCount = Math.max(2, Math.min(sampleCount, Math.floor(requestedPointCount)));
  const selectedPoints: { readonly mid: number; readonly side: number }[] = [];
  const displayGain = clampNumber(input.displayGain ?? 8, 0.5, 160);
  let rmsSum = 0;
  let midRmsSum = 0;
  let sideRmsSum = 0;
  let peak01 = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const left = clampSigned(input.left[index] ?? 0);
    const right = clampSigned(input.right[index] ?? 0);
    const mid = (left + right) * Math.SQRT1_2;
    const side = (right - left) * Math.SQRT1_2;
    rmsSum += left * left + right * right;
    midRmsSum += mid * mid;
    sideRmsSum += side * side;
    peak01 = Math.max(peak01, Math.abs(mid), Math.abs(side));
  }

  for (let index = 0; index < pointCount; index += 1) {
    const sourceIndex = Math.min(
      sampleCount - 1,
      Math.floor((index / Math.max(1, pointCount - 1)) * (sampleCount - 1)),
    );
    const left = clampSigned(input.left[sourceIndex] ?? 0);
    const right = clampSigned(input.right[sourceIndex] ?? 0);
    const mid = (left + right) * Math.SQRT1_2;
    const side = (right - left) * Math.SQRT1_2;
    selectedPoints.push({ mid, side });
  }

  const active = peak01 > 0.00001;
  const points = selectedPoints.map((point) => ({
    x: clampNumber(point.side * displayGain, -0.82, 0.82),
    y: clampNumber(-point.mid * displayGain, -0.82, 0.82),
  }));
  const rms = Math.sqrt(rmsSum / Math.max(1, sampleCount * 2));
  const midRms = Math.sqrt(midRmsSum / sampleCount);
  const sideRms = Math.sqrt(sideRmsSum / sampleCount);
  const stereoWidth01 = clampNumber(sideRms / (midRms + sideRms + 0.000001), 0, 1);

  return {
    rootHz: input.rootHz,
    active,
    rmsDb: 20 * Math.log10(Math.max(rms, 0.000001)),
    peak01,
    displayGain,
    stereoWidth01,
    points,
  };
}

export function smoothEarthRootDebugMeterRootHz(input: {
  readonly previousHz: number | undefined;
  readonly targetHz: number;
  readonly elapsedSeconds: number;
  readonly timeConstantSeconds: number;
}): number {
  if (input.previousHz === undefined || !Number.isFinite(input.previousHz) || input.previousHz <= 0) {
    return input.targetHz;
  }

  const elapsedSeconds = Math.max(0, input.elapsedSeconds);
  const timeConstantSeconds = Math.max(0.001, input.timeConstantSeconds);
  const response01 = 1 - Math.exp(-elapsedSeconds / timeConstantSeconds);
  return input.previousHz + (input.targetHz - input.previousHz) * response01;
}

function emptyEarthRootDebugMeterSnapshot(rootHz: number): EarthRootDebugMeterSnapshot {
  return {
    rootHz,
    active: false,
    rmsDb: -120,
    peak01: 0,
    displayGain: 1,
    stereoWidth01: 0,
    points: [],
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampSigned(value: number): number {
  return clampNumber(value, -1, 1);
}
