import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REQUIRED_RELEASE_DOCS = [
  "README.md",
  "LICENSE",
  "NOTICE.md",
  "ATTRIBUTIONS.md",
  "docs/deployment.md",
  "docs/cloud-atlas-operations.md",
  "docs/runtime-fallbacks.md",
  "public/about-ja.md",
  "public/about-en.md",
  "public/youtube-metadata.md",
] as const;

describe("release pack documents", () => {
  it("keeps the required release surfaces present", () => {
    for (const path of REQUIRED_RELEASE_DOCS) {
      expect(readText(path).trim().length, path).toBeGreaterThan(100);
    }
  });

  it("keeps safety and non-monitoring language visible in release surfaces", () => {
    const releaseText = [
      readText("README.md"),
      readText("ATTRIBUTIONS.md"),
      readText("docs/deployment.md"),
      readText("docs/runtime-fallbacks.md"),
      readText("copy/live-safety-copy.md"),
    ].join("\n");

    expect(releaseText).toContain("PENUMBRA will continue without you.");
    expect(releaseText).toContain("You are more important than this stream.");
    expect(releaseText).toContain("not a disaster monitoring service");
  });

  it("marks imported static data provenance explicitly", () => {
    const attributions = readText("ATTRIBUTIONS.md");
    const dataManifest = readText("docs/data-manifest.md");

    expect(attributions).toContain("VIIRS_Night_Lights");
    expect(attributions).toContain("OpenStreetMap");
    expect(dataManifest).toContain("NOAA GFS");
  });

  it("links legal and deployment docs from the README", () => {
    const readme = readText("README.md");

    expect(readme).toContain("[Deployment Notes](docs/deployment.md)");
    expect(readme).toContain("[Cloud Atlas Operations](docs/cloud-atlas-operations.md)");
    expect(readme).toContain("[Runtime Fallbacks](docs/runtime-fallbacks.md)");
    expect(readme).toContain("[Attributions](ATTRIBUTIONS.md)");
    expect(readme).toContain("[Notice](NOTICE.md)");
    expect(readme).toContain("[PENUMBRA について](docs/PENUMBRA-about-ja.md)");
    expect(readme).toContain("[PENUMBRA About](docs/PENUMBRA-about-en.md)");
  });
});

function readText(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}
