# Deployment Notes

PENUMBRA has one canonical browser application. `?stream` is an operational mode
for capture machines, not a separate artwork.

## Canonical Browser App

Build:

```bash
npm install
npm run build
```

Deploy the generated `dist/` directory to a static host. The host may serve
files, but it must not hold canonical musical state. The running browser derives
canonical state from UTC time and local deterministic calculations, then reads
shared static forecast artifacts and live earthquake data from the browser runtime.

Required static paths:

- `/data/tuning-kernels.json`
- `/data/worldgrid.production-seed.json`
- `/data/worldgrid.terrain-seed.json`
- `/data/fixtures/worldgrid.sample.json` as worldgrid fallback
- `/data/fixtures/earthquakes.sample.json` as startup/fallback seed
- `/live-safety.txt`
- `/youtube-metadata.md`

External runtime sources:

- USGS all-day GeoJSON feed for earthquakes
- NOAA GFS cloud forecast artifact, preferably published at
  `VITE_PENUMBRA_CLOUD_FORECAST_MANIFEST_URL`
- Open-Meteo current weather only as an explicit diagnostic scanline-local
  fallback via `?weather=live` or `?live-weather=1`

Static generated sources:

- Mapzen/AWS Terrain Tiles seed for elevation and bathymetry
- NASA GIBS `VIIRS_Night_Lights` seed for nighttime-light activation

If external APIs fail, PENUMBRA should continue from fixture/default data. The
app should not present the failure as public-safety information.

## Stream Machine

Use the same deployed application with `?stream`:

```text
https://penumbra.app/?stream
```

Operational expectations:

- open the canonical app in a browser suitable for capture
- click `Start audio` once to satisfy browser audio/fullscreen gesture rules
- capture the browser window or fullscreen output in streaming software
- keep the YouTube category as Music, not News
- include the safety block from `copy/live-safety-copy.md` in the stream description

`?stream` changes only capture behavior:

- target frame rate is capped at 30fps
- cursor is hidden
- fullscreen is requested from a user gesture
- render heartbeat and runtime-error recovery are enabled
- scheduled refresh is enabled for long captures

## Pre-Release Checks

Run:

```bash
npm run lint
npm run typecheck
npm run validate:fixtures
npm run test
npm run build
npm run check:visual
npm run check:perf
```

Manual checks:

- production HUD shows only UTC and scanline longitude
- `?debug` is the only mode with diagnostics
- `?stream` shows the same visual work as canonical mode
- audio starts after a user gesture
- safety copy is present in the stream description and public asset
- `ATTRIBUTIONS.md` and `NOTICE.md` are current for the shipped artifacts
