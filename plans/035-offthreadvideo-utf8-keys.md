# 035 — OffthreadVideo source keys survive non-ASCII paths

**Status:** DONE — 2026-08-24 — `extractKey` UTF-8-encodes before base64;
round-trip tests for `/vidéo.mp4` + `/日本語クリップ.mp4` through the real
`parseExtractUrl` (component side and server side).

**Backlog item:** Round 2 #14 (`backlog/14-offthreadvideo-non-ascii-paths.md`)

## Problem

`OffthreadVideo` builds its extraction-URL key with `btoa(src)` — Latin-1 —
while the server decodes base64url as UTF-8. `staticFile()` does no
percent-encoding, so `/vidéo.mp4` round-trips mojibake (ffmpeg ENOENT) and any
path outside Latin-1 (`/日本.mp4`) throws `InvalidCharacterError` mid-render.

## Fix

1. `OffthreadVideo.tsx`: UTF-8 encode before base64
   (`TextEncoder` → byte-string → `btoa`), exported as a small helper so the
   component and tests share one definition.
2. Tests: component-level round-trips for `/vidéo.mp4` and `/日本語.mp4`
   through the REAL server-side `parseExtractUrl`; plus a direct
   `parseExtractUrl` UTF-8 case in `offthread-server.test.mjs`.

## Acceptance

- Both test cases decode back to the exact original strings; suite green.
