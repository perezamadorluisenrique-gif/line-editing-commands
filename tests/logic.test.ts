import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deleteToLineEdge,
  Doc,
  duplicateLines,
  insertBlankLine,
  joinLines,
  parseLineTarget,
  rewriteLines,
  selectLines,
  type Edit,
  type Sel,
} from '../src/logic.ts';

function run(text: string, sels: Sel[], f: (d: Doc, s: Sel[]) => Edit): { text: string; sels: Sel[] } {
  const edit = f(new Doc(text), sels);
  let out = '';
  let at = 0;
  for (const c of edit.changes) {
    out += text.slice(at, c.from) + c.insert;
    at = c.to;
  }
  return { text: out + text.slice(at), sels: edit.selections };
}

const caret = (n: number): Sel => ({ anchor: n, head: n });

test('duplicate down copies the line and moves the caret to the copy', () => {
  const r = run('a\nb\nc', [caret(3)], (d, s) => duplicateLines(d, s, 'down'));
  assert.equal(r.text, 'a\nb\nb\nc');
  assert.deepEqual(r.sels, [caret(5)]);
});

test('duplicate up keeps the caret on the upper copy', () => {
  const r = run('a\nb\nc', [caret(3)], (d, s) => duplicateLines(d, s, 'up'));
  assert.equal(r.text, 'a\nb\nb\nc');
  assert.deepEqual(r.sels, [caret(3)]);
});

test('duplicate a multi-line selection and the last line without trailing newline', () => {
  const r = run('a\nb\nc', [{ anchor: 0, head: 3 }], (d, s) => duplicateLines(d, s, 'down'));
  assert.equal(r.text, 'a\nb\na\nb\nc');
  assert.deepEqual(r.sels, [{ anchor: 4, head: 7 }]);
  assert.equal(run('a\nb', [caret(3)], (d, s) => duplicateLines(d, s, 'down')).text, 'a\nb\nb');
});

test('duplicate with two cursors on different lines shifts the second correctly', () => {
  const r = run('a\nb\nc', [caret(1), caret(5)], (d, s) => duplicateLines(d, s, 'down'));
  assert.equal(r.text, 'a\na\nb\nc\nc');
  assert.deepEqual(r.sels, [caret(3), caret(9)]);
});

test('two cursors on one line duplicate it once', () => {
  const r = run('abc\nd', [caret(0), caret(2)], (d, s) => duplicateLines(d, s, 'down'));
  assert.equal(r.text, 'abc\nabc\nd');
  assert.equal(r.sels.length, 2);
});

test('selection ending at column 0 of the next line excludes that line', () => {
  const r = run('a\nb\nc', [{ anchor: 0, head: 2 }], (d, s) => duplicateLines(d, s, 'down'));
  assert.equal(r.text, 'a\na\nb\nc');
});

test('blank line below and above keep indentation', () => {
  const below = run('  - a\nb', [caret(3)], (d, s) => insertBlankLine(d, s, 'below'));
  assert.equal(below.text, '  - a\n  \nb');
  assert.deepEqual(below.sels, [caret(8)]);
  const above = run('x\n  y', [caret(5)], (d, s) => insertBlankLine(d, s, 'above'));
  assert.equal(above.text, 'x\n  \n  y');
  assert.deepEqual(above.sels, [caret(4)]);
});

test('blank line with two cursors', () => {
  const r = run('a\nb', [caret(0), caret(2)], (d, s) => insertBlankLine(d, s, 'below'));
  assert.equal(r.text, 'a\n\nb\n');
  assert.deepEqual(r.sels, [caret(2), caret(5)]);
});

test('select line selects the whole line with its newline, then extends', () => {
  const first = run('ab\ncd\nef', [caret(1)], selectLines);
  assert.deepEqual(first.sels, [{ anchor: 0, head: 3 }]);
  const second = run('ab\ncd\nef', first.sels, selectLines);
  assert.deepEqual(second.sels, [{ anchor: 0, head: 6 }]);
  const last = run('ab\ncd\nef', [caret(7)], selectLines);
  assert.deepEqual(last.sels, [{ anchor: 6, head: 8 }]);
  assert.deepEqual(run('ab\ncd\nef', last.sels, selectLines).sels, [{ anchor: 6, head: 8 }]);
});

test('join lines: caret line with the next one, trimming the next one\'s indent', () => {
  const r = run('a\n   b\nc', [caret(0)], joinLines);
  assert.equal(r.text, 'a b\nc');
  assert.deepEqual(r.sels, [caret(1)]);
});

test('join a selection, skipping empty lines, and do nothing on the last line', () => {
  assert.equal(run('a\n\nb\nc', [{ anchor: 0, head: 5 }], joinLines).text, 'a b\nc');
  const last = run('a\nb', [caret(3)], joinLines);
  assert.equal(last.text, 'a\nb');
  assert.equal(last.changes, undefined);
});

test('join does not double a trailing space', () => {
  assert.equal(run('a \nb', [caret(0)], joinLines).text, 'a b');
});

test('sort ascending is natural and case-insensitive; descending and reverse', () => {
  const text = 'item10\nItem2\nitem1';
  const all: Sel[] = [{ anchor: 0, head: text.length }];
  assert.equal(run(text, all, (d, s) => rewriteLines(d, s, 'sort-asc')).text, 'item1\nItem2\nitem10');
  assert.equal(run(text, all, (d, s) => rewriteLines(d, s, 'sort-desc')).text, 'item10\nItem2\nitem1');
  assert.equal(run(text, all, (d, s) => rewriteLines(d, s, 'reverse')).text, 'item1\nItem2\nitem10');
});

test('sort leaves the rest of the note alone and selects the result', () => {
  const r = run('x\nb\na\ny', [{ anchor: 2, head: 5 }], (d, s) => rewriteLines(d, s, 'sort-asc'));
  assert.equal(r.text, 'x\na\nb\ny');
  assert.deepEqual(r.sels, [{ anchor: 2, head: 5 }]);
});

test('a single-line block is not sorted', () => {
  const r = run('b\na', [caret(0)], (d, s) => rewriteLines(d, s, 'sort-asc'));
  assert.equal(r.text, 'b\na');
});

test('remove duplicate lines keeps the first of each', () => {
  const r = run('a\nb\na\nb\nc', [{ anchor: 0, head: 9 }], (d, s) => rewriteLines(d, s, 'unique'));
  assert.equal(r.text, 'a\nb\nc');
});

test('delete to line start and end, with several carets', () => {
  assert.equal(run('hello world', [caret(5)], (d, s) => deleteToLineEdge(d, s, 'start')).text, ' world');
  assert.equal(run('hello world', [caret(5)], (d, s) => deleteToLineEdge(d, s, 'end')).text, 'hello');
  const r = run('abc\ndef', [caret(2), caret(6)], (d, s) => deleteToLineEdge(d, s, 'start'));
  assert.equal(r.text, 'c\nf');
  assert.deepEqual(r.sels, [caret(0), caret(2)]);
});

test('parseLineTarget', () => {
  assert.deepEqual(parseLineTarget('12', 100), { line: 11, ch: 0 });
  assert.deepEqual(parseLineTarget('12:5', 100), { line: 11, ch: 4 });
  assert.deepEqual(parseLineTarget(' 500 ', 40), { line: 39, ch: 0 });
  assert.deepEqual(parseLineTarget('0', 40), { line: 0, ch: 0 });
  assert.equal(parseLineTarget('abc', 40), null);
  assert.equal(parseLineTarget('', 40), null);
});
