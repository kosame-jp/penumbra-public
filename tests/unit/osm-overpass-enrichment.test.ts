import { describe, expect, it } from "vitest";

import {
  estimateCellDensity,
  overpassQueryForBbox,
  summarizeOverpassElements,
  targetCells,
} from "../../scripts/precompute/enrich-worldgrid-osm-overpass.mjs";

describe("OSM Overpass worldgrid enrichment", () => {
  it("summarizes road length, building count, and forest area from Overpass elements", () => {
    const bbox = { south: 0, west: 0, north: 0.1, east: 0.1 };
    const summary = summarizeOverpassElements(
      [
        {
          type: "way",
          id: 1,
          tags: { highway: "primary" },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 0.1 },
          ],
        },
        {
          type: "way",
          id: 2,
          tags: { highway: "footway" },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0.1, lon: 0 },
          ],
        },
        { type: "way", id: 3, tags: { building: "yes" }, geometry: [] },
        { type: "relation", id: 4, tags: { building: "yes" } },
        {
          type: "way",
          id: 5,
          tags: { landuse: "forest" },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 0.01 },
            { lat: 0.01, lon: 0.01 },
            { lat: 0.01, lon: 0 },
            { lat: 0, lon: 0 },
          ],
        },
      ],
      bbox,
    );

    expect(summary.roadLengthKm).toBeGreaterThan(10);
    expect(summary.buildingCount).toBe(2);
    expect(summary.forestAreaKm2).toBeGreaterThan(0);
  });

  it("keeps OSM enrichment opt-in for nightlight-bearing non-ocean cells by default", () => {
    const cells = [
      { id: "dark-land", landClass: "land", nightLightMean: 0 },
      { id: "lit-land", landClass: "land", nightLightMean: 0.01 },
      { id: "lit-ocean", landClass: "ocean", nightLightMean: 0.2 },
    ];

    expect(
      targetCells(cells, {
        minNightLight: 0.001,
        includeZeroNightlight: false,
        includeOcean: false,
      }).map((cell) => cell.id),
    ).toEqual(["lit-land"]);
  });

  it("estimates density-normalized values from sampled area without changing the source query shape", () => {
    const cell = { latCenterDeg: 0, lonCenterDeg: 0 };
    const estimate = estimateCellDensity(cell, [
      {
        bbox: { south: 0, west: 0, north: 0.1, east: 0.1 },
        bboxAreaKm2: 100,
        roadLengthKm: 10,
        buildingCount: 20,
        forestAreaKm2: 25,
      },
    ], { densityReferenceAreaKm2: 1000 });

    expect(estimate.roadLengthKm).toBe(100);
    expect(estimate.buildingCount).toBe(200);
    expect(estimate.forestRatio).toBe(0.25);
    const query = overpassQueryForBbox({ south: 0, west: 0, north: 1, east: 1 });
    expect(query).toContain('way["highway"]');
    expect(query).toContain('way["building"]');
    expect(query).toContain('way["landuse"="forest"]');
    expect(query).not.toContain('relation["landuse"="forest"]');
  });
});
