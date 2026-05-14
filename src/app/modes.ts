import type { QueryFlags } from "./query-flags";
import type { AudioDebugMode } from "../core/audio/debug-mode";
import type { RuntimeFallbackStatusId } from "../core/runtime/fallback-status";
import {
  DEFAULT_STREAM_CHECK_INTERVAL_MS,
  DEFAULT_STREAM_SCHEDULED_RELOAD_MS,
  DEFAULT_STREAM_STALL_RELOAD_MS,
  type StreamOperationalOptions,
} from "./stream-ops";

export type PerformanceProfile = "standard" | "low" | "stream" | "capture";

export interface DevicePerformanceHints {
  readonly deviceMemoryGb?: number;
  readonly hardwareConcurrency?: number;
  readonly prefersReducedMotion?: boolean;
}

export interface RendererPerformanceOptions {
  readonly pixelRatioCap: number;
  readonly pixelRatioOverride?: number;
  readonly outputSize?: { readonly width: number; readonly height: number };
  readonly preserveDrawingBuffer: boolean;
  readonly terrainMarkerSegments: number;
}

export interface AppMode {
  readonly debug: boolean;
  readonly debugHud: boolean;
  readonly stream: boolean;
  readonly capture: boolean;
  readonly captureSceneId?: string;
  readonly captureScale: number;
  readonly captureSize?: { readonly width: number; readonly height: number };
  readonly captureUtcMs?: number;
  readonly captureWind: boolean;
  readonly captureWindTrail: boolean;
  readonly audioDebug: AudioDebugMode;
  readonly audioTuning: boolean;
  readonly surfaceGrid: "auto" | "canonical" | "1deg";
  readonly contactGrid: "auto" | "canonical" | "1deg";
  readonly cloudAtlas: "scanline" | "atlas" | "forecast" | "fixture";
  readonly liveWeatherFallback: boolean;
  readonly cloudDiagnostic: boolean;
  readonly earthRootWidget: boolean;
  readonly performanceProfile: PerformanceProfile;
  readonly targetFps: 60 | 30;
  readonly hideCursor: boolean;
  readonly fullscreenPreference: boolean;
  readonly renderer: RendererPerformanceOptions;
  readonly recovery: StreamOperationalOptions;
  readonly fallbackDemo: readonly RuntimeFallbackStatusId[];
}

export function resolveAppMode(flags: QueryFlags, hints: DevicePerformanceHints = {}): AppMode {
  const capture = Boolean(flags.capture) && !flags.stream;
  const captureScale = flags.captureScale ?? 3;
  const captureSize = capture ? flags.captureSize : undefined;
  const captureWindTrail = capture && Boolean(flags.captureWindTrail);
  const captureWind = capture && (Boolean(flags.captureWind) || captureWindTrail);
  const performanceProfile = resolvePerformanceProfile(flags, hints);
  const lowOrStream = performanceProfile === "low" || performanceProfile === "stream";
  const audioTuning = Boolean(flags.audioTune) && !flags.stream && !capture;

  return {
    debug: flags.debug,
    debugHud: flags.debug && !audioTuning,
    stream: flags.stream,
    capture,
    captureSceneId: capture ? flags.captureScene : undefined,
    captureScale,
    captureSize,
    captureUtcMs: capture ? flags.captureUtcMs : undefined,
    captureWind,
    captureWindTrail,
    audioDebug: flags.debug ? (flags.audioDebug ?? "off") : "off",
    audioTuning,
    surfaceGrid: flags.surfaceGrid ?? "auto",
    contactGrid: flags.contactGrid ?? "auto",
    cloudAtlas: flags.cloudAtlas ?? "forecast",
    liveWeatherFallback: Boolean(flags.liveWeatherFallback),
    cloudDiagnostic: flags.debug && Boolean(flags.cloudDiagnostic),
    earthRootWidget: Boolean(flags.earthRootWidget) || (flags.debug && !audioTuning),
    performanceProfile,
    targetFps: lowOrStream ? 30 : 60,
    hideCursor: flags.stream,
    fullscreenPreference: flags.stream,
    renderer: rendererOptionsForProfile(performanceProfile, captureScale, captureSize),
    recovery: {
      enabled: flags.stream,
      fullscreenPreference: flags.stream,
      reloadOnRuntimeError: flags.stream,
      stallReloadMs: DEFAULT_STREAM_STALL_RELOAD_MS,
      scheduledReloadMs: DEFAULT_STREAM_SCHEDULED_RELOAD_MS,
      checkIntervalMs: DEFAULT_STREAM_CHECK_INTERVAL_MS,
    },
    fallbackDemo: flags.fallbackDemo ?? [],
  };
}

export function readBrowserPerformanceHints(): DevicePerformanceHints {
  const navigatorWithMemory = window.navigator as Navigator & { readonly deviceMemory?: number };

  return {
    deviceMemoryGb: navigatorWithMemory.deviceMemory,
    hardwareConcurrency: window.navigator.hardwareConcurrency,
    prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

export function resolvePerformanceProfile(
  flags: QueryFlags,
  hints: DevicePerformanceHints = {},
): PerformanceProfile {
  if (flags.stream) {
    return "stream";
  }

  if (flags.capture) {
    return "capture";
  }

  if (flags.performance === "standard" || flags.performance === "low") {
    return flags.performance;
  }

  return shouldUseLowPerformanceProfile(hints) ? "low" : "standard";
}

export function shouldUseLowPerformanceProfile(hints: DevicePerformanceHints): boolean {
  return (
    hints.prefersReducedMotion === true ||
    (hints.deviceMemoryGb !== undefined && hints.deviceMemoryGb <= 4) ||
    (hints.hardwareConcurrency !== undefined && hints.hardwareConcurrency <= 4)
  );
}

function rendererOptionsForProfile(
  profile: PerformanceProfile,
  captureScale = 3,
  captureSize?: { readonly width: number; readonly height: number },
): RendererPerformanceOptions {
  if (profile === "stream") {
    return {
      pixelRatioCap: 1.5,
      preserveDrawingBuffer: false,
      terrainMarkerSegments: 18,
    };
  }

  if (profile === "low") {
    return {
      pixelRatioCap: 1.35,
      preserveDrawingBuffer: false,
      terrainMarkerSegments: 16,
    };
  }

  if (profile === "capture") {
    return {
      pixelRatioCap: captureScale,
      pixelRatioOverride: captureSize ? 1 : captureScale,
      outputSize: captureSize,
      preserveDrawingBuffer: true,
      terrainMarkerSegments: 32,
    };
  }

  return {
    pixelRatioCap: 2,
    preserveDrawingBuffer: false,
    terrainMarkerSegments: 28,
  };
}
