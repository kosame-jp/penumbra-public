import type { WorldGridCell } from "./worldgrid-loader";
import { PENUMBRA_VISUAL_PALETTE } from "../visual-palette";

export function terrainColorForCell(cell: WorldGridCell): string {
  if (cell.landClass === "ocean") {
    return oceanColorForBathymetry(cell.bathymetryM);
  }

  if (cell.landClass === "ice") {
    return PENUMBRA_VISUAL_PALETTE.terrain.ice;
  }

  if (cell.terrainClass === "urban") {
    return PENUMBRA_VISUAL_PALETTE.terrain.urban;
  }

  if (cell.elevationM > 4000) {
    return PENUMBRA_VISUAL_PALETTE.terrain.highLand;
  }

  if (cell.elevationM > 1500) {
    return PENUMBRA_VISUAL_PALETTE.terrain.mountain;
  }

  if (cell.forestRatio > 0.35) {
    return PENUMBRA_VISUAL_PALETTE.terrain.forest;
  }

  return PENUMBRA_VISUAL_PALETTE.terrain.lowLand;
}

function oceanColorForBathymetry(bathymetryM: number): string {
  const bands = PENUMBRA_VISUAL_PALETTE.terrain.oceanDepthBands;
  const depth01 = clamp(-bathymetryM / 9000, 0, 1);
  const bandIndex = Math.min(bands.length - 1, Math.floor(depth01 * bands.length));
  return bands[bandIndex] ?? PENUMBRA_VISUAL_PALETTE.terrain.deepOcean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
