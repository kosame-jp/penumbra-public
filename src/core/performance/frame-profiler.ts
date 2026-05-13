export interface FrameMeasurement {
  readonly frameElapsedMs: number;
  readonly renderElapsedMs: number;
  readonly heapUsedBytes?: number;
}

export interface FrameProfilerOptions {
  readonly targetFps: 60 | 30;
  readonly maxSamples?: number;
}

export interface FrameProfilerStats {
  readonly sampleCount: number;
  readonly targetFps: 60 | 30;
  readonly averageFrameMs: number;
  readonly p95FrameMs: number;
  readonly maxFrameMs: number;
  readonly averageRenderMs: number;
  readonly p95RenderMs: number;
  readonly maxRenderMs: number;
  readonly droppedFrameRatio: number;
  readonly heapDeltaBytes?: number;
  readonly latestHeapUsedBytes?: number;
}

const DEFAULT_MAX_SAMPLES = 240;

export class RollingFrameProfiler {
  private readonly targetFps: 60 | 30;
  private readonly maxSamples: number;
  private readonly measurements: FrameMeasurement[] = [];
  private baselineHeapUsedBytes: number | undefined;

  constructor(options: FrameProfilerOptions) {
    this.targetFps = options.targetFps;
    this.maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
  }

  record(measurement: FrameMeasurement): FrameProfilerStats {
    if (
      this.baselineHeapUsedBytes === undefined &&
      measurement.heapUsedBytes !== undefined
    ) {
      this.baselineHeapUsedBytes = measurement.heapUsedBytes;
    }

    this.measurements.push(measurement);
    if (this.measurements.length > this.maxSamples) {
      this.measurements.splice(0, this.measurements.length - this.maxSamples);
    }

    return this.stats();
  }

  stats(): FrameProfilerStats {
    const frameTimes = this.measurements.map((measurement) => measurement.frameElapsedMs);
    const renderTimes = this.measurements.map((measurement) => measurement.renderElapsedMs);
    const latestHeapUsedBytes = latestDefined(
      this.measurements.map((measurement) => measurement.heapUsedBytes),
    );
    const targetFrameMs = 1000 / this.targetFps;
    const droppedFrames = frameTimes.filter((frameMs) => frameMs > targetFrameMs * 1.5).length;

    return {
      sampleCount: this.measurements.length,
      targetFps: this.targetFps,
      averageFrameMs: average(frameTimes),
      p95FrameMs: percentile(frameTimes, 0.95),
      maxFrameMs: max(frameTimes),
      averageRenderMs: average(renderTimes),
      p95RenderMs: percentile(renderTimes, 0.95),
      maxRenderMs: max(renderTimes),
      droppedFrameRatio:
        this.measurements.length === 0 ? 0 : droppedFrames / this.measurements.length,
      heapDeltaBytes:
        latestHeapUsedBytes !== undefined && this.baselineHeapUsedBytes !== undefined
          ? latestHeapUsedBytes - this.baselineHeapUsedBytes
          : undefined,
      latestHeapUsedBytes,
    };
  }
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function max(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? 0;
}

function latestDefined<T>(values: readonly (T | undefined)[]): T | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}
