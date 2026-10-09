// Pure logic for the multiple-cursor commands: no `obsidian` import. Positions
// are document offsets (UTF-16 units, like the editor). Nothing here edits text.

import type { Sel } from './logic.ts';

export interface Selections {
  sels: Sel[]; // sorted by position, no duplicates
  main: number; // index of the main selection
}

const WORD = /^[\p{L}\p{N}\p{M}_]$/u;

export function isWordChar(ch: string): boolean {
  return WORD.test(ch);
}

/** The code point ending at `i` (so astral letters are not split). */
function before(text: string, i: number): string {
  if (i <= 0) return '';
  const lo = text.charCodeAt(i - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = text.charCodeAt(i - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return text.slice(i - 2, i);
  }
  return text[i - 1];
}

/** The code point starting at `i`. */
function after(text: string, i: number): string {
  if (i >= text.length) return '';
  const hi = text.charCodeAt(i);
  if (hi >= 0xd800 && hi <= 0xdbff && i + 1 < text.length) {
    const lo = text.charCodeAt(i + 1);
    if (lo >= 0xdc00 && lo <= 0xdfff) return text.slice(i, i + 2);
  }
  return text[i];
}

/** The word around (or touching) an offset, or null when there is none. Letters of any script, digits, marks and `_`. */
export function wordAt(text: string, offset: number): Sel | null {
  let from = offset;
  let to = offset;
  while (from > 0 && isWordChar(before(text, from))) from -= before(text, from).length;
  while (to < text.length && isWordChar(after(text, to))) to += after(text, to).length;
  return from === to ? null : { anchor: from, head: to };
}

const lo = (s: Sel) => Math.min(s.anchor, s.head);
const hi = (s: Sel) => Math.max(s.anchor, s.head);

/** Sort, drop exact duplicates and selections swallowed by another; return where `main` ended up. */
export function normalize(sels: Sel[], main: Sel): Selections {
  const sorted = [...sels].sort((a, b) => lo(a) - lo(b) || hi(a) - hi(b));
  const out: Sel[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && (lo(s) < hi(prev) || (lo(s) === hi(prev) && lo(s) === lo(prev)))) continue;
    out.push(s);
  }
  let idx = out.findIndex((s) => s.anchor === main.anchor && s.head === main.head);
  if (idx < 0) idx = out.findIndex((s) => lo(s) <= lo(main) && hi(s) >= hi(main));
  return { sels: out, main: Math.max(idx, 0) };
}

/** Which selection is the main one: the one whose head is at `headOffset`, else the last. */
export function pickMain(sels: Sel[], headOffset: number): number {
  const i = sels.findIndex((s) => s.head === headOffset);
  return i >= 0 ? i : sels.length - 1;
}

function overlaps(sels: Sel[], from: number, to: number): boolean {
  return sels.some((s) => lo(s) < to && hi(s) > from);
}

/** Next occurrence of `needle` at or after `start`, wrapping once, that does not touch any selection in `taken`. */
export function findNextOccurrence(text: string, needle: string, start: number, taken: Sel[]): Sel | null {
  if (!needle) return null;
  const first = Math.min(Math.max(start, 0), text.length);
  let at = first;
  let wrapped = false;
  for (;;) {
    let i = text.indexOf(needle, at);
    if (i < 0 || (wrapped && i >= first + needle.length)) {
      if (wrapped) return null;
      wrapped = true;
      at = 0;
      i = text.indexOf(needle, at);
      if (i < 0 || i >= first + needle.length) return null;
    }
    if (!overlaps(taken, i, i + needle.length)) return { anchor: i, head: i + needle.length };
    at = i + 1;
  }
}

/** Every non-overlapping occurrence of `needle`, left to right. */
export function allOccurrences(text: string, needle: string): Sel[] {
  const out: Sel[] = [];
  if (!needle) return out;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
    out.push({ anchor: i, head: i + needle.length });
  }
  return out;
}

const textOf = (text: string, s: Sel) => text.slice(lo(s), hi(s));

/**
 * "Select word or next occurrence". Cursors without a selection select their word. If
 * every cursor already has a selection, the main selection's text is searched for after
 * the main selection (wrapping) and the match becomes a new selection and the main one.
 */
export function selectNext(text: string, sels: Sel[], main: number): Selections | null {
  if (sels.some((s) => s.anchor === s.head)) {
    let changed = false;
    const next = sels.map((s) => {
      if (s.anchor !== s.head) return s;
      const w = wordAt(text, s.head);
      if (!w) return s;
      changed = true;
      return w;
    });
    if (!changed) return null;
    const m = next[main];
    return normalize(next, m);
  }
  const m = sels[main];
  const hit = findNextOccurrence(text, textOf(text, m), hi(m), sels);
  if (!hit) return null;
  return normalize([...sels, hit], hit);
}

/** "Select all occurrences" of the main selection's text, or of the word at the main cursor. */
export function selectAll(text: string, sels: Sel[], main: number): Selections | null {
  let m = sels[main];
  if (m.anchor === m.head) {
    const w = wordAt(text, m.head);
    if (!w) return null;
    m = w;
  }
  const hits = allOccurrences(text, textOf(text, m));
  if (hits.length === 0) return null;
  const mainHit = hits.find((h) => h.anchor === lo(m)) ?? hits[0];
  return normalize(hits, mainHit);
}

/** "Skip this occurrence": drop the main selection (the last added) and select the next one instead. */
export function skipOccurrence(text: string, sels: Sel[], main: number): Selections | null {
  const m = sels[main];
  if (m.anchor === m.head) return selectNext(text, sels, main);
  const rest = sels.filter((_, i) => i !== main);
  const hit = findNextOccurrence(text, textOf(text, m), hi(m), rest);
  if (!hit || (hit.anchor === lo(m) && hit.head === hi(m))) return null;
  return normalize([...rest, hit], hit);
}

export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let l = 0;
  let h = starts.length - 1;
  while (l < h) {
    const mid = (l + h + 1) >> 1;
    if (starts[mid] <= offset) l = mid;
    else h = mid - 1;
  }
  return l;
}

/** Add an empty cursor on the line above or below each cursor, at the same column, clamped to the line's length. */
export function addCursors(text: string, sels: Sel[], main: number, dir: 'above' | 'below'): Selections | null {
  const starts = lineStarts(text);
  const end = (l: number) => (l + 1 < starts.length ? starts[l + 1] - 1 : text.length);
  const added: Sel[] = [];
  for (const s of sels) {
    const l = lineOf(starts, s.head);
    const target = dir === 'above' ? l - 1 : l + 1;
    if (target < 0 || target >= starts.length) continue;
    const col = s.head - starts[l];
    const at = starts[target] + Math.min(col, end(target) - starts[target]);
    added.push({ anchor: at, head: at });
  }
  const before = normalize(sels, sels[main]);
  const all = normalize([...sels, ...added], sels[main]);
  if (all.sels.length === before.sels.length) return null;
  // The new cursor nearest the direction of travel becomes the main one.
  const extra = dir === 'above' ? added[0] : added[added.length - 1];
  return normalize(all.sels, extra ?? sels[main]);
}

/** "Keep only the main cursor". */
export function keepMain(sels: Sel[], main: number): Selections | null {
  if (sels.length < 2) return null;
  return { sels: [sels[main]], main: 0 };
}
