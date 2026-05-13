import type { ScanlineState } from "../scanline/scanline-state";
import { isWithinActiveReach } from "../scanline/reach";

export const QUAKE_WINDOW_MINUTES = 81;
export const QUAKE_EVICTION_MARGIN_MINUTES = 9;

export interface EarthquakeEvent {
  readonly id: string;
  readonly provider: string;
  readonly eventTimeUtc: string;
  readonly updatedTimeUtc: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly depthKm: number;
  readonly magnitude: number;
  readonly place?: string;
  readonly sourceFeed?: string;
}

export interface EarthquakeFixtureFile {
  readonly version: string;
  readonly events: readonly EarthquakeEvent[];
}

export function quakeAgeMinutes(now: Date, event: EarthquakeEvent): number {
  return (now.getTime() - Date.parse(event.eventTimeUtc)) / 60000;
}

export function isWithinQuakeWindow(
  now: Date,
  event: EarthquakeEvent,
  windowMinutes = QUAKE_WINDOW_MINUTES,
): boolean {
  const ageMinutes = quakeAgeMinutes(now, event);
  return ageMinutes >= 0 && ageMinutes <= windowMinutes;
}

export function isQuakeInScanlineReach(
  event: EarthquakeEvent,
  scanlineState: ScanlineState,
): boolean {
  const nearestPoint = nearestScanlinePointForLatitude(event.latitudeDeg, scanlineState);
  if (nearestPoint?.sunriseLongitudeDeg == null) {
    return false;
  }

  return isWithinActiveReach(
    event.longitudeDeg,
    nearestPoint.sunriseLongitudeDeg,
    scanlineState.sigmaDeg,
  );
}

export function filterActiveQuakes(
  events: readonly EarthquakeEvent[],
  now: Date,
  scanlineState: ScanlineState,
): EarthquakeEvent[] {
  return events.filter(
    (event) => isWithinQuakeWindow(now, event) && isQuakeInScanlineReach(event, scanlineState),
  );
}

export class QuakeStore {
  private readonly events = new Map<string, EarthquakeEvent>();

  upsertMany(events: readonly EarthquakeEvent[]): void {
    for (const event of events) {
      this.events.set(event.id, event);
    }
  }

  list(): EarthquakeEvent[] {
    return [...this.events.values()].sort(
      (left, right) => Date.parse(left.eventTimeUtc) - Date.parse(right.eventTimeUtc),
    );
  }

  evictStale(
    now: Date,
    windowMinutes = QUAKE_WINDOW_MINUTES,
    marginMinutes = QUAKE_EVICTION_MARGIN_MINUTES,
  ): number {
    const maxAgeMinutes = windowMinutes + marginMinutes;
    let evicted = 0;

    for (const [id, event] of this.events.entries()) {
      if (quakeAgeMinutes(now, event) > maxAgeMinutes) {
        this.events.delete(id);
        evicted += 1;
      }
    }

    return evicted;
  }

  active(now: Date, scanlineState: ScanlineState): EarthquakeEvent[] {
    return filterActiveQuakes(this.list(), now, scanlineState);
  }
}

export function nearestScanlinePointForLatitude(
  latitudeDeg: number,
  scanlineState: ScanlineState,
): ScanlineState["points"][number] | undefined {
  return scanlineState.points.reduce<ScanlineState["points"][number] | undefined>(
    (nearest, point) => {
      if (!nearest) {
        return point;
      }

      const currentDistance = Math.abs(point.latitudeDeg - latitudeDeg);
      const nearestDistance = Math.abs(nearest.latitudeDeg - latitudeDeg);
      return currentDistance < nearestDistance ? point : nearest;
    },
    undefined,
  );
}
