import type { EarthquakeEvent } from "./quake-store";

export const USGS_ALL_HOUR_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson";

export const USGS_ALL_DAY_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

export const USGS_DEFAULT_FEED_URL = USGS_ALL_DAY_URL;

export interface UsgsFeatureCollection {
  readonly features: readonly UsgsFeature[];
}

export interface UsgsFeature {
  readonly id: string;
  readonly properties: {
    readonly mag: number | null;
    readonly place: string | null;
    readonly time: number;
    readonly updated: number | null;
  };
  readonly geometry: {
    readonly coordinates: readonly [number, number, number];
  };
}

export function adaptUsgsFeatureCollection(collection: UsgsFeatureCollection): EarthquakeEvent[] {
  return collection.features.map(adaptUsgsFeature);
}

export function adaptUsgsFeature(feature: UsgsFeature): EarthquakeEvent {
  const [longitudeDeg, latitudeDeg, depthKm] = feature.geometry.coordinates;
  assertFiniteNumber(latitudeDeg, `USGS feature ${feature.id} latitude`);
  assertFiniteNumber(longitudeDeg, `USGS feature ${feature.id} longitude`);
  assertFiniteNumber(depthKm, `USGS feature ${feature.id} depth`);
  assertFiniteNumber(feature.properties.time, `USGS feature ${feature.id} event time`);

  const eventTimeUtc = new Date(feature.properties.time).toISOString();

  return {
    id: feature.id,
    provider: "USGS",
    eventTimeUtc,
    updatedTimeUtc:
      feature.properties.updated == null
        ? eventTimeUtc
        : new Date(feature.properties.updated).toISOString(),
    latitudeDeg,
    longitudeDeg,
    depthKm,
    magnitude: feature.properties.mag ?? 0,
    place: feature.properties.place ?? undefined,
    sourceFeed: "USGS GeoJSON",
  };
}

export async function fetchUsgsEarthquakes(
  fetchJson: (url: string) => Promise<unknown>,
  url = USGS_DEFAULT_FEED_URL,
): Promise<EarthquakeEvent[]> {
  const data = await fetchJson(url);
  assertUsgsFeatureCollection(data);
  return adaptUsgsFeatureCollection(data);
}

function assertUsgsFeatureCollection(data: unknown): asserts data is UsgsFeatureCollection {
  if (typeof data !== "object" || data === null || !("features" in data)) {
    throw new Error("USGS response is missing features.");
  }

  const features = (data as { features: unknown }).features;
  if (!Array.isArray(features)) {
    throw new Error("USGS response features must be an array.");
  }
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite.`);
  }
}
