# 10 — `npm run build` destroys the `build:lib` output

**Type:** Bug (packaging) · **Severity:** High · **Introduced by:** plan 028 (`5ff0210`)

## Problem

`vite.lib.config.ts` and `vite.config.ts` both emit to `dist/`, and Vite empties
`outDir` on build. The app build therefore wipes the publishable library:

```
$ npm run build:lib && ls dist/
framewise-lite.js  index.d.ts  interpolate.d.ts  … (22 .d.ts files)

$ npm run build && ls dist/
assets  bg.wav  blip.wav  clip.mp4  index.html  photo.png

$ ls dist/framewise-lite.js
ls: dist/framewise-lite.js: No such file or directory
```

`npm run verify` ends in `vite build`, so the documented gate-then-publish path
ships a package where:

- `exports["."].import` → `./dist/framewise-lite.js` does not exist
- `exports["."].types` → `./dist/index.d.ts` does not exist
- `files: ["dist"]` bundles the demo app plus `clip.mp4` / `bg.wav` / `blip.wav`

CLAUDE.md's command table lists `verify` (`… && vite build`) and `build:lib`
(`→ dist/framewise-lite.js`) on adjacent rows without noting they collide.

## Fix

Give the library build its own output directory and point the package entries at
it:

- `vite.lib.config.ts`: `build.outDir: 'dist-lib'`
- `tsconfig.lib.json`: `"outDir": "dist-lib"`
- `package.json`: `exports` → `./dist-lib/…`, `files: ["dist-lib"]`
- `.gitignore`: add `dist-lib`

## Acceptance

- `npm run build:lib && npm run verify && ls dist-lib/framewise-lite.js` succeeds.
- `npm pack --dry-run` lists only the library ESM + `.d.ts` files — no
  `index.html`, no `assets/`, no media.
