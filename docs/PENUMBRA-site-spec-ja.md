# PENUMBRA 仕様書 / 公式サイト用詳細原稿

Last updated: 2026-05-10

この文書は、公式サイト上で PENUMBRA を紹介するための元原稿である。
短いステートメントではなく、作品の設計思想、音響構造、視覚構造、データマッピング、同期原理をできるだけ具体的に記述する。

PENUMBRA は、地球の sunrise terminator、つまり朝が訪れる昼夜境界線を唯一の playhead として使う Earth Sequencer である。リスナーが開いた場所やブラウザに依存して勝手に演奏が変わる作品ではなく、UTC と共有されたデータ artifact によって、同じ UTC の瞬間にはほぼ同じ音と視覚が立ち上がることを目指している。

## 1. 基本思想

PENUMBRA の中心にあるのは、地球を「眺める対象」ではなく「鳴っている構造」として扱うことだ。
ただし、それは地球上の出来事を劇的に演出するという意味ではない。日の出の境界が地表を通過するとき、そこに存在する地形、海、雲、風、雨、夜間光、地震が、それぞれの物理的または構造的な条件に従って音と視覚を発生させる。

本作の playhead は sunrise terminator だけである。
画面上に別の時間軸やユーザー操作可能な再生位置は存在しない。sunset terminator は物理的には存在するが、作品上の発音 playhead ではない。

音響レイヤーは次の 3 つだけで構成される。

- Earth layer: 非人間的な地球音。drone、wind、water、rain texture など。
- Human musical layer: 夜間光に由来する tonal pluck 群。
- Earthquake percussion layer: 過去 81 分以内の地震に由来する打音。

この 3 レイヤーは独立している。
あるレイヤーが鳴ったから別のレイヤーを ducking する、地震の瞬間だけ作品全体を強調する、特定の都市を spotlight する、という処理は行わない。

PENUMBRA は災害監視システムではない。
地震は magnitude threshold で除外されず、過去 81 分以内かつ走査線の active reach 内に入ったものが同じ規則で鳴る。地震の音は警告でも追悼でもない。作品は地球上の出来事を知らせるためではなく、同じ規則で鳴り続けるために存在する。

## 2. UTC と同期

PENUMBRA の正典時間は UTC である。
ブラウザや OS の local timezone は作品の canonical state を決めない。

実装上は、同一オリジンの `GET /__penumbra-time` から millisecond UTC payload を取得し、端末時計との差分を補正する。これはサーバーが音楽状態を保持するという意味ではない。サーバーは「今の UTC」を補正するためにだけ使われ、作品の音楽的状態はブラウザ内で計算される。

同一オリジンの UTC endpoint が使えない場合は、HTTP `Date` header、それも使えない場合はブラウザの UTC を明示的 fallback として使う。fallback は隠さず、debug / status 上で確認できるようにする。

human contact、water droplet、rain high droplet、earthquake pulse などの発音イベントは、できるだけ「ページを開いた時刻」ではなく「UTC から直接決まる event field」に寄せている。これにより、同じ UTC と同じ data artifact を読んでいる限り、Mac、iPhone、別ブラウザ間でも同じ contact が同じタイミングで鳴る。

## 3. 走査線

走査線は sunrise terminator を中心とする Gaussian band である。
現在の標準値は以下。

```txt
sigma = 7 degrees
active reach = ±3 sigma = 約 ±21 degrees
weight = exp(-(offsetDeg^2) / (2 * sigma^2))
```

中心線の `weight` は 1 で、sigma の位置では約 0.607、3 sigma では約 0.011 まで下がる。
この weight は「線を描くため」ではなく、どの地表セルがどれだけ強く走査線に触れているかを表す。

ただし、すべての用途で同じ幅をそのまま使うわけではない。

- Earth layer は中心線 sample 群を主に読む。
- Human contact は Gaussian active reach 内の夜間光 cell を候補として保持する。
- Human contact が非常に多い場合は、候補そのものを切り捨てるのではなく、発音確率と pulse 間隔を変える。
- 高密度時は human pulse scheduler 内部の effective focus sigma が 7° から最小 4° へ狭まる。
- その結果、半影帯中心付近の contact は鳴りやすく、外側の contact は鳴る機会が薄くなる。

重要なのは、Gaussian band が「候補を消す」ためではなく、「到来し、通過し、離れていく」経験を作るために使われることだ。
走査線の真下にいる contact は確実に強い機会を持ち、外側は薄く、しかし完全にはゼロにならない。

## 4. 静的データと予報データ

PENUMBRA は複数のデータ層を使う。

静的データ:

- elevation / bathymetry
- land / water / ice classification
- nightlight
- road density
- building density
- forest ratio
- water ratio
- surface hardness
- openness
- tuning kernels

予報 / live 系データ:

- USGS earthquake feed
- scanline-local weather
- NOAA GFS cloud forecast artifact

現在の雲 forecast artifact は NOAA GFS 0.25° の GRIB2 から生成する。
使っている主な変数は以下。

- `TCDC: entire atmosphere`: total cloud cover
- `CWAT: entire atmosphere`: cloud water / optical-density proxy
- `PRATE: surface`: precipitation-rate activity

GFS の生データはそのままブラウザで直接取りに行かない。precompute script が forecast frame を生成し、`public/data/cloud-atlas.forecast/manifest.json` と versioned frame JSON として配信する。現在の production artifact は 0.5° grid を使い、forecast hour は `0, 3, 6, 9` を基本にしている。ブラウザは現在 UTC の前後 frame を線形時間補間する。

これにより、雲の見た目、human contact の scale mode 選定、雨の幅方向 activity が、ブラウザごとの live API 差ではなく、共有 artifact に基づく。

## 5. Earth layer

Earth layer は、人間活動ではなく地球そのものの drone / texture を担う。
ここには drone root、detuned companion、wind texture、water texture、rain granular、formant send が含まれる。これらはすべて Earth layer 内部の構成要素であり、第4レイヤーではない。

### 5.1 Earth root と Drone root

PENUMBRA には概念上の `Earth root` と、実際に鳴る `Drone root` がある。

- `Earth root`: debug / UI 上の概念的な root。実際に鳴る root の 1 octave 下。
- `Drone root`: 実際に鳴る Earth drone の基音。

`Drone root` は、sunrise terminator 中心線上の elevation / bathymetry register の加重平均を取り、そこから 1 octave 下げた値として導く。
深海や海洋が多い場所では低く、高地が多い場所では高くなる。緯度や経度を直接 pitch に割り当てることはしない。

実装上の目安:

- 深海側では Drone root が非常に低くなる。
- 平野や浅海では中低域に寄る。
- 高地を多く読むと root が上がる。
- UI に表示される Earth root は、その Drone root の 1 octave 下になる。

例:

- 走査線が太平洋の深い海域を読む場合: Earth root / Drone root は低く、wind や water が低い倍音を参照しやすい。
- 走査線が高地を多く読む場合: Drone root が上がり、それに従って wind の band center や water droplet の折り返し先も上方向に移動する。

### 5.2 Drone の audible output

以前は Earth drone に drawbar 的な倍音群を直接鳴らしていたが、現在の方針では audible output は主に基音である。
2倍音以上の partial mechanism は削除せず、内部情報として残している。

この内部 partial bank は次の用途に使う。

- wind texture の band center
- water droplet の pitch center
- human layer の key center
- drone companion / beat 表示

partial bank は整数倍音列を母体にしつつ、地表・気象・scanline spatial change に応じて非整数側へ少し広がる。

整数倍音寄りになる条件:

- humidity が高い
- cloud cover が高い
- forest ratio が高い
- water ratio が高い
- damping が強い
- surface roughness / built texture / wind が弱い

非整数倍音寄りになる条件:

- surface hardness が高い
- openness が高い
- road / building density が高い
- wind が強い
- scanline spatial change / variance が大きい
- precipitation activity がある

### 5.3 Detuned companion

Drone には、非常に小さく detune した companion sine が加わる。
これは音量 LFO ではなく、Drone root そのものに対して薄い sine を ±cent 方向にずらし、beat を作る仕組みである。

現在の設計:

- 最大 detune: 約 ±82 cents
- relative gain: root に対して最大 0.2 程度
- response: 約 1.05 秒

detune が大きくなる条件:

- wind が強い
- openness が高い
- surface hardness が高い
- built texture が高い
- surface roughness が高い
- scanline spatial change / variance が大きい

detune が unison に戻る条件:

- humidity が高い
- cloud cover が高い
- forest ratio が高い
- water ratio が高い
- drone damping が強い

例:

- 開けた硬い地表を強風が通過する時: Drone root に対する companion のずれが大きくなり、ゆっくりしたうなりが聞こえやすくなる。
- 湿度が高く森林や水域が多い時: companion は root に近づき、うなりは静かになる。

### 5.4 Wind texture

Wind texture は、単なるホワイトノイズではない。
Earth drone の partial bank に吸着する narrow-band noise である。

現在の wind band:

- body
- mid
- midHigh
- high
- air

各 band は、Drone root から導かれる partial のいずれかを center frequency として持つ。
partial と partial の中間周波数を補間して鳴らすのではなく、常に実 partial のどれかへ吸着する。

band center の方向:

- body: 1倍音または2倍音付近
- mid: 3倍音または4倍音付近
- midHigh: 5倍音または6倍音付近
- high: 8倍音またはそれ以上
- air: 15倍音から24倍音付近

Q の方向:

- body Q: 1.1-4
- mid / midHigh / high Q: おおむね 2.2-10
- air Q: 3-10

Q が高くなる条件:

- wind が強い
- openness が高い
- surface roughness が高い
- surface hardness が高い
- built texture がある

Q が低くなり、丸く広がる条件:

- humidity が高い
- cloud cover が高い
- forest ratio が高い
- water ratio が高い

例:

- 乾いた開けた地形で風が強い場合: wind band は細く焦点を結び、Drone root の倍音を noise で鳴らしているように聞こえる。
- 湿度が高く雲が厚い場合: wind band は広がり、倍音の輪郭が丸くなる。
- built texture と surface roughness が高い都市域を通る場合: mid / high の粒立ちが出やすい。

Wind は formant bus にも送られる。
現在は wind-only bus を分離しており、water が formant に余計に入らないようにしている。

### 5.5 Water texture

Water texture は、地球が水の星であることを常時表すための層である。
water noise floor は現在 0 にしており、主に droplets と low / mid / high の density で表現する。

Water は 3 band に分かれる。

#### low

海の深さを表す。
深い海ほど low density と low level が上がり、低域の水滴 / 水中の泡のような音が増える。

主な driver:

- oceanDepth01
- waterRatio01
- Earth layer gain

音の性格:

- 低い pitch
- 長めの sweep / decay
- 深海的、低く重い水の動き

#### mid

水域の質感を表す。
走査線上にどの程度 water ratio があるかによって density と level が上がる。

主な driver:

- waterRatio01
- oceanDepth01
- scanline weight

音の性格:

- low より高い
- 中域の水滴 / 水面 / 水中の細かい動き

#### high

主に雨を表す。
GFS の precipitation activity と Earth layer の precipitation grain density に従って発音する。

主な driver:

- PRATE-derived precipitation activity
- precipitationGrainDensityHz
- wind
- brightness

音の性格:

- 高域
- 短い droplet
- 雨粒として視覚化される

Water droplet の pitch は、Drone root の partial bank から選ばれ、各 band の音域内に octave fold される。

現在の partial selection:

- low: 1 / 2 partial
- mid: 2 / 3 / 4 / 5 partial
- high: 8 / 10 / 12 / 15 / 18 / 24 partial

例:

- 深い海を走査線が通る: low droplet が低い density で常時鳴り、長く低い水の存在感が出る。
- 広い海域を横切る: mid droplet が増え、水面の質感が出る。
- 強い雨域が半影帯に入る: high droplet が増え、短い高域の雨粒が鳴る。

### 5.6 Rain granular

Rain granular は、high droplet とは別に用意された補助的な雨の粒状 texture である。
外部サンプルは使わず、内部で生成した synthetic buffers を使う。

素材の考え方:

- mist buffer: filtered noise / very short soft grains
- drop buffer: pitched droplet / resonant sine sweep
- sheet buffer: dense rain bed / high-pass granular noise
- surface buffer: water / ground hit texture

現在は、production mix の中で強く前面化する主役ではなく、雨の粒状感を補助するための層として扱っている。
発音 density は precipitation activity に従うが、強い雨の時に音量だけが過剰に上がらないよう、density と gain は分離して扱う。

例:

- 小雨: density は低いが、粒そのものは存在感を持つ。
- 強雨: density は上がるが、gain は上限で抑え、全体を潰さない。

### 5.7 Earth formant

Earth formant は、Earth layer 内部の parallel send 処理である。
Drone と wind-only texture の dry copy を 3 本の bandpass 窓へ送り、母音的な formant を薄く足す。

これは「声」や「合唱」をサンプルするものではない。
あくまで abstract synthesis と filter bank による resonant coloration である。

現行方針:

- source: drone + wind-only bus
- water は formant bus へ入れない
- base weather noise は formant exciter として使わない
- 3 bandpass formant を parallel send で足す
- human presence field があるほど少し開く

重要なのは、human contact の発音イベントで formant を dramatize しないことだ。
formant は pulse に反応する spotlight ではなく、走査線が human presence を読んでいる時に、Earth layer の共鳴が少し変わるという扱いである。

## 6. Human musical layer

Human musical layer は、nightlight に由来する tonal pluck 群である。
ただし、文化的な楽器サンプルや地域楽器の模倣は使わない。全て抽象的な pluck synthesis で作られる。

### 6.1 発音条件

Human contact の基本 gain は次で決まる。

```txt
gain01 = nightLightNorm * scanlineWeight
```

nightLightNorm は夜間光を対数的に正規化した値である。
scanlineWeight は sunrise terminator からの Gaussian 距離である。

常時の visual nightlight は音の Gaussian とは切り離されている。
夜側では human presence field として灯りが見えるが、昼側では常時灯りは消える。ただし発音した瞬間の pulse glow は昼側でも表示される。

### 6.2 Candidate と Selected

`music contacts` は、その時点で走査線 active reach 内にある nightlight contact 候補数を表す。
`selected` は debug / fallback path で同時に選ばれる代表数を表す。

AudioWorklet path では、全 candidates が pulse scheduler の対象になりうる。
ただし全てが同時に鳴るわけではない。各 contact は自分の period、phase、emit probability を持ち、UTC に沿って発音機会を得る。

高密度地域では、次の調整が入る。

- period が伸びる
- emit probability が下がる
- effective focus sigma が狭くなる
- 半影帯中心付近が優先される
- 外側 contact の発音機会はさらに薄くなる

候補を構造的に消すのではなく、発音機会の分布を変える。

### 6.3 Pulse timing

各 contact の pulse は deterministic である。
`cellId`、UTC day、UTC week、season、nightlight topology、scheduled UTC slot などから決まる。

ページを開いた瞬間には鳴らない。
Start Audio 直後に一斉発音するのではなく、UTC 上ですでに存在している pulse event が通過した時に鳴る。

Pulse の主な値:

- period: おおむね数秒から数十秒。高密度時はさらに伸びる。
- phase: contact ごとに stable。
- jitter: contact topology と UTC seed 由来。無根拠な `Math.random` ではない。
- emit probability: Gaussian center で高く、外側で低い。

例:

- 明るい都市 contact が半影帯中心に近い: 発音機会が多い。
- 明るいが半影帯外側にある contact: 視覚的には存在しても、発音確率は低い。
- 小さな孤立した灯り: 頻度は低いが、発音した時は基音中心の澄んだ音になりやすい。

### 6.4 Pitch

Human contact の pitch は次の順で決まる。

1. contact の elevation / bathymetry から registerMidi を得る。
2. human presentation offset として target を +7 semitones 持ち上げる。
3. 現在の Drone root を key center とする。
4. contact の位置に対して dominant grid kernel / dominant scale kernel を求める。
5. selected scale mode の interval を dominant grid 上へ投影する。
6. target register に最も近い allowed pitch を選ぶ。

ここで重要なのは、Earth root / Drone root との関係が常に維持されることだ。
scale や grid は固定 C を基準に動くのではなく、その瞬間の Earth drone root に追従する。

例:

- 同じ contact でも、走査線が読む地形が変わって Drone root が下がれば、pitch permission 全体も下へ移動する。
- 高地の contact は target register が高くなる。
- 海沿い・低地の contact は中低域に寄りやすい。
- dominant grid が 12-TET でない場所では、scale interval はその grid 上の最も近い cent へ投影される。

### 6.5 Grid と Scale mode

PENUMBRA は tuning kernels を 2 系統に分ける。

- grid kernel: 音高の cent grid / tuning framework を決める。
- scale kernel: どの interval set を許可するかを決める。

scale は grid を上書きしない。
scale interval は dominant grid 上へ投影される。

Scale mode は contact-local に deterministic に選ばれる。
入力は次のような値。

- `cellId`
- UTC week
- season
- 3x3 nightlight topology
- surface hardness
- openness
- water ratio
- forest ratio
- road density
- building density
- GFS forecast artifact 由来の cloud / optical wetness / precipitation

mode 選定では、ブラウザごとの live weather は使わない。
同じ UTC と同じ forecast artifact なら、別ブラウザでも同じ mode が選ばれる。

mode selection の考え方:

- built / continuity / openness / hardness / forecast precipitation activity が高いほど、interval density が高い mode へ寄る。
- isolation / water / forest / forecast wetness / cloud が高いほど、sparse な mode へ寄る。
- UTC week と season がわずかに position を動かすため、昨日・今日・明日で完全に同じ選択になり続けることを避ける。

### 6.6 Timbre

Human pluck の音色は、文化圏や音律核では決めない。
地表・気象・human presence field の形で決まる。

主要な方向:

- forest / humidity / cloud / water: 基音中心、柔らかい、上位 partial が減る。
- low hardness: wood/body 寄り。
- surface hardness / building / road / openness / coldness / wind: upper partial が増え、metal/air 寄り。
- 3x3 nightlight topology が孤立: partial 数が 1-2 本へ減る。
- 連続した灯りや edge: partial 数が 3-4 本へ増える。

現在の canonical partial cap は 4。
iPhone を含む長時間再生の安定性と、聴感上のバランスを両立するため、human contact は最大 4 partial を基本にしている。

例:

- 森林・湿度・雲が強い低硬度地域: 基音中心で、木質寄りの丸い pluck になる。
- 開けた硬い都市域: 第2-第4 partial が出やすく、金属的・空気的な響きが増える。
- 周囲に灯りが少ない小さな contact: partial が減り、基音だけに近い音になることがある。
- 灯りが連続する都市 edge: 上位 partial が保持され、音色差が出やすい。

### 6.7 Reverb

Human pluck は shared Tone.js convolution reverb へ送られる。
Human Worklet 内部 reverb は現在 canonical path では bypass している。

reverb send / tail / damping の方向:

- humidity / water / openness / precipitation: send が増えやすい。
- cloud: send を少し抑える。
- openness / water / coldness: tail が伸びやすい。
- humidity / cloud / forest: damping が強くなり、高域が丸くなる。
- surface hardness / openness: damping frequency が開きやすい。

reverb は美化のためだけではなく、contact-local propagation の湿度・空間性の表現として扱う。

## 7. Earthquake percussion layer

Earthquake layer は、過去 81 分以内の地震を扱う。
magnitude threshold はない。

### 7.1 発音条件

地震が鳴る条件:

- USGS feed に含まれている。
- event time が現在 UTC から 81 分以内。
- 震源が sunrise terminator の active reach 内にある。
- quake-local pulse gate を通過する。

Start Audio 直後にまとめて鳴ることは避ける。
quake も human contact と同じく UTC event field に寄せ、ブラウザ間で同じように鳴ることを目指す。

### 7.2 Pitch / tone

Quake の pitch は Earth drone root に結びつく。

- body pitch: Earth drone root の subharmonic を 18-220 Hz 付近へ fold
- resonance: Earth drone partial を 70-1800 Hz 付近へ fold
- depth が深いほど darker / softer / longer
- magnitude は velocity / gain 的な強さへ作用するが、threshold には使わない

例:

- 浅い地震: 明るめで短い打音になりやすい。
- 深い地震: 低く丸く、長めに沈む。
- magnitude が大きい地震: 強く鳴るが、特別演出や警告にはならない。

### 7.3 Visual

Quake は cyan-blue 系の点として表示される。
鳴っていない quake が常時見え続けることは避け、発音 pulse に合わせて点が現れ、自然に fade out する。

地震 visual は shockwave ではない。
PENUMBRA は地震を災害演出として扱わない。

## 8. Visual system

PENUMBRA の visual は、音の由来を inspectable にするためのものだ。
地球は装飾ではなく、sequencer の盤面である。

### 8.1 Globe surface

地表は 1° visual surface grid を基本に描く。
補間を強くかけた滑らかな地球ではなく、1° grid の抽象化が見える方向を採用している。

海は bathymetry / water depth に応じた青の濃淡で描く。
陸は land class、森林、水域率、標高、地形 relief から色を作る。

現在の地形表現は、実際に頂点を大きく変形するのではなく、height texture から normal を微細に歪ませる方式である。
これにより、球体の形を崩さず、光が表面の凹凸に反応しているような質感を作る。

### 8.2 Day / night / penumbra

昼夜境界は追加の線ではなく、地球に当たる光の境界として見えるべきものとして設計されている。

shader は太陽方向と surface normal から dayMix を作り、そこに softness を加える。
半影帯は、暗い側を少し明るく、明るい側を少し暗くすることで、ぱっきりした二分割ではなく、球体に光が当たっている印象を作る。

### 8.3 Clouds

雲は地表に焼き込まれた色ではなく、地表より少し外側の transparent cloud shell として描かれる。
cloud shell は地球座標の texture を持ち、globe group とともに回転する。つまり、雲は地表と同じ経緯度に貼られており、地球の自転に合わせて見える位置が動く。

雲の visual は cached GFS cloud atlas を使う。
音に影響する雲は scanline-local weather を読むが、昼側の地球描写としての雲は forecast artifact を読む。この分離により、音の playhead 原則を壊さず、地球表面の雲をより豊かに描ける。

現在の雲描画:

- 0.5° GFS-derived cloud atlas
- `TCDC` で雲量
- `CWAT` で 100% cloud cover 領域内の濃淡
- 昼側中心に表示
- 夜側では強く fade out
- cloud texture は `NearestFilter` で、grid の粒度を残す
- color は主に `#f5fafc`
- opacity は cloud cover と density proxy から決まる

雲 opacity の大枠:

- 90% 未満の薄い雲はかなり抑える。
- 90-100% の濃い雲を中心に描く。
- 100% cloud cover の中でも `CWAT` によって濃淡を作る。
- 最大 opacity は 0.96 付近まで上がり、濃い雲は地表色と過剰に混ざらず白として見える。

例:

- TCDC は高いが CWAT が低い: 雲はあるが薄く、淡く表示される。
- TCDC も CWAT も高い: 白く厚い雲として見える。
- 夜側: 雲は自然に見えにくくなる。

### 8.4 Human presence light

Human presence light は nightlight に基づく。
夜側では常時表示されるが、昼側では常時表示されない。これは「夜は灯りが見え、昼は灯りが見えない」という自然な挙動に合わせるためである。

一方で、発音した contact の pulse glow は昼側でも表示される。
昼側ではデフォルトの presence light が 0 になっており、発音の瞬間だけ夜側と同じ presence light が立ち上がるように見える。

### 8.5 Rain visual

Rain high droplet は、音と同じ canonical `water:high` event field に同期して表示される。
以前の granular event 由来の表示は忙しすぎたため、現在は high droplet に寄せている。

雨 visual の流れ:

1. GFS `PRATE` から precipitation activity を作る。
2. sunrise Gaussian band 内の強い雨域だけを候補にする。
3. 雨 cell を cluster 化し、映像ノイズのような高速点滅を避ける。
4. high droplet の scheduled UTC event と同じ event を使って点を出す。
5. 発音後もしばらく visual particle は残り、自然に fade out する。

例:

- 小雨や trace precipitation: 音・視覚ともに基本的には拾いすぎない。
- 強雨域: high droplet が発音し、その近くに雨粒が見える。
- 同じ cluster 内: deterministic jitter により、同じ場所に完全固定されず、しかしブラウザ間では同じ散らばりになる。

### 8.6 Water low / mid ripples

Water low / mid droplet は、音だけでなく水面上の ripple としても表示される。
これは雨ではなく、水の中から泡や波紋が立ち上がるような表現である。

設計:

- low / mid の canonical droplet event を読む。
- event 発生時の scanline state から候補水域を固定する。
- 波紋の中心は event lifetime 中に横へ飛ばない。
- water mask によって陸地には描かない。
- low は大きく長い ripple、mid はやや小さく短い ripple。
- shader 内で球面上の角距離を使うため、広がる輪は地球表面に沿う。

現在の寿命:

- low: 約 18 秒
- mid: 約 12 秒

例:

- 深い海域: low ripple が低頻度で大きく広がる。
- 水域率の高い場所: mid ripple が発生しやすい。
- 海岸線付近: ripple は water mask で陸へはみ出しにくい。

### 8.7 Wind shimmer

Wind shimmer は、wind texture と同じ parameters から描かれる surface shimmer である。
気象上の風向を示すものではない。現行データには風向が含まれていないため、視覚上の流れは地球の自転と逆向きの longitude 方向に固定している。

目的は 3 つある。

- wind texture が鳴っていることを視覚的に追えるようにする。
- 半影帯 / Gaussian band の領域を示唆する。
- 地球の自転の躍動を、雲とは異なる速い粒の流れとして見せる。

Wind shimmer は大小 2 層の deterministic sparse particles で構成される。

- large particles: 大きく見える粒。流速は base phase の約 1.72 倍。
- fine particles: 細かい粒。流速は約 2.48 倍。

表示範囲は単純な全球表示ではない。
terminator 直下を強調する細い ridge と、Gaussian tail を組み合わせる。

```txt
windBand = tail * (0.18 + 0.82 * ridge)
```

そのため、半影帯中心で強く、外側へ速やかに減衰する。

例:

- wind level が強く Q が高い: 粒が見えやすく、焦点が合う。
- humidity / cloud が高い: 音と同様に shimmer も丸く弱くなる。
- `?capture&capture-wind=1&capture-wind-trail=1`: 静止画用に粒を横方向に伸ばした capture 表現を出せる。

## 9. Audio / Visual synchronization

PENUMBRA では、音と視覚を別々のランダムで動かさない。
同じ canonical event field または同じ runtime parameter を共有する。

主な同期関係:

| 音 | 視覚 | 同期方法 |
|---|---|---|
| Human pluck | Human pulse glow | 同じ human pulse scheduler |
| Water high droplet | Rain dot | 同じ `water:high` canonical event |
| Water low / mid droplet | Water ripple | 同じ low / mid droplet event |
| Quake hit | Quake pulse dot | 同じ quake-local UTC pulse |
| Wind texture | Wind shimmer | 同じ wind texture params |
| Drone companion beat | Debug beat envelope | 同じ detune companion params |
| Clouds | Cloud shell | 共有 GFS forecast artifact |

この同期は「演出として合わせる」ものではなく、同じ原因を別の感覚形式へ出しているという扱いである。

## 10. 具体例

### 10.1 深い海を sunrise terminator が通る

条件:

- oceanDepth01 が高い
- waterRatio01 が高い
- nightlight が少ない
- built texture が低い

起こること:

- Drone root は低くなる。
- Water low droplet が増える。
- Water mid は海面の質感として薄く残る。
- Human layer は少ない。
- 画面には海の青と、水面に沿った低域 ripple が出やすい。

### 10.2 明るい都市圏を半影帯が通る

条件:

- nightLightNorm が高い
- building / road density が高い
- surfaceHardness01 が高い
- scanlineWeight が高い

起こること:

- Human contacts の候補が増える。
- 高密度時は pulse 間隔が伸び、外側 contact の発音確率が下がる。
- 中心付近の contact は発音しやすい。
- Pluck は upper partial が増え、硬質・金属的・空気的な響きが出やすい。
- 昼側なら常時灯りは見えないが、発音時に glow が現れる。
- 夜側なら presence light と pulse glow が重なって見える。

### 10.3 湿った森林域を走査線が読む

条件:

- forestRatio が高い
- humidity が高い
- cloud が高い
- surfaceHardness が低い

起こること:

- Earth noise は高域が丸くなる。
- Drone partial dispersion は整数倍音寄りに戻る。
- Human pluck は partial 数が減り、基音中心になる。
- Human lowpass は閉じ気味になる。
- Reverb damping が強まり、高域 tail が丸くなる。

### 10.4 開けた硬い地表に風がある

条件:

- wind01 が高い
- openness01 が高い
- surfaceHardness01 が高い
- surfaceRoughness01 が高い
- cloud / humidity が低い

起こること:

- Wind texture の band Q が上がる。
- Drone partial に吸着した narrow-band noise がはっきりする。
- Wind shimmer が強く、焦点が合い、速く流れる粒として見える。
- Drone companion の detune が増え、beat が聞こえやすくなる。

### 10.5 強い雨域が半影帯に入る

条件:

- GFS PRATE-derived precipitation activity が高い
- precipitation band が active reach 内にある
- water high density が上がる

起こること:

- High droplet が増える。
- Rain visual dot が同じ event に同期して出る。
- Rain granular が補助的に粒状感を足す。
- 雨 visual は強い雨 cluster を中心に出るため、画面全体に細かいノイズのようには散らばらない。

### 10.6 地震が 81 分窓内で走査線に入る

条件:

- event time が現在 UTC から 81 分以内
- quake の位置が active reach 内
- quake-local pulse gate を通過

起こること:

- Earthquake percussion が鳴る。
- Pitch は Earth drone root の subharmonic / partial fold に結びつく。
- depth が深いほど暗く丸くなる。
- cyan-blue 系の点が発音に合わせて現れ、fade out する。

## 11. UI / modes

Production UI は最小限にする。
現在の表示要素は、UTC、LON、DEC、Earth root / Drone / Earth beat widget、audio control、fallback status などである。操作がない時は UI が静かに fade out する。

`?debug` は開発用であり、production の体験ではない。
debug では contact count、scale mode distribution、earth params、rain visual、cloud diagnostic などを表示できる。

`?stream` は運用モードであり、別作品ではない。
stream mode でも canonical rendering path は同じで、違うのは cursor、UI、回復処理、配信用 wordmark などの運用差分だけである。

`?capture` はビジュアル出力用の mode である。
UTC と scene を固定し、地表、雲、nightlight、必要なら wind capture 表現を安定して出力する。音の瞬間イベントに依存する pulse 類は capture では原則抑える。

## 12. Fallback と失敗状態

PENUMBRA は fallback を隠さない。
代表的な fallback は以下。

- server UTC が取れない: HTTP Date または browser UTC へ fallback。
- GFS cloud forecast が stale / future / empty: cloud atlas を使わず、状態通知を出す。
- AudioWorklet が使えない: 同じ音を無理に node fallback で似せるより、明示的に degraded / paused を扱う。
- live weather が一時的に stale: 短時間の hold は許容し、過敏に fallback 表示しない。

Fallback 時に重要なのは、「違う作品として鳴らさない」ことだ。
PENUMBRA は同じ UTC に同じ構造で鳴ることを優先するため、ブラウザごとに大きく違う代替音を鳴らすくらいなら、該当経路を止めるか、明示的な状態表示を出す。

## 13. 現時点で残している調整余地

現在、作品としての大枠はほぼ完成しているが、次の項目は最終調整対象として残してよい。

- master output gain
- safety limiter の最終値
- long-run iPhone 負荷試験
- cloud forecast cron / deployment staging
- rain granular の production 上の存在感
- wind shimmer の capture 用 appearance
- public page 用の短縮コピー
- release 時の fallback / safety notice

これらは作品構造を変える調整ではなく、現在の構造を保ったまま公開品質へ寄せるための項目である。

## 14. 言葉づかい

公開文では、次の区別を守る。

- リスナーが聴く。
- 作品は鳴る、動く、続く。
- 装置が聴くとは書かない。
- 地震を警報、追悼、スペクタクルとして扱わない。
- PENUMBRA は災害を監視しない。

必要な安全文面:

```txt
PENUMBRA will continue without you.
You are more important than this stream.
```

この文面は作品を止めるためではなく、作品の外側でリスナーの安全を優先するためのものとして保持する。
