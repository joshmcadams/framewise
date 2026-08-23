# 033 — React becomes a peerDependency

**Status:** DONE — 2026-08-24 — react/react-dom moved to `peerDependencies`
(">=19") + devDependencies; scratch-project install against a pre-existing
React 19 resolves exactly one `react`; SSR `<Player>` smoke renders a
`useCurrentFrame()` composition (`frame-0`) with no invalid-hook-call error.

**Backlog item:** Round 2 #12 (`backlog/12-react-should-be-peer-dependency.md`)

## Problem

The lib bundle externalizes React (`vite.lib.config.ts`) but `package.json`
declares react/react-dom as runtime `dependencies`. A consumer installing
framewise-lite gets a *second* React next to their own → classic
duplicate-renderer failure ("Invalid hook call"), and context — which
`useCurrentFrame()` is built on — silently fails to match across the boundary.

## Fix

1. `package.json`: drop `dependencies`; add
   `"peerDependencies": {"react": ">=19", "react-dom": ">=19"}`; move
   react/react-dom into `devDependencies` (demo app + tests keep working off
   the dev copy).
2. `npm install` to refresh the lockfile.
3. Full gate green.

## Acceptance

1. Pack the tarball; install into a scratch project that already has React 19:
   exactly **one** `react` directory resolves anywhere under its node_modules.
2. In that scratch project, SSR-render `<Player>` around a composition that
   calls `useCurrentFrame()` — no invalid-hook-call error, and the frame value
   flows through context (proves the single-React boundary, not just tree
   shape).
