# Third-party notices

This project contains code derived from other projects. This file records what,
from where, and under which license. See [`docs/PROVENANCE.md`](docs/PROVENANCE.md)
for the full provenance findings, including how each determination was made.

The MIT license in [`LICENSE`](LICENSE) covers this project's own work. It does
**not** cover the third-party portions listed below, which remain subject to
their own terms.

---

## React Native — MIT

Applies to:

- `src/framewise-lite/interpolate.ts` — derived from React Native's
  `AnimatedInterpolation`, by way of Remotion's `interpolate`. Remotion's own
  file credits
  <https://github.com/facebook/react-native/blob/0b9ea60b4fee8cacc36e7160e31b91fc114dbc0d/Libraries/Animated/src/nodes/AnimatedInterpolation.js>.
- `src/framewise-lite/easing.ts` — derived from React Native's `Easing`, by way
  of Remotion's `easing`. Remotion's own file credits
  <https://github.com/facebook/react-native/blob/0b9ea60b4fee8cacc36e7160e31b91fc114dbc0d/Libraries/Animated/src/Easing.js>.

Source: <https://github.com/facebook/react-native>

```
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Remotion — the Remotion License (source-available, not OSI open source)

Source: <https://github.com/remotion-dev/remotion> ·
License: <https://github.com/remotion-dev/remotion/blob/main/LICENSE.md>

Applies to:

- `src/framewise-lite/spring.ts` — the analytical damped-harmonic-oscillator
  solution is a port of Remotion's `packages/core/src/spring/spring-utils.ts`
  and `spring/index.ts`. Unlike the two modules above, Remotion's spring
  carries no third-party attribution of its own, so Remotion is the origin.
- More broadly, this project reimplements Remotion's public **API surface** —
  component and function names, prop names, and semantics.

The Remotion License is **not** an OSI-approved open source license. Remotion's
documentation states it "is not open-source software according to the Open
Source Initiative's Open Source Definition." It grants a free license to
individuals, non-profits, and for-profit organizations of up to three people,
and requires a paid Company License above that. It also states:

> "It is not allowed to copy or modify Remotion code for the purpose of selling,
> renting, licensing, relicensing, or sublicensing your own derivate of
> Remotion."

The full text is not reproduced here because it is a proprietary license whose
canonical version lives upstream; read it at the link above. **The disposition
of `spring.ts` under these terms is an open question** — tracked in
[`docs/PROVENANCE.md`](docs/PROVENANCE.md) §5 and
[`backlog/00-provenance-and-licensing.md`](backlog/00-provenance-and-licensing.md).
This project is not distributed on any package registry
(`package.json` is `"private": true`).

---

## Not affiliated

This project is an independent educational reimplementation. It is **not**
affiliated with, endorsed by, or sponsored by Remotion GmbH, Jonny Burger, or
Meta Platforms, Inc.

Sources above were read on 2026-08-24. Licenses change; re-verify before relying
on any of this.
