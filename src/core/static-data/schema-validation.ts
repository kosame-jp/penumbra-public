import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

import cloudAtlasManifestSchema from "../../../schemas/cloud-atlas-manifest.schema.json";
import cloudAtlasSchema from "../../../schemas/cloud-atlas.schema.json";
import earthquakeEventSchema from "../../../schemas/earthquake-event.schema.json";
import scanlineSampleSchema from "../../../schemas/scanline-sample.schema.json";
import tuningKernelsSchema from "../../../schemas/tuning-kernels.schema.json";
import weatherCacheEntrySchema from "../../../schemas/weather-cache-entry.schema.json";
import worldGridSchema from "../../../schemas/worldgrid.schema.json";

export type ArtifactKind =
  | "cloud-atlas"
  | "cloud-atlas-manifest"
  | "worldgrid"
  | "weather-cache-entry"
  | "earthquake-event"
  | "scanline-sample"
  | "tuning-kernels";

export interface ValidationSuccess {
  readonly valid: true;
}

export interface ValidationFailure {
  readonly valid: false;
  readonly errors: readonly string[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

const schemaIds: Record<ArtifactKind, string> = {
  "cloud-atlas": "https://penumbra.app/schemas/cloud-atlas.schema.json",
  "cloud-atlas-manifest": "https://penumbra.app/schemas/cloud-atlas-manifest.schema.json",
  "worldgrid": "https://penumbra.app/schemas/worldgrid.schema.json",
  "weather-cache-entry": "https://penumbra.app/schemas/weather-cache-entry.schema.json",
  "earthquake-event": "https://penumbra.app/schemas/earthquake-event.schema.json",
  "scanline-sample": "https://penumbra.app/schemas/scanline-sample.schema.json",
  "tuning-kernels": "https://penumbra.app/schemas/tuning-kernels.schema.json",
};

let cachedValidators: Map<ArtifactKind, ValidateFunction> | undefined;

export function validateArtifact(kind: ArtifactKind, data: unknown): ValidationResult {
  const validator = getValidator(kind);
  const valid = validator(data);

  if (valid) {
    return { valid: true };
  }

  return {
    valid: false,
    errors: formatErrors(validator.errors ?? []),
  };
}

export function assertValidArtifact(kind: ArtifactKind, data: unknown): void {
  const result = validateArtifact(kind, data);
  if (!result.valid) {
    throw new Error(`Invalid PENUMBRA ${kind} artifact:\n${result.errors.join("\n")}`);
  }
}

function getValidator(kind: ArtifactKind): ValidateFunction {
  const validators = cachedValidators ?? buildValidators();
  cachedValidators = validators;

  const validator = validators.get(kind);
  if (!validator) {
    throw new Error(`No schema validator registered for ${kind}.`);
  }
  return validator;
}

function buildValidators(): Map<ArtifactKind, ValidateFunction> {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
  });
  addFormats(ajv);

  ajv.addSchema(cloudAtlasSchema);
  ajv.addSchema(cloudAtlasManifestSchema);
  ajv.addSchema(earthquakeEventSchema);
  ajv.addSchema(scanlineSampleSchema);
  ajv.addSchema(tuningKernelsSchema);
  ajv.addSchema(weatherCacheEntrySchema);
  ajv.addSchema(worldGridSchema);

  return new Map(
    (Object.entries(schemaIds) as Array<[ArtifactKind, string]>).map(([kind, schemaId]) => {
      const validator = ajv.getSchema(schemaId);
      if (!validator) {
        throw new Error(`Failed to compile schema ${schemaId}.`);
      }
      return [kind, validator];
    }),
  );
}

function formatErrors(errors: readonly ErrorObject[]): string[] {
  return errors.map((error) => {
    const path = error.instancePath === "" ? "/" : error.instancePath;
    return `${path} ${error.message ?? "failed validation"}`;
  });
}
