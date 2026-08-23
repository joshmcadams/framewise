# 12 — React is a `dependency`, not a `peerDependency`

**Type:** Bug (packaging) · **Severity:** High · **Introduced by:** plan 028 (`5ff0210`)
**Status:** DONE — fixed by plan 033 (`peerDependencies: >=19` + devDependencies; verified with a scratch-project install and an SSR hook/context smoke test).

## Problem

`vite.lib.config.ts:15` externalizes React from the library bundle:

```js
rollupOptions: {external: ['react', 'react-dom', 'react/jsx-runtime']}
```

but `package.json` still declares them as runtime `dependencies`:

```json
"dependencies": {"react": "^19.2.7", "react-dom": "^19.2.7"}
```

A consumer installing `framewise-lite` therefore gets a *second* React resolved
transitively alongside their own. Two React copies in one tree is the classic
duplicate-renderer failure: hooks read from the wrong dispatcher and throw
"Invalid hook call", and context (which is what `useCurrentFrame` is built on)
silently fails to match across the boundary.

## Fix

```json
"peerDependencies": {"react": ">=19", "react-dom": ">=19"},
"devDependencies": {"react": "^19.2.7", "react-dom": "^19.2.7", …}
```

The demo app and the test suite keep working off the devDependency copy.

## Acceptance

- `npm pack` + install into a scratch project that already has React 19 resolves
  exactly one `react` in `node_modules`.
- The `Player` renders in that scratch project without an invalid-hook-call error.
