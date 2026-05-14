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

The default GFS build publishes `f000`, `f003`, `f006`, `f009`, `f012`, and `f015` frames at 1 degree.
The experimental `0p5` build publishes the same forecast hours at 0.5 degree. Both write versioned frame
URLs first, then atomically replace `manifest.json`. Eight prior generations are retained so
browsers holding the previous manifest can still resolve its frames.

## Production Cron

The repository includes a GitHub Actions forecast workflow:

```text
.github/workflows/cloud-forecast-staging.yml
```

It runs four times per UTC day after the expected GFS public availability window and can also be
started manually from `workflow_dispatch`. The scheduled job uses the current 0.5 degree GFS artifact
route:

```bash
npm run precompute:cloud-atlas:forecast-gfs:0p5:ops
```

The workflow installs `wgrib2` from conda-forge via micromamba, inspects the selected GFS source,
generates the forecast sequence, validates schema and operational freshness, publishes the forecast
sequence to Cloudflare R2 when configured, builds the static app, and uploads two artifacts:

- `cloud-atlas-forecast-*`: the generated `public/data/cloud-atlas.forecast` directory
- `penumbra-static-staging-*`: the built `dist` directory containing that forecast sequence

R2 is the preferred production path. The browser still reads a static `manifest.json` and versioned
frame JSON files, but those forecast files are no longer committed to Git history on every cycle.
The Git commit path remains available only as a fallback by setting `commit_forecast=true` manually
or repository variable `PENUMBRA_CLOUD_COMMIT_FORECAST=true`. Scheduled runs keep using the Git
commit fallback until `PENUMBRA_CLOUD_R2_ENABLED=true` is set, so the deployed app does not go stale
while R2 is being configured.

Manual runs expose two operational switches:

- `publish_r2`: default `true`; upload the generated artifact to Cloudflare R2
- `commit_forecast`: default `false`; commit the generated artifact back to `main`
- `deploy_pages`: default `false`; optional GitHub Pages staging artifact deployment

To test a live GitHub Pages staging URL, either start the workflow manually and set `deploy_pages` to
`true`, or set repository variable `PENUMBRA_CLOUD_STAGING_DEPLOY=true` so scheduled runs deploy to
GitHub Pages.

The deploy paths host static files; they must not hold canonical musical state. The browser still
derives canonical state from UTC and the shared static artifacts.

## Cloudflare R2 Publishing

Production forecast artifacts should be published to a public R2 bucket or R2 custom domain. Use
Cloudflare R2 Standard storage, not Infrequent Access. The current 0.5 degree GFS sequence is about
11-12 MB per generated forecast generation. The precompute script retains eight versioned generations
locally; the workflow stages only `manifest.json` plus versioned `YYYYMMDDTHHMMSSZ-fNNN.json` frames
and runs `aws s3 sync --delete`, so old R2 objects are removed automatically. Manual cleanup should
not be necessary.

Recommended object path:

```text
data/cloud-atlas.forecast/manifest.json
data/cloud-atlas.forecast/YYYYMMDDTHHMMSSZ-f000.json
data/cloud-atlas.forecast/YYYYMMDDTHHMMSSZ-f003.json
data/cloud-atlas.forecast/YYYYMMDDTHHMMSSZ-f006.json
data/cloud-atlas.forecast/YYYYMMDDTHHMMSSZ-f009.json
data/cloud-atlas.forecast/YYYYMMDDTHHMMSSZ-f012.json
data/cloud-atlas.forecast/YYYYMMDDTHHMMSSZ-f015.json
```

Repository variables:

```text
PENUMBRA_CLOUD_R2_ENABLED=true
PENUMBRA_CLOUD_R2_BUCKET=<bucket name>
PENUMBRA_CLOUD_R2_PREFIX=data/cloud-atlas.forecast
PENUMBRA_CLOUD_R2_RETAIN_GENERATIONS=8
```

Repository secrets:

```text
CLOUDFLARE_ACCOUNT_ID=<Cloudflare account id>
CLOUDFLARE_R2_ACCESS_KEY_ID=<R2 API token access key id>
CLOUDFLARE_R2_SECRET_ACCESS_KEY=<R2 API token secret access key>
```

Vercel production environment variable:

```text
VITE_PENUMBRA_CLOUD_FORECAST_MANIFEST_URL=https://<r2-public-host>/data/cloud-atlas.forecast/manifest.json
```

If the R2 public host is not same-origin with `penumbra.kosame.work`, configure the R2 bucket CORS
policy to allow `GET` from the production origin and the Vercel preview origin used for verification.
The app falls back to `/data/cloud-atlas.forecast/manifest.json` when the Vite environment variable
is absent.

## Freshness

Forecast frames are usable while current UTC is between the first and last `validAtUtc`.
After the last frame, PENUMBRA allows a 9 hour hold window. Beyond that window, the forecast
is operationally stale.

Runtime behavior:

- fresh/current sequence: draw the cached cloud shell and linearly interpolate frames by UTC
- hold window: keep the last available frame rather than hard cutting clouds
- stale/future/empty sequence: ignore it and leave the visual cloud layer empty; scanline weather
  uses bundled canonical defaults until a fresh forecast is available
- fresh/current/hold sequence: production derives scanline weather samples from the shared GFS
  forecast artifact instead of fanning out browser-local Open-Meteo requests. `TCDC` feeds cloud
  cover, `CWAT` feeds an atmospheric wetness / humidity proxy, and `PRATE` feeds precipitation
  activity. The current artifact does not carry true wind or temperature, so wind is a deterministic
  cloud-gradient texture proxy and temperature remains canonical default. This keeps browser
  instances sharing the same artifact aligned and avoids public runtime 429s from point weather APIs.
- explicit `?weather=live` or `?live-weather=1`: enable the legacy scanline-local Open-Meteo cache
  for diagnostics only. Do not use this in public production because every browser instance fans out
  point requests.

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
  old global weather as current. Production does not call Open-Meteo by default; scanline weather
  uses canonical defaults until the next fresh forecast artifact arrives.
