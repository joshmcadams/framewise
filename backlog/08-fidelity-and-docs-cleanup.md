# 08 — Fidelity & docs cleanup: undocumented `posterize`, stale README claims

## Problem

The project's value is partly *pedagogical accuracy* — the README leans on "this
is a faithful port" claims. A few small mismatches undercut that:

1. **`interpolate` has a `posterize` option that real Framewise/Remotion's
   `interpolate` does not.** It's implemented and validated
   (`interpolate.ts:12-17, 164-185`) but the README explicitly frames
   `interpolate` as a "Faithful port of `interpolate` (numeric path only)"
   (README "What's here" table + "Notes on fidelity"). Adding a non-upstream
   option contradicts that framing and isn't documented or tested.
   - **Decide:** either (a) document `posterize` as an intentional extension in
     both the file header and README, and add tests (see backlog 04), or
     (b) remove it for fidelity. Don't leave it undocumented and untested.

2. **Test-count claim drift.** `README.md` says `npm test` runs "17 unit tests
   for interpolate + spring," but the suite now also includes
   `audio-registry.test.ts`. Either update the number/description or make it
   non-numeric ("unit tests for the pure modules").

3. **`spring` overshootClamping fidelity note.** The header comment
   (`spring.ts:6-7`) asserts `overshootClamping` "behave[s] exactly like
   Framewise," but it's actually broken for `to !== 1` (see backlog 02). Once 02
   is fixed, verify the comment is true; if upstream shares the defect, say so
   explicitly instead of implying correctness.

## Goal

Bring the code's deviations and the docs into agreement so a reader can trust the
"faithful port" claims. This is a low-risk, high-trust-value pass.

## Acceptance criteria

- `posterize` is either documented + tested as an explicit extension, or removed.
- README's test description matches the actual suite.
- Every "faithful"/"verbatim"/"exactly like Framewise" claim in source comments
  and README is true after backlog 02 lands, or is annotated with the known
  deviation.
