/**
 * Parses raw textarea text into the `inputProps` shape `resolveCompositionConfig`
 * consumes. Untrusted: invalid JSON or non-object JSON stays in the error
 * channel instead of crashing.
 */
export const parsePropsInput = (
  text: string,
): {ok: true; props: Record<string, unknown>} | {ok: false; error: string} => {
  const trimmed = text.trim();
  if (trimmed === '') {
    return {ok: true, props: {}};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {ok: false, error: (e as Error).message};
  }

  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    return {ok: false, error: 'props must be a JSON object (e.g. {"title":"Hi"})'};
  }

  return {ok: true, props: parsed as Record<string, unknown>};
};
