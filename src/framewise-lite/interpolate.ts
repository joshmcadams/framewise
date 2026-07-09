// Ported from Framewise's `interpolate`, which itself derives from React
// Native's AnimatedInterpolation. This is the numeric path only — Framewise also
// supports string ("scale(2)") and tuple output ranges, which we omit here to
// keep the educational core readable. The semantics of the numeric path match
// Framewise exactly, including the surprising default: extrapolation is "extend",
// so values run linearly *past* the range rather than clamping.
//
// Deliberate extension (not in upstream Framewise): the `posterize` option.
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

function interpolateFunction(
  input: number,
  inputRange: [number, number],
  outputRange: [number, number],
  options: InterpolateSegmentResolvedOptions,
): number {
  const {extrapolateLeft, extrapolateRight, easing} = options;

  let result = input;
  const [inputMin, inputMax] = inputRange;
  const [outputMin, outputMax] = outputRange;

  if (result < inputMin) {
    if (extrapolateLeft === 'identity') {
      return result;
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
      return result;
    }

    if (extrapolateRight === 'clamp') {
      result = inputMax;
    } else if (extrapolateRight === 'wrap') {
      const range = inputMax - inputMin;
      result = ((((result - inputMin) % range) + range) % range) + inputMin;
    }
    // 'extend' is a no-op.
  }

  if (outputMin === outputMax) {
    return outputMin;
  }

  // Normalize input to [0, 1] within the segment.
  result = (result - inputMin) / (inputMax - inputMin);

  // Apply easing.
  result = easing(result);

  // Scale to the output segment.
  result = result * (outputMax - outputMin) + outputMin;

  return result;
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

function checkValidInputRange(arr: readonly number[]): void {
  for (let i = 1; i < arr.length; ++i) {
    if (!(arr[i] > arr[i - 1])) {
      throw new Error(
        `inputRange must be strictly monotonically increasing but got [${arr.join(',')}]`,
      );
    }
  }
}

function checkFiniteRange(name: string, arr: readonly number[]): void {
  if (arr.length < 1) {
    throw new Error(name + ' must have at least 1 element');
  }

  for (const element of arr) {
    if (typeof element !== 'number' || !Number.isFinite(element)) {
      throw new Error(`${name} must contain only finite numbers, but got [${arr.join(',')}]`);
    }
  }
}

/**
 * Maps a value from one range to another.
 *
 * @example
 * interpolate(5, [0, 10], [0, 100]) // => 50
 * interpolate(15, [0, 10], [0, 100], {extrapolateRight: 'clamp'}) // => 100
 */
export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options?: InterpolateOptions,
): number {
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
  checkFiniteRange('outputRange', outputRange);
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

  if (inputRange.length === 1) {
    return outputRange[0];
  }

  const extrapolateLeft = options?.extrapolateLeft ?? 'extend';
  const extrapolateRight = options?.extrapolateRight ?? 'extend';

  const posterizedInput =
    options?.posterize === undefined
      ? input
      : Math.floor(input / options.posterize) * options.posterize;

  const range = findRange(posterizedInput, inputRange);

  const easing: EasingFunction =
    easingOption === undefined
      ? defaultEasing
      : typeof easingOption === 'function'
        ? easingOption
        : (easingOption[range] as EasingFunction);

  return interpolateFunction(
    posterizedInput,
    [inputRange[range], inputRange[range + 1]],
    [outputRange[range], outputRange[range + 1]],
    {easing, extrapolateLeft, extrapolateRight},
  );
}
