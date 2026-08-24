// PROVENANCE: derived from React Native's `AnimatedInterpolation`
//   https://github.com/facebook/react-native/blob/0b9ea60b4fee8cacc36e7160e31b91fc114dbc0d/Libraries/Animated/src/nodes/AnimatedInterpolation.js
//   MIT License, Copyright (c) Meta Platforms, Inc. and affiliates.
// Reached here by way of Remotion's `interpolate`, whose own file credits the
// same React Native source. See THIRD-PARTY-NOTICES.md and docs/PROVENANCE.md.
//
// The semantics match Remotion, including the surprising default:
// extrapolation is "extend", so values run linearly *past* the range rather
// than clamping.
//
// Output shapes mirror RN's interpolation: plain numbers, tuples (arrays of
// numbers interpolated lane-by-lane), and string templates ("scale(2)") whose
// embedded numbers are extracted, interpolated, and substituted back in order.
//
// Deliberate extension (not in upstream Remotion): the `posterize` option.
// Posterizing snaps the input to multiples of `posterize` before mapping,
// producing a staircase effect. It's documented and tested here as an example
// of building on top of the core without touching the ported math.

export type ExtrapolateType = 'extend' | 'identity' | 'clamp' | 'wrap';

export type EasingFunction = (input: number) => number;

export type InterpolateOptions = Partial<{
  easing: EasingFunction | readonly EasingFunction[];
  extrapolateLeft: ExtrapolateType;
  extrapolateRight: ExtrapolateType;
  posterize: number;
}>;

type InterpolateSegmentResolvedOptions = {
  easing: EasingFunction;
  extrapolateLeft: ExtrapolateType;
  extrapolateRight: ExtrapolateType;
};

const defaultEasing: EasingFunction = (num) => num;

/**
 * Resolves the input against one segment: applies left/right extrapolation
 * (identity may short-circuit), normalizes to [0, 1] and applies easing.
 *
 * All output shapes (number, tuple, string template) consume this identical
 * input-side pipeline; they differ only in how the eased progress maps onto
 * their own kind of output.
 *
 * @internal — shared with interpolate-colors.ts
 */
export function resolveSegment(
  input: number,
  inputRange: [number, number],
  options: InterpolateSegmentResolvedOptions,
): {kind: 'identity'; value: number} | {kind: 'mapped'; t: number} {
  const {extrapolateLeft, extrapolateRight, easing} = options;

  let result = input;
  const [inputMin, inputMax] = inputRange;

  if (result < inputMin) {
    if (extrapolateLeft === 'identity') {
      return {kind: 'identity', value: result};
    }

    if (extrapolateLeft === 'clamp') {
      result = inputMin;
    } else if (extrapolateLeft === 'wrap') {
      const range = inputMax - inputMin;
      result = ((((result - inputMin) % range) + range) % range) + inputMin;
    }
    // 'extend' is a no-op: keep extrapolating linearly.
  }

  if (result > inputMax) {
    if (extrapolateRight === 'identity') {
      return {kind: 'identity', value: result};
    }

    if (extrapolateRight === 'clamp') {
      result = inputMax;
    } else if (extrapolateRight === 'wrap') {
      const range = inputMax - inputMin;
      result = ((((result - inputMin) % range) + range) % range) + inputMin;
    }
    // 'extend' is a no-op.
  }

  // Normalize input to [0, 1] within the segment, then ease.
  const t = easing((result - inputMin) / (inputMax - inputMin));

  return {kind: 'mapped', t};
}

/** Maps eased progress [0, 1] through one scalar output segment. */
function mapScalar(t: number, outputRange: [number, number]): number {
  const [outputMin, outputMax] = outputRange;
  if (outputMin === outputMax) {
    return outputMin;
  }

  return t * (outputMax - outputMin) + outputMin;
}

function findRange(input: number, inputRange: readonly number[]): number {
  let i;
  for (i = 1; i < inputRange.length - 1; ++i) {
    if (inputRange[i] >= input) {
      break;
    }
  }

  return i - 1;
}

/** @internal — shared with interpolate-colors.ts */
export function checkValidInputRange(arr: readonly number[]): void {
  for (let i = 1; i < arr.length; ++i) {
    if (!(arr[i] > arr[i - 1])) {
      throw new Error(
        `inputRange must be strictly monotonically increasing but got [${arr.join(',')}]`,
      );
    }
  }
}

/** @internal — shared with interpolate-colors.ts */
export function checkFiniteRange(name: string, arr: readonly unknown[]): void {
  if (arr.length < 1) {
    throw new Error(name + ' must have at least 1 element');
  }

  for (const element of arr) {
    if (typeof element !== 'number' || !Number.isFinite(element)) {
      throw new Error(`${name} must contain only finite numbers, but got [${arr.join(',')}]`);
    }
  }
}

/** @internal — shared with interpolate-colors.ts */
export function findSegment(input: number, inputRange: readonly number[]): number {
  return findRange(input, inputRange);
}

/** @internal — shared with interpolate-colors.ts */
export function resolveEasingForSegment(
  easingOption: EasingFunction | readonly EasingFunction[] | undefined,
  segment: number,
): EasingFunction {
  if (easingOption === undefined) {
    return defaultEasing;
  }

  return typeof easingOption === 'function'
    ? easingOption
    : (easingOption[segment] as EasingFunction);
}

// --- string-template mode -------------------------------------------------

const NUMBER_IN_PATTERN = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

function extractNumbers(pattern: string): number[] {
  return (pattern.match(NUMBER_IN_PATTERN) ?? []).map(Number);
}

/** Renders an interpolated slot: fixed precision, trailing zeros trimmed. */
const formatSlot = (value: number): string => String(Number(value.toFixed(4)));

function substitute(template: string, replacements: number[]): string {
  let index = 0;
  return template.replace(NUMBER_IN_PATTERN, () => formatSlot(replacements[index++]));
}

// --- entry point ----------------------------------------------------------

export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options?: InterpolateOptions,
): number;
export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly (readonly number[])[],
  options?: InterpolateOptions,
): number[];
export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly string[],
  options?: InterpolateOptions,
): string;
export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly (number | readonly number[] | string)[],
  options?: InterpolateOptions,
): number | number[] | string {
  if (typeof input === 'undefined') {
    throw new Error('input can not be undefined');
  }

  if (typeof inputRange === 'undefined') {
    throw new Error('inputRange can not be undefined');
  }

  if (typeof outputRange === 'undefined') {
    throw new Error('outputRange can not be undefined');
  }

  if (inputRange.length !== outputRange.length) {
    throw new Error(
      `inputRange (${inputRange.length}) and outputRange (${outputRange.length}) must have the same length`,
    );
  }

  checkFiniteRange('inputRange', inputRange);

  const firstOutput = outputRange[0];
  const isStringMode = typeof firstOutput === 'string';
  const isTupleMode = !isStringMode && Array.isArray(firstOutput);

  // Shape validation per output mode.
  if (isTupleMode) {
    const lanes = (firstOutput as readonly number[]).length;
    if (lanes === 0) {
      throw new Error('tuple outputRange entries must be non-empty arrays of numbers');
    }
    for (const entry of outputRange) {
      if (!Array.isArray(entry)) {
        throw new Error(
          'tuple outputRange entries must all be arrays — mix plain numbers with tuples by wrapping them, e.g. [[0], [10]]',
        );
      }
      if ((entry as readonly number[]).length !== lanes) {
        throw new Error(
          `tuple outputRange entries must all have the same length (${lanes}), but got one of length ${(entry as readonly number[]).length}`,
        );
      }
      for (const lane of entry as readonly number[]) {
        if (typeof lane !== 'number' || !Number.isFinite(lane)) {
          throw new Error(
            `tuple outputRange entries must contain only finite numbers, but got [${(entry as readonly number[]).join(',')}]`,
          );
        }
      }
    }
  } else if (!isStringMode) {
    checkFiniteRange('outputRange', outputRange as readonly number[]);
  }

  if (isStringMode) {
    const slotCount = extractNumbers(outputRange[0] as string).length;
    for (const entry of outputRange) {
      if (typeof entry !== 'string') {
        throw new Error(`string outputRange entries must all be strings, but got ${typeof entry}`);
      }
      const entrySlots = extractNumbers(entry).length;
      if (entrySlots !== slotCount) {
        throw new Error(
          `string template outputs must all contain the same number of embedded values (${slotCount}), but "${entry}" contains ${entrySlots}`,
        );
      }
      if (slotCount === 0 && entry !== firstOutput) {
        throw new Error(
          `string template outputs without embedded values are constants and must be identical, but got "${firstOutput}" and "${entry}"`,
        );
      }
    }
  }

  checkValidInputRange(inputRange);

  const easingOption = options?.easing;
  if (Array.isArray(easingOption) && easingOption.length !== inputRange.length - 1) {
    throw new Error(
      `When easing is an array, it must have one entry per segment (length inputRange.length - 1 = ${
        inputRange.length - 1
      }), but got length ${easingOption.length}`,
    );
  }

  if (options?.posterize !== undefined) {
    const p = options.posterize;
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) {
      throw new Error(`posterize must be a positive finite number, but got ${p}`);
    }
  }

  if (typeof input !== 'number') {
    throw new TypeError('Cannot interpolate an input which is not a number');
  }

  const extrapolateLeft = options?.extrapolateLeft ?? 'extend';
  const extrapolateRight = options?.extrapolateRight ?? 'extend';

  if (
    (isTupleMode || isStringMode) &&
    (extrapolateLeft === 'identity' || extrapolateRight === 'identity')
  ) {
    throw new Error(
      "extrapolate 'identity' is only supported for plain-number output ranges — it would have to invent a vector or string",
    );
  }

  const posterizedInput =
    options?.posterize === undefined
      ? input
      : Math.floor(input / options.posterize) * options.posterize;

  if (inputRange.length === 1) {
    if (isTupleMode) {
      return [...(firstOutput as readonly number[])];
    }
    return firstOutput as string | number;
  }

  const segment = findRange(posterizedInput, inputRange);
  const easing = resolveEasingForSegment(easingOption, segment);

  const resolved = resolveSegment(posterizedInput, [inputRange[segment], inputRange[segment + 1]], {
    easing,
    extrapolateLeft,
    extrapolateRight,
  });

  // resolveSegment can only produce 'identity' when an identity extrapolation
  // was requested — already rejected above for tuple/string modes.
  if (resolved.kind === 'identity') {
    return resolved.value;
  }
  const {t} = resolved;

  if (isTupleMode) {
    const from = outputRange[segment] as readonly number[];
    const to = outputRange[segment + 1] as readonly number[];
    return from.map((fromLane, i) => mapScalar(t, [fromLane, to[i]]));
  }

  if (isStringMode) {
    const fromSlots = extractNumbers(outputRange[segment] as string);
    const toSlots = extractNumbers(outputRange[segment + 1] as string);
    const slots = fromSlots.map((fromSlot, i) => mapScalar(t, [fromSlot, toSlots[i]]));
    // Substitute back into the FIRST template so its exact spelling survives.
    return substitute(outputRange[segment] as string, slots);
  }

  return mapScalar(t, [outputRange[segment] as number, outputRange[segment + 1] as number]);
}
