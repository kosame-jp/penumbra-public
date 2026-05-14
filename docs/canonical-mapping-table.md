# PENUMBRA 正準マッピング表

この表は「元 spec の思想を、実装可能なルールに落とした」ものです。  
`初期実装案` は v1 の出発点であり、耳・視覚・負荷試験で微調整してよいですが、方向は変えないでください。

## 1. 走査線

### 1.1 経度オフセット重み
- 対象: 走査線中心経度との差
- ルール: Gaussian
- 式:
  - `weight = exp(-(offsetDeg^2) / (2 * sigmaDeg^2))`
- 現在値:
  - `sigmaDeg = 7`
  - 実用 band = `±21°`
- テスト:
  - `offset=0 -> weight=1`
  - `offset=7 -> 約0.607`
  - `offset=21 -> 約0.011`

実装メモ:
- `createCanonicalScanlineSamples` は sunrise terminator の中心線 sample を保持し、各中心線 sample の `scanlineWeight` は `1` とする。
- 中心線 sample は Earth layer と quake contact の基準であり、疎な fixture worldgrid でも中心線そのものが無音にならない。
- 夜間光は中心線だけでなく、同じ sunrise terminator に対する `±3 sigma` の Gaussian band 内にある worldgrid cell を scanline contact として追加する。
- 追加された nightlight contact sample は `scanlineWeight = exp(-(offsetDeg^2) / (2 * sigmaDeg^2))` を持ち、human musical layer の gain に使われる。Earth layer は中心線 sample だけから導く。
- 1° contact grid が利用可能な場合、nightlight contact は 1° artifact から追加される。中心線 Earth / quake / weather cache は現段階では 5° production seed を維持する。
- 2026-05-05 の 1° contact grid 導入後、Gaussian sigma は初期 15° から 10° へ狭めた。2026-05-06 にさらに 7° へ狭めた。高密度 contact で発音契機は保ちつつ、半影帯の外側で鳴っているように感じる範囲を減らすための聴感調整である。
- 高密度 contact grid でも、nightlight があり sunrise terminator の active reach 内にある contact は候補として保持する。Gaussian weight は候補除外ではなく、音量・contact-local pulse period・pulse emit probability に作用する。
- 現行実装では地震 contact 判定、nightlight contact、visual terminator softness がこの幅を参照する。
- 音響側では、中心線 sample 群の `scanlineWeight` が Earth layer の存在量を決める。雲量は Earth layer を無音化せず、高域の鈍さと texture の質感として効く。

### 1.2 緯度サンプル
- 初期: `-90° .. +90°` を 5° 刻み
- サンプル数: 37
- 将来拡張:
  - 2° / 1°
  - 高密度地域のみ adaptive も可
- v1 では均一サンプリングから始める

## 2. 標高 / 海洋深度 → register

### 2.1 推奨アンカー
下のアンカー間を piecewise linear interpolation する:

| elevationM | registerMidi | 音域目安 |
|---:|---:|---|
| -10994 | 24 | C1 |
| -4000  | 36 | C2 |
| 0      | 48 | C3 |
| 500    | 60 | C4 |
| 2000   | 72 | C5 |
| 4000   | 84 | C6 |
| 8849   | 96 | C7 |

### 2.2 実装メモ
- `effectiveElevationM = land ? elevationM : bathymetryM`
- bathymetry は負値
- アンカー外は clamp
- 出力は midi でも Hz でもよいが、**同じ canonical function** から両方導く

## 3. 夜間光 → 楽音音量

### 3.1 方向性
- 線形ではなく対数的
- 飽和のためではなく、データ分布に従うため

### 3.2 推奨実装
生データを前処理で percentile 正規化する:

- `nightLightP99_5` を worldgrid stats に保存
- 実行時:
  - `norm = clamp(log1p(value) / log1p(p99_5), 0, 1)`

### 3.3 使い方
- `norm == 0` -> 楽音レイヤー停止
- `norm > 0` -> 楽音音量に使用
- Audio gain, event density, brightness への二次利用は可だが、**すべて主従関係を明記**

現行 audio 実装:
- `core/audio/audio-params.ts` は active music sample の `gain01` から human musical layer の gain を導く。
- Nightlight contact は sunrise terminator の Gaussian band 内で追加される。音量は `nightLightNorm * scanlineWeight` なので、都市が走査線に近づき、通過し、離れる動きとして立ち上がる。
- `core/fusion/human-voice-candidates.ts` は active music sample を deterministic な voice candidate として選び、初期値では最大 12 voices に cap する。
- `core/fusion/human-pulse-scheduler.ts` は selected voice ごとの stable period / phase に、UTC day / season / 3x3 nightlight topology 由来の deterministic timing variance を加える。これは contact 内部の pulse scheduling であり、新しい global playhead ではない。2026-05-09 の同期調整で、browser ごとの微小な weather cache / scanline weight / pitch 計算差が別 rhythm へ広がらないよう、`frequencyHz`, frame-local weather, current `scanlineWeight`, `gain01` は pulse clock の period / phase / jitter から外し、音量・音色・emit probability 側に残した。
- 1° contact grid で候補数が増えた場合、すべての候補を固定 cap で捨てるのではなく、ensemble density から contact-local pulse clock 全体の period を穏やかに伸ばす。現在は 5° grid の実測 contact 数に近い `72` を基準に、`candidateCount / 72` の 32% だけを共通 period scale とする。さらに密集時は human pulse scheduler 内部の effective focus sigma だけを 7° から最小 4° へ狭める。外側の contact は Gaussian によって gain が下がり、pulse emit probability が低くなる。2026-05-09 の iPhone 負荷調整では、同期済みの pulse clock は維持したまま、emit probability のみを中心寄せにした。過密 field では中心付近の上限も 0.82 に抑え、外側は `focusedScanlineWeight^2.75` と最小 0.03 まで薄くする。これにより、走査線近傍の contact は発音契機を保ちつつ、AudioWorklet の同時発音数が 5° grid 時代に近づく。
- `core/audio/human-pluck-params.ts` と `core/audio/engine.ts` は selected voices / candidates を、短い noise burst と sine partials による abstract resonant pluck として鳴らす。trigger は contact-local pulse crossing に基づき、Start Audio 直後や contact arrival そのものでは鳴らさない。
- AudioWorklet が利用可能な場合、human layer は `public/worklets/human-layer-processor.js` の単一 polyphonic synth node で鳴る。Worklet path では `music.candidates` 全体を pulse 対象にし、node fallback では現行の selected voices cap を使う。Worklet 内部の transient noise / partial initial phase seed は AudioContext start sample ではなく、contact id + scheduled UTC + pulse index から渡す。
- `core/visual/renderer.ts` も同じ pulse scheduler を使い、production の nightlight glow を発音 contact の envelope として短く反応させる。AudioWorklet path と揃えるため、visual pulse も `music.candidates` 全体を対象にする。これは debug meter UI ではなく、地表上の contact 自体の analyzer 的反応である。
- 常時の nightlight visual は音の候補化から切り離し、`contactWorldGrid` の nightlight cell 全体を human presence field として描く。ただし表示は太陽方向から見た夜側だけに制限し、昼側では常時 glow を消す。Gaussian はこの常時表示には使わない。
- 1° contact grid のように nightlight contact が高密度になる場合、production の human presence glow は表示中の contact 数に応じて alpha / size を下げる。これは音の候補を間引く処理ではなく、加算描画が地表と明暗境界を覆い隠さないための視覚 density compensation である。音の contact 候補化そのものは Gaussian active reach と nightlight presence に従う。
- 高密度 contact grid の runtime では、nightlight 値を持つ cell だけを cache して走査する。これは候補選定結果を変えるためではなく、1° grid の 64,800 cell 全走査を毎フレーム避けるための実装上の最適化である。
- Human layer の `frequencyHz` は contact ごとの elevation / bathymetry register を保持したまま、発音 target だけを +7 semitones 持ち上げ、現在の Earth drone root を key center として pitch permission を選ぶ。Earth drone root は sunrise terminator 中心線 sample 群の Earth register 平均から 1 octave 下げた値であり、緯度や経度の情緒的 mapping ではない。
- Human pluck timbre は同一 abstract pluck family 内で、surface hardness / openness / water / forest / road / building / weather によって wood/body と metal/air の material morph, partial presence, per-partial decay, damping, transient noise が変わる。canonical Human pluck は最大4 partial とし、湿度 / 雲 / 森林 / 水が強い contact は基音中心に寄り、硬い地表 / 開けた地形 / built texture / wind が強い contact は第2〜第4 partial が開く。加えて、contact grid 上の 3x3 nightlight topology を runtime で読み、周囲に灯りが少ない孤立 contact は実際に partial 配列を 1〜2 本へ減らし、連続した灯りや edge を持つ contact は上位 partial を保持する。これは人口密度を文化的音色へ割り当てる処理ではなく、human presence field の局所形状から基音中心 / 多倍音の差を作る処理である。音律核や地域ラベルで音色を固定しない。
- 現行 production seed の road / building / forest は OpenStreetMap sampled density proxy。完全な 5° cell 総量ではなく、夜間光がある非海洋 cell の小 bbox sample を 1000 km² 相当へ正規化した値として扱う。
- 旧単一 sustained sine / octave support の diagnostic bed は削除済み。Human layer の発音源は candidates / selected voices の polyphonic pluck とする。設計は `docs/human-layer-voice-design.md` を参照。

## 4. 音律核重み

### 4.1 距離
- Haversine 距離 km

### 4.2 重み
- `weight = exp(-(distanceKm^2)/(2*sigmaKm^2))`

### 4.3 正規化
- 同じ family 内で正規化して合計 1
- family:
  - `grid`
  - `scale`

### 4.4 出力
各 sample で最低限ほしいもの:
- `gridKernelWeights`
- `scaleKernelWeights`
- `dominantGridKernelId`
- `dominantScaleKernelId`

現行 audio 実装:
- `core/fusion/tuning.ts` は `grid` と `scale` の重みを family ごとに独立して正規化し、dominant grid / dominant scale を選ぶ。
- Human layer の pitch permission では、dominant grid の `intervalCents` を基礎チューニングとして使い、dominant scale の selected mode interval をその grid 上の最も近い interval へ投影する。これにより scale の形は保ちつつ、12-TET 固定ではなく地域 grid の微細な cent 差が入る。
- Grid projection は pitch permission のみを変える。音色 template は作らない。
- Human layer ではこの projected interval set を固定 C 基準ではなく、その瞬間の Earth drone root を key center として展開する。発音 target は contact の elevation / bathymetry register に +7 semitones の presentation offset を足した値で、保存される `registerMidi` は物理 register のまま残る。
- Scale mode は contact-local に deterministic に選ぶ。入力は `cellId`, UTC week / season, 3x3 nightlight topology, surface hardness, openness, water / forest ratio, road / building density と、共有 `CloudAtlas` forecast artifact から読む GFS-derived atmosphere である。Mode 用 atmosphere は live Open-Meteo weather ではなく、forecast sequence の `TCDC` cloud cover、`CWAT` optical-density proxy、`PRATE` precipitation activity を現在 UTC で frame 補間し、0.05 単位へ量子化した値を使う。密な human presence / 開けた硬い地表は interval density を上げる方向へ寄せ、孤立 contact / water / forest / forecast wetness / forecast cloud は sparse な mode へ寄せる。同じ UTC と同じ forecast artifact なら全 browser で同じ selected mode になる。Wind / temperature は現行 GFS artifact には含めず、mode 選定では使わない。Open-Meteo live weather は production default では使わず、明示 diagnostic fallback としてだけ残す。

## 5. 雲量 → filtering

### 5.1 方向性
- 雲量が高いほど high frequency transparency が減る
- 音楽的暗さの演出ではなく、物理的な鈍さの表現

### 5.2 推奨初期実装
- `cloudNorm = cloudCoverPct / 100`
- `lpTilt = 1 - cloudNorm`
- cutoff を直接固定せず:
  - Earth layer harmonic brightness
  - noise shelf
  - visual cloud opacity
  の canonical driver として使う

現行 audio 実装:
- `core/audio/audio-params.ts` は scanline sample 群の雲量を平均し、Earth layer の noise low-pass を下げる。
- Earth layer noise は brown / pink / white の abstract noise source を混ぜる。通常は pink から少し brown 側に丸め、雲量は low-pass と noise color の両方をさらにブラウン寄りにする。Base weather noise の gain は drone より後ろに置く。
- AudioWorklet が使える場合、wind / water texture が Earth layer の主要な連続 texture になる。旧 base weather noise は比較用に薄く残し、wind texture は Earth drone の現在の partial のいずれかへ body / mid / midHigh / high / air の狭帯域 noise として吸着する。
- 雲量は音量ゼロの条件ではない。PENUMBRA は地球音レイヤーを、雲の多い場所でも鳴らし続ける。
- 音響に入る雲量は引き続き sunrise terminator の scanline-local weather から導く。昼側の地球描写としての雲は、別途 cached `CloudAtlas` artifact を visual に読むことができるが、cloud cover 自体は音響 driver ではない。GFS forecast frame が optional `precipitationValues` を持つ場合だけ、同じ forecast artifact から sunrise Gaussian band 内の降水 activity を読み、Earth layer 内部の rain granular / water high と雨粒 visual の driver に使う。これは幅方向の雨を読むための scanline band driver であり、第4レイヤーや第2 playhead ではない。

## 6. 湿度 → reverb / propagation

### 6.1 方向性
- 湿度はリバーブ / tail / air propagation の driver
- 感情演出に使わない

### 6.2 推奨出力
- `humidityNorm = relativeHumidityPct / 100`
- 利用先:
  - wet mix
  - tail coefficient
  - attack softening
  - release shortening or smearing

現行 audio 実装:
- `core/audio/audio-params.ts` は湿度を Earth layer の propagation clarity に軽く反映し、高湿度時に noise band を少し暗くする。
- 湿度は Earth layer noise color もブラウン寄りに動かす。これは dramatic な暗転ではなく、空気中の high-frequency absorption として扱う。
- Human layer には専用の共有 stereo reverb bus を持つ。各 contact は `humidity`, `openness`, `waterRatio`, `forestRatio`, `cloudNorm`, `temperatureNorm`, `surfaceHardness01` から reverb send / tail / damping を導き、同じ bus へ送る。共有 bus は左右で異なる delay / feedback / damping を持つが、レイヤー間 ducking には使わない。

## 7. 地表硬さ → attack

### 7.1 推奨 canonical scalar
`surfaceHardness01`

例:
- rock / urban pavement: 0.9-1.0
- dry soil / hill: 0.6-0.8
- forest / wetland: 0.2-0.4
- snow / soft ground: 0.1-0.3
- open water: 0.0-0.1

### 7.2 使い方
- 高いほど attack 短め
- 低いほど attack 長め
- 楽音 / 地球音 / 打音で係数は別でも、driver は共有する

現行 audio 実装:
- `core/audio/audio-params.ts` は `surfaceHardness01`, `openness01`, `roadDensityNorm`, `buildingDensityNorm`, `wind` を Earth layer の surface roughness に反映する。
- `core/audio/engine.ts` は surface roughness を連続 bandpass texture として Earth layer 内部に接続する。これは新しい sounding layer ではない。
- 強風、硬い地表、道路 / 建物密度は bandpass Q を上げ、帯域を狭める。水域・森林・湿度・雲は surface smoothness として texture gain / filter / Q を丸める。
- 数秒単位の motion は自由 LFO や UTC value noise ではなく、sunrise terminator が読む地表の空間変化から導く。`createCanonicalScanlineSamples` は各中心線 sample の前後経度 probe から `spatialChange01` / `spatialSlope01` を持ち、`core/audio/audio-params.ts` は中心線 ensemble の `scanlineSpatialVariance01` も集約する。これらが base noise color / lowpass と surface texture filter / Q の微細変化を担う。
- Earth drone は elevation / bathymetry register を root とし、整数倍音列を母体にした 12 partial mechanism を持つ。2026-05-02 の試聴では drone の audible output は基音だけにし、2倍音以上は無音化する。ただし partial frequency / dispersion 計算は残し、wind texture / water droplet pitch center / Human key center のための内部情報として使う。hardness / openness / road / building / wind / precipitation / scanline spatial change が partial dispersion と中高域 tilt を増やし、humidity / cloud / forest / water が整数倍音列寄りに丸める。
- `?debug` では、実際に鳴っている drone root の1オクターブ下を conceptual な Earth root として 0.01Hz 単位で表示する。従来の root 周波数そのものの waveform / 小型 goniometer UI は外し、現在は drone root と detuned companion の差分 `abs(companionHz - droneRootHz)` から作る beat envelope を直近1秒相当の流れる履歴波形として描く。1秒を widget の横幅として扱うため、`0.66Hz` なら横幅内には約0.66周期だけが現れる。位相は `UTC * beatHz` で毎フレーム再計算せず、初期値だけ UTC から置き、その後は表示側で連続積分する。表示側の companion 値も音側の response に合わせて約1.05sで平滑化する。これは production output に接続されない検査 UI であり、Earth layer 内部のうなりを可視化するだけなので、第4レイヤーや追加 playhead ではない。
- Wind texture はこの Earth drone partial 計算を共有する。body / mid / midHigh / high / air は現在の drone partial のいずれかに吸着し、partial 間の中間周波数は鳴らさない。Q は wind / openness / hardness / roughness で狭まり、cloud / humidity / forest / water で広がる。AudioWorklet の main texture output では dry 側を `0.34x` に抑え、texture そのものが前に出すぎないようにする。一方で output 1 は wind-only bus とし、formant source は `0.58x` 相当を維持する。これは風を別の旋律源にするのではなく、Earth layer の drone spectrum を noise で励起する処理である。
- Wind visual shimmer は同じ wind texture params を読み、globe surface shader 内で半影帯付近に重ねる。wind band level が強度、band Q / surface roughness が焦点、upper band share が粒立ちを決める。現行データには風向がないため、気象上の風向は示さない。視覚上の流れは longitude 方向へ固定し、地球の自転と逆向きに高速で流れる surface resonance として扱う。速度は wind texture params から導くが、位相は UTC に速度を掛け直さず renderer 側で連続積分する。模様は deterministic hash grid から作る大小2層の sparse light particles を移流させる。大粒は flow phase の 1.72x、細粒は 2.48x で動かす。表示範囲は単一 Gaussian ではなく、terminator 直下を強調する細い ridge と外側へ薄く残る Gaussian tail の積 `tail * (0.18 + 0.82 * ridge)` とし、半影帯外側では速やかに消える。これは雲の流れではなく、地球音レイヤーの wind texture と自転の躍動を inspectable にする視覚痕跡であり、第4レイヤーや追加 playhead ではない。
- Earth formant は Earth layer 内部の parallel send 処理である。Earth drone / wind-only texture bus の dry copy だけを body / mid / air の 3 本の bandpass 窓へ送る。中心周波数は気象・地表・scanline spatial change と、同じ Earth drone partial bank への軽い吸着で決まり、緯度や文化的 vowel label では決めない。base weather noise を formant exciter として足す案は切り分け用には有効だったが、wind dry と formant return の判断を濁すため現行 production では 0 とする。2026-05-07 の調整では water が formant へ増えて入らないよう wind-only bus を分離し、wind send は `28x` のまま維持した。Water floor / water droplets / rain granular は formant bus へ入れない。量は scanline 上の human presence field によって少し開くが、Human layer の発音イベントで ducking / spotlight するものではなく、第4レイヤーでもない。

## 8. 空間特性 / 温度 / 湿度 → release

推奨 canonical scalars:
- `openness01`
- `humidityNorm`
- `temperatureNorm`

初期指針:
- openness 高 -> release 長め
- humidity 高 -> release 短め / smearing
- low temperature -> release 感の伸び

## 9. 建物密度 / 道路密度 / 森林率 / 水域率

前処理で各値の percentile stats を持つこと。

### 建物密度
- 倍音 richness
- resonant partial count

### 道路密度
- noise density / micro texture

### 森林率
- high-frequency attenuation
- attack softening
- Earth layer noise color をブラウン寄りにする

### 水域率
- wetness
- delay / reflection tendency
- Earth layer surface texture を滑らかに丸める

## 10. 降水量 → granular粒子

### 10.1 方向性
- 雨 / 雪 / 雹 = 粒子の集合
- granular の使用はここで正当化される

### 10.2 推奨出力
- `precipitationNorm`
- `precipitationType` (rain / snow / mixed)
- `grainDensityHz`
- `grainBrightness01`

現行 audio 実装:
- `core/audio/audio-params.ts` は通常 scanline sample 群の `precipitationMm / 8` を加重平均し、Earth layer 内部の `precipitationGrainDensityHz`, `precipitationGrainGain01`, `precipitationGrainBrightness01` を導く。`?cloud=forecast` の GFS frame が precipitation channel を持つ場合は、`core/fusion/precipitation-band.ts` が sunrise Gaussian band の幅方向から precipitation activity を加重平均し、その値で precipitationNorm だけを上書きする。GFS band では trace PRATE / 小雨を雨粒 granular として扱わず、強い雨だけを `smoothstep(0.68, 0.94)` で significant activity として集計する。visual rain candidate は precipitation activity `0.70` 以上の cell だけから作る。小雨・湿り気は rain granular ではなく、cloud / humidity / water texture 側の質感として扱う。
- AudioWorklet が使える場合、`public/worklets/penumbra-earth-texture-processor.js` が water droplet field を abstract droplet synthesis として鳴らす。Worklet が使えない場合は、従来の短い filtered noise burst へ fallback する。どちらも第4レイヤーではなく、Earth layer の表面粒状成分である。Production scheduling は page-open time や AudioContext start sample ではなく、UTC slot + band id から作る deterministic event field を使う。
- Water noise floor は production では 0。droplet は low / mid / high の独立 density field を持つ。low は `oceanDepth01`、mid は `waterRatio`、high は precipitation grain density に主に従う。
- droplet gain / brightness は precipitation 量、wind, openness, surface hardness, cloud, humidity, forest で変わる。雨がない時も low / mid は低い density で残り、水の星としての常在感を担う。
- Rain granular は high droplet とは別の Earth layer 内部 texture として構造を残すが、2026-05-07 の聴感確認では production mix から外した。外部 sample は使わず、AudioWorklet 内で固定 seed から生成した synthetic rain material buffer を持つ。grain event は UTC slot と scanline state から deterministic に決まり、density は significant precipitation、spread / read behavior は wind / openness / scanline spatial change、absorption は cloud / humidity / forest に従う。現状は `?debug&audio=rain-granular-solo` / `rain-granular-boost` の実験用に限定する。Production の雨粒 visual と Earth texture audio の `water:high` droplet は、32Hz の固定 UTC slot clock を density で deterministic に間引く同じ canonical event field を読む。Forecast precipitation channel がある時の visual は Gaussian band 内の強い実降水 cell を 8° 程度にまとめ、accepted event を独立した particle として 1.8-4.4 秒程度残す。これにより high droplet 由来の雨 rhythm は保ちつつ、browser frame timing / AudioContext start time / density 微小差による one-dot flicker と denser granular field の高速な映像ノイズを避ける。AudioWorklet から粒ごとに message を返さないため、同期はイベント規則の共有で成立する。
- Water low / mid droplet visual は `water:low` / `water:mid` の固定 UTC slot clock を density で deterministic に間引く canonical event field を読み、sunrise Gaussian band 内の水域 cell へ配置する。low は bathymetry 由来の ocean depth、mid は water ratio を候補重みに使う。候補位置は現在 frame ではなく event scheduled UTC の scanline state で決めるため、波紋が成長途中で隣接 cell へ飛ばない。描画は camera-facing point sprite ではなく globe surface shader 内の spherical-distance ring とし、別 `waterRatio` texture で陸側 fragment を消す。音が参照する低域 / 中域 water texture の発生場所を、水面側の現象として地表上で inspectable にする処理であり、第4レイヤーや別 playhead ではない。
- Droplet の pitch center は Earth drone partial から選び、low / mid / high の自然帯域へ octave fold する。low は partial 1/2、mid は partial 2/3/4/5、high は partial 8/10/12/15/18/24 を使う。Droplet shape は high / mid / low の基準値を持ち、発音周波数に応じて log-frequency 上で補間する。基準値は high: 2974Hz / sweep up 2 / 50ms / decay 0.04s / transient 0、mid: 605Hz / sweep up 1.6 / 90ms / decay 0.15s / transient 0、low: 197Hz / sweep up 5 / 240ms / decay 0.40s / transient 0。低い周波数ほど遅く長く、高い周波数ほど速く短くなる。
- Worklet 内部に fBm modulation は持たせない。連続的な変化は `AudioFrameParams` に畳まれた weather / terrain / scanline data から来る continuous params を受け取る。
- Earth texture の reverb は本体 routing では Tone.js Convolver send を使う。Worklet 内 reverb tank は fallback / 比較用で、Tone.js send 使用時は二重 reverb を避けるため wet を 0 にする。Tone.js Reverb の内部 noise IR は page-open ごとの random になり得るため、固定 seed の deterministic IR を Convolver に渡す。
- 2026-05-02 の統合 pass では、この Tone.js Convolver を wind / water だけでなく Human contact と Earth drone も共有する空間処理として使う。2026-05-08 の iPhone 検証後、Human Worklet 内部 reverb は canonical path では bypass し、Human contact の空間処理は shared Tone convolver send に統一した。Human / drone は source send だけを調整し、return や decay で wind / water まで過度に濃くしない。これは新しい sounding layer や cross-layer ducking ではない。
- Earthquake layer には作用せず、ducking や event spotlighting は行わない。

## 11. 地震

### 11.1 window
- `eventAgeMinutes <= 81`

### 11.2 velocity
- magnitude に線形比例
- しきい値で落とさない

現行 audio 実装:
- `core/audio/audio-params.ts` は magnitude を quake hit gain に線形反映する。
- `core/fusion/quake-pulse-scheduler.ts` は quake id / event time / UTC pulse index から deterministic な event-local percussion pulse を作る。Audio Start 直後に active quake を catch up して鳴らさず、`previousUtcMs -> currentUtcMs` に存在する pulse だけを鳴らす。
- `core/audio/engine.ts` は earthquake layer の gain を他レイヤーとは独立に持つ。Layer gain と impact peak は平方根カーブで持ち上げ、小さい quake を無音化しない。これは確認可能な打音レベルを確保するためであり、他レイヤーの ducking や spotlighting は行わない。
- Quake pulse は共有 Tone.js Convolver にも独立 send を持つ。Send は drone より多く water/wind texture より少なくし、dry impact を残したまま同じ空間へ置く。これは空間処理であり第4レイヤーではない。
- Quake pitch は Earth drone root に結びつける。Body は `earthDroneRootHz` の subharmonic を 18-220Hz に octave fold し、短い resonance は現在の Earth drone partial から選ぶ。source 地点の elevation / bathymetry register は visual/contact mapping として残るが、発音 pitch world は Earth drone root へ統合する。
- `core/visual/renderer.ts` は同じ quake pulse scheduler を使い、発音した quake source の緯度経度だけを cyan-blue 系の点として短く明るく・少し大きくする。鳴っていない quake の常時薄い点は production では出さず、pulse 反応だけを発音 trace とする。shockwave / flash / event spotlight は使わない。

### 11.3 depth
- depthKm が深いほど low-pass / darker / softer

### 11.4 register
- contact 地点 elevation / bathymetry は quake contact の物理 register として保持する
- 発音 pitch は Earth drone root の subharmonic / partial に結びつける

### 11.5 position
- 走査線中心からの相対経度・緯度で stereo / spatial distribution

## 12. 視覚 canonical drivers

各緯度 sample から最低限ほしい表示用値:

- `scanlineWeight`
- `nightLightNorm`
- `cloudOpacity`
- `precipitationNorm`
- `quakePointAlpha`
- `quakePointScale`
- `terrainColorBand`
- `audioEnergyEstimate` (debug or pulse only)
- `cloudAtlasCover01` (visual-only, cached daytime atmosphere; not an audio driver)

## 13. 禁止された近道

- 緯度だけで pitch を決める
- kernel 名ごとに timbre template を固定する
- earthquake magnitude で window を変える
- quake が来たら他レイヤーを下げる
- API 直叩きの global cloud texture を常時見せる
- sunrise を祝祭的フレアにする
