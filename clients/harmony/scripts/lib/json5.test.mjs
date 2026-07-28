import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseJson5 } from './json5.mjs';

test('parses a plain double-quoted string value', () => {
  const value = parseJson5('{"a": "hello"}');
  assert.deepEqual(value, { a: 'hello' });
});

test('parses single-quoted strings', () => {
  const value = parseJson5("{ 'a': 'hello', 'b': 'world' }");
  assert.deepEqual(value, { a: 'hello', b: 'world' });
});

test('handles escaped double quotes inside a double-quoted string', () => {
  const value = parseJson5('{"a": "she said \\"hi\\" back"}');
  assert.deepEqual(value, { a: 'she said "hi" back' });
});

test('handles escaped single quotes inside a single-quoted string', () => {
  const value = parseJson5("{'a': 'it\\'s fine'}");
  assert.deepEqual(value, { a: "it's fine" });
});

test('handles common escape sequences', () => {
  const value = parseJson5('{"a": "line1\\nline2\\ttabbed\\\\backslash"}');
  assert.deepEqual(value, { a: 'line1\nline2\ttabbed\\backslash' });
});

test('handles unicode escape sequences', () => {
  const value = parseJson5('{"a": "\\u0041\\u0042\\u0043"}');
  assert.deepEqual(value, { a: 'ABC' });
});

test('unquoted identifier bare keys', () => {
  const value = parseJson5('{ foo: 1, bar_baz: 2, $qux: 3 }');
  assert.deepEqual(value, { foo: 1, bar_baz: 2, $qux: 3 });
});

test('mix of quoted and unquoted keys', () => {
  const value = parseJson5('{ foo: 1, "bar": 2, \'baz\': 3 }');
  assert.deepEqual(value, { foo: 1, bar: 2, baz: 3 });
});

test('trailing comma in an object', () => {
  const value = parseJson5('{ "a": 1, "b": 2, }');
  assert.deepEqual(value, { a: 1, b: 2 });
});

test('trailing comma in an array', () => {
  const value = parseJson5('[1, 2, 3, ]');
  assert.deepEqual(value, [1, 2, 3]);
});

test('trailing comma in a nested array inside an object', () => {
  const value = parseJson5('{ "list": [1, 2, ], }');
  assert.deepEqual(value, { list: [1, 2] });
});

test('empty object and empty array', () => {
  assert.deepEqual(parseJson5('{}'), {});
  assert.deepEqual(parseJson5('[]'), []);
});

test('line comment outside a string is ignored', () => {
  const value = parseJson5('{\n  // this is a comment\n  "a": 1\n}');
  assert.deepEqual(value, { a: 1 });
});

test('line comment marker appearing inside a string is NOT treated as a comment', () => {
  const value = parseJson5('{ "a": "https://example.com/x // not a comment" }');
  assert.deepEqual(value, { a: 'https://example.com/x // not a comment' });
});

test('block comment outside a string is ignored', () => {
  const value = parseJson5('{ /* leading */ "a": 1 /* trailing */, "b": 2 }');
  assert.deepEqual(value, { a: 1, b: 2 });
});

test('block comment marker appearing inside a string is NOT treated as a comment', () => {
  const value = parseJson5('{ "a": "/* still a string */" }');
  assert.deepEqual(value, { a: '/* still a string */' });
});

test('multi-line block comment between tokens', () => {
  const value = parseJson5('{\n  "a": 1,\n  /* this\n     spans\n     lines */\n  "b": 2\n}');
  assert.deepEqual(value, { a: 1, b: 2 });
});

test('nested structures: object of arrays of objects', () => {
  const value = parseJson5(`{
    name: "root",
    children: [
      { name: "a", tags: ["x", "y",], },
      { name: "b", tags: [], },
    ],
  }`);
  assert.deepEqual(value, {
    name: 'root',
    children: [
      { name: 'a', tags: ['x', 'y'] },
      { name: 'b', tags: [] },
    ],
  });
});

test('numbers: integers, decimals, negatives, exponents', () => {
  const value = parseJson5('{ a: 1, b: -2, c: 3.14, d: -0.5, e: 1e3, f: 2.5E-2, g: +7 }');
  assert.deepEqual(value, { a: 1, b: -2, c: 3.14, d: -0.5, e: 1000, f: 0.025, g: 7 });
});

test('booleans and null', () => {
  const value = parseJson5('{ a: true, b: false, c: null }');
  assert.deepEqual(value, { a: true, b: false, c: null });
});

test('top-level array', () => {
  const value = parseJson5('[1, "two", true, null, {"k": "v"}]');
  assert.deepEqual(value, [1, 'two', true, null, { k: 'v' }]);
});

test('throws with file path and line/column on malformed input (missing value)', () => {
  assert.throws(
    () => parseJson5('{ "a": }', '/tmp/example.json5'),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /\/tmp\/example\.json5:1:8/);
      return true;
    },
  );
});

test('throws on unterminated string literal', () => {
  assert.throws(
    () => parseJson5('{ "a": "unterminated }', 'manifest.json5'),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /manifest\.json5/);
      assert.match(err.message, /\d+:\d+/);
      return true;
    },
  );
});

test('throws on trailing garbage after a valid value', () => {
  assert.throws(() => parseJson5('{ "a": 1 } garbage'), /unexpected/);
});

test('throws on missing comma between object members', () => {
  assert.throws(() => parseJson5('{ "a": 1 "b": 2 }'), /expected/);
});

test('throws on unexpected character', () => {
  assert.throws(() => parseJson5('{ a: @ }'), /unexpected character/);
});

test('error message omits file path segment when none is given', () => {
  assert.throws(
    () => parseJson5('{ a: }'),
    (err) => {
      assert.match(err.message, /^unexpected '}' at 1:6$/);
      return true;
    },
  );
});
