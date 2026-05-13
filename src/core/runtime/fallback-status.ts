export type RuntimeFallbackSeverity = "info" | "degraded" | "audio-muted" | "fatal";

export type RuntimeFallbackScope =
  | "audio"
  | "cloud"
  | "data"
  | "earth"
  | "human"
  | "quake"
  | "time"
  | "visual"
  | "weather";

export const RUNTIME_FALLBACK_STATUS_IDS = [
  "cloud-forecast-unavailable",
  "live-weather-fallback",
  "live-quake-fallback",
  "contact-grid-unavailable",
  "visual-surface-grid-unavailable",
  "worldgrid-production-fallback",
  "worldgrid-fixture-fallback",
  "canonical-clock-local-fallback",
  "human-worklet-unavailable",
  "earth-texture-worklet-unavailable",
  "shared-reverb-unavailable",
] as const;

export type RuntimeFallbackStatusId = (typeof RUNTIME_FALLBACK_STATUS_IDS)[number];

export interface RuntimeFallbackStatus {
  readonly id: RuntimeFallbackStatusId;
  readonly label: string;
  readonly severity: RuntimeFallbackSeverity;
  readonly affects: readonly RuntimeFallbackScope[];
  readonly message: string;
  readonly sinceUtc: string;
  readonly demo?: boolean;
}

interface RuntimeFallbackStatusDefinition {
  readonly label: string;
  readonly severity: RuntimeFallbackSeverity;
  readonly affects: readonly RuntimeFallbackScope[];
  readonly message: string;
}

const RUNTIME_FALLBACK_STATUS_DEFINITIONS: Record<
  RuntimeFallbackStatusId,
  RuntimeFallbackStatusDefinition
> = {
  "cloud-forecast-unavailable": {
    label: "Cloud field unavailable",
    severity: "degraded",
    affects: ["visual", "cloud", "weather"],
    message: "Cloud shell, GFS rain field, and cloud-derived tuning use fallback inputs.",
  },
  "live-weather-fallback": {
    label: "Live weather fallback",
    severity: "degraded",
    affects: ["earth", "weather"],
    message: "A substantial part of the live weather sweep is using canonical default weather samples.",
  },
  "live-quake-fallback": {
    label: "Live quake feed unavailable",
    severity: "degraded",
    affects: ["quake"],
    message: "New quake fetches are paused; retained 81-minute quake state continues.",
  },
  "contact-grid-unavailable": {
    label: "1deg contact grid unavailable",
    severity: "audio-muted",
    affects: ["audio", "human", "data"],
    message: "Human contact audio is paused because the 1deg contact grid is unavailable.",
  },
  "visual-surface-grid-unavailable": {
    label: "1deg surface grid unavailable",
    severity: "degraded",
    affects: ["visual", "data"],
    message: "The visual surface is using the canonical grid surface fallback.",
  },
  "worldgrid-production-fallback": {
    label: "Production worldgrid fallback",
    severity: "audio-muted",
    affects: ["audio", "visual", "data"],
    message: "Audio is paused because the production worldgrid was replaced by a seed fallback.",
  },
  "worldgrid-fixture-fallback": {
    label: "Fixture worldgrid fallback",
    severity: "fatal",
    affects: ["audio", "visual", "data"],
    message: "Canonical data is unavailable; runtime is using a fixture grid for diagnostics only.",
  },
  "canonical-clock-local-fallback": {
    label: "Server clock unavailable",
    severity: "degraded",
    affects: ["time"],
    message: "UTC is using this browser clock; separate devices may drift until sync recovers.",
  },
  "human-worklet-unavailable": {
    label: "Human AudioWorklet unavailable",
    severity: "audio-muted",
    affects: ["audio", "human"],
    message: "Canonical human layer audio is paused because AudioWorklet did not initialize.",
  },
  "earth-texture-worklet-unavailable": {
    label: "Earth texture AudioWorklet unavailable",
    severity: "audio-muted",
    affects: ["audio", "earth"],
    message: "Canonical earth texture audio is paused because AudioWorklet did not initialize.",
  },
  "shared-reverb-unavailable": {
    label: "Shared reverb unavailable",
    severity: "degraded",
    affects: ["audio", "earth", "human", "quake"],
    message: "Shared Tone.js reverb is unavailable; affected layers continue dry.",
  },
};

const DEMO_TOKEN_TO_IDS = new Map<string, readonly RuntimeFallbackStatusId[]>([
  ["cloud", ["cloud-forecast-unavailable"]],
  ["weather", ["live-weather-fallback"]],
  ["quake", ["live-quake-fallback"]],
  ["contact", ["contact-grid-unavailable"]],
  ["surface", ["visual-surface-grid-unavailable"]],
  ["data", ["worldgrid-production-fallback"]],
  ["fixture", ["worldgrid-fixture-fallback"]],
  ["clock", ["canonical-clock-local-fallback"]],
  ["time", ["canonical-clock-local-fallback"]],
  ["audio", ["human-worklet-unavailable", "earth-texture-worklet-unavailable"]],
  ["worklet", ["human-worklet-unavailable", "earth-texture-worklet-unavailable"]],
  ["reverb", ["shared-reverb-unavailable"]],
  ["all", RUNTIME_FALLBACK_STATUS_IDS],
]);

const STATUS_ORDER: Record<RuntimeFallbackSeverity, number> = {
  fatal: 0,
  "audio-muted": 1,
  degraded: 2,
  info: 3,
};

export function createRuntimeFallbackStatus(
  id: RuntimeFallbackStatusId,
  options: { readonly now?: Date; readonly demo?: boolean } = {},
): RuntimeFallbackStatus {
  const definition = RUNTIME_FALLBACK_STATUS_DEFINITIONS[id];
  return {
    id,
    label: definition.label,
    severity: definition.severity,
    affects: definition.affects,
    message: definition.message,
    sinceUtc: (options.now ?? new Date()).toISOString(),
    demo: options.demo,
  };
}

export function parseRuntimeFallbackDemoIds(value: string | null): readonly RuntimeFallbackStatusId[] {
  if (!value) {
    return [];
  }

  const ids = new Set<RuntimeFallbackStatusId>();
  for (const rawToken of value.split(",")) {
    const token = rawToken.trim().toLowerCase();
    if (!token) {
      continue;
    }
    const mapped = DEMO_TOKEN_TO_IDS.get(token);
    if (mapped) {
      for (const id of mapped) {
        ids.add(id);
      }
      continue;
    }
    if (isRuntimeFallbackStatusId(token)) {
      ids.add(token);
    }
  }
  return [...ids];
}

export function isAudioBlockingFallbackStatus(status: RuntimeFallbackStatus): boolean {
  return status.severity === "audio-muted" || status.severity === "fatal";
}

export function sortRuntimeFallbackStatuses(
  statuses: readonly RuntimeFallbackStatus[],
): readonly RuntimeFallbackStatus[] {
  return [...statuses].sort((left, right) => {
    const severityDelta = STATUS_ORDER[left.severity] - STATUS_ORDER[right.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return left.label.localeCompare(right.label);
  });
}

function isRuntimeFallbackStatusId(value: string): value is RuntimeFallbackStatusId {
  return RUNTIME_FALLBACK_STATUS_IDS.includes(value as RuntimeFallbackStatusId);
}
