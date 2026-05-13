export const AUDIO_TUNING_VERSION = "penumbra-audio-tuning-v1";

export const AUDIO_TUNING_CONTROLS = [
  {
    key: "masterGainDb",
    label: "MASTER",
    minDb: -24,
    maxDb: 12,
    stepDb: 0.5,
    defaultDb: 12,
  },
  {
    key: "earthBusGainDb",
    label: "EARTH BUS",
    minDb: -24,
    maxDb: 12,
    stepDb: 0.5,
    defaultDb: 0,
  },
  {
    key: "earthTextureDryGainDb",
    label: "TEXTURE DRY ALL",
    minDb: -36,
    maxDb: 12,
    stepDb: 0.5,
    defaultDb: -2.5,
  },
  {
    key: "waterTextureDryGainDb",
    label: "WATER DRY",
    minDb: -36,
    maxDb: 12,
    stepDb: 0.5,
    defaultDb: -4,
  },
  {
    key: "windTextureDryGainDb",
    label: "WIND DRY",
    minDb: -36,
    maxDb: 12,
    stepDb: 0.5,
    defaultDb: -24,
  },
  {
    key: "humanLayerGainDb",
    label: "HUMAN DRY",
    minDb: -24,
    maxDb: 12,
    stepDb: 0.5,
    defaultDb: 1,
  },
  {
    key: "quakeLayerGainDb",
    label: "QUAKE DRY",
    minDb: -24,
    maxDb: 12,
    stepDb: 0.5,
    defaultDb: 0,
  },
  {
    key: "sharedReverbReturnDb",
    label: "REVERB RETURN",
    minDb: -24,
    maxDb: 18,
    stepDb: 0.5,
    defaultDb: 0,
  },
  {
    key: "textureReverbSendDb",
    label: "WIND/WATER SEND",
    minDb: -36,
    maxDb: 18,
    stepDb: 0.5,
    defaultDb: 0,
  },
  {
    key: "waterReverbSendDb",
    label: "WATER SEND",
    minDb: -36,
    maxDb: 18,
    stepDb: 0.5,
    defaultDb: -2,
  },
  {
    key: "windReverbSendDb",
    label: "WIND SEND",
    minDb: -36,
    maxDb: 18,
    stepDb: 0.5,
    defaultDb: -8,
  },
  {
    key: "humanReverbSendDb",
    label: "HUMAN SEND",
    minDb: -36,
    maxDb: 18,
    stepDb: 0.5,
    defaultDb: 5,
  },
  {
    key: "droneReverbSendDb",
    label: "DRONE SEND",
    minDb: -36,
    maxDb: 18,
    stepDb: 0.5,
    defaultDb: 4,
  },
  {
    key: "quakeReverbSendDb",
    label: "QUAKE SEND",
    minDb: -36,
    maxDb: 18,
    stepDb: 0.5,
    defaultDb: 0,
  },
  {
    key: "formantReturnDb",
    label: "FORMANT RETURN",
    minDb: -36,
    maxDb: 18,
    stepDb: 0.5,
    defaultDb: 0,
  },
  {
    key: "formantDroneSendDb",
    label: "FORMANT DRONE",
    minDb: -36,
    maxDb: 18,
    stepDb: 0.5,
    defaultDb: 0,
  },
  {
    key: "formantWindSendDb",
    label: "FORMANT WIND",
    minDb: -36,
    maxDb: 18,
    stepDb: 0.5,
    defaultDb: -13,
  },
] as const;

export type AudioTuningControl = (typeof AUDIO_TUNING_CONTROLS)[number];
export type AudioTuningControlKey = AudioTuningControl["key"];
export type AudioTuningOverrides = Record<AudioTuningControlKey, number>;

export const AUDIO_PERF_DIAGNOSTIC_BYPASSES = [
  { key: "sharedReverb", label: "SHARED REVERB" },
  { key: "formant", label: "FORMANT" },
  { key: "humanWorkletReverb", label: "HUMAN REVERB" },
  { key: "humanWorklet", label: "HUMAN WORKLET" },
  { key: "earthTextureWorklet", label: "EARTH TEXTURE" },
  { key: "rainGranular", label: "RAIN GRANULAR" },
  { key: "droneCompanion", label: "DRONE COMPANION" },
] as const;

export type AudioPerfDiagnosticBypass = (typeof AUDIO_PERF_DIAGNOSTIC_BYPASSES)[number];
export type AudioPerfDiagnosticBypassKey = AudioPerfDiagnosticBypass["key"];
export type AudioPerfDiagnosticBypasses = Record<AudioPerfDiagnosticBypassKey, boolean>;

export const AUDIO_PERF_DIAGNOSTIC_HUMAN_VOICE_CAPS = [56, 32, 16, 8] as const;
export type AudioPerfDiagnosticHumanVoiceCap =
  (typeof AUDIO_PERF_DIAGNOSTIC_HUMAN_VOICE_CAPS)[number];
export const AUDIO_PERF_DIAGNOSTIC_HUMAN_EVENT_CAPS = [0, 48, 24, 12, 6] as const;
export type AudioPerfDiagnosticHumanEventCap =
  (typeof AUDIO_PERF_DIAGNOSTIC_HUMAN_EVENT_CAPS)[number];
export const AUDIO_PERF_DIAGNOSTIC_HUMAN_PARTIAL_CAPS = [4, 2, 1] as const;
export type AudioPerfDiagnosticHumanPartialCap =
  (typeof AUDIO_PERF_DIAGNOSTIC_HUMAN_PARTIAL_CAPS)[number];

export interface AudioPerfDiagnostics {
  readonly bypasses: AudioPerfDiagnosticBypasses;
  readonly humanVoiceCap: AudioPerfDiagnosticHumanVoiceCap;
  readonly humanEventCapPerSecond: AudioPerfDiagnosticHumanEventCap;
  readonly humanPartialCap: AudioPerfDiagnosticHumanPartialCap;
}

export interface AudioTuningSnapshot {
  readonly version: typeof AUDIO_TUNING_VERSION;
  readonly createdAtUtc: string;
  readonly overrides: AudioTuningOverrides;
  readonly diagnostics: AudioPerfDiagnostics;
}

export const DEFAULT_AUDIO_TUNING_OVERRIDES: AudioTuningOverrides =
  createDefaultAudioTuningOverrides();
export const DEFAULT_AUDIO_PERF_DIAGNOSTIC_BYPASSES: AudioPerfDiagnosticBypasses =
  createDefaultAudioPerfDiagnosticBypasses();
export const DEFAULT_AUDIO_PERF_DIAGNOSTICS: AudioPerfDiagnostics =
  createDefaultAudioPerfDiagnostics();

export function createDefaultAudioTuningOverrides(): AudioTuningOverrides {
  return Object.fromEntries(
    AUDIO_TUNING_CONTROLS.map((control) => [control.key, control.defaultDb]),
  ) as AudioTuningOverrides;
}

export function clampAudioTuningOverrides(
  overrides: Partial<Record<AudioTuningControlKey, number>>,
): AudioTuningOverrides {
  const next = createDefaultAudioTuningOverrides();
  for (const control of AUDIO_TUNING_CONTROLS) {
    const value = overrides[control.key];
    next[control.key] =
      typeof value === "number" && Number.isFinite(value)
        ? clampNumber(value, control.minDb, control.maxDb)
        : control.defaultDb;
  }
  return next;
}

export function createDefaultAudioPerfDiagnosticBypasses(): AudioPerfDiagnosticBypasses {
  return Object.fromEntries(
    AUDIO_PERF_DIAGNOSTIC_BYPASSES.map((bypass) => [
      bypass.key,
      bypass.key === "humanWorkletReverb",
    ]),
  ) as AudioPerfDiagnosticBypasses;
}

export function createDefaultAudioPerfDiagnostics(): AudioPerfDiagnostics {
  return {
    bypasses: createDefaultAudioPerfDiagnosticBypasses(),
    humanVoiceCap: 56,
    humanEventCapPerSecond: 0,
    humanPartialCap: 4,
  };
}

export function clampAudioPerfDiagnosticBypasses(
  bypasses: Partial<Record<AudioPerfDiagnosticBypassKey, boolean>>,
): AudioPerfDiagnosticBypasses {
  const next = createDefaultAudioPerfDiagnosticBypasses();
  for (const bypass of AUDIO_PERF_DIAGNOSTIC_BYPASSES) {
    const value = bypasses[bypass.key];
    if (typeof value === "boolean") {
      next[bypass.key] = value;
    }
  }
  return next;
}

export function clampAudioPerfDiagnostics(
  diagnostics: {
    readonly bypasses?: Partial<Record<AudioPerfDiagnosticBypassKey, boolean>>;
    readonly humanVoiceCap?: number;
    readonly humanEventCapPerSecond?: number;
    readonly humanPartialCap?: number;
  },
): AudioPerfDiagnostics {
  return {
    bypasses: clampAudioPerfDiagnosticBypasses(diagnostics.bypasses ?? {}),
    humanVoiceCap: clampAudioPerfDiagnosticHumanVoiceCap(diagnostics.humanVoiceCap),
    humanEventCapPerSecond: clampAudioPerfDiagnosticHumanEventCap(
      diagnostics.humanEventCapPerSecond,
    ),
    humanPartialCap: clampAudioPerfDiagnosticHumanPartialCap(diagnostics.humanPartialCap),
  };
}

export function clampAudioPerfDiagnosticHumanVoiceCap(
  value: number | undefined,
): AudioPerfDiagnosticHumanVoiceCap {
  return AUDIO_PERF_DIAGNOSTIC_HUMAN_VOICE_CAPS.includes(
    value as AudioPerfDiagnosticHumanVoiceCap,
  )
    ? (value as AudioPerfDiagnosticHumanVoiceCap)
    : 56;
}

export function clampAudioPerfDiagnosticHumanEventCap(
  value: number | undefined,
): AudioPerfDiagnosticHumanEventCap {
  return AUDIO_PERF_DIAGNOSTIC_HUMAN_EVENT_CAPS.includes(
    value as AudioPerfDiagnosticHumanEventCap,
  )
    ? (value as AudioPerfDiagnosticHumanEventCap)
    : 0;
}

export function clampAudioPerfDiagnosticHumanPartialCap(
  value: number | undefined,
): AudioPerfDiagnosticHumanPartialCap {
  return AUDIO_PERF_DIAGNOSTIC_HUMAN_PARTIAL_CAPS.includes(
    value as AudioPerfDiagnosticHumanPartialCap,
  )
    ? (value as AudioPerfDiagnosticHumanPartialCap)
    : 4;
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function audioTuningGain(
  overrides: AudioTuningOverrides,
  key: AudioTuningControlKey,
): number {
  return dbToGain(overrides[key]);
}

export function createAudioTuningSnapshot(
  overrides: AudioTuningOverrides,
  createdAt: Date = new Date(),
  diagnostics: AudioPerfDiagnostics = DEFAULT_AUDIO_PERF_DIAGNOSTICS,
): AudioTuningSnapshot {
  return {
    version: AUDIO_TUNING_VERSION,
    createdAtUtc: createdAt.toISOString(),
    overrides: clampAudioTuningOverrides(overrides),
    diagnostics: clampAudioPerfDiagnostics(diagnostics),
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
