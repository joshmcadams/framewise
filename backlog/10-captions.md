# 10 — Captions kit (SRT/VTT parse + timed-text components)

**Status:** ready
**Effort:** M · **Depends on:** nothing (pairs with 02d `playbackRate` later)
**Unblocks:** social/explainer content — the biggest creator genres

## Audit verdict

Solid as drafted; nothing wrong with it. Four things worth pinning before an
agent starts, because they are where caption implementations actually go wrong:

1. **The frame-window rule must be stated as a formula, not as prose**, and the
   same formula must appear in the code, the test names, and the chapter.
2. **The parser should be usable from Node**, not just the browser — it is pure
   text→data and makes a good CLI validation target later. That means no DOM
   APIs in the parse path (no `DOMParser` for VTT).
3. **The fetch cache must be keyed and bounded**, and must not strand a
   `delayRender` handle on a 404 — the exact failure mode item 06 also has to
   avoid.
4. **Word-level timing is what makes this worth doing.** Plain timed text is 40
   lines; karaoke highlighting is the feature people want and the reason to
   design `tokens` into the type from the start rather than bolting it on.

## Design

### Parsing — pure, deterministic, DOM-free

```ts
type CaptionToken = {text: string; startSeconds: number; endSeconds: number};
type Caption = {
  startSeconds: number;
  endSeconds: number;
  text: string;          // newlines preserved for multi-line cues
  tokens?: CaptionToken[];
};

parseSrt(text: string): Caption[]
parseVtt(text: string): Caption[]     // tokens from <00:00:01.000> inline tags
serializeSrt(captions: Caption[]): string
serializeVtt(captions: Caption[]): string
```

Edge cases that get a golden-file test each — this list _is_ the test plan:

- CRLF line endings; leading UTF-8 BOM
- `HH:MM:SS,mmm` (SRT comma) vs `HH:MM:SS.mmm` (VTT dot); missing hours field
  (`MM:SS.mmm`, legal in VTT)
- multi-line cues; blank lines inside a cue block
- overlapping cue windows (two captions active at once — decide and document:
  v1 renders the **first** active cue and records the overlap in a warning)
- out-of-order cues (sort by start; do not assume file order)
- cue with `start >= end`, negative timestamps, non-numeric fields → **named
  errors** with the line number:
  `captions: malformed timestamp on line 12: "00:00:0a,000"`
- VTT header (`WEBVTT`), `NOTE` blocks, cue settings (`align:start line:90%`) —
  ignored in v1, but ignored _knowingly_, not by accident
- empty file → `[]`, not an error

### Rendering

```tsx
<Captions src={staticFile('captions.srt')} style={…} />
<WordHighlightCaptions captions={caps} activeStyle={…} inactiveStyle={…} />
```

**The window rule (state it exactly once, everywhere):**

> Composition frame `f` covers `[f/fps, (f+1)/fps)`. A caption is visible on
> frame `f` iff its `[startSeconds, endSeconds)` intersects that interval —
> i.e. `startSeconds < (f+1)/fps && endSeconds > f/fps`.

Half-open on both sides means a caption ending exactly at 2.000 s is not shown
on the frame beginning at 2.000 s. Put that sentence in the chapter and name a
test after it.

Selection is a pure function of `useCurrentFrame()` + `useVideoConfig()` — no
state, no effects. Invariant-safe by construction.

### Fetching

`<Captions src>` follows the established async-asset pattern (`Img.tsx:22-41`):
take a `delayRender('captions: <src>')` handle, fetch, parse, clear. Cache the
_parsed_ result module-level, keyed by `src`, bounded (LRU, mirroring the spring
cache). On fetch or parse failure: clear the handle **first**, then throw the
named error — a stranded handle turns a 404 into a 30-second timeout with the
wrong message.

Each parallel worker fetches once per page; that is correct and cheap. Say it,
so nobody adds cross-worker caching.

## Files touched

New `src/framewise-lite/captions.ts` (parse/serialize, DOM-free) +
`captions.test.ts` with a `__fixtures__/` folder of golden files; new
`Captions.tsx` + `WordHighlightCaptions` + test; barrel exports; demo
`WithCaptions` + registry entry + **pinned id list update in the same commit**
(`render-lib.test.mjs:288-306`); a sample `.srt` and `.vtt` in `public/`.

## STOP — decisions the executor must not make alone

1. **Whisper / speech-to-text is out of scope.** Document the community path
   (run whisper yourself, feed the SRT in); do not add a transcription
   dependency or a network call to a transcription service.
2. **Do not implement VTT cue positioning/styling** (`line:`, `align:`,
   `::cue`) in v1. Ignore them knowingly and say so.
3. **Do not invent a caption format.** SRT and VTT in, SRT and VTT out.

## Risks

- Parser edge cases — covered by the golden-file list above; that list is not
  optional.
- Handle leaks on error paths — assert `getPendingDelayRenders()` is empty after
  a failed fetch and after a parse error (drain in `afterEach`, per testing
  conventions).
- Overlapping cues silently dropping content — surface it rather than hiding it.

## Verification

- **Golden-file parser suite**, one fixture per edge case above, both formats
- **Round-trip:** `parseSrt(serializeSrt(caps))` deep-equals `caps` for a fixture
  with multi-line cues and tokens
- **Window rule:** parametrized test over the boundary frames of a cue —
  specifically the frame where `endSeconds` falls exactly on the boundary
- **Artifact:** render `WithCaptions`; extract stills at the first, middle, and
  last frame of a cue and at the frame _after_ it ends; confirm the text appears
  and disappears where the rule says
- **Karaoke:** at a chosen frame, exactly the expected word carries `activeStyle`
- Hash identical at `-c 1` vs `-c 4` (fetch happens once per worker page)

**Does not cover:** rendered-still checks confirm the right _text_ at the right
_frame_; they say nothing about legibility over busy footage. Note the
stroke/shadow props exist for that and are the author's call.

## Docs

New section in a media chapter, or a short chapter 14 if it outgrows one —
whichever, add the source-map entry. The window rule and the overlap policy are
the two things a reader must leave with. Tutorial gains a captions step. The
"DIY delayRender fetch" pattern in `docs/tutorial.md:337-343` gets a pointer to
`<Captions>` as the built-in version of the same idea.

## Definition of done

- [ ] SRT + VTT parse/serialize, DOM-free, every listed edge case fixtured
- [ ] window rule stated identically in code, tests, and chapter
- [ ] no stranded handles on fetch/parse failure (asserted)
- [ ] `WithCaptions` demo registered; pinned id list updated same commit
- [ ] stills confirm appearance/disappearance frames; karaoke word verified
- [ ] hash identical at `-c 1` vs `-c 4`
- [ ] chapter + source map + tutorial updated
