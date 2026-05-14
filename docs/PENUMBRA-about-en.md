# PENUMBRA — Earth Sequencer

A 24-hour generative music work where Earth's sunrise terminator is the playhead.

---

## What you are hearing

PENUMBRA is an *earth sequencer* — a new form of generative music in which the sunrise terminator, the line of dawn that travels around Earth once every 24 hours, acts as a planetary playhead.

What sounds at any given moment is determined by what the line of dawn is currently passing over: the topography, the climate, the human activity, the earthquakes that have occurred in the last 81 minutes. The work has no composer in the moment. Earth plays itself through the device.

You are hearing right now the sound of Earth as it actually is, in this exact instant, in timezone-independent UTC time. So is everyone else who has the work open.

---

## How it works

A line called the **sunrise terminator** divides Earth into day and night. Because Earth rotates once every 24 hours, this line moves westward across the planet, always tracing the boundary between night and dawn. PENUMBRA uses this line as a sequencer playhead.

Wherever the line currently passes:

- **Topography sounds.** The actual elevation of the land — from the deep ocean trenches to the highest mountains — determines the pitch register. The deep sea sounds in low frequencies; high mountains sound in high frequencies.
- **Climate sounds.** Shared UTC forecast data (cloud cover, atmospheric wetness, precipitation, and texture-derived wind) shapes the timbre, filter, and texture.
- **Human activity sounds.** Where there is night light — where humans live — tonal music emerges, drawn from one of eight tuning centers distributed geographically across the planet.
- **Earthquakes sound.** Any earthquake that has occurred within the last 81 minutes within the line's reach becomes percussion.

When the line passes over the open ocean, deep low resonances of the sea floor are heard. When it passes over the Himalayas, high mountain air is heard. When it passes over Tokyo, human music in the tuning of East Asia is heard. When it passes over a place where an earthquake has just occurred, it sounds as a drum.

Earth is doing this right now. The work simply runs.

---

## Philosophy

### The Earth does not judge

PENUMBRA does not celebrate sunrises and does not mourn earthquakes. The Earth itself does not distinguish between rhythm and disaster, between the beautiful and the catastrophic. We do. The work attempts, as far as is possible for a human-made artifact, to sound Earth on Earth's terms.

### It may sound, or it may not

The work makes no promise that any particular event will be heard. An earthquake that occurs while the dawn line is on the opposite side of the planet will not sound. A magnitude 8 earthquake that occurs 90 minutes before the line reaches it will not sound. This is not a flaw. It is the work's stance.

When you open PENUMBRA, the Earth at that moment may be quiet, or it may be intense. Beautiful moments and tedious moments are equal in this work. The work is a device that runs; what is heard is whatever happens to be there.

### About the cultural imprint

PENUMBRA's tonal layer draws on eight tuning centers — twelve-tone equal temperament, maqam, Indian tunings, slendro/pelog, East Asian pentatonicism, European church modes, West African scales with blues inflection, and Andean pentatonicism. Their geographical centers are placed in deserts, oceans, and unpopulated highlands rather than in particular cities, so that no nation is centered over another.

The work does not perform any of these traditions. It uses only their tuning grids — the abstract structure of which frequencies are permitted — and renders all sound through abstract synthesis. No instrument samples are used. No religious or ceremonial repertoire is invoked.

### About the absence of culture

This means that the work is not a map of world music. Many distinct musical cultures collapse into a single tuning grid here. The mapping is necessarily reductive. I acknowledge this, and ask the listener to hold the work as one specific abstraction of Earth, not as a representation of its musical wealth.

### A note from the author

> This work is made by a Japanese composer. I have chosen to give East Asian pentatonic structures their own gravitational center, not because it is more important than other traditions, but because I can speak honestly only from where I stand.

---

## The author's signature: 81 minutes

The earthquake time window in this work is 81 minutes.

At 5:46 AM JST on January 17, 1995, a magnitude 7.3 earthquake struck Awaji Island in Japan. I, then a child of seven, experienced this earthquake from Osaka. Sunrise in Kobe, near the epicenter, occurred at 7:06 AM that day. The difference is 81 minutes.

Thirty years later, while designing this work, I realized that PENUMBRA was a device that sounded earthquakes occurring near dawn. The choice of 81 minutes for the time window emerged from this realization. It is a value with no particular physical justification. The seismic waves that travel through Earth take only about 20 minutes; a 30-minute or 60-minute window would have served the function. 81 minutes is my signature inscribed into the device's parameters.

Earthquakes are not wished for. I hope none occur. But PENUMBRA is a device that sounds earthquakes, and this property does not waver. The 81-minute value remains in the work as a mark of an event that no one could prevent, made by someone who experienced it.

The work would have sounded the 1995 Hanshin-Awaji earthquake. It also continues to sound the dawn earthquakes that no one can prevent, as long as it runs.

This is not a privileging of any particular event. It is a signature.

---

## In the event of a disaster

> 災害発生時のお願い / In the event of a disaster
>
> 地震・津波・その他の災害が発生した際は、ご自身の安全を最優先してください。
> 本配信は作品としての性質を持つものであり、災害情報を提供するものではありません。
> また、24時間配信ですが、常時監視されているわけではありません。
> 公式の警報・避難情報に従い、安全な場所に避難してください。
>
> If a natural disaster occurs near you, your safety is the first priority.
> PENUMBRA is an artistic work, not a disaster monitoring service.
> This stream is not actively monitored at all times.
> Please follow official guidance and evacuate if necessary.
>
> **PENUMBRA will continue without you. You are more important than this stream.**

---

## What you are not hearing

PENUMBRA does not predict earthquakes. It does not warn. It does not provide disaster information. The presence or absence of sound in the work has no relationship to safety in the physical world.

The work does not teach you about the music of any place. It is a single specific abstraction of Earth, not a survey of human culture.

The work does not change. Earth changes. The work simply continues to run.

---

## Technical notes

PENUMBRA runs entirely in your browser. No server holds the state. The work calculates the sunrise terminator's position from the current UTC time and Earth's axial tilt, and renders the resulting sound and visuals locally. Real-time earthquake data is fetched from the United States Geological Survey. Cloud, atmospheric wetness, and precipitation are read from a shared NOAA GFS forecast artifact; Open-Meteo is not used in the public default runtime and remains only as a diagnostic fallback path. All other data — elevation, ocean depth, OpenStreetMap features, night lights, tuning kernels — is bundled with the work itself.

The work is designed to continue running for as long as the browser supports it, as long as the data sources remain available, and as long as Earth turns. I hope for at least the third condition.

The work is open source under AGPL-3.0. The source code is available at [repository URL when public].

---

## Data sources and acknowledgments

- **USGS Earthquake Hazards Program** — earthquake data
- **NOAA Global Forecast System (GFS)** — cloud, cloud-water, and precipitation forecast artifacts
- **Open-Meteo** — diagnostic fallback scanline-local weather data
- **NASA Blue Marble** — base imagery (where used)
- **NASA SRTM** — terrain elevation
- **GEBCO** — ocean bathymetry
- **VIIRS Nightlights** — human activity proxy
- **OpenStreetMap contributors (ODbL)** — surface features

PENUMBRA depends on Three.js, Tone.js, SunCalc.js, and astronomy-engine. Their licenses are listed in NOTICE.md.

---

## License and credits

PENUMBRA is licensed under **AGPL-3.0**.

```
PENUMBRA — Earth Sequencer
Copyright (c) 2026 kosame
Licensed under AGPL-3.0
```

The name "PENUMBRA" and the genre name "earth sequencer" are not trademarked. Penumbra is the Latin and English word for the partial shadow at the boundary of light and dark. It is an existing physical phenomenon. I do not claim it. The earth sequencer form is offered to anyone who wishes to make works in this lineage.

---

## Listening

The work is at penumbra.app.
The 24-hour stream is at [YouTube URL].

There is nothing to do. Earth is already turning.
