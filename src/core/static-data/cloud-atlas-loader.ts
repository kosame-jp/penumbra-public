import { clamp } from "../scanline/geometry";
import { loadJson } from "./worldgrid-loader";

export interface CloudAtlasSource {
  readonly kind: "noaa-gfs" | "open-meteo" | "provisional-fixture";
  readonly model?: string;
  readonly cycleUtc?: string;
  readonly forecastHour?: number;
  readonly provenance: string;
}

export interface CloudAtlas {
  readonly version: string;
  readonly generatedAtUtc: string;
  readonly validAtUtc: string;
  readonly resolutionDeg: number;
  readonly width: number;
  readonly height: number;
  readonly latitudeStartDeg: number;
  readonly longitudeStartDeg: number;
  readonly valuesEncoding: "uint8-cloud-cover-pct";
  readonly opticalDensityValuesEncoding?: "uint8-cloud-water-density-proxy-pct";
  readonly precipitationValuesEncoding?: "uint8-precipitation-activity-pct";
  readonly source: CloudAtlasSource;
  readonly values: readonly number[];
  readonly opticalDensityValues?: readonly number[];
  readonly precipitationValues?: readonly number[];
}

export interface CloudAtlasFrameRef {
  readonly url: string;
  readonly validAtUtc: string;
  readonly cycleUtc?: string;
  readonly forecastHour?: number;
  readonly label?: string;
}

export interface CloudAtlasManifest {
  readonly version: string;
  readonly generatedAtUtc: string;
  readonly activeCycleUtc?: string;
  readonly transitionDurationMinutes?: number;
  readonly interpolation: "linear-time";
  readonly source: CloudAtlasSource;
  readonly frames: readonly CloudAtlasFrameRef[];
}

export interface LoadedCloudAtlasFrame extends CloudAtlasFrameRef {
  readonly atlas: CloudAtlas;
  readonly validAtMs: number;
}

export interface CloudAtlasSequence {
  readonly manifest: CloudAtlasManifest;
  readonly frames: readonly LoadedCloudAtlasFrame[];
}

export type CloudAtlasSequenceFreshnessStatus =
  | "empty"
  | "current"
  | "hold"
  | "future"
  | "stale";

export interface CloudAtlasSequenceFreshness {
  readonly status: CloudAtlasSequenceFreshnessStatus;
  readonly usable: boolean;
  readonly firstValidAtUtc?: string;
  readonly lastValidAtUtc?: string;
  readonly holdMs: number;
  readonly maxHoldMs: number;
  readonly message: string;
}

export interface CloudAtlasDistributionStats {
  readonly count: number;
  readonly p50Pct: number;
  readonly p75Pct: number;
  readonly p90Pct: number;
  readonly p95Pct: number;
  readonly p99Pct: number;
  readonly maxPct: number;
  readonly atLeast95Pct: number;
  readonly atLeast98Pct: number;
  readonly atLeast99Pct: number;
  readonly fullCoverPct: number;
}

export interface LoadCloudAtlasSequenceOptions {
  readonly cacheBust?: string;
}

export const DEFAULT_CLOUD_ATLAS_URL = "/data/cloud-atlas.current.json";
export const DEFAULT_CLOUD_ATLAS_FORECAST_MANIFEST_URL =
  configuredCloudAtlasForecastManifestUrl() ?? "/data/cloud-atlas.forecast/manifest.json";
export const FIXTURE_CLOUD_ATLAS_URL = "/data/fixtures/cloud-atlas.provisional.json";
export const DEFAULT_CLOUD_ATLAS_FORECAST_MAX_HOLD_MS = 9 * 60 * 60 * 1000;

const cloudAtlasDistributionStatsCache = new WeakMap<CloudAtlas, CloudAtlasDistributionStats>();
const cloudAtlasOpticalDensityDistributionStatsCache =
  new WeakMap<CloudAtlas, CloudAtlasDistributionStats>();
const cloudAtlasPrecipitationDistributionStatsCache =
  new WeakMap<CloudAtlas, CloudAtlasDistributionStats>();

export async function loadCloudAtlas(url = DEFAULT_CLOUD_ATLAS_URL): Promise<CloudAtlas | undefined> {
  try {
    return parseCloudAtlas(await loadJson<unknown>(url), url);
  } catch (error) {
    console.warn(`Failed to load cloud atlas ${url}; leaving cached cloud shell empty.`, error);
    return undefined;
  }
}

export function parseCloudAtlas(data: unknown, sourceUrl = "cloud atlas"): CloudAtlas {
  assertCloudAtlasShape(data, sourceUrl);
  return data;
}

export async function loadCloudAtlasSequence(
  manifestUrl = DEFAULT_CLOUD_ATLAS_FORECAST_MANIFEST_URL,
  options: LoadCloudAtlasSequenceOptions = {},
): Promise<CloudAtlasSequence | undefined> {
  try {
    const manifestRequestUrl = withCacheBust(manifestUrl, options.cacheBust);
    const manifest = parseCloudAtlasManifest(await loadJson<unknown>(manifestRequestUrl), manifestUrl);
    const frames = await Promise.all(
      manifest.frames.map(async (frame) => {
        const atlasUrl = resolveRelativeUrl(frame.url, manifestUrl);
        const atlasRequestUrl = withCacheBust(atlasUrl, options.cacheBust);
        const atlas = parseCloudAtlas(await loadJson<unknown>(atlasRequestUrl), atlasUrl);
        return {
          ...frame,
          atlas,
          validAtMs: requireUtcMs(frame.validAtUtc, `${manifestUrl}.frames[].validAtUtc`),
        };
      }),
    );
    return {
      manifest,
      frames: frames.sort((left, right) => left.validAtMs - right.validAtMs),
    };
  } catch (error) {
    console.warn(`Failed to load cloud atlas sequence ${manifestUrl}; leaving cached cloud shell empty.`, error);
    return undefined;
  }
}

export function parseCloudAtlasManifest(
  data: unknown,
  sourceUrl = "cloud atlas manifest",
): CloudAtlasManifest {
  assertCloudAtlasManifestShape(data, sourceUrl);
  return data;
}

export function cloudAtlasSequenceFreshness(
  sequence: CloudAtlasSequence | undefined,
  utcMs: number,
  options: { readonly maxHoldMs?: number } = {},
): CloudAtlasSequenceFreshness {
  const maxHoldMs = Math.max(
    0,
    options.maxHoldMs ?? DEFAULT_CLOUD_ATLAS_FORECAST_MAX_HOLD_MS,
  );
  const frames = sequence?.frames ?? [];
  const firstFrame = frames[0];
  const lastFrame = frames.at(-1);
  if (!firstFrame || !lastFrame || !Number.isFinite(utcMs)) {
    return {
      status: "empty",
      usable: false,
      holdMs: 0,
      maxHoldMs,
      message: "cloud atlas forecast has no usable frames",
    };
  }

  if (utcMs < firstFrame.validAtMs) {
    return {
      status: "future",
      usable: false,
      firstValidAtUtc: firstFrame.validAtUtc,
      lastValidAtUtc: lastFrame.validAtUtc,
      holdMs: utcMs - firstFrame.validAtMs,
      maxHoldMs,
      message: `cloud atlas forecast starts in ${formatDurationMs(firstFrame.validAtMs - utcMs)}`,
    };
  }

  if (utcMs <= lastFrame.validAtMs) {
    return {
      status: "current",
      usable: true,
      firstValidAtUtc: firstFrame.validAtUtc,
      lastValidAtUtc: lastFrame.validAtUtc,
      holdMs: 0,
      maxHoldMs,
      message: "cloud atlas forecast covers current UTC",
    };
  }

  const holdMs = utcMs - lastFrame.validAtMs;
  if (holdMs <= maxHoldMs) {
    return {
      status: "hold",
      usable: true,
      firstValidAtUtc: firstFrame.validAtUtc,
      lastValidAtUtc: lastFrame.validAtUtc,
      holdMs,
      maxHoldMs,
      message: `cloud atlas forecast is holding last frame for ${formatDurationMs(holdMs)}`,
    };
  }

  return {
    status: "stale",
    usable: false,
    firstValidAtUtc: firstFrame.validAtUtc,
    lastValidAtUtc: lastFrame.validAtUtc,
    holdMs,
    maxHoldMs,
    message: `cloud atlas forecast is stale by ${formatDurationMs(holdMs - maxHoldMs)}`,
  };
}

function withCacheBust(url: string, cacheBust: string | undefined): string {
  if (!cacheBust) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(cacheBust)}`;
}

function formatDurationMs(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h${String(minutes).padStart(2, "0")}m`;
}

export function cloudCover01At(atlas: CloudAtlas, latitudeDeg: number, longitudeDeg: number): number {
  return sampledValues01At(atlas, atlas.values, latitudeDeg, longitudeDeg);
}

export function precipitation01At(atlas: CloudAtlas, latitudeDeg: number, longitudeDeg: number): number {
  if (!atlas.precipitationValues) {
    return 0;
  }

  return sampledValues01At(atlas, atlas.precipitationValues, latitudeDeg, longitudeDeg);
}

export function opticalDensity01At(atlas: CloudAtlas, latitudeDeg: number, longitudeDeg: number): number {
  if (!atlas.opticalDensityValues) {
    return 0;
  }

  return sampledValues01At(atlas, atlas.opticalDensityValues, latitudeDeg, longitudeDeg);
}

function sampledValues01At(
  atlas: CloudAtlas,
  values: readonly number[],
  latitudeDeg: number,
  longitudeDeg: number,
): number {
  const yFloat = (clamp(latitudeDeg, -90, 90) - atlas.latitudeStartDeg) / atlas.resolutionDeg;
  const longitudeOffsetDeg = wrapDegrees360(longitudeDeg - atlas.longitudeStartDeg);
  const xFloat = longitudeOffsetDeg / atlas.resolutionDeg;
  const x0 = wrapIndex(Math.floor(xFloat), atlas.width);
  const x1 = wrapIndex(x0 + 1, atlas.width);
  const y0 = clampIndex(Math.floor(yFloat), atlas.height);
  const y1 = clampIndex(y0 + 1, atlas.height);
  const tx = xFloat - Math.floor(xFloat);
  const ty = yFloat - Math.floor(yFloat);
  const top = lerp(value01(atlas, values, x0, y0), value01(atlas, values, x1, y0), tx);
  const bottom = lerp(value01(atlas, values, x0, y1), value01(atlas, values, x1, y1), tx);
  return lerp(top, bottom, ty);
}

export function cloudAtlasDistributionStats(atlas: CloudAtlas): CloudAtlasDistributionStats {
  const cached = cloudAtlasDistributionStatsCache.get(atlas);
  if (cached) {
    return cached;
  }

  const stats = distributionStatsForValues(atlas.values);
  cloudAtlasDistributionStatsCache.set(atlas, stats);
  return stats;
}

export function cloudAtlasOpticalDensityDistributionStats(
  atlas: CloudAtlas,
): CloudAtlasDistributionStats | undefined {
  if (!atlas.opticalDensityValues) {
    return undefined;
  }

  const cached = cloudAtlasOpticalDensityDistributionStatsCache.get(atlas);
  if (cached) {
    return cached;
  }

  const stats = distributionStatsForValues(atlas.opticalDensityValues);
  cloudAtlasOpticalDensityDistributionStatsCache.set(atlas, stats);
  return stats;
}

export function cloudAtlasPrecipitationDistributionStats(
  atlas: CloudAtlas,
): CloudAtlasDistributionStats | undefined {
  if (!atlas.precipitationValues) {
    return undefined;
  }

  const cached = cloudAtlasPrecipitationDistributionStatsCache.get(atlas);
  if (cached) {
    return cached;
  }

  const stats = distributionStatsForValues(atlas.precipitationValues);
  cloudAtlasPrecipitationDistributionStatsCache.set(atlas, stats);
  return stats;
}

function distributionStatsForValues(values: readonly number[]): CloudAtlasDistributionStats {
  const histogram = new Array<number>(101).fill(0);
  let maxPct = 0;
  for (const rawValue of values) {
    const value = clampIndex(Math.round(rawValue), 101);
    histogram[value] = (histogram[value] ?? 0) + 1;
    maxPct = Math.max(maxPct, value);
  }

  const count = values.length;
  return (
    count === 0
      ? {
          count,
          p50Pct: 0,
          p75Pct: 0,
          p90Pct: 0,
          p95Pct: 0,
          p99Pct: 0,
          maxPct: 0,
          atLeast95Pct: 0,
          atLeast98Pct: 0,
          atLeast99Pct: 0,
          fullCoverPct: 0,
        }
      : {
          count,
          p50Pct: percentileFromHistogram(histogram, count, 0.5),
          p75Pct: percentileFromHistogram(histogram, count, 0.75),
          p90Pct: percentileFromHistogram(histogram, count, 0.9),
          p95Pct: percentileFromHistogram(histogram, count, 0.95),
          p99Pct: percentileFromHistogram(histogram, count, 0.99),
          maxPct,
          atLeast95Pct: ratioAtOrAbove(histogram, count, 95),
          atLeast98Pct: ratioAtOrAbove(histogram, count, 98),
          atLeast99Pct: ratioAtOrAbove(histogram, count, 99),
          fullCoverPct: ratioAtOrAbove(histogram, count, 100),
        }
  );
}

function resolveRelativeUrl(url: string, baseUrl: string): string {
  if (url.startsWith("/") || /^https?:\/\//.test(url)) {
    return url;
  }

  const slashIndex = baseUrl.lastIndexOf("/");
  if (slashIndex < 0) {
    return url;
  }
  return `${baseUrl.slice(0, slashIndex + 1)}${url}`;
}

function value01(atlas: CloudAtlas, values: readonly number[], x: number, y: number): number {
  return clamp((values[y * atlas.width + x] ?? 0) / 100, 0, 1);
}

function lerp(left: number, right: number, mix01: number): number {
  return left + (right - left) * clamp(mix01, 0, 1);
}

function percentileFromHistogram(
  histogram: readonly number[],
  count: number,
  percentile01: number,
): number {
  const targetRank = Math.max(1, Math.ceil(count * clamp(percentile01, 0, 1)));
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value] ?? 0;
    if (cumulative >= targetRank) {
      return value;
    }
  }
  return histogram.length - 1;
}

function ratioAtOrAbove(histogram: readonly number[], count: number, thresholdPct: number): number {
  if (count <= 0) {
    return 0;
  }

  let matching = 0;
  for (let value = clampIndex(thresholdPct, histogram.length); value < histogram.length; value += 1) {
    matching += histogram[value] ?? 0;
  }
  return matching / count;
}

function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

function wrapDegrees360(value: number): number {
  return ((value % 360) + 360) % 360;
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(length - 1, index));
}

function assertCloudAtlasShape(data: unknown, sourceUrl: string): asserts data is CloudAtlas {
  const atlas = requireRecord(data, sourceUrl);
  requireString(atlas, "version", sourceUrl);
  requireString(atlas, "generatedAtUtc", sourceUrl);
  requireString(atlas, "validAtUtc", sourceUrl);
  requireNumber(atlas, "resolutionDeg", sourceUrl);
  requireInteger(atlas, "width", sourceUrl);
  requireInteger(atlas, "height", sourceUrl);
  requireNumber(atlas, "latitudeStartDeg", sourceUrl);
  requireNumber(atlas, "longitudeStartDeg", sourceUrl);
  if (atlas.valuesEncoding !== "uint8-cloud-cover-pct") {
    throw new Error(`${sourceUrl}.valuesEncoding must be uint8-cloud-cover-pct.`);
  }
  if (
    atlas.opticalDensityValuesEncoding !== undefined &&
    atlas.opticalDensityValuesEncoding !== "uint8-cloud-water-density-proxy-pct"
  ) {
    throw new Error(`${sourceUrl}.opticalDensityValuesEncoding must be uint8-cloud-water-density-proxy-pct.`);
  }
  if (
    atlas.precipitationValuesEncoding !== undefined &&
    atlas.precipitationValuesEncoding !== "uint8-precipitation-activity-pct"
  ) {
    throw new Error(`${sourceUrl}.precipitationValuesEncoding must be uint8-precipitation-activity-pct.`);
  }
  const source = requireRecord(atlas.source, `${sourceUrl}.source`);
  if (source.kind !== "noaa-gfs" && source.kind !== "open-meteo" && source.kind !== "provisional-fixture") {
    throw new Error(`${sourceUrl}.source.kind must be noaa-gfs, open-meteo, or provisional-fixture.`);
  }
  requireString(source, "provenance", `${sourceUrl}.source`);
  if (!Array.isArray(atlas.values)) {
    throw new Error(`${sourceUrl}.values must be an array.`);
  }
  const expectedCount = Number(atlas.width) * Number(atlas.height);
  if (atlas.values.length !== expectedCount) {
    throw new Error(`${sourceUrl}.values must contain ${expectedCount} values.`);
  }
  atlas.values.forEach((value, index) => {
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new Error(`${sourceUrl}.values[${index}] must be an integer in [0, 100].`);
    }
  });
  if (atlas.opticalDensityValues !== undefined) {
    if (!Array.isArray(atlas.opticalDensityValues)) {
      throw new Error(`${sourceUrl}.opticalDensityValues must be an array.`);
    }
    if (atlas.opticalDensityValues.length !== expectedCount) {
      throw new Error(`${sourceUrl}.opticalDensityValues must contain ${expectedCount} values.`);
    }
    if (atlas.opticalDensityValuesEncoding !== "uint8-cloud-water-density-proxy-pct") {
      throw new Error(`${sourceUrl}.opticalDensityValuesEncoding is required when opticalDensityValues is present.`);
    }
    atlas.opticalDensityValues.forEach((value, index) => {
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        throw new Error(`${sourceUrl}.opticalDensityValues[${index}] must be an integer in [0, 100].`);
      }
    });
  }
  if (atlas.precipitationValues !== undefined) {
    if (!Array.isArray(atlas.precipitationValues)) {
      throw new Error(`${sourceUrl}.precipitationValues must be an array.`);
    }
    if (atlas.precipitationValues.length !== expectedCount) {
      throw new Error(`${sourceUrl}.precipitationValues must contain ${expectedCount} values.`);
    }
    if (atlas.precipitationValuesEncoding !== "uint8-precipitation-activity-pct") {
      throw new Error(`${sourceUrl}.precipitationValuesEncoding is required when precipitationValues is present.`);
    }
    atlas.precipitationValues.forEach((value, index) => {
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        throw new Error(`${sourceUrl}.precipitationValues[${index}] must be an integer in [0, 100].`);
      }
    });
  }
}

function assertCloudAtlasManifestShape(
  data: unknown,
  sourceUrl: string,
): asserts data is CloudAtlasManifest {
  const manifest = requireRecord(data, sourceUrl);
  requireString(manifest, "version", sourceUrl);
  requireString(manifest, "generatedAtUtc", sourceUrl);
  requireUtcMs(String(manifest.generatedAtUtc), `${sourceUrl}.generatedAtUtc`);
  if (manifest.interpolation !== "linear-time") {
    throw new Error(`${sourceUrl}.interpolation must be linear-time.`);
  }
  const source = requireRecord(manifest.source, `${sourceUrl}.source`);
  if (source.kind !== "noaa-gfs" && source.kind !== "open-meteo" && source.kind !== "provisional-fixture") {
    throw new Error(`${sourceUrl}.source.kind must be noaa-gfs, open-meteo, or provisional-fixture.`);
  }
  requireString(source, "provenance", `${sourceUrl}.source`);
  if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) {
    throw new Error(`${sourceUrl}.frames must be a non-empty array.`);
  }
  manifest.frames.forEach((frame, index) => {
    const label = `${sourceUrl}.frames[${index}]`;
    const frameRecord = requireRecord(frame, label);
    requireString(frameRecord, "url", label);
    requireString(frameRecord, "validAtUtc", label);
    requireUtcMs(String(frameRecord.validAtUtc), `${label}.validAtUtc`);
  });
}

function requireUtcMs(value: string, label: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`${label} must be a valid UTC date-time.`);
  }
  return ms;
}

function requireRecord(data: unknown, label: string): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${label} must be an object.`);
  }
  return data as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, field: string, label: string): void {
  if (typeof record[field] !== "string") {
    throw new Error(`${label}.${field} must be a string.`);
  }
}

function requireNumber(record: Record<string, unknown>, field: string, label: string): void {
  if (typeof record[field] !== "number" || !Number.isFinite(record[field])) {
    throw new Error(`${label}.${field} must be a finite number.`);
  }
}

function requireInteger(record: Record<string, unknown>, field: string, label: string): void {
  if (!Number.isInteger(record[field])) {
    throw new Error(`${label}.${field} must be an integer.`);
  }
}

function configuredCloudAtlasForecastManifestUrl(): string | undefined {
  const env = (import.meta as ImportMeta & {
    readonly env?: Record<string, string | undefined>;
  }).env;
  const configured = env?.VITE_PENUMBRA_CLOUD_FORECAST_MANIFEST_URL?.trim();
  return configured === "" ? undefined : configured;
}
