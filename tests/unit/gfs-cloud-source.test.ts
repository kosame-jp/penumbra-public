import { describe, expect, it } from "vitest";

describe("GFS cloud source planner", () => {
  it("builds official NOAA GFS 0.25 atmosphere object URLs", async () => {
    const { gfsAtmosIndexObjectKey, gfsAtmosIndexUrl, gfsAtmosObjectKey, gfsAtmosUrl } = await importGfsSource();

    const options = { date: "20260506", cycleHour: 0, forecastHour: 3 };

    expect(gfsAtmosObjectKey(options)).toBe("gfs.20260506/00/atmos/gfs.t00z.pgrb2.0p25.f003");
    expect(gfsAtmosIndexObjectKey(options)).toBe("gfs.20260506/00/atmos/gfs.t00z.pgrb2.0p25.f003.idx");
    expect(gfsAtmosUrl(options)).toBe(
      "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20260506/00/atmos/gfs.t00z.pgrb2.0p25.f003",
    );
    expect(gfsAtmosIndexUrl(options)).toBe(
      "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20260506/00/atmos/gfs.t00z.pgrb2.0p25.f003.idx",
    );
  });

  it("selects instantaneous total cloud cover instead of accumulated average cloud cover", async () => {
    const { planGfsCloudCoverFrameFromIndex } = await importGfsSource();
    const plan = planGfsCloudCoverFrameFromIndex({
      date: "20260506",
      cycleHour: 0,
      forecastHour: 3,
      indexText: [
        "634:447573006:d=2026050600:CWAT:entire atmosphere (considered as a single layer):3 hour fcst:",
        "635:448573006:d=2026050600:HCDC:high cloud layer:3 hour fcst:",
        "636:449133280:d=2026050600:TCDC:entire atmosphere:3 hour fcst:",
        "637:449955471:d=2026050600:TCDC:entire atmosphere:0-3 hour ave fcst:",
        "638:450710600:d=2026050600:PRATE:surface:0-3 hour ave fcst:",
        "639:451210600:d=2026050600:HGT:cloud ceiling:3 hour fcst:",
      ].join("\n"),
    });

    expect(plan.validAtUtc).toBe("2026-05-06T03:00:00.000Z");
    expect(plan.message.messageNumber).toBe(636);
    expect(plan.message.forecastLabel).toBe("3 hour fcst");
    expect(plan.byteRangeHeader).toBe("bytes=449133280-449955470");
    expect(plan.byteLength).toBe(822191);
    expect(plan.cloudWaterMessage.forecastLabel).toBe("3 hour fcst");
    expect(plan.cloudWaterByteRangeHeader).toBe("bytes=447573006-448573005");
    expect(plan.precipitationMessage.forecastLabel).toBe("0-3 hour ave fcst");
    expect(plan.precipitationByteRangeHeader).toBe("bytes=450710600-451210599");
  });

  it("selects the analysis total cloud cover field for f000 plans", async () => {
    const { planGfsCloudCoverFrameFromIndex } = await importGfsSource();
    const plan = planGfsCloudCoverFrameFromIndex({
      date: "20260506",
      cycleHour: 0,
      forecastHour: 0,
      indexText: [
        "605:432596835:d=2026050600:CWAT:entire atmosphere (considered as a single layer):anl:",
        "608:434224308:d=2026050600:LCDC:low cloud layer:anl:",
        "609:434999168:d=2026050600:MCDC:middle cloud layer:anl:",
        "610:435570974:d=2026050600:HCDC:high cloud layer:anl:",
        "611:436283889:d=2026050600:TCDC:entire atmosphere:anl:",
        "612:437113679:d=2026050600:PRATE:surface:anl:",
        "613:437313679:d=2026050600:HGT:cloud ceiling:anl:",
      ].join("\n"),
    });

    expect(plan.validAtUtc).toBe("2026-05-06T00:00:00.000Z");
    expect(plan.message.forecastLabel).toBe("anl");
    expect(plan.byteRangeHeader).toBe("bytes=436283889-437113678");
    expect(plan.cloudWaterMessage.forecastLabel).toBe("anl");
    expect(plan.cloudWaterByteRangeHeader).toBe("bytes=432596835-434224307");
    expect(plan.precipitationMessage.forecastLabel).toBe("anl");
    expect(plan.precipitationByteRangeHeader).toBe("bytes=437113679-437313678");
  });

  it("chooses the latest UTC cycle with an availability latency", async () => {
    const { latestAvailableGfsCycle } = await importGfsSource();

    expect(latestAvailableGfsCycle(Date.parse("2026-05-06T04:30:00.000Z"), 5)).toEqual({
      date: "20260505",
      cycleHour: 18,
    });
    expect(latestAvailableGfsCycle(Date.parse("2026-05-06T13:15:00.000Z"), 5)).toEqual({
      date: "20260506",
      cycleHour: 6,
    });
  });
});

async function importGfsSource(): Promise<{
  gfsAtmosIndexObjectKey: (options: Record<string, unknown>) => string;
  gfsAtmosIndexUrl: (options: Record<string, unknown>) => string;
  gfsAtmosObjectKey: (options: Record<string, unknown>) => string;
  gfsAtmosUrl: (options: Record<string, unknown>) => string;
  latestAvailableGfsCycle: (nowUtcMs: number, latencyHours: number) => {
    date: string;
    cycleHour: number;
  };
  planGfsCloudCoverFrameFromIndex: (options: Record<string, unknown>) => {
    validAtUtc: string;
    byteRangeHeader: string;
    byteLength?: number;
    cloudWaterByteRangeHeader: string;
    precipitationByteRangeHeader: string;
    message: {
      messageNumber: number;
      forecastLabel: string;
    };
    cloudWaterMessage: {
      forecastLabel: string;
    };
    precipitationMessage: {
      forecastLabel: string;
    };
  };
}> {
  return import("../../scripts/precompute/gfs-cloud-source.mjs");
}
