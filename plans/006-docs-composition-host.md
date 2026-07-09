# Plan 006: Fix walkthrough drift — teach CompositionHost, regenerate the source-tree map

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 985ca38..HEAD -- docs/ src/framewise-lite/CompositionHost.tsx src/framewise-lite/Player.tsx src/render/main-render.tsx`
> If the source files changed since this plan was written, quote the LIVE code
> in the docs, not this plan's excerpts. If the docs chapters changed, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (docs only)
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `985ca38`, 2026-07-09

## Why this matters

The guided code walkthrough in `docs/code/` is this repo's product as much as
the code — and it currently teaches provider wiring the code abandoned when
`CompositionHost` was extracted (backlog item 03). Chapters 5, 7, and 9 show
the Player and render entry each inlining `<VideoConfigProvider>`/
`<FrameProvider>`, and **no chapter mentions `CompositionHost`** — the one
component that enforces the walkthrough's own central thesis ("the preview and
the export run the identical component code"). The chapter index's source-tree
map is also stale: it omits four library files and six of the eight test
suites. A reader following the tour builds a wrong mental model of the exact
seam the docs exist to teach.

## Current state

- `src/framewise-lite/CompositionHost.tsx` — the real wiring (read the whole
  41-line file before writing). Key facts to teach: both frame sources render
  through it; preview passes `playback`, render omits it; a null
  PlaybackContext is how `<Audio>`/`<Video>` detect render mode:

  ```tsx
  return playback ? (
    <PlaybackProvider value={playback}>{tree}</PlaybackProvider>
  ) : (
    tree
  );
  ```

- `src/framewise-lite/Player.tsx:190` — actual Player render:

  ```tsx
  <CompositionHost config={config} frame={frame} playback={playbackValue}>
  ```

- `src/render/main-render.tsx:78-93` — actual render entry (plan 003 added
  `beginAudioFrame()` at line 81; the CompositionHost call is at lines 86-91):

  ```tsx
  const renderFrame = (frame: number) => {
    // Arm audio collection BEFORE the render pass, so each <Audio>'s layout effect
    // reports into a freshly-cleared bucket for this frame.
    beginAudioFrame();
    // flushSync forces React to commit synchronously, so the DOM reflects this
    // frame *before* the renderer takes its screenshot.
    flushSync(() => {
      root.render(
        // No `playback` prop: the PlaybackContext stays null, which is how
        // <Audio>/<Video> know they're rendering and must not drive the element.
        <CompositionHost config={config} frame={frame}>
          <Component {...mergedProps} />
        </CompositionHost>,
      );
    });
  };
  ```

Drift sites (all verified against the live files):

1. `docs/code/05-player.md:164-172` — shows the Player inlining
   `<VideoConfigProvider><FrameProvider>` and says "The Player wraps the
   user's `component` in both providers."
2. `docs/code/07-renderer.md:44-57` — shows `main-render.tsx`'s `renderFrame`
   inlining both providers and rendering `<Component {...comp.defaultProps}>`;
   the real file uses `CompositionHost` and `mergedProps` (CLI `?props=`
   merged over defaults), and the `window.framewiseLite` surface now also has
   `getPending`, `getAudioFrame`, `compositionIds`.
3. `docs/code/09-audio.md:149` — says "`Player.tsx` wraps the composition in
   `<PlaybackProvider value={{playing}}>`"; that conditional wrap now lives in
   `CompositionHost.tsx:36-40`.
4. `docs/code/README.md:81-112` — the "Map of the source tree" omits
    `CompositionHost.tsx`, `staticFile.ts`, `random.ts`,
    `delay-render-defaults.mjs`/`.d.mts`, and lists only 2 of the test files
    (`interpolate.test.ts`, `spring.test.ts`).

Pedagogical constraint: chapter 7 teaches the *Stage 2* renderer as it was
first built, and later chapters layer on audio/props. Do NOT rewrite its
narrative arc — update the code blocks to match today's file and add short
forward references ("the file has since grown X — chapter N") where the
staging would otherwise look like an error.

Style: match the existing chapters — prose-first, code blocks quoted from real
files, one idea per section, em-dash-heavy explanatory voice.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Drift gone | `grep -n "The Player wraps the user" docs/code/05-player.md` | no match |
| Coverage | `grep -rln "CompositionHost" docs/code/` | at least: 05-player.md, 07-renderer.md, 09-audio.md, README.md |
| Map | `grep -n "CompositionHost.tsx" docs/code/README.md` | one hit in the tree block |
| Sanity | `npm test` | still 51+ passing (docs-only change) |

## Scope

**In scope**:
- `docs/code/05-player.md`
- `docs/code/07-renderer.md`
- `docs/code/09-audio.md`
- `docs/code/README.md`
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- Any source file.
- Other chapters (01, 02, 03, 04, 06, 08, 10, 11) — unless you find a literal
  `VideoConfigProvider`-inlining code block in them too; if so, report it,
  don't expand scope silently.
- `docs/code/06-demo-and-wiring.md:154-155` — shows `VideoConfigProvider`/
  `FrameProvider` in a conceptual tree diagram ("one frame's journey"). This
  is a diagram, not source code; updating it would require restructuring the
  chapter's narrative. Deliberately out of scope.
- Top-level `README.md`.

## Git workflow

- Branch: `advisor/006-docs-composition-host`
- One commit, e.g. `Docs: teach CompositionHost, sync chapters 5/7/9 and the source map`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Chapter 5 — introduce CompositionHost where the Player renders

Read `docs/code/05-player.md` in full. Replace the lines 164-172 code block
with the real `<CompositionHost config={config} frame={frame} playback={playbackValue}>`
usage, and rewrite the surrounding prose: the Player delegates the provider
stack to `CompositionHost`, the single canonical wrapper both frame sources
share, so preview and export cannot drift. Add a short (~10-15 line) subsection
— "One wrapper, two frame sources" — quoting the conditional-playback return
from `CompositionHost.tsx:30-40` and stating the null-context contract (render
mode == no playback). Keep the existing point that `config` is memoized.

**Verify**: `grep -n "CompositionHost" docs/code/05-player.md` → ≥ 2 hits;
`grep -n "wraps the user's \`component\` in both providers" docs/code/05-player.md` → no match.

### Step 2: Chapter 7 — sync the render-entry code block

Read `docs/code/07-renderer.md` in full. Update the lines 44-57 block to match
today's `main-render.tsx:71-97` (CompositionHost, `mergedProps`, and the full
`window.framewiseLite` object). Where the chapter's Stage-2 narrative predates
audio/props, add one-line staging notes rather than rewriting: e.g. "at Stage 2
this object held only `config` and `renderFrame`; audio collection (ch. 9) and
CLI props (ch. 11/README) later widened it." Point out explicitly that the
render entry passes NO `playback` — and cross-reference the chapter 5
subsection.

**Verify**: `grep -n "CompositionHost" docs/code/07-renderer.md` → ≥ 1 hit;
`grep -n "VideoConfigProvider" docs/code/07-renderer.md` → no hits inside the
renderFrame code block (checking the stale inline wiring is gone).

### Step 3: Chapter 9 — correct the PlaybackProvider attribution

At `docs/code/09-audio.md:149`, change the claim so it names
`CompositionHost` as the place the conditional `<PlaybackProvider>` wrap
lives (the Player just passes `playbackValue` down). One or two sentences;
keep the surrounding Job-1/Job-2 framing untouched.

**Verify**: `grep -n "PlaybackProvider" docs/code/09-audio.md` → the hit's
sentence mentions CompositionHost.

### Step 4: Regenerate the source-tree map

In `docs/code/README.md:81-112`, update the tree block to reflect the actual
`src/` contents: add `CompositionHost.tsx` (annotate: "shared provider stack —
both frame sources render through it (ch. 5, 7)"), `staticFile.ts`,
`random.ts`, `delay-render-defaults.mjs` + `.d.mts` ("shared timeout constants
for TS and render.mjs"), and `playback.ts` if missing. For tests, replace the
two-file listing with one line: "`*.test.ts(x)` — each core module has a
colocated test suite." Run `ls src/framewise-lite/ src/render/ src/compositions/`
first and mirror reality, not this plan.

**Verify**: `grep -c "test" docs/code/README.md` — the map no longer
enumerates individual stale test files; `grep -n "CompositionHost.tsx" docs/code/README.md` → 1 hit.

## Test plan

Docs-only: the greps above are the machine checks. Additionally read each
modified chapter top-to-bottom once and confirm every code block still
compiles-by-inspection against the live source it quotes (quote real lines).

## Done criteria

- [ ] All four grep verifications above pass
- [ ] `grep -rn "FrameProvider" docs/code/05-player.md docs/code/07-renderer.md` — remaining hits (if any) are in prose explaining CompositionHost's internals, not in stale Player/renderer wiring examples
- [ ] `npm test` still green (nothing but docs changed)
- [ ] Only the four docs files + `plans/README.md` modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The live `Player.tsx`/`main-render.tsx` no longer match this plan's excerpts
  (quote the live code — but if the architecture itself changed again, e.g.
  CompositionHost was renamed/removed, STOP).
- You find yourself wanting to restructure a chapter's narrative rather than
  sync its code blocks — that's a bigger editorial decision; report it.

## Maintenance notes

- Plans 010 and 016 add further docs content (staticFile/random coverage; an
  Easing chapter) — they assume this plan's corrected map and will extend it.
  Land 006 before them to avoid merge conflicts in `docs/code/README.md`.
- The repo needs a standing rule (plan 008 puts it in CLAUDE.md): any change
  to a module with a chapter must update that chapter in the same commit.
