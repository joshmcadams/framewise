# 043 — Provenance, attribution, and licensing

**Status:** PARTIALLY DONE — 2026-08-24. Investigation complete
(`docs/PROVENANCE.md`); the decision-independent attribution work has shipped
(branch `fix/attribution`). The gating questions remain BLOCKED ON OWNER.

**Backlog item:** `backlog/00-provenance-and-licensing.md` — TOP PRIORITY, S

## Problem

Three modules describe themselves as ports rather than clean-room
reimplementations — `spring.ts:1` ("ported **verbatim** (math-wise)… a faithful
copy"), `interpolate.ts:1`, `easing.ts:1` — while `LICENSE` is MIT © the repo
author with no upstream notice of any kind. Nothing has been distributed
(`"private": true`), which is why this was worth settling before any further
investment. Blocks `backlog/17-publishing.md` 17e absolutely.

## What was executed (steps 1–2 of the backlog item)

Fact-finding only, under the item's STOP conditions.

1. **Upstream identified as Remotion** (<https://www.remotion.dev>). The
   `framewise.dev` domain credited at `README.md:3` is an **unrelated web design
   agency**; there is no "Framewise" video framework. "Framewise" is a stand-in
   name for Remotion throughout this repo.
2. **Remotion License captured** — custom, source-available, explicitly not
   OSI-approved by Remotion's own documentation. Free tier for individuals and
   for-profit orgs up to 3 people; Company License at 4+. Contains the clause:
   "It is not allowed to copy or modify Remotion code for the purpose of
   selling, renting, licensing, relicensing, or sublicensing your own derivate
   of Remotion."
3. **Provenance traced per module** against live upstream sources:
   - `spring.ts` → Remotion's own `spring/spring-utils.ts`, which carries **no
     third-party attribution**. No MIT ancestor. Most exposed of the three.
   - `interpolate.ts` → React Native (MIT, Meta), via Remotion, which credits
     `AnimatedInterpolation.js` in its own header.
   - `easing.ts` → React Native (MIT, Meta), via Remotion, which credits
     `Easing.js` in its own header.
4. **This repo's existing "Ported from…" comments were verified accurate** in
   every checkable particular, and this repo's original contributions were
   catalogued so they are not lost inside a blanket attribution.

Findings written to **`docs/PROVENANCE.md`** with sources, URLs, and read date.

## Why execution stopped here

The backlog item's STOP #1: "Do not conclude the licensing is 'fine'… If the
findings show a restrictive upstream license, say so plainly and stop." They do.

### Shipped in the follow-up attribution PR

Correct regardless of every open decision, so done without waiting:

- `THIRD-PARTY-NOTICES.md` — React Native MIT text in full; Remotion's terms
  recorded with the open question flagged
- `LICENSE` — MIT now scoped to this project's original work only
- three per-file headers naming true origins + licenses; `spring.ts` carries an
  explicit "do not publish without resolving this" warning
- `README.md` and `docs/OVERVIEW.md` — wrong `framewise.dev` link replaced with
  Remotion; prominent attribution/non-affiliation notice added

### Still not done, deliberately

Each depends on an owner decision the executor is not permitted (or qualified)
to make:

- disposition of `spring.ts` — the gating question
- any rename (package name and the "Framewise" stand-in throughout)
- whether to publish at all (`backlog/17-publishing.md` 17e)
- sweep of remaining modules for undocumented ported code

## Acceptance (for the part that ran)

1. `docs/PROVENANCE.md` records upstream identity, license text with sources and
   date, per-module provenance, this repo's own contributions, and the open
   decisions. ✅
2. No legal conclusion asserted anywhere. ✅
3. Nothing published, nothing renamed, `"private": true` untouched. ✅
4. Comment/doc-only changes; `npm run verify` green. ✅

## To resume

Owner decides items 1–5 in `docs/PROVENANCE.md` §5 (professional advice
warranted on §5.1). The remaining checklist is `docs/PROVENANCE.md` §6.
