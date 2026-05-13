import { validateArtifact, type ArtifactKind, type ValidationResult } from "../../src/core/static-data/schema-validation";

export interface FixtureValidationTarget {
  readonly kind: ArtifactKind;
  readonly data: unknown;
}

export function validateFixtureTargets(
  targets: readonly FixtureValidationTarget[],
): readonly ValidationResult[] {
  return targets.map((target) => validateArtifact(target.kind, target.data));
}
