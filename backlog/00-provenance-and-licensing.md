# 00 — Provenance, attribution, and licensing cleanup

**Status:** **TOP PRIORITY — do this before anything else in this backlog**
**Effort:** S for the investigation (hours) · S–M for the mechanical fixes ·
**unknown** for the outcome, which is the point
**Depends on:** nothing · **Blocks absolutely:** 17e (npm publish) ·
**Informs:** the whole project's distribution posture

> **This item is fact-finding and mechanical compliance work. It is NOT a legal
> conclusion, and no executor may reach one.** The deliverable is a findings
> document plus attribution files. Whether to publish, whether to rename, and
> whether the licensing is acceptable are decisions for the repo owner — with a
> lawyer if the findings warrant one. See STOP below; it is the most important
> section in this file.

## Why this is first

Three modules in `src/framewise-lite/` describe themselves as **ports, not
clean-room reimplementations**:

| File             | Line | What it says                                                                                                               |
| ---------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- |
| `spring.ts`      | 1–9  | "Ported **verbatim** (math-wise) from Framewise's `spring/spring-utils.ts` and `spring/index.ts`… this is a faithful copy" |
| `interpolate.ts` | 1    | "Ported from Framewise's `interpolate`, which itself derives from React Native's…"                                         |
| `easing.ts`      | 1    | "Ported from Framewise's Easing module (itself React Native's Easing)"                                                     |

Meanwhile `LICENSE` is MIT, © 2026 Josh McAdams, and contains **no upstream
copyright notice of any kind**. `package.json` declares `"private": true`, so
nothing has been distributed yet — which is exactly why this is cheap to fix
_now_ and expensive to fix after a publish.

Two things follow:

1. **Even in the friendliest case this is already non-compliant.** If upstream is
   MIT, MIT itself requires that "the above copyright notice… be included in all
   copies or **substantial portions** of the Software." A verbatim port of a
   spring solver is plausibly a substantial portion. The notice is missing today.
2. **In the unfriendly case, the project's distribution story changes entirely** —
   you generally cannot relicense someone else's code as MIT, and some
   source-available licenses add commercial-use conditions on top. That would not
   stop you building or learning; it would stop you publishing, and it would
   change what item 17 is even about.

Doing this first also means every later item is built on settled ground rather
than on a question someone has to re-open at the worst possible moment.

## The one fact that decides most of it

**What license governs the upstream that `spring.ts`, `interpolate.ts`, and
`easing.ts` were ported from?** Everything else is downstream of the answer.

`README.md:3` names [Framewise](https://www.framewise.dev/) as upstream. Note an
internal inconsistency that must be resolved as part of this item:
`backlog/README.md` describes **Remotion** as "the direct model", the public API
surface here matches Remotion's name-for-name (`useCurrentFrame`,
`useVideoConfig`, `AbsoluteFill`, `interpolate` with
`extrapolateLeft`/`extrapolateRight`, `spring` with `overshootClamping`,
`<Sequence from durationInFrames>`, `<Series.Sequence>`, `<Loop>`,
`delayRender`/`continueRender`, `staticFile`, `<OffthreadVideo>`,
`calculateMetadata`, `measureSpring`, and — in this backlog — `TransitionSeries`
/`linearTiming`/`springTiming`, `visualizeAudio`, Lambda-style distributed
rendering), and the file paths cited in `spring.ts:1` match Remotion's package
layout. **If the real upstream is Remotion, note that Remotion is source-available
with a paid company-license tier, not permissive open source** — which lands this
in the second case above.

Establish the truth and record it. Do not paper over it: inaccurate or
inconsistent attribution reads as obfuscation, which is the worst posture to be
in if anyone ever asks.

## Tasks

### 1. Establish upstream identity and license (investigation)

- Identify the actual upstream project the three modules were ported from.
- Retrieve its `LICENSE` **verbatim** and record it in the findings doc, with the
  URL, the version/commit it was read at, and the date.
- Record whether it is OSI-permissive (MIT/Apache-2.0/BSD), copyleft (GPL/AGPL),
  or source-available/custom with use restrictions.
- Note any explicit terms about derivative works, redistribution, relicensing,
  and commercial use.

### 2. Trace real provenance per module (investigation)

This may substantially defuse two of the three. Both `interpolate.ts` and
`easing.ts` say they derive **through** upstream from **React Native**, which is
MIT (Meta). If React Native is the true origin of that expression, the correct
attribution target is React Native, and MIT-with-notice is clean.

For each of the three modules, record:

- the true origin of the expression (upstream? React Native? independent?)
- how close the copy is — verbatim, structurally similar, or same-behavior-only
- the specific upstream files, with URLs and commit hashes
- which parts are genuinely this repo's own work (`spring.ts:11-15`'s
  `overshootClamping` fix in output space, `interpolate.ts:10-11`'s `posterize`,
  the tuple/string-template output modes, `measureSpring`'s additions)

That last bullet matters: the original contributions should be identified as
such, not lost inside a blanket attribution.

Also sweep the rest of `src/framewise-lite/` for undocumented porting. The three
above are the ones that _declare_ it; confirm nothing else copied silently.

### 3. Write the attribution files (mechanical)

- **`NOTICE`** (or `THIRD-PARTY-LICENSES.md`) at the repo root: upstream
  copyright lines and full license texts for every origin identified in step 2.
- **`LICENSE`**: keep your MIT for your own work, but make the file state plainly
  that portions derive from other projects and point at `NOTICE`. Do not imply
  MIT covers code you did not write.
- **Per-file headers**: update the three "Ported from…" comments so they name the
  **true** origin, its license, and a URL — not a stand-in name.
- **`README.md:3`**: make the attribution accurate and consistent with the
  findings.
- **`backlog/README.md`**: reconcile the "Remotion (the direct model)" phrasing
  with whatever the findings establish.
- **`package.json`**: if publishing ever happens, `license` must reflect reality;
  leave `"private": true` until item 17e is decided.

### 4. Prepare (do not execute) the naming decision

Trademark is a separate body of law from copyright, and in practice the most
likely to produce an actual complaint — sending one is cheap for the rights
holder and expensive to answer. `framewise-lite` under a project called
"Framewise" is the textbook confusing-similarity pattern, and a `-lite` suffix
does not cure it; it can worsen it by implying an official reduced edition. npm
has a dispute policy and will act on trademark complaints, including transferring
or unpublishing names.

Deliverable here is **options, not a choice**: propose 3–5 candidate names that
carry no upstream mark, and estimate the rename blast radius (package name,
`src/framewise-lite/` directory, the `framewise-lite` identifier throughout
docs/chapters/tutorial, `window.framewiseLite` page seam in
`main-render.tsx:29-51`, `/__framewise_extract` mount in
`offthread-server.mjs:18`, the `framewiseExtract` plugin, test fixtures).
The owner picks.

## STOP — an executor must not do any of these

1. **Do not conclude the licensing is "fine."** Record facts; the owner decides.
   If the findings show a restrictive upstream license, say so plainly and stop.
2. **Do not publish anything, flip `"private": false`, or reserve an npm name.**
3. **Do not rename anything** without the owner's explicit pick from step 4.
4. **Do not delete or reword the existing "Ported from…" comments to make the
   problem look smaller.** They are the honest record that made this item
   findable at all. They get made _more_ precise, never vaguer.
5. **Do not rewrite the ported modules to "clean-room" them as part of this
   item.** That is a separate, deliberate decision (see below) and doing it
   casually — while having read the original — defeats the purpose.
6. **Do not offer legal conclusions in commit messages or docs.** "Upstream is
   licensed X; here is the text" is a fact. "Therefore we are allowed to Y" is
   not an executor's call.

## If the findings are unfavorable — the follow-on options

Record these in the findings doc as options for the owner; do not act on them
here.

- **Stay private / GitHub-only, no npm.** Preserves essentially all the
  educational value. Not claiming a package namespace materially lowers
  trademark exposure. This is a perfectly good permanent outcome.
- **Obtain the appropriate upstream license** if one is offered for the intended
  use.
- **Genuine clean-room reimplementation** of the affected modules: a person who
  has not read the upstream source implements from a behavioral specification.
  For the spring solver specifically, note that `spring.ts:1-4` warns
  reconstructing the analytical damped-harmonic-oscillator solution from scratch
  is "the classic 'almost right' trap" — so this is real work with a real
  correctness risk, and `measureSpring`-based tests would be the safety net.
- **Talk to a lawyer** before publishing. Cheap relative to the alternative.

## Verification

This item's output is documents, so "verification" means completeness and
accuracy, not tests:

- [ ] Findings doc exists (suggest `docs/PROVENANCE.md`) recording, for each
      ported module: true origin, closeness of copy, upstream URL + commit,
      upstream license text, and this repo's own contributions
- [ ] Upstream license captured **verbatim** with URL and date read
- [ ] `NOTICE` / `THIRD-PARTY-LICENSES.md` exists and covers every origin found
- [ ] `LICENSE` no longer implies MIT covers third-party code
- [ ] All three per-file headers name the true origin + license + URL
- [ ] `README.md` and `backlog/README.md` attributions are accurate **and agree
      with each other**
- [ ] A sweep confirms no other module contains undocumented ported code
- [ ] Rename candidates + blast radius documented; **no rename performed**
- [ ] `"private": true` still set; nothing published
- [ ] `npm run verify` green (comment-only changes must not break the build)

**What this does not cover:** none of this is a legal opinion, and a complete
`NOTICE` file does not by itself make redistribution permissible — that depends
entirely on the upstream license found in step 1. Say so in the findings doc so
a future reader does not mistake compliance paperwork for permission.

## Docs

`docs/PROVENANCE.md` is the primary artifact and should be linked from
`README.md` and from `docs/code/README.md`'s source map — "docs are the product"
applies here more than anywhere, because this is the document that tells an
honest reader exactly what they are looking at. Chapters 2 and 3
(`interpolate`, `spring`) should each gain a one-line provenance pointer, since
those are the two chapters that teach ported math.

## Definition of done

- [ ] Upstream identified, license captured verbatim, findings doc written
- [ ] Provenance traced per module, including this repo's own contributions
- [ ] `NOTICE` written; `LICENSE` corrected; three file headers corrected
- [ ] Attributions consistent across README, backlog README, and code
- [ ] Rename options presented; decision left to the owner
- [ ] Item 17e updated with the findings (it depends on this outcome)
- [ ] Nothing published, nothing renamed, no legal conclusion asserted
