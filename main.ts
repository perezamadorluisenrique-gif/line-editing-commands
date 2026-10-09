import { App, Editor, EditorChange, Modal, Notice, Plugin, Setting } from 'obsidian';

import {
  deleteToLineEdge,
  Doc,
  duplicateLines,
  Edit,
  insertBlankLine,
  joinLines,
  LineTransform,
  parseLineTarget,
  rewriteLines,
  Sel,
  selectLines,
} from './src/logic.ts';
import { addCursors, keepMain, pickMain, selectAll, selectNext, Selections, skipOccurrence } from './src/cursors.ts';

type Command = (doc: Doc, sels: Sel[]) => Edit;

interface Spec {
  id: string;
  name: string;
  icon: string;
  run: Command;
}

const rewrite = (how: LineTransform): Command => (doc, sels) => rewriteLines(doc, sels, how);

const SPECS: Spec[] = [
  { id: 'duplicate-down', name: 'Duplicate line or selection down', icon: 'copy-plus', run: (d, s) => duplicateLines(d, s, 'down') },
  { id: 'duplicate-up', name: 'Duplicate line or selection up', icon: 'copy-plus', run: (d, s) => duplicateLines(d, s, 'up') },
  { id: 'blank-below', name: 'Insert blank line below', icon: 'corner-down-left', run: (d, s) => insertBlankLine(d, s, 'below') },
  { id: 'blank-above', name: 'Insert blank line above', icon: 'corner-up-left', run: (d, s) => insertBlankLine(d, s, 'above') },
  { id: 'select-line', name: 'Select line (repeat to extend)', icon: 'text-select', run: selectLines },
  { id: 'join-lines', name: 'Join lines', icon: 'merge', run: joinLines },
  { id: 'sort-asc', name: 'Sort selected lines (A to Z)', icon: 'arrow-down-narrow-wide', run: rewrite('sort-asc') },
  { id: 'sort-desc', name: 'Sort selected lines (Z to A)', icon: 'arrow-up-wide-narrow', run: rewrite('sort-desc') },
  { id: 'reverse-lines', name: 'Reverse selected lines', icon: 'arrow-up-down', run: rewrite('reverse') },
  { id: 'unique-lines', name: 'Remove duplicate lines in selection', icon: 'list-minus', run: rewrite('unique') },
  { id: 'delete-to-start', name: 'Delete to line start', icon: 'delete', run: (d, s) => deleteToLineEdge(d, s, 'start') },
  { id: 'delete-to-end', name: 'Delete to line end', icon: 'eraser', run: (d, s) => deleteToLineEdge(d, s, 'end') },
];

function selections(editor: Editor): Sel[] {
  return editor.listSelections().map((s) => ({ anchor: editor.posToOffset(s.anchor), head: editor.posToOffset(s.head) }));
}

/** Apply an edit as one transaction, so a single undo reverts it. */
function apply(editor: Editor, edit: Edit): void {
  const changes: EditorChange[] = edit.changes.map((c) => ({
    from: editor.offsetToPos(c.from),
    to: editor.offsetToPos(c.to),
    text: c.insert,
  }));
  // Selection offsets are in the new document; convert after the change lands.
  const before = editor.getValue();
  const newText = applyToText(before, edit);
  const posIn = (off: number) => {
    const lines = newText.slice(0, off).split('\n');
    return { line: lines.length - 1, ch: lines[lines.length - 1].length };
  };
  editor.transaction({
    changes,
    selections: edit.selections.map((s) => ({ from: posIn(s.anchor), to: posIn(s.head) })),
  });
}

function applyToText(text: string, edit: Edit): string {
  let out = '';
  let at = 0;
  for (const c of edit.changes) {
    out += text.slice(at, c.from) + c.insert;
    at = c.to;
  }
  return out + text.slice(at);
}

type CursorCommand = (text: string, sels: Sel[], main: number) => Selections | null;

const CURSOR_SPECS: { id: string; name: string; icon: string; run: CursorCommand }[] = [
  { id: 'select-next', name: 'Select word or next occurrence', icon: 'text-cursor-input', run: selectNext },
  { id: 'select-all-occurrences', name: 'Select all occurrences', icon: 'list-checks', run: selectAll },
  { id: 'skip-occurrence', name: 'Skip this occurrence and select the next', icon: 'skip-forward', run: skipOccurrence },
  { id: 'cursor-above', name: 'Add cursor above', icon: 'arrow-up-from-line', run: (t, s, m) => addCursors(t, s, m, 'above') },
  { id: 'cursor-below', name: 'Add cursor below', icon: 'arrow-down-from-line', run: (t, s, m) => addCursors(t, s, m, 'below') },
  { id: 'keep-main-cursor', name: 'Keep only the main cursor', icon: 'locate-fixed', run: (_t, s, m) => keepMain(s, m) },
];

/**
 * Obsidian's `setSelections` ignores its `main` argument (the first range is always the main
 * one), so the selection a command made "current" is remembered here per editor and matched
 * against the live selections on the next command. If the user changed them, it just won't match.
 */
const lastMain = new WeakMap<Editor, Sel>();

/** Selection-only commands: no text changes, so there is nothing to undo. */
function runCursorCommand(editor: Editor, run: CursorCommand): void {
  const sels = selections(editor);
  const remembered = lastMain.get(editor);
  const known = remembered ? sels.findIndex((s) => s.anchor === remembered.anchor && s.head === remembered.head) : -1;
  const main = known >= 0 ? known : pickMain(sels, editor.posToOffset(editor.getCursor('head')));
  const result = run(editor.getValue(), sels, main);
  if (!result) return;
  editor.setSelections(
    result.sels.map((s) => ({ anchor: editor.offsetToPos(s.anchor), head: editor.offsetToPos(s.head) })),
    result.main,
  );
  const m = result.sels[result.main];
  lastMain.set(editor, m);
  editor.scrollIntoView({ from: editor.offsetToPos(Math.min(m.anchor, m.head)), to: editor.offsetToPos(Math.max(m.anchor, m.head)) }, true);
}

class GoToLineModal extends Modal {
  constructor(app: App, private readonly editor: Editor) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, editor } = this;
    const count = editor.lineCount();
    this.setTitle('Go to line');
    let value = '';
    const go = () => {
      const target = parseLineTarget(value, count);
      if (!target) {
        new Notice('Type a line number, or line:column.');
        return;
      }
      const ch = Math.min(target.ch, editor.getLine(target.line).length);
      editor.setCursor({ line: target.line, ch });
      editor.scrollIntoView({ from: { line: target.line, ch }, to: { line: target.line, ch } }, true);
      this.close();
    };
    new Setting(contentEl).setName(`Line number (1 to ${count}), or line:column`).addText((t) => {
      t.setPlaceholder('42').onChange((v) => (value = v));
      t.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          go();
        }
      });
      window.setTimeout(() => t.inputEl.focus(), 0);
    });
    new Setting(contentEl).addButton((b) => b.setButtonText('Go').setCta().onClick(go));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export default class LineEditingCommandsPlugin extends Plugin {
  onload() {
    for (const spec of SPECS) {
      this.addCommand({
        id: spec.id,
        name: spec.name,
        icon: spec.icon,
        editorCallback: (editor) => {
          const doc = new Doc(editor.getValue());
          const edit = spec.run(doc, selections(editor));
          if (edit.changes.length === 0 && edit.selections.length === 0) return;
          apply(editor, edit);
        },
      });
    }
    for (const spec of CURSOR_SPECS) {
      this.addCommand({
        id: spec.id,
        name: spec.name,
        icon: spec.icon,
        editorCallback: (editor) => runCursorCommand(editor, spec.run),
      });
    }
    this.addCommand({
      id: 'go-to-line',
      name: 'Go to line number',
      icon: 'arrow-down-to-line',
      editorCallback: (editor) => new GoToLineModal(this.app, editor).open(),
    });
  }
}
