# Plan 023 — Sample-accurate A/V sync: measured analysis (Phase 2 item 3)

**Status:** DONE (2026-08-23) — measured on a live render (AAC 44.1 kHz mp4):
blip onset 2.00011–2.00027 s against an exact expectation of 2.000000 s
(+0.11–0.27 ms, threshold-dependent), blip end −0.1–0.2 ms, container
start_time 0.000000. The theoretical ±0.5 ms adelay rounding bound holds.
Verdict recorded in chapter 9's new "How sample-accurate is it? (measured)"
section with reproduction commands and the per-stage error table: render-path
placement is sub-audible (~±0.5 ms); what remains frame-granular is volume
automation timing (by design) and preview drift-snap (by design). No code
change was warranted — the `-itsoffset` candidate stayed in its STOP gate
because measurement showed adelay already inside its bound. Phase 2 complete.
**Priority:** P3 · **Effort:** S · **Risk:** NONE (documentation deliverable; code changes only if evidence demands a cheap, verified fix)
**Depends on:** none open (plans 021/022 landed; this closes Phase 2)
**Category:** direction (README's last media-fidelity omission)

## Why

Chapters 9/10 say "best-effort, not sample-accurate, by design" without ever
quantifying _how far off_ best-effort is, or which stage contributes what. An
honest engineering answer needs three things: an inventory of error sources
with magnitudes, empirical measurements on real renders, and a verdict on
which of them matter (audibility thresholds: ~1 ms for aligned transients,
~20+ ms for lip sync).

## Error-source inventory (to be confirmed by measurement)

RENDER path — video frames are pixel-exact by construction (each PNG **is**
the frame), so audio placement is measured against a perfect reference:

| # | Source | Expected magnitude |
| - | ------ | ------------------ |
| 1 | Segment placement quantizes to whole ms (`adelay` takes integer ms; `Math.round(startFrame/fps*1000)`); 30 fps grid = 33.33 ms | ≤ 0.5 ms per segment |
| 2 | Trim points (`atrim=start=mediaTime`) are exact rationals (frame/fps) | ~0 |
| 3 | Volume automation granularity: one constant value per frame interval | ≤ half a frame of "wrong" gain (≤ 16.7 ms @30fps), matching the visual frame granularity |
| 4 | AAC encoding priming/padding + player edit-list handling | potentially ~21–46 ms if a player ignores gapless metadata |
| 5 | Container `start_time` non-zero offsets | measure |

PREVIEW path (best-effort by design):

| # | Source | Expected magnitude |
| - | ------ | ------------------ |
| 6 | rAF clock granularity + wall-clock derivation | ~16.7 ms |
| 7 | Drift-tolerance snapping (0.3 s) between snaps | up to 300 ms while playing |
| 8 | Element seek/play latency + OS output latency | platform-dependent, ms–tens of ms |

## Steps

1. **Measure render-path placement**: render `WithAudio`; detect the blip's
   actual onset in the output with `silencedetect`, compare against its exact
   expected time (frame 60 = 2.000000 s). Report the delta.
2. **Measure container/AAC effects**: `ffprobe` the output's audio stream
   `start_time`; compare onset deltas between the raw mix timeline and the
   encoded file; state plainly whether a player honoring edit lists sees 0 or
   the priming offset.
3. **Verify the adelay rounding bound analytically** against every segment in
   the rendered log (all placements must round-trip within 0.5 ms).
4. **Write it up** in chapter 9 ("How sample-accurate is it?" section with
   method, numbers, and reproduction commands); cross-reference from chapter
   10's simplified list; update README/OVERVIEW omission notes to point at
   the measured answer instead of a shrug.
5. **Code change only if evidence demands it** and it stays cheap + fully
   tested (candidate: replace `adelay` ms rounding with `-itsoffset` input
   placement if #1 measures above its theoretical bound). Otherwise record
   the verdict and stop.
6. Gate: `npm run verify`.

## STOP conditions

- Measurement contradicting the inventory table by >2× → investigate before
  writing conclusions; don't paper over it.
- Any proposed code fix touching more than `planEncode` args + its tests →
  stop and report first.

## Done means

Measured section lives in chapter 9 with reproducible commands; omissions
lists reference real numbers; verify green; plan header + row flipped DONE.
