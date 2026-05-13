import { loadJson } from "./worldgrid-loader";

export const DEFAULT_CAPTURE_SCENE_ID = "blue-earth-01";

export interface CaptureScene {
  readonly version: "penumbra-capture-scene-v1";
  readonly id: string;
  readonly label?: string;
  readonly utc: string;
  readonly captureSize?: { readonly width: number; readonly height: number };
  readonly cloud?: {
    readonly type: "forecast-sequence";
    readonly manifestUrl: string;
  };
  readonly visual?: {
    readonly staticOnly?: boolean;
  };
}

export async function loadCaptureScene(id = DEFAULT_CAPTURE_SCENE_ID): Promise<CaptureScene | undefined> {
  const safeId = /^[a-z0-9][a-z0-9-]{0,63}$/i.test(id) ? id : DEFAULT_CAPTURE_SCENE_ID;
  const url = `/data/capture-scenes/${safeId}/scene.json`;
  try {
    return parseCaptureScene(await loadJson<unknown>(url), url);
  } catch (error) {
    console.warn(`Failed to load capture scene ${url}; using query/default capture settings.`, error);
    return undefined;
  }
}

export function parseCaptureScene(data: unknown, sourceUrl = "capture scene"): CaptureScene {
  if (!isRecord(data)) {
    throw new Error(`${sourceUrl} must be an object.`);
  }
  if (data.version !== "penumbra-capture-scene-v1") {
    throw new Error(`${sourceUrl}.version must be penumbra-capture-scene-v1.`);
  }
  if (typeof data.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(data.id)) {
    throw new Error(`${sourceUrl}.id must be a stable capture scene id.`);
  }
  if (typeof data.utc !== "string" || !Number.isFinite(Date.parse(data.utc))) {
    throw new Error(`${sourceUrl}.utc must be an ISO UTC timestamp.`);
  }

  const captureSize = parseCaptureSize(data.captureSize, `${sourceUrl}.captureSize`);
  const cloud = parseCaptureCloud(data.cloud, `${sourceUrl}.cloud`);
  const visual = isRecord(data.visual) ? { staticOnly: data.visual.staticOnly === true } : undefined;

  return {
    version: data.version,
    id: data.id,
    label: typeof data.label === "string" ? data.label : undefined,
    utc: data.utc,
    captureSize,
    cloud,
    visual,
  };
}

function parseCaptureSize(
  value: unknown,
  sourceUrl: string,
): { readonly width: number; readonly height: number } | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || typeof value.width !== "number" || typeof value.height !== "number") {
    throw new Error(`${sourceUrl} must contain numeric width and height.`);
  }
  const width = Math.floor(value.width);
  const height = Math.floor(value.height);
  if (width < 512 || width > 8192 || height < 512 || height > 8192) {
    throw new Error(`${sourceUrl} must be between 512 and 8192 pixels per side.`);
  }
  return { width, height };
}

function parseCaptureCloud(
  value: unknown,
  sourceUrl: string,
): CaptureScene["cloud"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || value.type !== "forecast-sequence" || typeof value.manifestUrl !== "string") {
    throw new Error(`${sourceUrl} must define a forecast-sequence manifestUrl.`);
  }
  if (!value.manifestUrl.startsWith("/data/")) {
    throw new Error(`${sourceUrl}.manifestUrl must point at a bundled /data artifact.`);
  }
  return {
    type: value.type,
    manifestUrl: value.manifestUrl,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
