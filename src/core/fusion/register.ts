import { clamp } from "../scanline/geometry";
import type { WorldGridCell } from "../static-data/worldgrid-loader";

export interface RegisterAnchor {
  readonly elevationM: number;
  readonly registerMidi: number;
}

export const REGISTER_ANCHORS: readonly RegisterAnchor[] = [
  { elevationM: -10994, registerMidi: 24 },
  { elevationM: -4000, registerMidi: 36 },
  { elevationM: 0, registerMidi: 48 },
  { elevationM: 500, registerMidi: 60 },
  { elevationM: 2000, registerMidi: 72 },
  { elevationM: 4000, registerMidi: 84 },
  { elevationM: 8849, registerMidi: 96 },
];

export function effectiveElevationM(cell: WorldGridCell): number {
  return cell.landClass === "ocean" ? cell.bathymetryM : cell.elevationM;
}

export function registerMidiForElevation(elevationM: number): number {
  const clampedElevation = clamp(
    elevationM,
    REGISTER_ANCHORS[0].elevationM,
    REGISTER_ANCHORS[REGISTER_ANCHORS.length - 1].elevationM,
  );

  for (let index = 0; index < REGISTER_ANCHORS.length - 1; index += 1) {
    const lower = REGISTER_ANCHORS[index];
    const upper = REGISTER_ANCHORS[index + 1];

    if (clampedElevation >= lower.elevationM && clampedElevation <= upper.elevationM) {
      const ratio =
        (clampedElevation - lower.elevationM) / (upper.elevationM - lower.elevationM);
      return lower.registerMidi + ratio * (upper.registerMidi - lower.registerMidi);
    }
  }

  return REGISTER_ANCHORS[REGISTER_ANCHORS.length - 1].registerMidi;
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
