import type { ScanlineState } from "../scanline/scanline-state";
import type { CanonicalScanlineSample } from "../fusion/scanline-sample";

export interface RuntimeSnapshot {
  readonly scanlineState: ScanlineState;
  readonly samples: readonly CanonicalScanlineSample[];
}

export class RuntimeStore {
  private snapshot: RuntimeSnapshot | undefined;

  setSnapshot(snapshot: RuntimeSnapshot): void {
    this.snapshot = snapshot;
  }

  getSnapshot(): RuntimeSnapshot | undefined {
    return this.snapshot;
  }
}
