# ATTRIBUTIONS

PENUMBRA uses real-world data and open-source software to sound the sunrise
terminator as a browser-native earth sequencer. This document records attribution
requirements and the current implementation status.

PENUMBRA is an artistic work. It is not a disaster monitoring service, warning
system, map product, or public-safety information source.

## Live Data Sources

| Source | Current Use | Runtime Status | Attribution / Notes |
|---|---|---|---|
| USGS Earthquake Hazards Program | Earthquake event id, magnitude, depth, latitude, longitude, event time, update time, and place | Live browser runtime, using the all-day GeoJSON feed so PENUMBRA's 81-minute window is not truncated | Credit the United States Geological Survey. Earthquake data is used only as artistic input; PENUMBRA does not warn, predict, or monitor disasters. |
| NOAA Global Forecast System (GFS) | Total cloud cover, cloud water, and surface precipitation-rate forecast artifacts | GitHub Actions precompute + Cloudflare R2 distribution | Credit NOAA/NCEP/NODD. Forecast artifacts drive visual clouds, rain activity, shared atmosphere, and production weather texture proxies. |
| Open-Meteo | Current cloud cover, humidity, wind, precipitation, temperature, and pressure for scanline-local cells | Browser fallback when the shared GFS forecast artifact is unavailable | Credit Open-Meteo. Fallback weather data is used as local texture/filter input, not as forecast presentation. |
| Mapzen Terrain Tiles on AWS | Terrain and bathymetry seed worldgrid | Generated static artifact at `public/data/worldgrid.terrain-seed.json`, then enriched into `public/data/worldgrid.production-seed.json` | Terrain Tiles was accessed on 2026-04-30 from https://registry.opendata.aws/terrain-tiles/. This seed covers elevation/bathymetry. |
| NASA GIBS `VIIRS_Night_Lights` | Nighttime-light seed for human musical layer activation | Generated static artifact at `public/data/worldgrid.production-seed.json` | `VIIRS_Night_Lights` 2016-01-01 tiles were accessed on 2026-04-30 from https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/VIIRS_Night_Lights.json. The current seed uses 3x3 per-cell luminance samples of the rendered WMTS layer as visualization brightness, not calibrated radiance. |
| OpenStreetMap contributors via Overpass API | Sampled road, building, and forest density proxies for human-layer surface texture drivers | Generated static artifact at `public/data/worldgrid.production-seed.json` | OSM sampled density was accessed on 2026-05-01 through the Overpass API. The current seed samples nightlight-bearing non-ocean 5° cells with a 0.12° bbox and normalizes road/building density to a 1000 km² reference area. These values are mapping proxies, not complete 5° cell totals. Attribution: © OpenStreetMap contributors. License: ODbL 1.0. |

## Static Data Sources Planned For Production Worldgrid

The current app ships a generated terrain/bathymetry seed plus tiny fixtures for
tests. The following sources are still planned for the production static
worldgrid and must receive exact source version, download date, processing notes,
and license confirmation when imported.

| Source | Intended Use | Current Status |
|---|---|---|
| NASA SRTM or compatible elevation source | Land elevation for register mapping and terrain classification | Partially represented through Mapzen/AWS Terrain Tiles seed; direct source-specific ingest remains pending |
| GEBCO or compatible bathymetry source | Ocean bathymetry for deep-ocean register mapping | Partially represented through Mapzen/AWS Terrain Tiles seed; direct source-specific ingest remains pending |
| Calibrated VIIRS / Black Marble radiance product, if replacing the current seed | Human activity proxy for tonal layer activation with calibrated radiance values | Current production seed uses NASA GIBS rendered `VIIRS_Night_Lights` brightness; direct radiance ingest remains optional future work |
| NASA Blue Marble or alternative Earth imagery | Optional base imagery if used in future visual passes | Placeholder; current renderer is procedural and does not depend on a Blue Marble texture. |

## Bundled Project Fixtures

The fixture artifacts under `public/data/fixtures/`, `samples/`, and
`tests/fixtures/` are small project-authored examples for implementation and
test coverage. They are not production global datasets.

## Bundled Fonts

| Font | Current Use | Attribution / Notes |
|---|---|---|
| Cormorant SC Regular / Medium Latin subsets | `?stream` lower-center wordmark | Designed by Christian Thalmann / Catharsis Fonts. The bundled Latin subsets are served from `public/fonts/cormorant-sc-regular-latin.woff2` and `public/fonts/cormorant-sc-medium-latin.woff2` under the SIL Open Font License 1.1. |

## Tuning Kernels

The tuning-kernel artifact is reviewable project data. Several kernels are
marked provisional and review-required in `public/data/tuning-kernels.json`.
They define pitch permission only. They do not imply instrumental timbre,
ritual practice, cultural sampling, or a complete representation of any music
tradition.

## Software

Third-party software dependencies are listed in `NOTICE.md`.
