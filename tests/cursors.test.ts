import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addCursors,
  allOccurrences,
  findNextOccurrence,
  keepMain,
  pickMain,
  selectAll,
  selectNext,
  skipOccurrence,
  wordAt,
} from '../src/cursors.ts';

const S = (anchor: number, head = anchor) => ({ anchor, head });
const texts = (text: string, r: { sels: { anchor: number; head: number }[] } | null) =>
  r && r.sels.map((s) => text.slice(Math.min(s.anchor, s.head), Math.max(s.anchor, s.head)));

test('wordAt: inside, at both edges, none in whitespace or punctuation', () => {
  const t = 'foo bar_1, baz';
  assert.deepEqual(wordAt(t, 5), S(4, 9));
  assert.deepEqual(wordAt(t, 4), S(4, 9));
  assert.deepEqual(wordAt(t, 9), S(4, 9));
  assert.equal(wordAt('a  b', 2), null);
  assert.equal(wordAt('', 0), null);
});

test('wordAt: non-Latin letters, accents, marks and astral letters', () => {
  assert.deepEqual(wordAt('día ñandú', 6), S(4, 9));
  assert.deepEqual(wordAt('привет мир', 2), S(0, 6));
  assert.deepEqual(wordAt('x 日本語 y', 3), S(2, 5));
  const t = 'a 𝒜𝒷 b'; // astral letters, two code units each
  assert.deepEqual(wordAt(t, 4), S(2, 6));
  assert.deepEqual(wordAt('éa', 1), S(0, 3)); // combining accent
});

test('findNextOccurrence wraps and skips taken ranges', () => {
  const t = 'ab ab ab';
  assert.deepEqual(findNextOccurrence(t, 'ab', 2, [S(0, 2)]), S(3, 5));
  assert.deepEqual(findNextOccurrence(t, 'ab', 8, [S(6, 8)]), S(0, 2));
  assert.equal(findNextOccurrence(t, 'ab', 2, [S(0, 2), S(3, 5), S(6, 8)]), null);
  assert.equal(findNextOccurrence(t, 'zz', 0, []), null);
  assert.equal(findNextOccurrence(t, '', 0, []), null);
});

test('findNextOccurrence is case-sensitive', () => {
  assert.deepEqual(findNextOccurrence('Ab ab AB', 'ab', 0, []), S(3, 5));
});

test('findNextOccurrence finds a match that straddles the wrap point', () => {
  assert.deepEqual(findNextOccurrence('aXa', 'a', 2, [S(2, 3)]), S(0, 1));
});

test('allOccurrences does not overlap', () => {
  assert.deepEqual(allOccurrences('aaaa', 'aa'), [S(0, 2), S(2, 4)]);
  assert.deepEqual(allOccurrences('x', ''), []);
});

test('selectNext: bare cursors select their words, then occurrences are added', () => {
  const t = 'cat dog cat cat';
  const first = selectNext(t, [S(1)], 0)!;
  assert.deepEqual(first.sels, [S(0, 3)]);
  const second = selectNext(t, first.sels, first.main)!;
  assert.deepEqual(second.sels, [S(0, 3), S(8, 11)]);
  assert.equal(second.main, 1);
  const third = selectNext(t, second.sels, second.main)!;
  assert.deepEqual(third.sels, [S(0, 3), S(8, 11), S(12, 15)]);
  assert.equal(third.main, 2);
  assert.equal(selectNext(t, third.sels, third.main), null); // all taken
});

test('selectNext wraps around the note', () => {
  const t = 'cat dog cat';
  const r = selectNext(t, [S(8, 11)], 0)!;
  assert.deepEqual(r.sels, [S(0, 3), S(8, 11)]);
  assert.equal(r.main, 0);
});

test('selectNext with several bare cursors selects each word', () => {
  const t = 'one two';
  assert.deepEqual(selectNext(t, [S(1), S(5)], 1)!.sels, [S(0, 3), S(4, 7)]);
});

test('selectNext keeps a reversed selection and ignores a cursor in whitespace', () => {
  assert.equal(selectNext('a  b', [S(2)], 0), null);
  const r = selectNext('ab xx ab', [S(2, 0)], 0)!;
  assert.deepEqual(r.sels, [S(2, 0), S(6, 8)]);
});

test('selectAll from a word or a selection', () => {
  const t = 'cat dog cat cats';
  assert.deepEqual(texts(t, selectAll(t, [S(1)], 0)), ['cat', 'cat', 'cat']);
  assert.deepEqual(texts(t, selectAll(t, [S(0, 3)], 0)), ['cat', 'cat', 'cat']);
  assert.equal(selectAll('  ', [S(1)], 0), null);
  assert.equal(selectAll(t, [S(0, 3)], 0)!.main, 0);
});

test('skipOccurrence replaces the last added', () => {
  const t = 'cat cat cat';
  const r = skipOccurrence(t, [S(0, 3), S(4, 7)], 1)!;
  assert.deepEqual(r.sels, [S(0, 3), S(8, 11)]);
  assert.equal(r.main, 1);
  // only one other match left, already taken: nothing to skip to
  assert.equal(skipOccurrence('cat cat', [S(0, 3), S(4, 7)], 1), null);
});

test('addCursors below and above clamp the column', () => {
  const t = 'abcdef\nab\nabcd';
  const down = addCursors(t, [S(5)], 0, 'below')!;
  assert.deepEqual(down.sels, [S(5), S(9)]);
  assert.equal(down.main, 1);
  const down2 = addCursors(t, down.sels, down.main, 'below')!;
  assert.deepEqual(down2.sels, [S(5), S(9), S(12)]);
  const up = addCursors(t, [S(13)], 0, 'above')!;
  assert.deepEqual(up.sels, [S(9), S(13)]);
  assert.equal(up.main, 0);
});

test('addCursors: no line to go to, or already there', () => {
  assert.equal(addCursors('abc', [S(1)], 0, 'above'), null);
  assert.equal(addCursors('abc', [S(1)], 0, 'below'), null);
  assert.equal(addCursors('a\nb', [S(0), S(2)], 0, 'below'), null);
});

test('addCursors works on every cursor and merges collisions', () => {
  const t = 'aa\nbb\ncc\ndd';
  const r = addCursors(t, [S(1), S(4)], 0, 'below')!;
  assert.deepEqual(r.sels, [S(1), S(4), S(7)]);
});

test('addCursors onto empty lines', () => {
  const t = 'abc\n\nabc';
  assert.deepEqual(addCursors(t, [S(2)], 0, 'below')!.sels, [S(2), S(4)]);
});

test('keepMain and pickMain', () => {
  assert.deepEqual(keepMain([S(0), S(5)], 0)!.sels, [S(0)]);
  assert.equal(keepMain([S(0)], 0), null);
  assert.equal(pickMain([S(0, 2), S(5, 7)], 2), 0);
  assert.equal(pickMain([S(0, 2), S(5, 7)], 99), 1);
});
