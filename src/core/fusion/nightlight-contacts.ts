import type { TerminatorPoint } from "../astronomy/terminator";
import { gaussianWeight } from "../scanline/gaussian";
import { signedLongitudeOffsetDeg } from "../scanline/geometry";
import { createScanlineState, type ScanlineState } from "../scanline/scanline-state";
import type { WorldGrid, WorldGridCell } from "../static-data/worldgrid-loader";
import { normalizeNightLight } from "./nightlight";

export const MIN_MUSIC_CONTACT_GAIN = 0;
export const DEBUG_NIGHTLIGHT_FORECAST_GAIN = 0.05;
const nightLightCellsByGrid = new WeakMap<WorldGrid, readonly WorldGridCell[]>();

export interface NightLightScanlineContact {
  readonly cell: WorldGridCell;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly scanlineWeight: number;
  readonly longitudeOffsetDeg: number;
  readonly nightLightNorm: number;
  readonly musicGain01: number;
}

export interface NightLightForecast {
  readonly utcIso: string;
  readonly minutesFromNow: number;
  readonly contact: NightLightScanlineContact;
}

export interface NightLightContactInput {
  readonly scanlineState: ScanlineState;
  readonly worldGrid: WorldGrid;
  readonly minGain01?: number;
  readonly excludedCellIds?: ReadonlySet<string>;
}

export function scanlineNightLightContacts(
  input: NightLightContactInput,
): NightLightScanlineContact[] {
  const minGain01 = input.minGain01 ?? MIN_MUSIC_CONTACT_GAIN;
  const latitudeReachDeg = input.scanlineState.latitudeStepDeg / 2 + 1e-6;
  const contacts: NightLightScanlineContact[] = [];

  for (const cell of nightLightCellsForGrid(input.worldGrid)) {
    if (input.excludedCellIds?.has(cell.id)) {
      continue;
    }

    const point = nearestNormalTerminatorPoint(
      input.scanlineState.points,
      cell.latCenterDeg,
      latitudeReachDeg,
    );
    if (!point || point.sunriseLongitudeDeg === null) {
      continue;
    }

    const longitudeOffsetDeg = signedLongitudeOffsetDeg(
      cell.lonCenterDeg,
      point.sunriseLongitudeDeg,
    );
    if (Math.abs(longitudeOffsetDeg) > input.scanlineState.activeReachDeg) {
      continue;
    }

    const scanlineWeight = gaussianWeight(longitudeOffsetDeg, input.scanlineState.sigmaDeg);
    const nightLightNorm = normalizeNightLight(
      cell.nightLightMean,
      input.worldGrid.stats.nightLight,
    );
    const musicGain01 = nightLightNorm * scanlineWeight;
    if (musicGain01 <= minGain01) {
      continue;
    }

    contacts.push({
      cell,
      latitudeDeg: cell.latCenterDeg,
      longitudeDeg: cell.lonCenterDeg,
      scanlineWeight,
      longitudeOffsetDeg,
      nightLightNorm,
      musicGain01,
    });
  }

  return contacts.sort((left, right) => right.musicGain01 - left.musicGain01);
}

function nightLightCellsForGrid(worldGrid: WorldGrid): readonly WorldGridCell[] {
  const cached = nightLightCellsByGrid.get(worldGrid);
  if (cached) {
    return cached;
  }

  const cells = worldGrid.cells.filter((cell) => cell.nightLightMean > 0);
  nightLightCellsByGrid.set(worldGrid, cells);
  return cells;
}

export function strongestNightLightContact(
  input: NightLightContactInput,
): NightLightScanlineContact | undefined {
  return scanlineNightLightContacts(input)[0];
}

export function nextNightLightForecast(input: {
  readonly startDate: Date;
  readonly worldGrid: WorldGrid;
  readonly horizonMinutes?: number;
  readonly stepMinutes?: number;
  readonly minGain01?: number;
}): NightLightForecast | undefined {
  const horizonMinutes = input.horizonMinutes ?? 24 * 60;
  const stepMinutes = input.stepMinutes ?? 10;
  const minGain01 = input.minGain01 ?? DEBUG_NIGHTLIGHT_FORECAST_GAIN;

  for (let minutesFromNow = 0; minutesFromNow <= horizonMinutes; minutesFromNow += stepMinutes) {
    const date = new Date(input.startDate.getTime() + minutesFromNow * 60_000);
    const scanlineState = createScanlineState(date);
    const contact = strongestNightLightContact({
      scanlineState,
      worldGrid: input.worldGrid,
      minGain01,
    });

    if (contact) {
      return {
        utcIso: scanlineState.utc.iso,
        minutesFromNow,
        contact,
      };
    }
  }

  return undefined;
}

function nearestNormalTerminatorPoint(
  points: readonly TerminatorPoint[],
  latitudeDeg: number,
  maxLatitudeDistanceDeg: number,
): TerminatorPoint | undefined {
  const insertionIndex = lowerBoundTerminatorLatitude(points, latitudeDeg);
  let nearest: { point: TerminatorPoint; distanceDeg: number } | undefined;

  for (
    let leftIndex = insertionIndex - 1, rightIndex = insertionIndex;
    leftIndex >= 0 || rightIndex < points.length;

  ) {
    const leftPoint = leftIndex >= 0 ? points[leftIndex] : undefined;
    const rightPoint = rightIndex < points.length ? points[rightIndex] : undefined;
    const leftDistance = leftPoint ? Math.abs(leftPoint.latitudeDeg - latitudeDeg) : Number.POSITIVE_INFINITY;
    const rightDistance = rightPoint ? Math.abs(rightPoint.latitudeDeg - latitudeDeg) : Number.POSITIVE_INFINITY;

    if (leftDistance > maxLatitudeDistanceDeg && rightDistance > maxLatitudeDistanceDeg) {
      break;
    }

    if (leftDistance <= rightDistance) {
      nearest = nearestTerminatorCandidate(nearest, leftPoint, leftDistance, maxLatitudeDistanceDeg);
      leftIndex -= 1;
    } else {
      nearest = nearestTerminatorCandidate(nearest, rightPoint, rightDistance, maxLatitudeDistanceDeg);
      rightIndex += 1;
    }
  }

  return nearest?.point;
}

function nearestTerminatorCandidate(
  nearest: { point: TerminatorPoint; distanceDeg: number } | undefined,
  point: TerminatorPoint | undefined,
  distanceDeg: number,
  maxLatitudeDistanceDeg: number,
): { point: TerminatorPoint; distanceDeg: number } | undefined {
  if (!point || point.sunriseLongitudeDeg === null || distanceDeg > maxLatitudeDistanceDeg) {
    return nearest;
  }

  if (!nearest || distanceDeg < nearest.distanceDeg) {
    return { point, distanceDeg };
  }

  return nearest;
}

function lowerBoundTerminatorLatitude(points: readonly TerminatorPoint[], latitudeDeg: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((points[mid]?.latitudeDeg ?? Number.POSITIVE_INFINITY) < latitudeDeg) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}
