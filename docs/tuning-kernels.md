# PENUMBRA Tuning Kernel Asset

`public/data/tuning-kernels.json` is the first reviewable tuning-kernel artifact for PENUMBRA. It keeps the exact eight-kernel topology from the design spec and keeps the split between `grid` kernels and `scale` kernels.

## Philosophical Boundary

The asset does not make PENUMBRA a world-music emulator.

- Kernels define pitch-permission structures only.
- Kernels do not define timbre, instrumentation, repertoire, religion, nation, or emotional meaning.
- Timbral identity remains driven by Earth data such as terrain, weather, nightlight, cloud cover, and humidity.
- Provisional kernels are explicitly marked with `reviewRequired: true`.

## Direct Formal Abstractions

These entries are treated as direct formal abstractions because their interval structures are represented as simple 12-TET pitch sets or a well-defined formal grid:

- `12tet`
- `church_modes`
- `east_asia_pentatonic`

`east_asia_pentatonic` is also an author-position decision from the spec. It is not presented as more important than other traditions; it is separated because the author can speak from that position honestly.

## Provisional Review-Required Abstractions

These entries remain intentionally provisional:

- `maqam`
- `indian`
- `slendro_pelog`
- `west_african_blues`
- `andean_pentatonic`

Their mode names are orientation labels for implementation review, not authenticity claims. Human review should happen before any public language describes them more strongly than "abstract grid" or "abstract subset."

## Kernel Notes

| id | family | topology | status | review |
|---|---|---|---|---|
| `12tet` | grid | `(48N, 15E), sigma 4000km` | reviewed | no |
| `maqam` | grid | `(33N, 38E), sigma 2500km` | provisional | yes |
| `indian` | grid | `(23N, 80E), sigma 2000km` | provisional | yes |
| `slendro_pelog` | grid | `(5S, 112E), sigma 1500km` | provisional | yes |
| `east_asia_pentatonic` | scale | `(35N, 122E), sigma 2500km` | reviewed | no |
| `church_modes` | scale | `(57N, 17E), sigma 3500km` | reviewed | no |
| `west_african_blues` | scale | `(12N, 0E), sigma 3000km` | provisional | yes |
| `andean_pentatonic` | scale | `(15S, 72W), sigma 1500km` | provisional | yes |

## Runtime Use

The runtime keeps `grid` and `scale` separate.

- `grid` kernels provide the underlying pitch grid through `intervalCents`.
- `scale` kernels provide the pitch-permission shape through a deterministic selected mode.
- Human contact pitch permission projects the dominant scale intervals onto the nearest intervals of the dominant grid.
- The resulting intervals are interpreted relative to the current Earth drone root, not fixed C.
- Kernel selection does not create timbre templates. Timbre remains derived from terrain, weather, surface, and human-presence topology.

Scale mode selection is contact-local and deterministic. It uses `cellId`, UTC week / season, local nightlight topology, terrain / surface values, weather, and built-density proxies. Dense or open/hard/windy cells lean toward denser mode choices; isolated, wet, forested, humid, or cloudy cells lean toward sparser mode choices. Stable hash is used only as a small tie-breaker so browsers sharing the same UTC and artifacts choose the same mode.

## Review Rules

Before changing this asset:

1. Keep all eight geographic centers and sigma values unless the design spec changes.
2. Preserve `family` values; do not collapse grid and scale kernels.
3. Keep `notes` and `provenance` populated.
4. Keep `reviewRequired: true` for culturally sensitive provisional abstractions.
5. Do not add kernel-specific timbre instructions.
