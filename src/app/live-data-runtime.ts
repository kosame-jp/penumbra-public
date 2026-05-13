import { fetchOpenMeteoWeather, type WeatherSample } from "../core/live-data/openmeteo-client";
import { type EarthquakeEvent, QuakeStore } from "../core/live-data/quake-store";
import { fetchUsgsEarthquakes } from "../core/live-data/usgs-client";
import { WeatherCache } from "../core/live-data/weather-cache";
import type { ScanlineState } from "../core/scanline/scanline-state";
import {
  findNearestWorldGridCell,
  type WorldGrid,
  type WorldGridCell,
} from "../core/static-data/worldgrid-loader";

const DEFAULT_QUAKE_POLL_INTERVAL_MS = 2 * 60 * 1000;
const DEFAULT_WEATHER_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_WEATHER_TTL_MINUTES = 60;
const DEFAULT_MAX_WEATHER_FETCHES_PER_SWEEP = 37;
const WEATHER_VISIBLE_FALLBACK_FAILURE_RATIO = 0.25;
const WEATHER_VISIBLE_FALLBACK_MIN_FAILURES = 4;

export interface LiveDataRuntimeOptions {
  readonly fetchJson?: (url: string) => Promise<unknown>;
  readonly quakePollIntervalMs?: number;
  readonly weatherSweepIntervalMs?: number;
  readonly weatherTtlMinutes?: number;
  readonly maxWeatherFetchesPerSweep?: number;
}

export interface LiveDataRuntimeDiagnostics {
  readonly quakeCount: number;
  readonly weatherCacheSize: number;
  readonly lastQuakeSuccessUtc?: string;
  readonly lastWeatherSuccessUtc?: string;
  readonly lastQuakeError?: string;
  readonly lastWeatherError?: string;
  readonly lastWeatherWarning?: string;
  readonly lastWeatherFailedCount: number;
  readonly lastWeatherRequestCount: number;
  readonly lastWeatherFailureRatio: number;
}

export class LiveDataRuntime {
  private readonly fetchJson: (url: string) => Promise<unknown>;
  private readonly quakePollIntervalMs: number;
  private readonly weatherSweepIntervalMs: number;
  private readonly weatherTtlMinutes: number;
  private readonly maxWeatherFetchesPerSweep: number;
  private readonly quakeStore = new QuakeStore();
  private readonly weatherCache = new WeatherCache();
  private quakePollInFlight: Promise<void> | undefined;
  private weatherSweepInFlight: Promise<void> | undefined;
  private lastQuakePollMs = Number.NEGATIVE_INFINITY;
  private lastWeatherSweepMs = Number.NEGATIVE_INFINITY;
  private lastQuakeSuccessUtc: string | undefined;
  private lastWeatherSuccessUtc: string | undefined;
  private lastQuakeError: string | undefined;
  private lastWeatherError: string | undefined;
  private lastWeatherWarning: string | undefined;
  private lastWeatherFailedCount = 0;
  private lastWeatherRequestCount = 0;
  private lastWeatherFailureRatio = 0;

  constructor(options: LiveDataRuntimeOptions = {}) {
    this.fetchJson = options.fetchJson ?? browserFetchJson;
    this.quakePollIntervalMs = Math.max(0, options.quakePollIntervalMs ?? DEFAULT_QUAKE_POLL_INTERVAL_MS);
    this.weatherSweepIntervalMs = Math.max(
      0,
      options.weatherSweepIntervalMs ?? DEFAULT_WEATHER_SWEEP_INTERVAL_MS,
    );
    this.weatherTtlMinutes = Math.max(1, options.weatherTtlMinutes ?? DEFAULT_WEATHER_TTL_MINUTES);
    this.maxWeatherFetchesPerSweep = Math.max(
      1,
      Math.floor(options.maxWeatherFetchesPerSweep ?? DEFAULT_MAX_WEATHER_FETCHES_PER_SWEEP),
    );
  }

  seedQuakes(events: readonly EarthquakeEvent[]): void {
    this.quakeStore.upsertMany(events);
  }

  maybePollQuakes(now = new Date()): Promise<void> | undefined {
    this.quakeStore.evictStale(now);

    if (this.quakePollInFlight) {
      return this.quakePollInFlight;
    }

    if (now.getTime() - this.lastQuakePollMs < this.quakePollIntervalMs) {
      return undefined;
    }

    this.lastQuakePollMs = now.getTime();
    this.quakePollInFlight = this.pollQuakes(now).finally(() => {
      this.quakePollInFlight = undefined;
    });
    return this.quakePollInFlight;
  }

  maybeRefreshWeatherForScanline(
    scanlineState: ScanlineState,
    worldGrid: WorldGrid,
    now = new Date(),
  ): Promise<void> | undefined {
    this.weatherCache.pruneStale(now);

    if (this.weatherSweepInFlight) {
      return this.weatherSweepInFlight;
    }

    if (now.getTime() - this.lastWeatherSweepMs < this.weatherSweepIntervalMs) {
      return undefined;
    }

    const missingCells = scanlineCells(scanlineState, worldGrid).filter(
      (cell) => this.getWeatherForCell(cell.id, now) === undefined,
    );
    if (missingCells.length === 0) {
      this.lastWeatherSweepMs = now.getTime();
      return undefined;
    }

    const cellsToFetch = missingCells.slice(0, this.maxWeatherFetchesPerSweep);
    this.lastWeatherSweepMs = now.getTime();
    this.weatherSweepInFlight = this.refreshWeatherCells(cellsToFetch, now).finally(() => {
      this.weatherSweepInFlight = undefined;
    });
    return this.weatherSweepInFlight;
  }

  listQuakes(now = new Date()): EarthquakeEvent[] {
    this.quakeStore.evictStale(now);
    return this.quakeStore.list();
  }

  getWeatherForCell(cellId: string, now = new Date()): WeatherSample | undefined {
    const lookup = this.weatherCache.get(cellId, now);
    return lookup?.source === "cache" ? lookup.sample : undefined;
  }

  weatherCacheSize(): number {
    return this.weatherCache.size();
  }

  diagnostics(now = new Date()): LiveDataRuntimeDiagnostics {
    return {
      quakeCount: this.listQuakes(now).length,
      weatherCacheSize: this.weatherCacheSize(),
      lastQuakeSuccessUtc: this.lastQuakeSuccessUtc,
      lastWeatherSuccessUtc: this.lastWeatherSuccessUtc,
      lastQuakeError: this.lastQuakeError,
      lastWeatherError: this.lastWeatherError,
      lastWeatherWarning: this.lastWeatherWarning,
      lastWeatherFailedCount: this.lastWeatherFailedCount,
      lastWeatherRequestCount: this.lastWeatherRequestCount,
      lastWeatherFailureRatio: this.lastWeatherFailureRatio,
    };
  }

  private async pollQuakes(now: Date): Promise<void> {
    try {
      const events = await fetchUsgsEarthquakes(this.fetchJson);
      this.quakeStore.upsertMany(events);
      this.quakeStore.evictStale(now);
      this.lastQuakeSuccessUtc = now.toISOString();
      this.lastQuakeError = undefined;
    } catch (error) {
      this.lastQuakeError = toErrorMessage(error);
      console.warn(`PENUMBRA live quake fetch failed: ${this.lastQuakeError}`);
    }
  }

  private async refreshWeatherCells(
    cells: readonly WorldGridCell[],
    now: Date,
  ): Promise<void> {
    const results = await Promise.allSettled(
      cells.map(async (cell) => {
        const sample = await fetchOpenMeteoWeather(
          this.fetchJson,
          cell.latCenterDeg,
          cell.lonCenterDeg,
        );
        this.weatherCache.set(cell.id, sample, now, this.weatherTtlMinutes);
      }),
    );

    const rejected = results.filter((result) => result.status === "rejected");
    const fulfilledCount = results.length - rejected.length;
    const failedCount = rejected.length;
    const failureRatio = results.length > 0 ? failedCount / results.length : 0;
    this.lastWeatherFailedCount = failedCount;
    this.lastWeatherRequestCount = results.length;
    this.lastWeatherFailureRatio = failureRatio;

    if (fulfilledCount > 0) {
      this.lastWeatherSuccessUtc = now.toISOString();
    }

    if (failedCount === 0) {
      this.lastWeatherError = undefined;
      this.lastWeatherWarning = undefined;
      return;
    }

    const firstReason = rejected[0]?.reason;
    const message = `${failedCount}/${results.length} weather requests failed: ${toErrorMessage(
      firstReason,
    )}`;
    this.lastWeatherWarning = message;

    if (shouldShowLiveWeatherFallback({
      failedCount,
      fulfilledCount,
      failureRatio,
    })) {
      this.lastWeatherError = message;
      console.warn(`PENUMBRA live weather fetch degraded: ${message}`);
      return;
    }

    this.lastWeatherError = undefined;
  }
}

export function shouldShowLiveWeatherFallback(options: {
  readonly failedCount: number;
  readonly fulfilledCount: number;
  readonly failureRatio: number;
}): boolean {
  if (options.failedCount <= 0) {
    return false;
  }
  if (options.fulfilledCount <= 0) {
    return true;
  }
  return (
    options.failedCount >= WEATHER_VISIBLE_FALLBACK_MIN_FAILURES &&
    options.failureRatio >= WEATHER_VISIBLE_FALLBACK_FAILURE_RATIO
  );
}

export async function browserFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function scanlineCells(scanlineState: ScanlineState, worldGrid: WorldGrid): WorldGridCell[] {
  const cellsById = new Map<string, WorldGridCell>();

  for (const point of scanlineState.points) {
    if (point.sunriseLongitudeDeg == null) {
      continue;
    }

    const cell = findNearestWorldGridCell(
      worldGrid,
      point.latitudeDeg,
      point.sunriseLongitudeDeg,
    );
    cellsById.set(cell.id, cell);
  }

  return [...cellsById.values()];
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
