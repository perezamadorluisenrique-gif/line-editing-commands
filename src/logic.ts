// Pure logic: no `obsidian` import, so tests/ can run it under plain Node.
// Positions are document offsets. Every command returns changes in ORIGINAL
// coordinates (sorted, non-overlapping) and selections in NEW coordinates, so
// the caller can apply the whole thing as one editor transaction.

export interface Sel {
  anchor: number;
  head: number;
}

export interface Change {
  from: number;
  to: number;
  insert: string;
}

export interface Edit {
  changes: Change[];
  selections: Sel[];
}

interface Block {
  start: number; // first line index
  end: number; // last line index (inclusive)
  sels: Sel[];
}

export class Doc {
  readonly text: string;
  readonly lines: string[];
  readonly starts: number[];

  constructor(text: string) {
    this.text = text;
    this.lines = text.split('\n');
    this.starts = [];
    let pos = 0;
    for (const l of this.lines) {
      this.starts.push(pos);
      pos += l.length + 1;
    }
  }

  lineOf(offset: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  lineStart(i: number): number {
    return this.starts[i];
  }

  lineEnd(i: number): number {
    return this.starts[i] + this.lines[i].length;
  }
}

/**
 * Line range touched by a selection. A non-empty selection that ends at the
 * very start of a line does not include that line.
 */
function selLines(doc: Doc, s: Sel): [number, number] {
  const from = Math.min(s.anchor, s.head);
  const to = Math.max(s.anchor, s.head);
  const a = doc.lineOf(from);
  let b = doc.lineOf(to);
  if (to > from && b > a && to === doc.lineStart(b)) b -= 1;
  return [a, b];
}

/** Merge the lines of all selections into disjoint blocks, keeping each selection with its block. */
function blocksOf(doc: Doc, sels: Sel[]): Block[] {
  const items = sels
    .map((s) => ({ s, r: selLines(doc, s) }))
    .sort((x, y) => x.r[0] - y.r[0] || x.r[1] - y.r[1]);
  const blocks: Block[] = [];
  for (const { s, r } of items) {
    const last = blocks[blocks.length - 1];
    if (last && r[0] <= last.end) {
      last.end = Math.max(last.end, r[1]);
      last.sels.push(s);
    } else {
      blocks.push({ start: r[0], end: r[1], sels: [s] });
    }
  }
  return blocks;
}

function blockText(doc: Doc, b: Block): string {
  return doc.lines.slice(b.start, b.end + 1).join('\n');
}

/** One caret per distinct line holding a selection head. */
function headLines(doc: Doc, sels: Sel[]): { line: number; head: number }[] {
  const seen = new Set<number>();
  const out: { line: number; head: number }[] = [];
  for (const s of [...sels].sort((x, y) => x.head - y.head)) {
    const line = doc.lineOf(s.head);
    if (seen.has(line)) continue;
    seen.add(line);
    out.push({ line, head: s.head });
  }
  return out;
}

export function duplicateLines(doc: Doc, sels: Sel[], direction: 'up' | 'down'): Edit {
  const changes: Change[] = [];
  const selections: Sel[] = [];
  let delta = 0;
  for (const b of blocksOf(doc, sels)) {
    const text = blockText(doc, b);
    if (direction === 'down') {
      changes.push({ from: doc.lineEnd(b.end), to: doc.lineEnd(b.end), insert: '\n' + text });
      const shift = delta + text.length + 1;
      for (const s of b.sels) selections.push({ anchor: s.anchor + shift, head: s.head + shift });
    } else {
      changes.push({ from: doc.lineStart(b.start), to: doc.lineStart(b.start), insert: text + '\n' });
      for (const s of b.sels) selections.push({ anchor: s.anchor + delta, head: s.head + delta });
    }
    delta += text.length + 1;
  }
  return { changes, selections };
}

export function insertBlankLine(doc: Doc, sels: Sel[], where: 'above' | 'below'): Edit {
  const changes: Change[] = [];
  const selections: Sel[] = [];
  let delta = 0;
  for (const { line } of headLines(doc, sels)) {
    const indent = /^[ \t]*/.exec(doc.lines[line])![0];
    if (where === 'below') {
      const at = doc.lineEnd(line);
      changes.push({ from: at, to: at, insert: '\n' + indent });
      const caret = at + delta + 1 + indent.length;
      selections.push({ anchor: caret, head: caret });
    } else {
      const at = doc.lineStart(line);
      changes.push({ from: at, to: at, insert: indent + '\n' });
      const caret = at + delta + indent.length;
      selections.push({ anchor: caret, head: caret });
    }
    delta += indent.length + 1;
  }
  return { changes, selections };
}

/** Select whole lines; repeated calls extend the selection one line down. */
export function selectLines(doc: Doc, sels: Sel[]): Edit {
  const selections: Sel[] = [];
  for (const b of blocksOf(doc, sels)) {
    const from = doc.lineStart(b.start);
    const lastLine = doc.lines.length - 1;
    const endOf = (l: number) => (l < lastLine ? doc.lineStart(l + 1) : doc.lineEnd(l));
    const already = b.sels.some((s) => Math.min(s.anchor, s.head) === from && Math.max(s.anchor, s.head) === endOf(b.end));
    const end = already && b.end < lastLine ? b.end + 1 : b.end;
    selections.push({ anchor: from, head: endOf(end) });
  }
  return { changes: [], selections };
}

export function joinLines(doc: Doc, sels: Sel[]): Edit {
  const changes: Change[] = [];
  const selections: Sel[] = [];
  let delta = 0;
  const lastLine = doc.lines.length - 1;
  for (const b of blocksOf(doc, sels)) {
    const end = b.start === b.end ? b.start + 1 : b.end;
    if (end > lastLine) continue;
    let acc = doc.lines[b.start];
    let caret = -1;
    for (let i = b.start + 1; i <= end; i++) {
      const next = doc.lines[i].replace(/^\s+/, '');
      if (next === '') continue;
      if (caret < 0) caret = acc.length;
      acc += (acc === '' || /\s$/.test(acc) ? '' : ' ') + next;
    }
    const from = doc.lineStart(b.start);
    const to = doc.lineEnd(end);
    const before = doc.lines.slice(b.start, end + 1).join('\n');
    if (acc === before) continue;
    changes.push({ from, to, insert: acc });
    const c = from + delta + (caret < 0 ? acc.length : caret);
    selections.push({ anchor: c, head: c });
    delta += acc.length - (to - from);
  }
  return { changes, selections };
}

export type LineTransform = 'sort-asc' | 'sort-desc' | 'reverse' | 'unique';

export function transformLines(lines: string[], how: LineTransform): string[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  switch (how) {
    case 'sort-asc':
      return [...lines].sort(cmp);
    case 'sort-desc':
      return [...lines].sort((a, b) => cmp(b, a));
    case 'reverse':
      return [...lines].reverse();
    case 'unique': {
      const seen = new Set<string>();
      return lines.filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
    }
  }
}

/** Sort, reverse or de-duplicate the lines of every multi-line selection. Single-line blocks are left alone. */
export function rewriteLines(doc: Doc, sels: Sel[], how: LineTransform): Edit {
  const changes: Change[] = [];
  const selections: Sel[] = [];
  let delta = 0;
  for (const b of blocksOf(doc, sels)) {
    if (b.start === b.end) continue;
    const from = doc.lineStart(b.start);
    const to = doc.lineEnd(b.end);
    const insert = transformLines(doc.lines.slice(b.start, b.end + 1), how).join('\n');
    if (insert !== doc.text.slice(from, to)) changes.push({ from, to, insert });
    selections.push({ anchor: from + delta, head: from + delta + insert.length });
    delta += insert.length - (to - from);
  }
  return { changes, selections };
}

/** Delete from the caret to the start or end of its line, for every caret. */
export function deleteToLineEdge(doc: Doc, sels: Sel[], edge: 'start' | 'end'): Edit {
  const changes: Change[] = [];
  const selections: Sel[] = [];
  let delta = 0;
  for (const { line, head } of headLines(doc, sels)) {
    const from = edge === 'start' ? doc.lineStart(line) : head;
    const to = edge === 'start' ? head : doc.lineEnd(line);
    if (from < to) changes.push({ from, to, insert: '' });
    const caret = from + delta;
    selections.push({ anchor: caret, head: caret });
    delta -= to - from;
  }
  return { changes, selections };
}

/** "12" or "12:5" (line, optional column), 1-based, clamped to the document. Null if not a number. */
export function parseLineTarget(input: string, lineCount: number): { line: number; ch: number } | null {
  const m = /^\s*(\d+)\s*(?:[:,]\s*(\d+))?\s*$/.exec(input);
  if (!m) return null;
  const line = Math.min(Math.max(parseInt(m[1], 10), 1), Math.max(lineCount, 1));
  const col = m[2] ? Math.max(parseInt(m[2], 10), 1) : 1;
  return { line: line - 1, ch: col - 1 };
}
