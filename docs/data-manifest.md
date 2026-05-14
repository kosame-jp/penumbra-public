# データマニフェスト

## 1. リアルタイム外部データ

### USGS Earthquake Feed
用途:
- 地震イベント取得
- 81分窓を欠かさないため、runtime の既定 feed は `all_day.geojson`

必要項目:
- id
- magnitude
- depth
- lat/lon
- event time
- updated time
- place

更新:
- 1〜5分ごと poll
- 現行 runtime 初期値は 2分

出力先:
- canonical quake store
- fixture mirror for tests

### Open-Meteo
用途:
- 雲量、湿度、降水、風、温度、気圧

更新:
- 15〜60分
- 走査線が今後通過する地点を先回りキャッシュ
- 現行 runtime は現在の走査線 sample に対応する worldgrid cell を 30分ごとに更新する

出力先:
- weather cache
- canonical weather normalized object

---

## 2. バンドル静的データ

### worldgrid-YYYY.json(.gz)
内容:
- 1°×1° あるいは将来 0.5°×0.5°
- OSM派生
- terrain / bathymetry / land class
- road length, building count, water ratio, forest ratio
- nightlight summary
- global stats / percentiles

想定サイズ:
- 5〜10MB 程度（spec 想定）

現行 seed:
- `public/data/worldgrid.production-seed.json`
- Mapzen Terrain Tiles on AWS の Terrarium PNG から 5° cell の elevation / bathymetry を生成
- NASA GIBS `VIIRS_Night_Lights` layer から 5° cell の nightlight seed を生成
- OpenStreetMap / Overpass API から、夜間光がある非海洋 cell に road / building / forest の sampled density proxy を追加
- OSM 由来の `roadLengthKm` / `buildingCount` は完全な 5° cell 総量ではなく、`0.12°` bbox sample を `1000 km²` 相当へ正規化した mapping proxy
- runtime default はこの production seed を読む。読み込み失敗時は terrain seed、さらに失敗した時のみ tiny fixture へ fallback

中間 seed:
- `public/data/worldgrid.terrain-seed.json`
- terrain / bathymetry のみ。nightlight と human-density fields は 0 placeholder。

視覚確認用 surface seed:
- `public/data/worldgrid.visual-surface-1deg.json`
- renderer の地表テクスチャ専用。canonical audio / scanline / nightlight contact には使わない。
- `surface=canonical` query で正準 worldgrid surface に戻せる。
- 現行 prototype は Mapzen Terrain Tiles on AWS の Terrarium PNG から 1° cell の terrain / bathymetry を生成し、海陸・地形境界の見え方を確認する。

1° contact seed:
- `public/data/worldgrid.contact-1deg.json`
- `worldgrid.visual-surface-1deg.json` に NASA GIBS `VIIRS_Night_Lights` を加えた human contact 用 artifact。
- 現行 runtime はこの artifact が存在すれば human/nightlight contact に使い、Earth layer centerline / weather cache / quake scanline は引き続き 5° production seed を使う。
- 高密度 contact grid でも、nightlight があり sunrise terminator の active reach 内にある contact は候補として保持する。Gaussian weight は候補除外ではなく、音量・contact-local pulse period・pulse emit probability に作用する。
- `contact=canonical` query で従来の 5° contact に戻せる。
- OSM / forest density は未統合なので、1° contact の road / building / forest は現時点では placeholder。

### cloud-atlas.current.json
内容:
- visual-only の昼側雲量 atlas
- 1°×1° を初期目標にする
- 値は `uint8-cloud-cover-pct`、つまり 0-100 の雲量
- GFS 生成 frame では任意で `opticalDensityValues` を持つ。これは `CWAT:entire atmosphere (considered as a single layer)` を 0-100 に正規化した `uint8-cloud-water-density-proxy-pct` で、TCDC が 99-100% に飽和した領域の内部濃淡を visual-only に描くための proxy
- 音響 driver ではなく、地球描写としての大気レイヤーに使う

想定生成:
- NOAA GFS などの gridded model data から、サーバー / cron / build process が1日数回生成する
- ブラウザは point weather API を大量に叩かず、配布済み artifact だけを読む
- 更新は UTC model cycle に合わせる
- 初期実装として `npm run precompute:cloud-atlas:openmeteo` は Open-Meteo の batch current `cloud_cover` を 10° anchor grid で取得し、1° atlas へ bilinear resample する。429 / 5xx は backoff retry する。これは本番 gridded model ingestion へ移るまでの bridge であり、browser runtime から大量取得しないための artifact 生成経路。

現行状態:
- production default は cached forecast cloud sequence を読む
- `?cloud=scanline` は cached atlas を使わず、visual cloud layer を空にする明示 option。scanline-local cloud 値は音響 / debug に残る
- `public/data/fixtures/cloud-atlas.provisional.json` は renderer 確認用 fixture。気象データではない
- `?cloud=fixture` で fixture atlas を表示確認できる
- `?cloud=atlas` は `/data/cloud-atlas.current.json` 確認用。artifact が未生成なら visual cloud layer は空になる。

### cloud-atlas.forecast/manifest.json
内容:
- 昼側雲量 forecast atlas sequence。GFS frame は optional precipitation activity channel も持てる
- `manifest.json` が複数 frame の `url` / `validAtUtc` / `forecastHour` を持つ
- 各 frame は通常の `cloud-atlas` artifact と同じ shape
- ブラウザは現在 UTC に対して前後2枚の frame を選び、shader で `linear-time` 補間する

現行 bridge:
- `npm run precompute:cloud-atlas:forecast-openmeteo`
- Open-Meteo hourly `cloud_cover` を 10° anchor grid で取得し、`f000`, `f003`, `f006`, `f009`, `f012`, `f015` 相当の 1° atlas を生成する
- `?cloud=forecast` で `/data/cloud-atlas.forecast/manifest.json` を読む
- artifact の write / manifest publish / versioned frame retention は `scripts/precompute/cloud-atlas-forecast-artifacts.mjs` に分離する。Open-Meteo bridge と GFS adapter は、最終的に同じ publisher に `values` / optional `opticalDensityValues` / optional `precipitationValues` / `validAtUtc` / source metadata を渡す。
- npm script は `--atomic-publish --retain-generations 8` を使う。各 frame は生成時刻 prefix 付きの versioned URL として先に書き、最後に `manifest.json` を atomic rename で置き換える。これにより、配信中のブラウザが「新 manifest だが frame がまだ未生成」という半端な状態を読みづらくする。古い versioned frame は8世代だけ残し、それ以前は生成完了後に削除する。
- `npm run check:cloud-atlas:forecast` は manifest schema、参照 frame の存在、frame schema、`validAtUtc` の単調増加、manifest / frame の時刻一致、grid shape 一致を検査する。GFS adapter へ差し替える時もこのチェックを通す。
- `npm run check:cloud-atlas:ops` は現在 UTC が forecast sequence の frame span または 9h hold window に入っているかを検査する。`docs/cloud-atlas-operations.md` を運用 runbook とし、stale / future / empty forecast は runtime でも visual cloud layer を空にする。
- `npm run precompute:cloud-atlas:forecast-gfs:0p5:ops` は同じ forecast hours を 0.5° grid で生成する visual resolution experiment。音の mapping / sounding rule は変えないが、同じ artifact に含まれる PRATE channel も 0.5° grid になるため、雨 band の source data density は増える。
- browser runtime は manifest を定期的に再読込し、内容が変わった時は旧 sequence と新 sequence を shader 内で crossfade する。frame 間補間で forecast hour の段差を消し、manifest 更新時の段差も `transitionDurationMinutes` で滑らかにする。
- Open-Meteo bridge は本番 gridded model ingestion へ移るまでの暫定経路。本番 GFS 化では manifest / frame contract を保ち、生成元だけを NOAA GFS などの配布済み gridded artifact に差し替える。
- GFS source planner として `scripts/precompute/gfs-cloud-source.mjs` を追加した。これは NOAA/NODD の `noaa-gfs-bdp-pds` bucket にある `gfs.YYYYMMDD/CC/atmos/gfs.tCCz.pgrb2.0p25.fFFF.idx` を読み、`TCDC:entire atmosphere`, `CWAT:entire atmosphere (considered as a single layer)`, `PRATE:surface` の message を選び、GRIB2 byte range と `validAtUtc` を確定する。`npm run inspect:gfs-cloud-source` はこの plan を確認するためのネットワーク診断。
- `npm run precompute:cloud-atlas:forecast-gfs` は source planner が選んだ byte range だけを取得し、`wgrib2 -no_header -text` で cloud-cover grid、cloud-water grid、precipitation-rate grid を decode する。TCDC は 1° `uint8-cloud-cover-pct` values へ resample し、CWAT は 1° resample 後に上位 percentile を基準に `uint8-cloud-water-density-proxy-pct` へ正規化する。PRATE は mm/hour 相当へ変換して `uint8-precipitation-activity-pct` へ正規化し、runtime では sunrise Gaussian band 内の rain granular / rain visual driver にだけ使う。Runtime 側ではこの PRATE channel から trace rain を直接鳴らさず、強い雨 gate を通った activity だけを rain granular / rain visual に渡す。`wgrib2` がない環境では明示的に失敗する。ブラウザ runtime に `wgrib2` は不要で、これは artifact 生成環境だけの依存。
- Runtime の scale mode selection は、browser-local live weather ではなく、この forecast sequence の `TCDC` / `CWAT` / `PRATE` を現在 UTC で frame 補間した共有値を読む。値は mode 用に 0.05 単位へ量子化され、`CWAT` は relative humidity ではなく atmospheric wetness proxy として扱う。これにより mode は日ごとに変化し得るが、同じ `activeCycleUtc` / `validAtUtc` artifact を読む browser 間では同じ選択になる。現行 artifact は wind / temperature を含まないため、mode selection でもそれらは使わない。
- Runtime production は、fresh/current/hold の forecast sequence がある間、scanline weather sample も同じ共有 artifact から合成する。`TCDC` は `cloudCoverPct`、`CWAT` と TCDC の混合は `relativeHumidityPct` proxy、`PRATE` は `precipitationMm` proxy へ写像する。現行 artifact には実 wind / temperature がないため、`windSpeedMps` は local cloud gradient / wetness / precipitation から作る deterministic texture proxy、`temperatureC` は canonical default を使う。これにより公開 runtime は Open-Meteo point API を各ブラウザから大量に叩かない。Forecast が使えない時、production は Open-Meteo へ自動 fallback せず、canonical default weather samples で継続する。旧 scanline-local Open-Meteo cache は `?weather=live` / `?live-weather=1` の明示 diagnostic 経路としてのみ残る。
- NOMADS の旧 OPeNDAP 形式は 2025 年の service change で retired されているため、本番 GFS path は OPeNDAP ASCII ではなく、AWS/NODD の GRIB2 + index + decoder を前提にする。

### tuning-kernels.json
内容:
- 8 kernel 定義
- family (grid / scale)
- centroid
- sigma
- interval / mode metadata
- provenance notes
- review flag

### terrain source artifacts
v1 方針:
- ランタイムの最小要件は worldgrid に register driver が入っていれば満たせる
- 高解像度メッシュ用 raw / baked terrain は別 artifact に分離してよい

---

## 3. 前処理で計算しておくべき統計

以下はランタイムの mapping を素直にするため、前処理で求めて `stats` に保存する:

- nightlight:
  - min / max / p95 / p99 / p99.5
- roadLengthKm:
  - p95 / p99
- buildingCount:
  - p95 / p99
- waterRatio:
  - min / max
- forestRatio:
  - min / max
- elevation:
  - min / max
- bathymetry:
  - min / max

## 4. ライセンス / 帰属の注意

実装時に必ず `ATTRIBUTIONS.md` と `NOTICE.md` に整理すること。

帰属対象:
- USGS
- Open-Meteo
- NASA / SRTM
- GEBCO
- VIIRS Nightlights
- OpenStreetMap contributors (ODbL)
- Three.js / Tone.js / SunCalc.js / astronomy-engine

## 5. v1 の推奨方針

- 生データは repo に直置きしない
- 生成済み artifact とその build script を分ける
- 小さい fixture を tests 用に持つ
- 本番 artifact の build 手順を再現可能にする

## 6. 実装済みのパイプライン土台（2026-04-30）

### Schema validation

`src/core/static-data/schema-validation.ts` が以下の artifact を JSON Schema で検証する:

- `worldgrid`
- `weather-cache-entry`
- `earthquake-event`
- `scanline-sample`
- `tuning-kernels`

小さい正例 fixture は `tests/fixtures/valid/`、負例 fixture は `tests/fixtures/invalid/` に置く。検証は `tests/unit/schema-validation.test.ts` で実行する。

`scanline-sample` は audio / visual の canonical runtime contract として、地表由来の texture drivers
`waterRatio`, `forestRatio`, `roadDensityNorm`, `buildingDensityNorm` も含む。Human layer はこれらを
同一 abstract pluck family 内の partial color / damping に使い、tuning kernel id から timbre template は作らない。

### Generated artifact loaders

`src/core/static-data/generated-artifact-loaders.ts` は生成済み artifact を schema validation 後に型付き object として返す。fixture / precompute / unit test で artifact contract を厳密に守るための入口。

ブラウザ runtime の `src/core/static-data/worldgrid-loader.ts` は bundle size を抑えるため JSON Schema validator を含めず、worldgrid の必須 shape guard だけを実行する。schema validation は生成・検証工程で済ませ、runtime は artifact が壊れている場合に明示的に fail / fixture fallback する。

### Runtime-safe accessors

`src/core/static-data/canonical-accessors.ts` に、正準 field の安全な取り出しを集約する:

- nightlight normalization reference (`p99_5` -> `p99` -> `max`)
- percentile stats の必須確認
- land/ocean を区別した effective elevation
- weather cache entry から canonical weather sample への変換

### Precompute scripts

初期実装:

- `scripts/precompute/compute-stats.ts`
  - `min / max / p95 / p99 / p99_5` を決定論的に計算
- `scripts/precompute/build-worldgrid.ts`
  - generated cells から `worldgrid` artifact を構築
- `scripts/precompute/build-terrain-worldgrid.mjs`
  - Mapzen/AWS Terrain Tiles の Terrarium PNG から 5° terrain/bathymetry seed を生成
- `npm run precompute:visual-surface-worldgrid`
  - 同じ terrain seed generator を使い、renderer 専用の 1° visual surface artifact を `public/data/worldgrid.visual-surface-1deg.json` に生成
- `npm run precompute:contact-worldgrid:1deg`
  - 1° visual surface artifact に VIIRS nightlight を追加し、human contact 用の `public/data/worldgrid.contact-1deg.json` を生成
- `scripts/precompute/enrich-worldgrid-nightlights.mjs`
  - NASA GIBS `VIIRS_Night_Lights` の WMTS PNG から 5° nightlight seed を生成
  - 3x3 per-cell luminance sample を平均する seed 実装。sample spread は artifact の `cellSizeDegrees` に従う。値は calibrated radiance ではなく visualization brightness として扱う。
- `scripts/precompute/enrich-worldgrid-osm-overpass.mjs`
  - OpenStreetMap contributors の Overpass API response から、夜間光がある非海洋 cell に road / building / forest sampled density proxy を追加
  - `npm run precompute:osm-density-worldgrid` は `sample-grid 1`, `sample-radius-deg 0.12`, `density-reference-area-km2 1000` を使う
  - 生 OSM planet extract ではなく、PENUMBRA の audio / visual mapping 用の再現可能な seed。完全な cell 総量ではないことを artifact provenance に明記する。
- `npm run precompute:worldgrid:base` は terrain + nightlight まで、`npm run precompute:worldgrid` は OSM sampled density まで含む。
- `scripts/precompute/build-kernels.ts`
  - tuning kernel artifact の provenance / review flag を保持して検査

### Future raw-source ingestion

本番 ingest は以下の順で実装する:

1. raw source は `data/raw/` または外部 download cache に置き、app bundle へ直置きしない。
2. 各 source adapter は source 固有の形を読むだけにし、canonical field への変換は precompute 層で行う。
3. 生成物は `public/data/` に `worldgrid-YYYY.json(.gz)`、`tuning-kernels.json`、必要なら terrain index として出力する。
4. 生成時に percentile stats を artifact 内へ保存する。
5. schema validation を通った artifact のみ runtime loader が読む。
6. tuning kernel は provisional / reviewed / final を明示し、provenance と review flag を消さない。

## 7. Runtime live-data integration（2026-04-30）

`src/app/live-data-runtime.ts` がブラウザ内で以下を行う:

- 起動時に bundled earthquake fixture を quake store へ seed する。
- その後、USGS `all_day.geojson` を 2分間隔で poll し、magnitude threshold をかけずに merge する。
- quake store は 81分窓 + 9分 margin を過ぎた event を stale eviction する。
- 明示 diagnostic の Open-Meteo は現在の sunrise terminator 上の緯度 sample から最寄り worldgrid cell を求め、その cell だけを 30分間隔で cache する。
- weather API が失敗した cell は canonical fusion 側で `DEFAULT_WEATHER_SAMPLE` に戻る。API 失敗は音響・視覚・時刻進行を止めない。
- external API から得た値も bundled fixture と同じ `createCanonicalScanlineSamples` の入力に入り、audio / visual は同じ canonical sample object を読む。
- Nightlight は中心線 sample に加えて sunrise terminator の Gaussian band 内にある bundled worldgrid cell から contact sample を追加する。これにより human musical layer は中心線一点ではなく、現在は `sigma = 7°` の到来 / 通過 / 離脱として動く。

未実装として残るもの:

- 走査線の先読み weather cache。現状は現在走査線の local cache まで。
- OSM / forest coverage は sampled density proxy として `public/data/worldgrid.production-seed.json` に入った。full planet extract に基づく完全な 5° cell 集計は未実装。
- `ATTRIBUTIONS.md` / `NOTICE.md` は作成済み。ただし本番 static data artifact を取り込む時点で、正確な source version / download date / upstream license bundle を追記する。
