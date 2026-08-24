# Provenance and attribution — findings

**Status: FACT-FINDING COMPLETE. Decisions pending — see "Open decisions".**

Produced by backlog item `00-provenance-and-licensing.md`, executed 2026-08-24
against repo commit `10285fb`. This document records **what was found**, with
sources. It deliberately contains **no legal conclusions** — see "What this
document is not" at the end.

## Summary of findings

1. The upstream this project reimplements is **Remotion**
   (<https://www.remotion.dev>), by Jonny Burger / Remotion GmbH.
2. Remotion is distributed under the **Remotion License** — a custom,
   **source-available** license. Remotion's own documentation states it "is not
   open-source software according to the Open Source Initiative's Open Source
   Definition."
3. `README.md:3` currently attributes this project to
   **"[Framewise](https://www.framewise.dev/)"**. That domain belongs to an
   **unrelated web design agency**. There is no video framework called
   "Framewise." The attribution as written is incorrect and points a reader at
   an uninvolved third party.
4. Of the three modules that describe themselves as ports, **two trace to React
   Native (MIT, Meta)** and **one is Remotion's own code with no third-party
   ancestor**.
5. This repository's existing "Ported from…" source comments were found to be
   **accurate** in every particular that was checkable. They are the reason this
   was findable at all.
6. Nothing has been distributed: `package.json` has `"private": true`, and no
   npm package exists.

## 1. Upstream identity

| Question               | Finding                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name used in this repo | "Framewise", linked to `https://www.framewise.dev/` (`README.md:3`)                                                                                                                                                                                                                                              |
| What that domain is    | A web design/development agency. Not a video framework, no software product, no license.                                                                                                                                                                                                                         |
| Actual upstream        | **Remotion**, <https://www.remotion.dev>, repo `remotion-dev/remotion`                                                                                                                                                                                                                                           |
| Evidence               | The public API matches Remotion's name-for-name; the file paths cited in `spring.ts:1` (`spring/spring-utils.ts`, `spring/index.ts`) match Remotion's `packages/core/src/` layout; `backlog/README.md` independently names Remotion "the direct model". Verified against the live Remotion sources listed below. |

"Framewise" is therefore a **stand-in name for Remotion** used throughout this
repository's code, docs, and identifiers.

## 2. Upstream license

Read from <https://github.com/remotion-dev/remotion/blob/main/LICENSE.md> on
2026-08-24, corroborated by <https://www.remotion.dev/docs/license/faq>,
<https://www.remotion.dev/docs/license/pricing>, and
<https://www.remotion.pro/license>.

- **Name:** the Remotion License. Custom; **not** MIT/Apache/BSD; **not**
  OSI-approved.
- **Free License tier:** individuals, non-profits, and for-profit organizations
  **up to 3 people** may use it free, including commercially.
- **Company License:** required for for-profit organizations of **4 or more
  people**; paid.
- **Clause bearing directly on this repository**, quoted from the license:

  > "It is not allowed to copy or modify Remotion code for the purpose of
  > selling, renting, licensing, relicensing, or sublicensing your own derivate
  > of Remotion."

- **Remotion's own characterization**, from its FAQ:

  > "Remotion is source-available software, but it is not open-source software
  > according to the Open Source Initiative's Open Source Definition."

The license FAQ does **not** address forking, reimplementation, educational use,
or whether the license follows code copied out of Remotion. Those questions are
not answered by the published documents reviewed here.

## 3. Per-module provenance

### `src/framewise-lite/spring.ts` — **originates with Remotion**

- **This repo says** (`spring.ts:1-9`): "Ported **verbatim** (math-wise) from
  Framewise's `spring/spring-utils.ts` and `spring/index.ts`… this is a faithful
  copy."
- **Upstream file:** `packages/core/src/spring/spring-utils.ts`. Checked for a
  third-party attribution header — **it has none.** No reference to React
  Native, Reanimated, Meta, or any other project. It is an analytical
  (closed-form) damped-harmonic-oscillator solution covering the under-damped
  and critically-damped cases, with memoization.
- **True origin of the expression: Remotion.** There is no MIT-licensed ancestor
  to attribute to instead.
- **This is the most exposed of the three modules.**
- **This repo's own contributions here**, which are genuinely original and should
  not be lost inside any blanket attribution: the `overshootClamping` fix that
  clamps in output space rather than upstream's normalized space
  (`spring.ts:11-15`, `:311-317`), and the `measureSpring` family additions
  (`measureSpring()`, the `durationInFrames` time-warp, `reverse`).

### `src/framewise-lite/interpolate.ts` — **originates with React Native (MIT)**

- **This repo says** (`interpolate.ts:1`): "Ported from Framewise's
  `interpolate`, which itself derives from React Native's…"
- **Upstream file:** `packages/core/src/interpolate.ts` carries the header:

  > `// Taken from https://github.com/facebook/react-native/blob/0b9ea60b4fee8cacc36e7160e31b91fc114dbc0d/Libraries/Animated/src/nodes/AnimatedInterpolation.js`

- **True origin: React Native**, MIT-licensed (Meta Platforms). This repo's
  comment is accurate, and the correct attribution target is React Native.
- **This repo's own contributions:** the `posterize` option
  (`interpolate.ts:10-11`), and the tuple / string-template output modes.

### `src/framewise-lite/easing.ts` — **originates with React Native (MIT)**

- **This repo says** (`easing.ts:1`): "Ported from Framewise's Easing module
  (itself React Native's Easing)."
- **Upstream file:** `packages/core/src/easing.ts` carries the header:

  > `// Taken from https://github.com/facebook/react-native/blob/0b9ea60b4fee8cacc36e7160e31b91fc114dbc0d/Libraries/Animated/src/Easing.js`

- **True origin: React Native**, MIT-licensed (Meta Platforms). Comment accurate;
  attribution target is React Native.

### Remaining modules

The rest of `src/framewise-lite/` declares no porting. A sweep for further
undocumented copying is listed as outstanding work below — it was not completed
in this pass.

## 4. Current licensing state of this repository

- `LICENSE`: MIT, "Copyright (c) 2026 Josh McAdams". **Contains no upstream
  copyright notice of any kind** — not Remotion's, not React Native's.
- For the two React-Native-derived modules, MIT itself requires that the
  original copyright notice accompany "copies or substantial portions of the
  Software." That notice is currently absent.
- `package.json`: `"private": true`. **Nothing has been published or otherwise
  distributed.**

## 5. Open decisions — for the repository owner

These are **not** engineering decisions and were deliberately left untouched:

1. **Whether the Remotion License permits what `spring.ts` does**, and under what
   conditions this repository may be distributed at all. This is the gating
   question and the one that most warrants professional advice.
2. **Attribution rewrite.** The `framewise.dev` link (`README.md:3`) is
   incorrect and names an uninvolved business. This wants fixing regardless of
   every other decision, but it is part of a single coherent attribution rewrite
   rather than a patch, so it was not edited unilaterally.
3. **Naming.** "Framewise" as a stand-in, and the package name `framewise-lite`,
   are entangled with decision 2. Trademark is a separate body of law from
   copyright.
4. **Whether to publish at all.** See `backlog/17-publishing.md` 17e, which is
   blocked on this document.
5. **What to do about `spring.ts` specifically**, if distribution is intended —
   options include obtaining an appropriate license, or a genuine clean-room
   reimplementation by someone who has not read the upstream. Note
   `spring.ts:1-4`'s own warning that reconstructing the analytical solution is
   "the classic 'almost right' trap"; `measureSpring`-based tests would be the
   safety net.

## 6. Outstanding work in item 00

- [ ] Sweep the remaining `src/framewise-lite/` modules for undocumented ported
      code
- [ ] `NOTICE` / `THIRD-PARTY-LICENSES.md` — shape depends on decisions 1–3
- [ ] `LICENSE` correction — depends on decisions 1–3
- [ ] Per-file header corrections naming true origins and licenses
- [ ] `README.md` / `backlog/README.md` attribution reconciliation
- [ ] Rename candidates and blast radius

## What this document is not

This is a record of facts with sources, assembled by an automated executor under
the STOP conditions in `backlog/00-provenance-and-licensing.md`. **It is not
legal advice and contains no legal conclusion.** Nothing here should be read as
asserting that any particular use is or is not permitted. A complete `NOTICE`
file would be compliance paperwork, not permission — what is permitted depends
on the license quoted in section 2 and on advice this executor is not qualified
to give.

Sources were read on **2026-08-24**; licenses and terms change, so re-verify
before relying on any of it.
