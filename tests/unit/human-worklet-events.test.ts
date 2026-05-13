import { describe, expect, it } from "vitest";

import { createHumanWorkletPluckMessage } from "../../src/core/audio/human-worklet-events";
import type { HumanPluckParams } from "../../src/core/audio/human-pluck-params";

describe("human AudioWorklet event contract", () => {
  it("serializes pluck parameters without embedding non-cloneable audio nodes", () => {
    const message = createHumanWorkletPluckMessage(
      pluckParams({
        frequencyHz: 330,
        peakGain01: 0.04,
      }),
      12.5,
      { randomSeed: 12345 },
    );

    expect(message).toEqual({
      type: "pluck",
      startTimeSeconds: 12.5,
      randomSeed: 12345,
      frequencyHz: 330,
      peakGain01: 0.04,
      attackSeconds: 0.01,
      decaySeconds: 0.7,
      lowpassHz: 3200,
      noiseGain01: 0.004,
      reverbSend01: 0.08,
      reverbTailSeconds: 0.6,
      reverbDampingHz: 2800,
      partials: [
        { ratio: 1, gain01: 1, detuneCents: 0, decayScale: 1 },
        { ratio: 2, gain01: 0.2, detuneCents: 1.5, decayScale: 0.7 },
      ],
    });
    expect(() => structuredClone(message)).not.toThrow();
  });
});

function pluckParams(overrides: Partial<HumanPluckParams> = {}): HumanPluckParams {
  return {
    frequencyHz: overrides.frequencyHz ?? 220,
    peakGain01: overrides.peakGain01 ?? 0.02,
    attackSeconds: overrides.attackSeconds ?? 0.01,
    decaySeconds: overrides.decaySeconds ?? 0.7,
    lowpassHz: overrides.lowpassHz ?? 3200,
    noiseGain01: overrides.noiseGain01 ?? 0.004,
    reverbSend01: overrides.reverbSend01 ?? 0.08,
    reverbTailSeconds: overrides.reverbTailSeconds ?? 0.6,
    reverbDampingHz: overrides.reverbDampingHz ?? 2800,
    partials: overrides.partials ?? [
      { ratio: 1, gain01: 1, detuneCents: 0, decayScale: 1 },
      { ratio: 2, gain01: 0.2, detuneCents: 1.5, decayScale: 0.7 },
    ],
  };
}
