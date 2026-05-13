import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseCloudAtlasArtifact } from "../../src/core/static-data/generated-artifact-loaders";

describe("Open-Meteo cloud atlas precompute", () => {
  it("builds a deterministic batched request URL", async () => {
    const { openMeteoCloudCoverUrl } = await importOpenMeteoBuilder();
    const url = openMeteoCloudCoverUrl([
      { latitudeDeg: 35, longitudeDeg: 139 },
      { latitudeDeg: -12.5, longitudeDeg: -42.25 },
    ]);

    expect(url).toContain("latitude=35%2C-12.5");
    expect(url).toContain("longitude=139%2C-42.25");
    expect(url).toContain("current=cloud_cover");
    expect(url).toContain("timezone=UTC");
  });

  it("parses current cloud cover batches into uint8 atlas values", async () => {
    const { parseOpenMeteoCloudCoverResponse } = await importOpenMeteoBuilder();
    const parsed = parseOpenMeteoCloudCoverResponse(
      [
        { current: { time: "2026-05-06T06:00", cloud_cover: 0.2 } },
        { current: { time: "2026-05-06T06:00", cloud_cover: 58.6 } },
        { current: { time: "2026-05-06T06:00", cloud_cover: 140 } },
      ],
      3,
      "unit-test",
    );

    expect(parsed.values).toEqual([0, 59, 100]);
    expect(parsed.validTimes).toEqual([
      "2026-05-06T06:00:00.000Z",
      "2026-05-06T06:00:00.000Z",
      "2026-05-06T06:00:00.000Z",
    ]);
  });

  it("builds a valid 1 degree artifact from mocked batch responses", async () => {
    const { buildCloudAtlas } = await importOpenMeteoBuilder();
    const output = join(mkdtempSync(join(tmpdir(), "penumbra-cloud-atlas-")), "cloud-atlas.current.json");
    const artifact = await buildCloudAtlas({
      output,
      requestDelayMs: 0,
      batchSize: 360,
      generatedAtUtc: "2026-05-06T06:12:00.000Z",
      quiet: true,
      fetchJson: async (url: string) => {
        const params = new URL(url).searchParams;
        const latitudes = params.get("latitude")?.split(",") ?? [];
        return latitudes.map((_, index) => ({
          current: {
            time: "2026-05-06T06:00",
            cloud_cover: index % 101,
          },
        }));
      },
    });

    expect(artifact.width).toBe(360);
    expect(artifact.height).toBe(181);
    expect(artifact.values).toHaveLength(65160);

    const parsed = parseCloudAtlasArtifact(JSON.parse(readFileSync(output, "utf8")) as unknown);
    expect(parsed.source.kind).toBe("open-meteo");
    expect(parsed.validAtUtc).toBe("2026-05-06T06:00:00.000Z");
  });
});

async function importOpenMeteoBuilder(): Promise<{
  buildCloudAtlas: (options: Record<string, unknown>) => Promise<{
    width: number;
    height: number;
    values: readonly number[];
  }>;
  openMeteoCloudCoverUrl: (points: readonly { latitudeDeg: number; longitudeDeg: number }[]) => string;
  parseOpenMeteoCloudCoverResponse: (
    response: unknown,
    expectedCount: number,
    source: string,
  ) => { values: readonly number[]; validTimes: readonly string[] };
}> {
  return import("../../scripts/precompute/build-cloud-atlas-openmeteo.mjs");
}
