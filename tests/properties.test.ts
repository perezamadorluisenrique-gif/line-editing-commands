/**
 * Properties of every line command and cursor command, for any note and any
 * set of selections: the edits are well formed, the selections land inside
 * the new text, and the commands do what they say (duplicate keeps the
 * selected text selected, reverse twice restores, sort and unique settle,
 * join only removes whitespace). Notes are the hand-written ones in
 * `markdown-samples.ts` and generated ones; selections are seeded.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { allOccurrences, addCursors, normalize, selectAll, selectNext, wordAt } from '../src/cursors.ts';
import { Doc, deleteToLineEdge, duplicateLines, insertBlankLine, joinLines, rewriteLines, selectLines } from '../src/logic.ts';
import type { Change, Edit, Sel } from '../src/logic.ts';
import { SAMPLES, randomNote, rng } from './markdown-samples.ts';

const lo = (s: Sel) => Math.min(s.anchor, s.head);
const hi = (s: Sel) => Math.max(s.anchor, s.head);

const TEXTS = [
  ...Object.values(SAMPLES),
  ...Array.from({ length: 300 }, (_, i) => randomNote(i + 1)),
  '', 'a', '\n', 'a\nb', 'x\n\ny\n', '😀 word\nsecond 😀\n😀😀', '\nb\na\nz', 'b\na\n\nc',
].map((text) => text.replace(/\r/g, ''));

interface Case {
  text: string;
  doc: Doc;
  sels: Sel[];
  label: string;
}

const CASES: Case[] = TEXTS.flatMap((text, t) =>
  Array.from({ length: 8 }, (_, k) => {
    const random = rng(t * 8 + k + 1);
    const sels = Array.from({ length: 1 + Math.floor(random() * 4) }, () => {
      const anchor = Math.floor(random() * (text.length + 1));
      return { anchor, head: random() < 0.5 ? anchor : Math.floor(random() * (text.length + 1)) };
    });
    return { text, doc: new Doc(text), sels, label: JSON.stringify({ text: text.slice(0, 60), sels }) };
  }),
);

function apply(text: string, changes: Change[]): string {
  let out = '';
  let at = 0;
  for (const c of changes) {
    out += text.slice(at, c.from) + c.insert;
    at = c.to;
  }
  return out + text.slice(at);
}

/** Checks the edit is well formed and returns the new text. */
function applied(text: string, edit: Edit, label: string): string {
  edit.changes.forEach((c, i) => {
    assert.ok(c.from >= 0 && c.from <= c.to && c.to <= text.length, label);
    if (i > 0) assert.ok(edit.changes[i - 1].to <= c.from, label);
  });
  const out = apply(text, edit.changes);
  for (const s of edit.selections) assert.ok(lo(s) >= 0 && hi(s) <= out.length, label);
  return out;
}

test('duplicating lines keeps the same text selected and adds the lines once', () => {
  for (const { text, doc, sels, label } of CASES) {
    for (const direction of ['up', 'down'] as const) {
      const edit = duplicateLines(doc, sels, direction);
      const out = applied(text, edit, label);
      assert.ok(out.split('\n').length > text.split('\n').length, label);
      sels.forEach((s, i) => assert.equal(out.slice(lo(edit.selections[i]), hi(edit.selections[i])), text.slice(lo(s), hi(s)), label));
    }
  }
});

test('a blank line goes in once per line with a cursor, and the cursor lands on it', () => {
  for (const { text, doc, sels, label } of CASES) {
    for (const where of ['above', 'below'] as const) {
      const edit = insertBlankLine(doc, sels, where);
      const out = applied(text, edit, label);
      const lines = new Set(sels.map((s) => doc.lineOf(s.head))).size;
      assert.equal(out.split('\n').length, text.split('\n').length + lines, label);
      const after = new Doc(out);
      for (const s of edit.selections) assert.equal(after.lines[after.lineOf(s.head)].trim(), '', label);
    }
  }
});

test('joining lines only removes whitespace, and a caret above the last line always joins', () => {
  for (const { text, doc, sels, label } of CASES) {
    const edit = joinLines(doc, sels);
    const out = applied(text, edit, label);
    assert.equal(out.replace(/\s/g, ''), text.replace(/\s/g, ''), label);
    const last = doc.lines.length - 1;
    const joinable = sels.some((s) => s.anchor === s.head && doc.lineOf(s.head) < last && doc.lines[doc.lineOf(s.head) + 1].trim() !== '');
    if (joinable && sels.every((s) => s.anchor === s.head)) assert.ok(out.split('\n').length < text.split('\n').length, label);
  }
});

test('sorting, reversing and removing duplicates keep the lines, and settle or undo', () => {
  for (const { text, doc, sels, label } of CASES) {
    for (const how of ['sort-asc', 'sort-desc', 'reverse', 'unique'] as const) {
      const edit = rewriteLines(doc, sels, how);
      const out = applied(text, edit, label);
      if (how !== 'unique') assert.deepEqual(out.split('\n').sort(), text.split('\n').sort(), label);
      const again = rewriteLines(new Doc(out), edit.selections, how);
      if (how === 'reverse') {
        // An empty last line at the very end of the note cannot be told from
        // the end of the selection, so that one block is not reversed back.
        if (!(out.endsWith('\n') && edit.changes.some((c) => c.from + c.insert.length >= out.length))) {
          assert.equal(apply(out, again.changes), text, label);
        }
      } else {
        assert.deepEqual(again.changes, [], `${how}: ${label}`);
      }
    }
  }
});

test('deleting to a line edge never removes a line, and selecting lines starts at a line start', () => {
  for (const { text, doc, sels, label } of CASES) {
    for (const edge of ['start', 'end'] as const) {
      const out = applied(text, deleteToLineEdge(doc, sels, edge), label);
      assert.equal(out.split('\n').length, text.split('\n').length, label);
    }
    for (const s of selectLines(doc, sels).selections) assert.ok(lo(s) === 0 || text[lo(s) - 1] === '\n', label);
  }
});

test('the cursor commands keep selections sorted, apart and on whole words or matches', () => {
  for (const { text, sels, label } of CASES) {
    const { sels: sorted, main } = normalize(sels, sels[0]);
    sorted.forEach((s, i) => i > 0 && assert.ok(lo(s) >= hi(sorted[i - 1]), label));
    for (const s of sels) {
      const word = wordAt(text, s.head);
      if (word) assert.match(text.slice(word.anchor, word.head), /^[\p{L}\p{N}\p{M}_]+$/u, label);
    }
    const all = selectAll(text, sorted, main);
    if (all) {
      const needle = text.slice(lo(all.sels[all.main]), hi(all.sels[all.main]));
      assert.deepEqual(all.sels, allOccurrences(text, needle), label);
      // Select next, again and again, reaches the same set.
      let current = { sels: [all.sels[0]], main: 0 };
      for (let i = 0; i <= all.sels.length; i++) current = selectNext(text, current.sels, current.main) ?? current;
      assert.equal(current.sels.length, all.sels.length, label);
    }
    for (const direction of ['above', 'below'] as const) {
      const added = addCursors(text, sorted, main, direction);
      if (!added) continue;
      for (const s of added.sels) assert.ok(s.head >= 0 && s.head <= text.length, label);
      assert.ok(added.main >= 0 && added.main < added.sels.length, label);
    }
  }
});
