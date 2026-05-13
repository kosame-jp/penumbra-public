# PENUMBRA — Earth Sequencer

PENUMBRA is a browser-native earth sequencer. The sunrise terminator is the only planetary playhead, and the work runs from UTC canonical time.

The scanline turns terrain, bathymetry, weather, night lights, and recent earthquakes into a continuous audiovisual system. The browser holds the canonical musical state; a server may host static files and cached forecast artifacts, but it does not conduct the piece.

## What Runs

- A Three.js globe with UTC day/night geometry.
- Cached cloud forecast rendering for the daytime atmosphere layer.
- Night-side human presence lights and scanline-triggered human tonal events.
- Earth texture layers: drone, wind, water, and rain-derived granular events.
- Earthquake percussion within the canonical 81-minute window.
- Minimal production UI, stream mode, capture mode, and debug/tuning modes.

PENUMBRA is not a disaster monitoring service. It does not warn, mourn, or celebrate events. It continues as a generative musical work.

## Setup

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

Useful local modes:

```text
http://127.0.0.1:5174/
http://127.0.0.1:5174/?debug
http://127.0.0.1:5174/?stream
http://127.0.0.1:5174/?capture
http://127.0.0.1:5174/?capture&scene=blue-earth-01-18z
http://127.0.0.1:5174/?debug&tune=audio
```

For LAN device testing, use HTTPS so AudioWorklet paths run in a secure context:

```bash
npm run dev:https
```

The local development certificate lives under `.cert/` and is intentionally not tracked.

## Build And Verify

```bash
npm run lint
npm run typecheck
npm run validate:fixtures
npm run test
npm run build
npm run check:cloud-atlas:forecast
```

The app is deployed as static browser assets. The canonical work remains UTC-driven in the client.

## Cached Forecasts

PENUMBRA uses a cached cloud forecast artifact under:

```text
public/data/cloud-atlas.forecast/
```

The included GitHub Actions workflow can refresh this artifact on a schedule. The app can continue from fallback data when a forecast artifact is stale or temporarily unavailable, but the preferred public deployment should keep this forecast cache current.

See [Cloud Atlas Operations](docs/cloud-atlas-operations.md) and [Runtime Fallbacks](docs/runtime-fallbacks.md).

## Public Documentation

- [PENUMBRA について](docs/PENUMBRA-about-ja.md)
- [PENUMBRA About](docs/PENUMBRA-about-en.md)
- [Site Specification](docs/PENUMBRA-site-spec-ja.md)
- [Deployment Notes](docs/deployment.md)
- [Stream and Safety Notes](docs/stream-and-safety.md)
- [Canonical Mapping Table](docs/canonical-mapping-table.md)
- [Data Manifest](docs/data-manifest.md)
- [Visual Engine Notes](docs/visual-engine.md)
- [Tuning Kernel Notes](docs/tuning-kernels.md)
- [Attributions](ATTRIBUTIONS.md)
- [Notice](NOTICE.md)

Safety language for streams:

```text
PENUMBRA will continue without you.
You are more important than this stream.
```

## License

```text
PENUMBRA — Earth Sequencer
Copyright (c) 2026 kosame
Licensed under AGPL-3.0
```

See [LICENSE](LICENSE).
