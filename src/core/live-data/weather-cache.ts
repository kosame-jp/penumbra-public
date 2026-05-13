import { DEFAULT_WEATHER_SAMPLE, type WeatherSample } from "./openmeteo-client";

export interface WeatherCacheEntryArtifact extends WeatherSample {
  readonly cacheKey: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly observedAtUtc: string;
  readonly fetchedAtUtc: string;
  readonly validUntilUtc: string;
  readonly weatherCode?: number;
}

export interface WeatherCacheEntry {
  readonly key: string;
  readonly fetchedAtUtc: string;
  readonly validUntilUtc: string;
  readonly sample: WeatherSample;
}

export interface WeatherLookupResult {
  readonly sample: WeatherSample;
  readonly source: "cache" | "fallback";
  readonly reason?: string;
}

export class WeatherCache {
  private readonly entries = new Map<string, WeatherCacheEntry>();

  size(): number {
    return this.entries.size;
  }

  get(key: string, now = new Date()): WeatherLookupResult | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.parse(entry.validUntilUtc) < now.getTime()) {
      return {
        sample: DEFAULT_WEATHER_SAMPLE,
        source: "fallback",
        reason: `weather cache entry ${key} is stale`,
      };
    }

    return {
      sample: entry.sample,
      source: "cache",
    };
  }

  getOrFallback(key: string, now = new Date()): WeatherLookupResult {
    return (
      this.get(key, now) ?? {
        sample: DEFAULT_WEATHER_SAMPLE,
        source: "fallback",
        reason: `weather cache entry ${key} is missing`,
      }
    );
  }

  set(key: string, sample: WeatherSample, fetchedAt: Date, ttlMinutes = 60): void {
    const validUntil = new Date(fetchedAt.getTime() + ttlMinutes * 60000);
    this.entries.set(key, {
      key,
      fetchedAtUtc: fetchedAt.toISOString(),
      validUntilUtc: validUntil.toISOString(),
      sample,
    });
  }

  setArtifact(entry: WeatherCacheEntryArtifact): void {
    this.entries.set(entry.cacheKey, {
      key: entry.cacheKey,
      fetchedAtUtc: entry.fetchedAtUtc,
      validUntilUtc: entry.validUntilUtc,
      sample: {
        cloudCoverPct: entry.cloudCoverPct,
        relativeHumidityPct: entry.relativeHumidityPct,
        windSpeedMps: entry.windSpeedMps,
        precipitationMm: entry.precipitationMm,
        temperatureC: entry.temperatureC,
        pressureHpa: entry.pressureHpa,
      },
    });
  }

  prefetch(entries: readonly WeatherCacheEntryArtifact[]): void {
    for (const entry of entries) {
      this.setArtifact(entry);
    }
  }

  pruneStale(now = new Date(), graceMinutes = 10): number {
    const cutoffMs = now.getTime() - graceMinutes * 60000;
    let pruned = 0;

    for (const [key, entry] of this.entries.entries()) {
      const validUntilMs = Date.parse(entry.validUntilUtc);
      if (Number.isNaN(validUntilMs) || validUntilMs < cutoffMs) {
        this.entries.delete(key);
        pruned += 1;
      }
    }

    return pruned;
  }
}

export async function getWeatherWithCacheFallback(
  cache: WeatherCache,
  key: string,
  fetchSample: () => Promise<WeatherSample>,
  now = new Date(),
  ttlMinutes = 60,
): Promise<WeatherLookupResult> {
  const cached = cache.get(key, now);
  if (cached?.source === "cache") {
    return cached;
  }

  try {
    const sample = await fetchSample();
    cache.set(key, sample, now, ttlMinutes);
    return {
      sample,
      source: "cache",
    };
  } catch (error) {
    return {
      sample: DEFAULT_WEATHER_SAMPLE,
      source: "fallback",
      reason: `weather fetch failed for ${key}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
