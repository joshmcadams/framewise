import {describe, expect, it} from 'vitest';
import {parsePropsInput} from './parse-props-input';

describe('parsePropsInput', () => {
  it('parses a valid JSON object', () => {
    expect(parsePropsInput('{"title":"Hi","n":3}')).toEqual({
      ok: true,
      props: {title: 'Hi', n: 3},
    });
  });

  it('treats empty or whitespace-only input as an empty object', () => {
    expect(parsePropsInput('')).toEqual({ok: true, props: {}});
    expect(parsePropsInput('   \n\t  ')).toEqual({ok: true, props: {}});
  });

  it('rejects malformed JSON with the syntax error', () => {
    const result = parsePropsInput('{"a":}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Unexpected token|Expected/);
  });

  it('rejects non-object JSON (scalars, arrays, null)', () => {
    expect(parsePropsInput('"hello"').ok).toBe(false);
    expect(parsePropsInput('42').ok).toBe(false);
    expect(parsePropsInput('[1,2]').ok).toBe(false);
    expect(parsePropsInput('null').ok).toBe(false);
  });

  it('produces a human-readable error for non-objects', () => {
    const result = parsePropsInput('[1]');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON object/);
  });

  it('accepts nested objects (shallow-merge semantics are the caller concern)', () => {
    expect(parsePropsInput('{"a":{"b":1}}')).toEqual({
      ok: true,
      props: {a: {b: 1}},
    });
  });
});
