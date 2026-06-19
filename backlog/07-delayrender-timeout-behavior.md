# 07 — `delayRender` timeout only logs; timeout constant is duplicated

## Problem

Two related inconsistencies around the delayRender timeout:

1. **It doesn't actually fail anything.** When a handle isn't cleared in time,
   `delay-render.ts:44-51` only `console.error`s — the handle stays pending
   forever. The comment says "the renderer's own `waitForFunction` timeout is the
   hard backstop." But both timeouts are **30s** (`delay-render.ts:29` and
   `render.mjs:27`), so the in-app timer and the renderer's `waitForFunction`
   race at the same deadline. In the Player (preview) there is *no* backstop at
   all, so a forgotten `continueRender` leaves the loading badge stuck with only
   a console message.

2. **The 30s constant lives in two places.** `DEFAULT_DELAY_RENDER_TIMEOUT` in
   `delay-render.ts` and `DELAY_RENDER_TIMEOUT` in `render.mjs` can drift apart.
   If someone lowers one, the "backstop ordering" assumption silently breaks.

## Goal

- Decide and document the ordering contract: the renderer's `waitForFunction`
  backstop should fire **after** any in-app timeout (e.g. renderer = app timeout
  + a small margin), so the error message that reaches the user is the specific
  per-handle label, not a generic page-level timeout. Adjust
  `render.mjs:27`/line 122 accordingly (e.g. `appTimeout + 5_000`).
- Make the timeout surface usefully in preview too: the badge or a
  `console.error` is fine, but the message should name the stuck handle's label
  (it already has it — pass it through).
- Single source of truth for the default: export it from `delay-render.ts` and
  have the renderer import/derive from it rather than re-declaring a literal.
  (The renderer is `.mjs`; if it can't import the TS module directly, define the
  value once in a shared `.mjs`/JSON the build and renderer both read, or pass it
  in as a flag with the documented default.)

## Acceptance criteria

- The renderer's per-frame wait deadline is strictly later than the in-app
  delayRender timeout, and the failure message names the offending handle label.
- Lowering the timeout in one place changes it everywhere (no second literal).
- A test (or documented manual check) confirms a never-cleared handle produces a
  clear, labeled error rather than a silent hang.
