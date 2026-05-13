import type { CanonicalScanlineSample } from "../fusion/scanline-sample";
import type { EarthquakeEvent } from "../live-data/quake-store";
import type { WeatherCacheEntryArtifact } from "../live-data/weather-cache";
import type { CloudAtlas, CloudAtlasManifest } from "./cloud-atlas-loader";
import type { TuningKernelSet } from "./kernels-loader";
import { assertValidArtifact, type ArtifactKind } from "./schema-validation";
import type { WorldGrid } from "./worldgrid-loader";

export function parseCloudAtlasArtifact(data: unknown): CloudAtlas {
  return parseArtifact<CloudAtlas>("cloud-atlas", data);
}

export function parseCloudAtlasManifestArtifact(data: unknown): CloudAtlasManifest {
  return parseArtifact<CloudAtlasManifest>("cloud-atlas-manifest", data);
}

export function parseWorldGridArtifact(data: unknown): WorldGrid {
  return parseArtifact<WorldGrid>("worldgrid", data);
}

export function parseWeatherCacheEntryArtifact(data: unknown): WeatherCacheEntryArtifact {
  return parseArtifact<WeatherCacheEntryArtifact>("weather-cache-entry", data);
}

export function parseEarthquakeEventArtifact(data: unknown): EarthquakeEvent {
  return parseArtifact<EarthquakeEvent>("earthquake-event", data);
}

export function parseScanlineSampleArtifact(data: unknown): CanonicalScanlineSample {
  return parseArtifact<CanonicalScanlineSample>("scanline-sample", data);
}

export function parseTuningKernelArtifact(data: unknown): TuningKernelSet {
  return parseArtifact<TuningKernelSet>("tuning-kernels", data);
}

export async function loadGeneratedArtifactFromUrl<T>(
  url: string,
  kind: ArtifactKind,
  fetchJson: (url: string) => Promise<unknown>,
): Promise<T> {
  const data = await fetchJson(url);
  return parseArtifact<T>(kind, data);
}

function parseArtifact<T>(kind: ArtifactKind, data: unknown): T {
  assertValidArtifact(kind, data);
  return data as T;
}
