import { describe, expect, it } from "vitest";

import {
  AUDIO_PERF_DIAGNOSTIC_BYPASSES,
  AUDIO_TUNING_VERSION,
  clampAudioPerfDiagnosticBypasses,
  clampAudioPerfDiagnostics,
  clampAudioTuningOverrides,
  createAudioTuningSnapshot,
  dbToGain,
} from "../../src/core/audio/audio-tuning";

describe("audio tuning overrides", () => {
  it("converts dB offsets into linear gain", () => {
    expect(dbToGain(0)).toBeCloseTo(1);
    expect(dbToGain(6)).toBeCloseTo(1.995, 3);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
  });

  it("clamps user-facing override ranges and fills omitted values", () => {
    const overrides = clampAudioTuningOverrides({
      masterGainDb: 99,
      humanLayerGainDb: -99,
      sharedReverbReturnDb: Number.NaN,
    });

    expect(overrides.masterGainDb).toBe(12);
    expect(overrides.humanLayerGainDb).toBe(-24);
    expect(overrides.sharedReverbReturnDb).toBe(0);
    expect(overrides.formantWindSendDb).toBe(-13);
    expect(overrides.waterTextureDryGainDb).toBe(-4);
  });

  it("normalizes diagnostic bypass toggles independently from gain overrides", () => {
    const bypasses = clampAudioPerfDiagnosticBypasses({
      sharedReverb: true,
      formant: false,
      humanWorklet: true,
    });

    expect(bypasses.sharedReverb).toBe(true);
    expect(bypasses.formant).toBe(false);
    expect(bypasses.humanWorklet).toBe(true);
    expect(bypasses.humanWorkletReverb).toBe(true);
    expect(bypasses.earthTextureWorklet).toBe(false);
    expect(Object.keys(bypasses).sort()).toEqual(
      AUDIO_PERF_DIAGNOSTIC_BYPASSES.map((bypass) => bypass.key).sort(),
    );
  });

  it("exports deterministic JSON-friendly snapshots", () => {
    const createdAt = new Date("2026-05-08T00:00:00.000Z");
    const overrides = clampAudioTuningOverrides({ textureReverbSendDb: 3.5 });
    const snapshot = createAudioTuningSnapshot(
      overrides,
      createdAt,
      clampAudioPerfDiagnostics({
        bypasses: { rainGranular: true },
        humanVoiceCap: 16,
        humanEventCapPerSecond: 12,
        humanPartialCap: 4,
      }),
    );

    expect(snapshot.version).toBe(AUDIO_TUNING_VERSION);
    expect(snapshot.createdAtUtc).toBe("2026-05-08T00:00:00.000Z");
    expect(snapshot.overrides.textureReverbSendDb).toBe(3.5);
    expect(snapshot.diagnostics.bypasses.rainGranular).toBe(true);
    expect(snapshot.diagnostics.bypasses.sharedReverb).toBe(false);
    expect(snapshot.diagnostics.bypasses.humanWorkletReverb).toBe(true);
    expect(snapshot.diagnostics.humanVoiceCap).toBe(16);
    expect(snapshot.diagnostics.humanEventCapPerSecond).toBe(12);
    expect(snapshot.diagnostics.humanPartialCap).toBe(4);
  });

  it("uses the current auditioned mix as the default override state", () => {
    const overrides = clampAudioTuningOverrides({});

    expect(overrides.masterGainDb).toBe(12);
    expect(overrides.earthBusGainDb).toBe(0);
    expect(overrides.earthTextureDryGainDb).toBe(-2.5);
    expect(overrides.waterTextureDryGainDb).toBe(-4);
    expect(overrides.windTextureDryGainDb).toBe(-24);
    expect(overrides.humanLayerGainDb).toBe(1);
    expect(overrides.quakeLayerGainDb).toBe(0);
    expect(overrides.sharedReverbReturnDb).toBe(0);
    expect(overrides.textureReverbSendDb).toBe(0);
    expect(overrides.waterReverbSendDb).toBe(-2);
    expect(overrides.windReverbSendDb).toBe(-8);
    expect(overrides.humanReverbSendDb).toBe(5);
    expect(overrides.droneReverbSendDb).toBe(4);
    expect(overrides.quakeReverbSendDb).toBe(0);
    expect(overrides.formantReturnDb).toBe(0);
    expect(overrides.formantDroneSendDb).toBe(0);
    expect(overrides.formantWindSendDb).toBe(-13);
  });
});
