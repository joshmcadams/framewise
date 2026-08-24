# 14 — Resumable renders (frame cache reuse)

**Status:** ready, but **deprioritized** — lowest value-to-risk ratio in the
backlog. Read the honest-value section before promoting it.
**Effort:** M · **Depends on:** 00b, 04, and a stable frames dir (below)
**Unblocks:** iteration speed on long compositions; crash recovery

## Audit verdict

Technically sound, and the "opt-in because the failure mode is silent wrong
pixels" instinct is exactly right. But two things need saying:

1. **The frames dir is a `mkdtemp` temp dir that is deliberately destroyed**
   (`render.mjs:471`, removed by `cleanup()` at `:513`). There is nothing to
   resume _from_ today. This item's real first step is adding a stable,
   opt-in `--frames-dir <path>` that `cleanup()` does not delete — a change to
   the resource-ownership model, not just a skip check. The first draft did not
   mention it.
2. **`bundleHash` — "hash of served bundle contents" — does not exist.** The
   renderer runs a **Vite dev server** (`render.mjs:472-476`); nothing is
   bundled. There is no artifact to hash. A real invalidation key has to be
   built from the source tree.

### Honest value assessment

The repo already measured parallel rendering at **−69% wall time at `-c 4`**
(plan 024). Most compositions here are 90–150 frames. So the population this
helps is: long compositions, on machines where a render takes long enough that a
crash is expensive. That is a real population, but it is not the one most of this
backlog serves — and it is the only item whose failure mode is _silently wrong
output_ rather than a loud error. Ship items 00b/01/03/04/06 first; promote this
when someone actually has a render long enough to want it.

## Design

### Prerequisite: `--frames-dir <path>`

- Default stays `mkdtemp` + delete: no behavior change for anyone not asking.
- With `--frames-dir`, the directory persists across runs and `cleanup()` skips
  the `rm` — but still closes browsers and the server
  (`render.mjs:496-517` gains a conditional, not a bypass).
- Note the interaction: `<OffthreadVideo>`'s extraction cache lives under the
  frames dir (`render.mjs:475`), so a persistent frames dir also persists
  extracted video frames. That is a bonus, and it is also a second thing that can
  go stale — key it the same way.

### The manifest

```json
{
  "version": 1,
  "compId": "HelloWorld",
  "configHash": "sha256(width|height|fps|durationInFrames)",
  "propsHash": "sha256(canonical json of RESOLVED props)",
  "sourceHash": "sha256(src/** + public/** + package-lock.json)",
  "captureHash": "sha256(format|scale|jpegQuality|alpha)",
  "frames": {"00042": "sha256 of the frame file"}
}
```

- **`propsHash` must be over the _resolved_ props** (after `defaultProps` merge
  and `calculateMetadata`, `registry.ts:234-249`), not the CLI string — otherwise
  `--props '{"a":1}'` and `--props '{ "a": 1 }'` look different, and a changed
  default looks the same.
- **`sourceHash` replaces the mythical `bundleHash`.** Content hash over `src/**`
  and `public/**` plus `package-lock.json`, with a stable file ordering. Coarse
  on purpose: editing any source file invalidates everything. That is the honest
  default, and it is what makes the feature safe.
- **`captureHash`** covers item 05's settings — a `--scale 0.5` cache must never
  be served to a scale-1 run.
- **Build this hash helper once and share it with item 08b's thumbnail cache.**
  Two definitions of "did anything change" is how one of them ends up wrong.

### `--reuse-frames` (opt-in)

Skip capture for frame `f` when **all** hold: the manifest exists, all four
hashes match, `frame-%05d.*` exists, and its content hash equals the manifest
entry. Verify-on-skip costs one file read and hash — far cheaper than a capture,
and it is what makes a truncated file (crash mid-write) fail closed.

Write the manifest **atomically** (temp + rename) and update it incrementally so
a crash leaves a valid, smaller manifest rather than a corrupt one.

Report reused vs captured counts through item 04's events
(`{type:'frame', frame, ms, reused: true}`) so the studio and batch summaries
show it without special-casing.

## Files touched

`scripts/render.mjs` (`--frames-dir`, `--reuse-frames`, conditional cleanup,
skip path in the capture loop `:374-424`), new `scripts/frame-cache.mjs`
(manifest read/write, hashing, the shared source-hash helper) + tests. No encode
changes.

## STOP — decisions the executor must not make alone

1. **Do not make reuse the default**, ever. The failure mode is a video that
   looks right and is wrong.
2. **Do not use mtimes** for invalidation. `git checkout` moves mtimes without
   changing content, and editors touch files without changing them. Content
   hashes only.
3. **Do not skip the per-frame content verification** as an optimization. It is
   the thing that turns "crash mid-write" from silent corruption into a
   re-capture.
4. **Do not include `node_modules` in `sourceHash`** (too slow) — `package-lock.json`
   stands in for it, and the docs must state that a hand-edited dependency inside
   `node_modules` is not detected.

## Risks

- **Silently wrong pixels** — the whole risk of this item. Mitigations, in order
  of strength: opt-in flag; four-part hash key; per-frame verify-on-skip; docs
  that state when not to reuse.
- **Non-determinism in user code** would already have violated the sha256 gate,
  so reuse does not make it _worse_ — but it does make it _invisible_ for the
  reused frames. Say that.
- **Parallel skips** — with `-c 4`, four workers consult the same manifest.
  Manifest reads must be safe concurrently, and two workers must never both
  capture the same frame. Test it.
- **Disk growth** — a persistent frames dir is unbounded. Document it and
  consider a `--prune-frames` companion or at least a size line in the summary.

## Verification

- **Kill and resume:** start a render, `SIGKILL` at ~60%, re-run with
  `--reuse-frames --frames-dir …`; it completes, and **the final frame-set
  sha256 equals an uninterrupted run's**. This is the acceptance test.
- **Invalidation, one test each:** touch a composition file → 0 frames reused;
  change `--props` → 0 reused; change `--scale` → 0 reused; change nothing →
  100% reused
- **Corruption fails closed:** truncate one cached frame file → that frame is
  re-captured, not served
- **Crossings:** `--reuse-frames` × `-c 4` (no double-capture, no double-write),
  × `--distributed`, × `--frames` subset (item 05)
- Manifest atomicity: kill during the manifest write; the file left on disk still
  parses

**Does not cover:** hash equality with an uninterrupted run proves the _frames_
are right; it says nothing about the encoded file, which is re-encoded from
scratch each time anyway. Say that so nobody thinks resume covers encoding.

## Docs

Chapter 7 (or 11, next to the parallel-rendering material) gains "Resuming a
render": the invalidation rules spelled out as a table, the opt-in rationale, and
an explicit "when not to use this". README flag description.

## Definition of done

- [ ] `--frames-dir` persists and is excluded from cleanup, without changing the
      default path's behavior
- [ ] four-part manifest key; source-hash helper shared with item 08b
- [ ] kill-and-resume produces a hash identical to an uninterrupted run
- [ ] all four invalidation tests green; truncated frame fails closed
- [ ] `-c 4` reuse tested for double-capture
- [ ] chapter updated with the invalidation table and the "when not to" section
