# AGENTS.md — scripts/ (renderer + audio)

Working in `scripts/render.mjs` / `render-lib.mjs` / `offthread-server.mjs`?
Read root [`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](../CLAUDE.md) first;
this file is only the verification playbook specific to this directory.

## Verify the artifact, not the log

A green renderer run proves nothing by itself. Depending on what you changed,
at least one of:

- `ffprobe -v error -show_entries format=duration,stream=codec_name ...` on
  the output (codec/container/duration claims).
- The frame-set sha256 the renderer prints — must be **identical** across
  local vs `--concurrency N` vs `--distributed`, and before/after a refactor
  that shouldn't change pixels.
- A/B against the pre-fix worktree (`git worktree add`) when replacing an
  implementation: same comp, compare segment counts / intermediate metrics /
  output hash side by side.

## Measure filters through REAL ffmpeg with the exact emitted chain

Unit tests pin filter-graph _text_; only ffmpeg proves behavior. Import the
real builders instead of retyping expressions:

```js
import {planEncode, volumeFilterToken} from './render-lib.mjs';
```

Then run your measurement against the exact string those emit. This caught
the nested-`if()` limit (~90 levels) and the audio-frame resolution smear —
both invisible in tests.

## ffmpeg invocation traps

- Dumping raw PCM: name the format explicitly (`-f s16le`). An extension like
  `.pcm` makes ffmpeg guess an exotic muxer and fail confusingly.
- Normalizing measurements against the source: write the source to raw PCM
  too and divide by its MEASURED peak. Assuming full-scale int16 or guessing
  wav header offsets produces silently wrong numbers.
- The expression parser rejects nesting past ~90 levels — prefer flat forms.

## Flag crossings

Any new CLI flag gets checked against every orthogonal one it can combine
with: `--format mp4|webm|gif|png-seq`, `--still` (mutually exclusive with
`--format`/`--concurrency`), `--concurrency`, `--distributed` (excluded with
`--still`/png-seq), `--props`. Add the exclusivity error up front if a
combination is meaningless; add a test pinning each allowed/disallowed pair.

## Failure-shape checks need real failures

Named-error paths (backstops, timeouts) are verified live: build a temp
composition that wedges/hangs/rejects, watch the named error arrive at the
expected layer, then delete the temp files. Generic timeouts further up the
ladder mean the naming contract broke — see invariant 5 in CLAUDE.md.
