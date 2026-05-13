# PENUMBRA Runtime Fallbacks

PENUMBRA should fail explicitly. Fallbacks are allowed only when they preserve the
canonical UTC structure or clearly mark that the runtime is degraded.

## Status Surface

The browser runtime keeps a small fallback status list. The status panel appears
only while a fallback is active. Demo states can be forced without breaking data
loads:

```text
?fallback-demo=cloud
?fallback-demo=clock
?fallback-demo=audio
?fallback-demo=cloud,audio
?fallback-demo=all
```

Demo states are marked as `DEMO` and remain visible even if the real subsystem is
healthy.

## Current Fallback Classes

- `cloud-forecast-unavailable`: cached GFS cloud forecast is missing, stale, or
  rejected. Cloud shell, forecast rain field, and cloud-derived tuning use
  fallback inputs. Audio continues for now, but the status is visible.
- `live-weather-fallback`: a substantial part of a live weather sweep failed, or
  every requested weather cell failed. Isolated request failures remain in
  diagnostics only, because one or two missing cells do not materially degrade
  the scanline. The affected cells use the canonical default weather sample.
- `live-quake-fallback`: the live USGS quake request failed. Retained 81-minute
  quake state continues; new quake fetches are paused until recovery.
- `contact-grid-unavailable`: the 1 degree contact grid is unavailable. Human
  contact audio is paused because falling back to a coarser contact field would
  alter the canonical musical surface.
- `visual-surface-grid-unavailable`: the 1 degree visual surface is unavailable.
  The visual layer uses the canonical grid surface; audio is not paused.
- `worldgrid-production-fallback` / `worldgrid-fixture-fallback`: the production
  grid was replaced by a seed or fixture grid. Audio is paused because the
  canonical data contract is not intact.
- `canonical-clock-local-fallback`: the same-origin `GET /__penumbra-time`
  millisecond UTC probe failed, and the HTTP `Date` fallback could not provide a
  usable sample. The work continues from the browser's UTC clock, but separate
  devices may drift until the server clock probe recovers.
- `human-worklet-unavailable` / `earth-texture-worklet-unavailable`: the browser
  cannot run the required AudioWorklet. Audio is paused instead of falling back to
  a different sound engine.
- `shared-reverb-unavailable`: shared Tone.js reverb failed. Affected layers
  continue dry and the status remains visible.

## Audio Gating

Statuses with `audio-muted` or `fatal` severity disable the `Start audio` button
and show `Audio paused`. This avoids silently sounding a non-canonical fallback.
Cloud and live-data fallbacks currently remain degraded-but-audible so they can
be evaluated in production context.
