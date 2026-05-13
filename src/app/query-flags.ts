import { parseAudioDebugMode, type AudioDebugMode } from "../core/audio/debug-mode";
import {
  parseRuntimeFallbackDemoIds,
  type RuntimeFallbackStatusId,
} from "../core/runtime/fallback-status";

export interface QueryFlags {
  readonly debug: boolean;
  readonly stream: boolean;
  readonly capture?: boolean;
  readonly captureScene?: string;
  readonly captureScale?: number;
  readonly captureSize?: { readonly width: number; readonly height: number };
  readonly captureUtcMs?: number;
  readonly captureWind?: boolean;
  readonly captureWindTrail?: boolean;
  readonly performance: "auto" | "standard" | "low";
  readonly surfaceGrid?: "auto" | "canonical" | "1deg";
  readonly contactGrid?: "auto" | "canonical" | "1deg";
  readonly cloudAtlas?: "scanline" | "atlas" | "forecast" | "fixture";
  readonly cloudDiagnostic?: boolean;
  readonly audioDebug?: AudioDebugMode;
  readonly audioTune?: boolean;
  readonly earthRootWidget?: boolean;
  readonly fallbackDemo?: readonly RuntimeFallbackStatusId[];
}

export function parseQueryFlags(search: string): QueryFlags {
  const params = new URLSearchParams(search);
  const performanceParam = params.get("perf");
  const surfaceParam = params.get("surface");
  const contactParam = params.get("contact");
  const cloudParam = params.get("cloud");
  const tuneParam = params.get("tune");
  const rootParam = params.get("root");
  const captureParam = params.get("capture");
  return {
    debug: params.has("debug"),
    stream: params.has("stream"),
    capture: params.has("capture") && captureParam !== "0" && captureParam !== "false",
    captureScene: parseCaptureScene(params.get("scene")),
    captureScale: parseCaptureScale(params.get("capture-scale")),
    captureSize: parseCaptureSize(params.get("capture-size")),
    captureUtcMs: parseCaptureUtcMs(params.get("capture-utc")),
    captureWind: parseBooleanQueryFlag(params, "capture-wind"),
    captureWindTrail: parseBooleanQueryFlag(params, "capture-wind-trail"),
    performance:
      performanceParam === "standard" || performanceParam === "low" ? performanceParam : "auto",
    surfaceGrid:
      surfaceParam === "canonical"
        ? "canonical"
        : surfaceParam === "1deg" || surfaceParam === "1"
          ? "1deg"
          : "auto",
    contactGrid:
      contactParam === "canonical"
        ? "canonical"
        : contactParam === "1deg" || contactParam === "1"
          ? "1deg"
          : "auto",
    cloudAtlas:
      cloudParam === "scanline"
        ? "scanline"
        : cloudParam === "atlas"
          ? "atlas"
          : cloudParam === "forecast"
            ? "forecast"
            : cloudParam === "fixture"
              ? "fixture"
              : undefined,
    cloudDiagnostic: params.has("cloud-diagnostic"),
    audioDebug: parseAudioDebugMode(params.get("audio")),
    audioTune: tuneParam === "audio",
    earthRootWidget:
      params.has("root") && (rootParam === null || rootParam === "" || rootParam === "1"),
    fallbackDemo: parseRuntimeFallbackDemoIds(params.get("fallback-demo")),
  };
}

function parseBooleanQueryFlag(params: URLSearchParams, name: string): boolean {
  if (!params.has(name)) {
    return false;
  }

  const value = params.get(name);
  return value !== "0" && value !== "false";
}

function parseCaptureScale(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const scale = Number(value);
  if (!Number.isFinite(scale)) {
    return undefined;
  }

  return Math.min(4, Math.max(1, scale));
}

function parseCaptureScene(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  return /^[a-z0-9][a-z0-9-]{0,63}$/i.test(value) ? value : undefined;
}

function parseCaptureSize(
  value: string | null,
): { readonly width: number; readonly height: number } | undefined {
  if (!value) {
    return undefined;
  }

  const match = /^(\d{3,5})x(\d{3,5})$/i.exec(value.trim());
  if (!match) {
    return undefined;
  }

  const width = Math.min(8192, Math.max(512, Number(match[1])));
  const height = Math.min(8192, Math.max(512, Number(match[2])));
  return { width, height };
}

function parseCaptureUtcMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}
