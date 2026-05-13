# Cloud Atlas Operations

This runbook covers the cached forecast cloud atlas used by production `?cloud=forecast`.
The browser must only read static artifacts; it must not fan out weather requests per listener.

## Generate

Use the GFS path when `wgrib2` is available on the artifact-generation machine:

```bash
npm run inspect:gfs-cloud-source
npm run precompute:cloud-atlas:forecast-gfs:ops
```

For the current visual-only cloud resolution experiment, use:

```bash
npm run precompute:cloud-atlas:forecast-gfs:0p5:ops
```

`precompute:cloud-atlas:forecast-gfs:ops` performs three steps:

1. Build `public/data/cloud-atlas.forecast/*` from NOAA/NODD GFS GRIB2 ranges.
2. Validate manifest/frame shape with `npm run check:cloud-atlas:forecast`.
3. Validate operational freshness with `npm run check:cloud-atlas:ops`.

The default GFS build publishes `f000`, `f003`, `f006`, and `f009` frames at 1 degree. The
experimental `0p5` build publishes the same forecast hours at 0.5 degree. Both write versioned frame
URLs first, then atomically replace `manifest.json`. Eight prior generations are retained so
browsers holding the previous manifest can still resolve its frames.

## Staging Cron

The repository includes a GitHub Actions staging workflow:

```text
.github/workflows/cloud-forecast-staging.yml
```

It runs every 3 hours and can also be started manually from `workflow_dispatch`.
The scheduled job uses the current 0.5 degree GFS artifact route:

```bash
npm run precompute:cloud-atlas:forecast-gfs:0p5:ops
```

The workflow installs `wgrib2` from conda-forge via micromamba, inspects the selected GFS source,
generates the forecast sequence, validates schema and operational freshness, builds the static app,
and uploads two artifacts:

- `cloud-atlas-forecast-*`: the generated `public/data/cloud-atlas.forecast` directory
- `penumbra-static-staging-*`: the built `dist` directory containing that forecast sequence

By default, scheduled runs do not publish a public site. To test a live staging URL, either:

- start the workflow manually and set `deploy_pages` to `true`, or
- set repository variable `PENUMBRA_CLOUD_STAGING_DEPLOY=true` so scheduled runs deploy to GitHub Pages

The deploy path is staging-only. It hosts static files; it must not hold canonical musical state.
The browser still derives canonical state from UTC and the shared static artifacts.

## Freshness

Forecast frames are usable while current UTC is between the first and last `validAtUtc`.
After the last frame, PENUMBRA allows a 6 hour hold window. Beyond that window, the forecast
is operationally stale.

Runtime behavior:

- fresh/current sequence: draw the cached cloud shell and linearly interpolate frames by UTC
- hold window: keep the last available frame rather than hard cutting clouds
- stale/future/empty sequence: ignore it and leave the visual cloud layer empty; scanline-local
  cloud values continue to feed audio/rain/debug state

Operational check:

```bash
npm run check:cloud-atlas:ops
```

This fails if the local `manifest.json` is outside the current/hold window. Use it after generation
and in any deployment or cron job that refreshes cloud artifacts.

## Cadence

GFS cycles are produced several times per UTC day. The local builder intentionally waits for a
recent cycle that is likely to have all requested forecast hours available, then builds a short
forecast sequence. A practical production cadence is to regenerate after each available model cycle
and alert when `check:cloud-atlas:ops` fails.

The forecast atlas is visual-first. Its `PRATE` channel may drive rain activity inside the sunrise
Gaussian band, but it does not create a second global playhead and it does not replace scanline-local
weather semantics.

## Failure Modes

- `wgrib2` missing: the GFS precompute command fails explicitly. The browser does not need `wgrib2`.
- NOAA/NODD index or byte-range fetch unavailable: generation fails; keep serving the previous
  manifest only while it is inside the hold window.
- Partial generation: avoided by atomic manifest publish.
- Stale deployed artifact: runtime rejects it and shows no visual cloud layer rather than showing
  old global weather as current. Scanline-local cloud values remain available to audio/rain/debug
  state, but the old dotted visual fallback is intentionally hidden.
