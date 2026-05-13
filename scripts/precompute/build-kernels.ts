import type { TuningKernelSet } from "../../src/core/static-data/kernels-loader";

export function buildTuningKernelArtifact(kernelSet: TuningKernelSet): TuningKernelSet {
  assertTuningKernelProvenance(kernelSet);
  return {
    version: kernelSet.version,
    kernels: kernelSet.kernels.map((kernel) => ({ ...kernel })),
  };
}

export function assertTuningKernelProvenance(kernelSet: TuningKernelSet): void {
  for (const kernel of kernelSet.kernels) {
    if (!kernel.provenance || !kernel.notes) {
      throw new Error(`Tuning kernel ${kernel.id} must keep provenance and notes.`);
    }
    if (kernel.status === "provisional" && kernel.reviewRequired !== true) {
      throw new Error(`Provisional tuning kernel ${kernel.id} must keep reviewRequired=true.`);
    }
  }
}
