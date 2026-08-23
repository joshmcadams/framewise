// Color interpolation, Framewise-style. Colors are parsed into {r, g, b, a},
// mixed per channel with the same easing/extrapolation contract as
// `interpolate`, and returned as an "rgba(r, g, b, a)" string.
//
// Why colors get their own entry point instead of reusing interpolate's
// string templates: "#ff00ff" contains no usable numeric slots (the digits of
// a hex string are one giant base-16 number), so template interpolation would
// silently produce nonsense. Parsing first keeps the math honest.
//
// Supported input formats: #rgb #rgba #rrggbb #rrggbbaa,
// rgb()/rgba() (comma syntax), hsl()/hsla() (comma syntax; s/l as percentages).

import {
  checkFiniteRange,
  checkValidInputRange,
  findSegment,
  resolveEasingForSegment,
  resolveSegment,
  type EasingFunction,
} from './interpolate';

type RGBA = {r: number; g: number; b: number; a: number};

function parseHex(input: string): RGBA {
  const hex = input.slice(1);
  if (![3, 4, 6, 8].includes(hex.length) || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error(
      `Unsupported color "${input}". Supported: #rgb #rgba #rrggbb #rrggbbaa, rgb()/rgba(), hsl()/hsla().`,
    );
  }

  const expand = (pair: string) => parseInt(pair.length === 1 ? pair + pair : pair, 16);
  if (hex.length <= 4) {
    return {
      r: expand(hex[0]),
      g: expand(hex[1]),
      b: expand(hex[2]),
      a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
    };
  }

  return {
    r: expand(hex.slice(0, 2)),
    g: expand(hex.slice(2, 4)),
    b: expand(hex.slice(4, 6)),
    a: hex.length === 8 ? expand(hex.slice(6, 8)) / 255 : 1,
  };
}

function parseRgbChannel(value: string, source: string): number {
  // Number('') is 0 — finite and in range — so an empty component must be
  // rejected explicitly or "rgb(, , )" would silently parse as black.
  const n = Number(value);
  if (
    value.trim() === '' ||
    !Number.isFinite(n) ||
    n < 0 ||
    n > 255 ||
    value.trim().endsWith('%')
  ) {
    throw new Error(
      `Invalid rgb component "${value}" in "${source}" — expected a number from 0 to 255.`,
    );
  }

  return n;
}

function parseRgbLike(input: string): RGBA {
  const parts = input
    .replace(/^rgba?\(/, '')
    .replace(/\)$/, '')
    .split(',');
  const alpha = parts.length === 4 ? Number(parts[3]) : 1;
  if (parts.length !== 3 && parts.length !== 4) {
    throw new Error(
      `Invalid color "${input}" — expected comma-separated rgb()/rgba(), e.g. rgba(255, 0, 128, 0.5).`,
    );
  }
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error(`Invalid alpha "${parts[3]}" in "${input}" — expected a number from 0 to 1.`);
  }

  return {
    r: parseRgbChannel(parts[0], input),
    g: parseRgbChannel(parts[1], input),
    b: parseRgbChannel(parts[2], input),
    a: alpha,
  };
}

/** hsl → rgb, per the CSS spec's standard algorithm. h in degrees (mod 360). */
function hslToRgb(h: number, s: number, l: number): Pick<RGBA, 'r' | 'g' | 'b'> {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const segment = Math.floor(hue / 60) % 6;
  const table = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ] as const;
  const [r, g, b] = table[segment];

  return {r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255};
}

function parseHslPercent(value: string, name: string, source: string): number {
  if (!value.trim().endsWith('%')) {
    throw new Error(
      `Invalid ${name} "${value}" in "${source}" — hsl() saturation/lightness are percentages, e.g. 50%.`,
    );
  }
  const n = Number(value.trim().slice(0, -1));
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new Error(`Invalid ${name} "${value}" in "${source}" — expected 0% to 100%.`);
  }

  return n / 100;
}

function parseHslLike(input: string): RGBA {
  const parts = input
    .replace(/^hsla?\(/, '')
    .replace(/\)$/, '')
    .split(',');
  if (parts.length !== 3 && parts.length !== 4) {
    throw new Error(
      `Invalid color "${input}" — expected comma-separated hsl()/hsla(), e.g. hsl(240, 100%, 50%).`,
    );
  }
  const hue = Number(parts[0]);
  if (parts[0].trim() === '' || !Number.isFinite(hue)) {
    throw new Error(`Invalid hue "${parts[0]}" in "${input}".`);
  }
  const sat = parseHslPercent(parts[1], 'saturation', input);
  const light = parseHslPercent(parts[2], 'lightness', input);
  const alpha = parts.length === 4 ? Number(parts[3]) : 1;
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error(`Invalid alpha "${parts[3]}" in "${input}" — expected a number from 0 to 1.`);
  }

  return {a: alpha, ...hslToRgb(hue, sat, light)};
}

export function parseColor(input: string): RGBA {
  // Lowercase once, before dispatching: the detection regexes are
  // case-insensitive, but the branch parsers' prefix-stripping is not — an
  // uppercase "HSL(240, …)" used to slip through detection and then fail
  // inside parseHslLike with a confusing hue error. Hex digits are
  // case-insensitive too, so lowering first is safe everywhere.
  const trimmed = input.trim().toLowerCase();
  if (trimmed.startsWith('#')) {
    return parseHex(trimmed);
  }
  if (/^rgba?\(/.test(trimmed)) {
    return parseRgbLike(trimmed);
  }
  if (/^hsla?\(/.test(trimmed)) {
    return parseHslLike(trimmed);
  }

  throw new Error(
    `Unsupported color "${input}". Supported: #rgb #rgba #rrggbb #rrggbbaa, rgb()/rgba(), hsl()/hsla().`,
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

const mixChannel = (from: number, to: number, t: number): number => from + t * (to - from);

// Formatting clamps on purpose: extrapolation may push the mix past the range
// (the `extend` default), and while browsers silently clamp out-of-range rgb()
// per CSS Color 4, every other consumer — canvas APIs, CSS-in-JS, downstream
// parsers — rejects or mangles it, and alpha > 1 is invalid everywhere. The
// math still extends linearly; only the returned STRING is guaranteed valid.
const formatColor = ({r, g, b, a}: RGBA): string =>
  `rgba(${Math.round(clamp(r, 0, 255))}, ${Math.round(clamp(g, 0, 255))}, ${Math.round(
    clamp(b, 0, 255),
  )}, ${Number(clamp(a, 0, 1).toFixed(3))})`;

/**
 * Interpolates between colors. Formats can be mixed freely — everything is
 * normalized to RGBA before mixing:
 *
 *   interpolateColors(progress, [0, 1], ['#ff0000', 'rgb(0, 0, 255)'])
 *   // → "rgba(128, 0, 128, 1)"
 *
 * Options mirror `interpolate`: `easing` (single function or one per segment),
 * `extrapolateLeft` / `extrapolateRight` accepting 'extend' (the default) or
 * 'clamp'.
 */
export function interpolateColors(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly string[],
  options?: {
    easing?: EasingFunction | readonly EasingFunction[];
    extrapolateLeft?: 'extend' | 'clamp';
    extrapolateRight?: 'extend' | 'clamp';
  },
): string {
  if (inputRange.length !== outputRange.length) {
    throw new Error(
      `inputRange (${inputRange.length}) and outputRange (${outputRange.length}) must have the same length`,
    );
  }

  checkFiniteRange('inputRange', inputRange);
  checkValidInputRange(inputRange);

  const colors = outputRange.map(parseColor);

  if (typeof input !== 'number' || !Number.isFinite(input)) {
    throw new TypeError('Cannot interpolate an input which is not a finite number');
  }

  if (Array.isArray(options?.easing) && options.easing.length !== inputRange.length - 1) {
    throw new Error(
      `When easing is an array, it must have one entry per segment (length inputRange.length - 1 = ${
        inputRange.length - 1
      }), but got length ${options.easing.length}`,
    );
  }

  for (const side of ['extrapolateLeft', 'extrapolateRight'] as const) {
    const mode = options?.[side];
    if (mode !== undefined && mode !== 'extend' && mode !== 'clamp') {
      throw new Error(
        `interpolateColors supports only 'extend' and 'clamp' extrapolation, but got ${side}: '${mode}' — colors cannot fall back to a raw scalar ('identity') or wrap around`,
      );
    }
  }

  if (inputRange.length === 1) {
    return formatColor(colors[0]);
  }

  const segment = findSegment(input, inputRange);
  const easing = resolveEasingForSegment(options?.easing, segment);

  // Reuse interpolate's input-side pipeline (extrapolation + easing). The
  // 'identity' outcome is unreachable: both modes are rejected above.
  const resolved = resolveSegment(input, [inputRange[segment], inputRange[segment + 1]], {
    easing,
    extrapolateLeft: options?.extrapolateLeft ?? 'extend',
    extrapolateRight: options?.extrapolateRight ?? 'extend',
  });
  if (resolved.kind !== 'mapped') {
    throw new Error('interpolateColors internal error: unexpected non-mapped segment outcome');
  }
  const {t} = resolved;

  const from = colors[segment];
  const to = colors[segment + 1];

  return formatColor({
    r: mixChannel(from.r, to.r, t),
    g: mixChannel(from.g, to.g, t),
    b: mixChannel(from.b, to.b, t),
    a: mixChannel(from.a, to.a, t),
  });
}
