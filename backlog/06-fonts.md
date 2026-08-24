# 06 — Font loading helper (`loadFont`)

**Status:** ready
**Effort:** S · **Depends on:** 02a (`cancelRender`) is a soft nice-to-have, not
a blocker
**Unblocks:** closes the documented fallback-font gap; 02c (`preloadFont`);
makes any text-heavy demo honest

## Audit verdict

Correct, small, and high value — this closes a gap the docs already admit
(`docs/code/07-renderer.md:319-322`: `document.fonts.ready` is called "a
_gesture_ toward fixing this… deliberately insufficient"). One correction and
two additions:

- The first draft cited `07-renderer.md:310-320`; the actual passage is
  **`:316-322`**. Minor, but these citations are load-bearing for the executor.
- The `applyViewport` await (`render.mjs:369`) runs **once per worker before the
  frame loop**. A font registered later — by a component, on a later frame —
  is not covered. That is the precise hole, and it is worth stating that way
  because it explains why a `delayRender`-gated loader is the fix rather than
  "await fonts.ready again".
- **`document.fonts.load()` resolves for a font that failed**, returning an empty
  array of matched faces rather than rejecting. Checking only the promise gives
  you a silent fallback — exactly what this item exists to prevent. Check
  `FontFace.status === 'loaded'` explicitly.

## Design

```ts
const {family, waitUntilDone} = loadFont({
  family: 'Inter',
  url: staticFile('fonts/Inter-Bold.woff2'),
  weight: '700', // default '400'
  style: 'normal', // default 'normal'
  display: 'block', // default 'block' — never flash a fallback
});
```

Mechanism:

1. Construct `new FontFace(family, `url(${url})`, {weight, style, display})`.
2. `document.fonts.add(face)`.
3. Take a `delayRender(`font: ${family} ${weight}`)` handle
   (`delay-render.ts:36-57`) and clear it when `face.load()` resolves **and**
   `face.status === 'loaded'`. The renderer's existing per-frame pending-handle
   wait (`render.mjs:385-405`) then makes every frame deterministic — no new
   renderer code at all, which is the point.
4. On failure: `continueRender` the handle first (never strand it), then throw a
   named error `` `font failed to load: ${url} (${family} ${weight})` ``. Once
   02a lands, route it through `cancelRender` so the CLI gets a fast named
   failure instead of a React error.

**Cache:** module-level `Map` keyed by `family|url|weight|style`. Repeated calls
return the same promise, so N components asking for one font take one handle.
Each parallel worker has its own page and therefore its own cache — that is
correct and costs one load per worker; say so rather than trying to share.

**`display: 'block'`** as the default is deliberate: `swap` would render a
fallback _and then_ the real face, which is precisely the non-deterministic
frame this item removes. Comment the choice in the source.

## Files touched

- **New** `src/framewise-lite/fonts.ts` + `fonts.test.ts`
- `src/framewise-lite/index.ts` barrel
- A demo that actually exercises it: **prefer adding the webfont to the existing
  `HelloWorld`** over registering a new composition — that avoids touching the
  pinned id list (`render-lib.test.mjs:288-306`) and puts the font on the
  composition everyone renders first. If you do add a new comp, update the
  pinned list in the same commit.
- `public/fonts/` — one small, licensed woff2 (check the license, note it in the
  README asset list)

## STOP — decisions the executor must not make alone

1. **Which font file ships in `public/`.** It is a licensing question. Prefer an
   SIL OFL face and record the license in the repo.
2. **Do not build the Google-Fonts catalog codegen here.** That is a separate,
   larger item (typed catalog, hundreds of families). This item is the loader.

## Risks

- **jsdom has no `FontFace`.** Mock at module level, the convention used for
  `probe-media` (`src/render/AGENTS.md`). The unit tests then prove the
  _bookkeeping_ — handle taken, handle cleared, cache hit, named throw — and the
  artifact render proves reality. Say which test proves which; do not let the
  mocked suite imply the font actually loaded.
- **Handle leaks on the error path** are the specific failure this item could
  introduce. Drain the registry in `afterEach`
  (`delay-render.test.tsx:17-21`) and add a test that asserts
  `getPendingDelayRenders()` is empty after a _failed_ load.
- **StrictMode double-invocation** — the cache makes the second call a no-op, but
  test it: `<Img>`'s comment (`Img.tsx:15-17`) exists because this exact class of
  bug bit before.

## Verification

- unit: handle cleared on success; handle cleared _and_ named error thrown on
  failure; second call returns the identical promise; `status !== 'loaded'` is
  treated as failure even when the promise resolved
- **artifact:** render a still of the webfont demo and confirm the glyphs are the
  intended face, not a fallback (compare against a still rendered with the
  `loadFont` call removed — the point is that the two differ before the fix and
  the fallback one is what today's renderer can produce)
- render twice → hash-identical
- **crossing:** `-c 4` — every worker loads the font independently and the hash
  still matches `-c 1`

**Does not cover:** this proves the font is loaded before capture. It does not
prove text _layout_ is identical across platforms — it is not, and that is a
different (unsolved, honest) problem worth one sentence in the chapter.

## Docs

- `docs/code/07-renderer.md:316-322` — rewrite the caveat: the gesture is now a
  fallback and `loadFont` is the answer; keep the explanation of _why_
  `fonts.ready` alone is insufficient, because that is the teaching
- `docs/code/08-delay-render.md` — a line noting `loadFont` as a second canonical
  `delayRender` use alongside `<Img>`
- tutorial media step gains fonts; source-map entry

## Definition of done

- [ ] `loadFont` exported; cache, named failure, and `status` check all tested
- [ ] no pending handles after a failed load (asserted)
- [ ] demo renders with the real face; before/after stills compared
- [ ] hash identical at `-c 1` and `-c 4`
- [ ] chapter 7 caveat rewritten; chapter 8 cross-reference; tutorial + source map
- [ ] font license recorded
