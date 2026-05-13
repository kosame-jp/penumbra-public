import { loadJson } from "./worldgrid-loader";

export type KernelFamily = "grid" | "scale";

export interface TuningKernelMode {
  readonly id: string;
  readonly label: string;
  readonly intervalCents: readonly number[];
  readonly notes?: string;
}

export interface TuningKernel {
  readonly id: string;
  readonly family: KernelFamily;
  readonly label: string;
  readonly centroid: {
    readonly latDeg: number;
    readonly lonDeg: number;
  };
  readonly sigmaKm: number;
  readonly status: "reviewed" | "provisional" | "final";
  readonly reviewRequired: boolean;
  readonly intervalCents?: readonly number[];
  readonly modes?: readonly TuningKernelMode[];
  readonly notes?: string;
  readonly provenance?: string;
}

export interface TuningKernelSet {
  readonly version: string;
  readonly kernels: readonly TuningKernel[];
}

export async function loadTuningKernels(
  url = "/data/tuning-kernels.json",
): Promise<TuningKernelSet> {
  return loadJson<TuningKernelSet>(url);
}
