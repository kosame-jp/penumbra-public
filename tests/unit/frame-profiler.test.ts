import { describe, expect, it } from "vitest";

import { RollingFrameProfiler } from "../../src/core/performance/frame-profiler";

describe("frame profiler", () => {
  it("keeps a bounded rolling window of render measurements", () => {
    const profiler = new RollingFrameProfiler({ targetFps: 30, maxSamples: 3 });

    profiler.record({ frameElapsedMs: 33, renderElapsedMs: 4, heapUsedBytes: 100 });
    profiler.record({ frameElapsedMs: 34, renderElapsedMs: 5, heapUsedBytes: 120 });
    profiler.record({ frameElapsedMs: 50, renderElapsedMs: 7, heapUsedBytes: 140 });
    const stats = profiler.record({ frameElapsedMs: 36, renderElapsedMs: 6, heapUsedBytes: 160 });

    expect(stats.sampleCount).toBe(3);
    expect(stats.averageFrameMs).toBeCloseTo(40, 6);
    expect(stats.p95RenderMs).toBe(7);
    expect(stats.maxFrameMs).toBe(50);
    expect(stats.heapDeltaBytes).toBe(60);
  });

  it("reports dropped-frame ratio relative to the active target fps", () => {
    const profiler = new RollingFrameProfiler({ targetFps: 60, maxSamples: 4 });

    profiler.record({ frameElapsedMs: 16, renderElapsedMs: 3 });
    profiler.record({ frameElapsedMs: 18, renderElapsedMs: 4 });
    const stats = profiler.record({ frameElapsedMs: 40, renderElapsedMs: 5 });

    expect(stats.targetFps).toBe(60);
    expect(stats.droppedFrameRatio).toBeCloseTo(1 / 3, 6);
  });
});
