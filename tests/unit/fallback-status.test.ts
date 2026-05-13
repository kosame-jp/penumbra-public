import { describe, expect, it } from "vitest";

import {
  createRuntimeFallbackStatus,
  isAudioBlockingFallbackStatus,
  parseRuntimeFallbackDemoIds,
  sortRuntimeFallbackStatuses,
} from "../../src/core/runtime/fallback-status";

describe("runtime fallback status", () => {
  it("parses demo aliases deterministically", () => {
    expect(parseRuntimeFallbackDemoIds("cloud")).toEqual(["cloud-forecast-unavailable"]);
    expect(parseRuntimeFallbackDemoIds("audio")).toEqual([
      "human-worklet-unavailable",
      "earth-texture-worklet-unavailable",
    ]);
    expect(parseRuntimeFallbackDemoIds("cloud,audio,unknown,cloud")).toEqual([
      "cloud-forecast-unavailable",
      "human-worklet-unavailable",
      "earth-texture-worklet-unavailable",
    ]);
    expect(parseRuntimeFallbackDemoIds("clock")).toEqual(["canonical-clock-local-fallback"]);
  });

  it("marks only critical statuses as audio blocking", () => {
    expect(
      isAudioBlockingFallbackStatus(createRuntimeFallbackStatus("cloud-forecast-unavailable")),
    ).toBe(false);
    expect(
      isAudioBlockingFallbackStatus(createRuntimeFallbackStatus("human-worklet-unavailable")),
    ).toBe(true);
    expect(
      isAudioBlockingFallbackStatus(createRuntimeFallbackStatus("canonical-clock-local-fallback")),
    ).toBe(false);
    expect(isAudioBlockingFallbackStatus(createRuntimeFallbackStatus("worldgrid-fixture-fallback"))).toBe(
      true,
    );
  });

  it("sorts severe statuses first", () => {
    const statuses = sortRuntimeFallbackStatuses([
      createRuntimeFallbackStatus("cloud-forecast-unavailable"),
      createRuntimeFallbackStatus("human-worklet-unavailable"),
      createRuntimeFallbackStatus("worldgrid-fixture-fallback"),
    ]);

    expect(statuses.map((status) => status.id)).toEqual([
      "worldgrid-fixture-fallback",
      "human-worklet-unavailable",
      "cloud-forecast-unavailable",
    ]);
  });
});
