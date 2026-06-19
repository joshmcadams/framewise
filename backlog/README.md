# Backlog

Suggestions from a code review of framewise-lite, ordered most-impactful first.
Each file is written as a standalone implementation prompt (problem → evidence →
goal → acceptance criteria).

| # | Item | Type | Status | Why it ranks here |
|---|------|------|--------|-------------------|
| [01](01-cross-platform-chrome-resolution.md) | Cross-platform Chrome resolution | Bug (portability) | ✅ Done | The headline feature (render) can't run off macOS — including this repo's own WSL/Linux env. Hardcoded Chrome path. |
| [02](02-spring-overshoot-clamping-bug.md) | `spring` overshootClamping no-op for `to≠1` | Bug (correctness) | ✅ Done | Confirmed: clamping silently does nothing unless `to===1`. Hidden by single-case test. |
| [03](03-shared-composition-host.md) | Shared composition host | Architecture / reuse | 🔧 In progress | Player and renderer duplicate the provider stack — the exact seam the project is about. |
| [04](04-test-coverage-core-primitives.md) | Test the untested core | Quality | ☐ Todo | `<Sequence>`, the Player clock, and `delayRender` — the most important primitives — have no tests. |
| [05](05-renderer-robustness-and-ergonomics.md) | Renderer preflight + config + props | Robustness / feature | ☐ Todo | Fail-fast on missing ffmpeg, configurable encode, asset paths, `--props`. |
| [06](06-spring-quadratic-recompute.md) | `spring` O(n²) recompute | Performance | ☐ Todo | Recomputes from frame 0 every call; matters on long timelines. |
| [07](07-delayrender-timeout-behavior.md) | delayRender timeout behavior | Correctness / consistency | ☐ Todo | Timeout only logs; 30s constant duplicated; backstop ordering unclear. |
| [08](08-fidelity-and-docs-cleanup.md) | Fidelity & docs cleanup | Docs / trust | ☐ Todo | Undocumented non-upstream `posterize`; stale README claims. |
| [09](09-feature-backlog-next-primitives.md) | Next primitives | Features | ☐ Todo | staticFile, string/color interpolate, Easing, Series/Loop, measureSpring, seeded random, progress. |

**Bugs (do first):** 01, 02. **Then** architecture/quality 03–04, robustness 05.
The rest are incremental.
