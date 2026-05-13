# Stream and Safety

`?stream` is an operational mode for long-running capture. It is not a separate artwork.

## Stream Mode

Open:

```text
http://127.0.0.1:5173/?stream
```

Stream mode keeps the same canonical UTC state, same sunrise terminator, same visual work, and same audio engine as the normal browser work.

Operational differences:

- target frame rate is capped at 30fps
- WebGL pixel ratio and terrain marker geometry are capped for long-running capture stability
- cursor is hidden
- the work title `penumbra` is shown as a restrained lower-center Cormorant SC typographic mark for capture context
- the app requests fullscreen from the next user gesture, usually the audio start click
- a watchdog reloads if the render heartbeat stalls
- runtime errors and unhandled promise rejections trigger a recovery reload
- a scheduled refresh runs every six hours

These behaviors serve capture stability only. They do not move the playhead, alter the mapping, change the mix, or create stream-only dramaturgy.

## Public Safety Copy

The live safety text is available as:

- `copy/live-safety-copy.md`
- `public/live-safety.txt`
- a hidden accessibility copy in stream mode

Required text:

```text
災害発生時のお願い / In the event of a disaster

地震・津波・その他の災害が発生した際は、ご自身の安全を最優先してください。
本配信は作品としての性質を持つものであり、災害情報を提供するものではありません。
また、24時間配信ですが、常時監視されているわけではありません。
公式の警報・避難情報に従い、安全な場所に避難してください。

If a natural disaster occurs near you, your safety is the first priority.
PENUMBRA is an artistic work, not a disaster monitoring service.
This stream is not actively monitored at all times.
Please follow official guidance and evacuate if necessary.

PENUMBRA will continue without you.
You are more important than this stream.
```

## YouTube Metadata

The YouTube draft is available as:

- `copy/youtube-metadata.md`
- `docs/youtube-metadata.md`
- `public/youtube-metadata.md`

The stream should be categorized as Music, not News. The description should identify PENUMBRA as an artistic work and generative music before any mention of earthquakes or live data.
