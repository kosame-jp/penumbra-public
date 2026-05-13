# NOTICE

PENUMBRA — Earth Sequencer
Copyright (c) 2026 kosame

PENUMBRA is licensed under the GNU Affero General Public License v3.0. See
`LICENSE` for the full license text.

This notice summarizes third-party software used by the browser application,
development tooling, tests, and smoke checks. It is not a substitute for the
full upstream license texts distributed by each dependency.

## Runtime Dependencies

| Package | Version | License | Purpose |
|---|---:|---|---|
| Three.js | 0.184.0 | MIT | WebGL / Three.js visual rendering |
| Tone.js | 15.1.22 | MIT | Web Audio synthesis support |
| SunCalc | 1.9.0 | BSD-2-Clause-style license in upstream `LICENSE` | Solar position helper |
| astronomy-engine | 2.1.19 | MIT | Astronomy calculations |
| Ajv | 8.20.0 | MIT | JSON Schema validation |
| ajv-formats | 3.0.1 | MIT | JSON Schema format validation |
| Cormorant SC Regular / Medium Latin subsets | v19 | SIL Open Font License 1.1 | Stream-mode wordmark typography |

## Development And Verification Dependencies

| Package | Version | License | Purpose |
|---|---:|---|---|
| Vite | 6.4.2 | MIT | Development server and production build |
| TypeScript | 5.9.3 | Apache-2.0 | Type checking |
| ESLint | 9.38.0 | MIT | Linting |
| typescript-eslint | 8.55.0 | MIT | TypeScript lint integration |
| Vitest | 4.1.5 | MIT | Unit tests |
| Playwright Core | 1.59.1 | Apache-2.0 | Browser smoke checks |
| `@eslint/js` | 9.38.0 | MIT | ESLint JavaScript rules |
| `@types/node` | 20.19.39 | MIT | Node.js TypeScript types |
| `@types/suncalc` | 1.9.2 | MIT | SunCalc TypeScript types |
| `@types/three` | 0.184.0 | MIT | Three.js TypeScript types |

## Legal Placeholder Status

- Exact bundled license text extraction for each dependency is still a release
  packaging task before public distribution.
- Current static seed data includes generated terrain/bathymetry, VIIRS nightlight
  brightness, and sampled OpenStreetMap density proxies. Exact upstream license
  bundle packaging remains a release task; current source notes live in
  `ATTRIBUTIONS.md`.
