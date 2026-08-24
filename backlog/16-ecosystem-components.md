# 16 — Ecosystem components (Gif / shapes / paths / noise / Lottie / ~~three.js~~)

**Status:** 16a–d ready · 16e ready **as a documented recipe, not a barrel
export** · 16f **not planned** (see below)
**Effort:** S each for a–d · M for e · **Depends on:** varies, noted per item
**Unblocks:** content genres currently out of reach

## Audit verdict

The ordering-by-fit instinct was right, and 16a really is the cheapest big win.
Two changes:

- **16f (three.js / R3F) is cut, not deferred.** Headless WebGL rasterization
  depends on the GPU or the SwiftShader build, so frames would not be
  byte-identical across machines — or even across driver updates on one machine.
  That does not merely make it hard; it makes the sha256 integrity gate
  (invariant 1, the repo's central guarantee) _meaningless_ for any composition
  that uses it. Shipping it would mean either abandoning the gate for those
  compositions or shipping a guarantee that quietly does not hold. Recording it
  as **not planned, with the reason**, is more valuable than leaving it on a list
  for someone to re-derive.
- **16e (Lottie) ships as a recipe, not an export.** `lottie-web` is a ~500 KB
  runtime dependency, and `src/framewise-lite/` currently has **zero** runtime
  dependencies (only peer React). Adding one to the published library to serve
  one genre is a bad trade. A documented chapter + a demo composition (with
  `lottie-web` as a **devDependency**) gives authors everything and costs the
  library nothing.

The remaining four are all genuinely small, genuinely useful, and — importantly —
**pure math**, which is exactly what this codebase is good at testing.

---

## 16a — `<Gif>` embed · S · depends on nothing

The strongest of the group. The extraction middleware is already ffmpeg-backed
and format-agnostic (`offthread-server.mjs:57-59` builds a plain
`-ss/-i/-frames:v 1` command), so a GIF is just another input it can serve.

- Component mirrors `<OffthreadVideo>` (`OffthreadVideo.tsx:40-82`): render mode
  requests `/__framewise_extract/<key>/<frame>.png?fps=`, which flows through
  `<Img>` and therefore through `delayRender` — frame-accurate by construction.
- **Preview mode is the design question.** `<OffthreadVideo>` delegates to a live
  `<Video>` in preview (`OffthreadVideo.tsx:63-66`); a GIF has no seekable
  element. Options: (a) show the animated `<img>` unsynced with a documented
  caveat, (b) use the same extraction endpoint in preview (the dev server has the
  plugin either way — `render.mjs:475`, but `npm run dev` does **not**; check
  `vite.config.ts` before assuming). **Pick one and write down why**; this is the
  one non-obvious part of an otherwise mechanical item.
- Add `loop` / `playbackRate` semantics via frame mapping only (no element
  timers). GIF frame timing is per-frame-variable, so decide: honor the GIF's own
  delays (needs an `ffprobe` pass to read them) or treat it as a constant-fps
  source. v1: constant-fps at the composition's fps, **documented as a
  simplification** in the chapter's "what this simplifies" tradition.
- Verify against ffmpeg-extracted expectations (A/B a chosen frame).

## 16b — Shapes · S

`Circle`, `Rect`, `Triangle`, `Star`, `Pie`, `Ellipse` as pure SVG components
with frame-friendly props (radius, points, inner/outer ratio, corner radius).
~200 lines plus tests, zero deps. Pure geometry → unit-testable path strings
without a DOM. Snapshot the generated `d` attributes.

## 16c — Path utilities · S

`getLength(d)`, `getPointAtLength(d, l)`, `getTangentAtLength(d, l)`,
`evolvePath(progress, d)` → `{strokeDasharray, strokeDashoffset}` for
line-drawing animations (handwriting, map traces).

**Note the browser trap:** `SVGGeometryElement.getTotalLength()` needs a DOM and
is unavailable in jsdom, and its results can differ subtly between engines —
which would make a path animation non-deterministic across browser builds.
Implement the math in pure TypeScript (flatten cubic/quadratic béziers to a
polyline at a fixed tolerance) so it is deterministic _and_ testable without a
DOM. Say that in the chapter; it is the interesting lesson in this component.

## 16d — Noise · S

Seeded simplex/perlin `noise2D`/`noise3D`/`noise4D` consistent with
`random.ts`'s determinism rules (`random.ts:24-37`). Enables organic motion
without breaking the sha256 gate. Pure math, easy to test: same seed → same
sequence, known-value regression vectors, output range assertions. **Pin
reference vectors in the test** so a future refactor cannot silently change every
existing composition's motion.

## 16e — Lottie · M · as a recipe

- Demo composition + chapter section; `lottie-web` as a **devDependency**.
- The trap, and the whole teaching point: **lottie's own timers must never be
  trusted.** Use `goToAndStop(frame / fps * 1000, true)` for a forced seek, gated
  by a `delayRender` handle per frame, and never call `play()`.
- Cache the animation JSON by src; clear handles on error paths (same rule as
  items 06, 10, 11).
- Verification: render the same frame set twice and confirm identical hashes —
  seek determinism is the entire risk.
- If a future consumer really wants it in the library, that is a separate
  proposal that must argue for the first runtime dependency.

## 16f — three.js / @react-three/fiber · **NOT PLANNED**

Reason, recorded so it is not re-derived: headless WebGL output depends on the
GPU/SwiftShader build and driver, so frames are not reproducible across machines
and the sha256 integrity gate stops meaning anything for such compositions.
Reconsider only if someone first solves "how does the determinism gate work for
GPU-rasterized frames" — that is the actual blocking question, and it is a
research question, not an implementation task.

---

## Shared rules for every component in this group

- One module + colocated test + one demo composition each, **each with its own
  plan** — they are independent and should not be batched into one commit.
- Every new demo composition updates the pinned id list
  (`render-lib.test.mjs:288-306`) in the same commit.
- Every one gets a chapter or a chapter section plus a source-map entry — "docs
  are the product" applies to small components too.
- Every one is verified the same way: unit suite (pure math without a DOM where
  possible) + artifact render stills at meaningful frames + hash identity at
  `-c 1` vs `-c 4`.
- **Zero new runtime dependencies in `src/framewise-lite/`** — 16a–d all satisfy
  this; 16e is the reason it ships as a recipe.

## STOP — decisions the executor must not make alone

1. **Do not add a runtime dependency to the library** for any of these.
2. **Do not use DOM measurement APIs** (`getTotalLength`, `getComputedStyle`,
   `measureText`) in path or shape math — they are engine-dependent and
   untestable in jsdom.
3. **Do not resurrect 16f** without answering the determinism question first.

## Definition of done (per component)

- [ ] pure math implemented and unit-tested without a DOM
- [ ] demo composition registered; pinned id list updated same commit
- [ ] artifact stills at meaningful frames inspected
- [ ] hash identical at `-c 1` vs `-c 4`
- [ ] chapter/section + source-map entry
- [ ] zero new runtime dependencies
