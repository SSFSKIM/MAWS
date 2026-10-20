// Suite 3, editor level, on MAWS's own document binding (src/artifacts/document: the schema's extensions and the
// `collaboration` extension over @y/prosemirror 2 and @y/y 14, replicas of an in-memory host over MessageChannel ports,
// exactly as the editor suites build them). Typing is trusted (webContents.insertText), ⌘Z a trusted keyDown.
//  (i)  reparent: the editor body (its scroll container and the editor) moved from pane A to pane B with moveBefore,
//       then back with insertBefore for contrast;
//  (ii) remount: the editor destroyed and a new one made over the same replica, with a Y.UndoManager made outside the
//       editor and swapped into the undo plugin (`tr.setMeta(yUndoPluginKey, { undoManager })`, the swap the plugin
//       supports), plus the explicit transfer of scroll and selection (Y relative positions); and the control: the
//       same remount as MAWS does it today (the binding's own manager), row 147.
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { Collaboration } from '../../../src/artifacts/document/collab';
import { coreExtensionOptions } from '../../../src/artifacts/document/ids';
import { extensions } from '../../../src/artifacts/document/schema';
import { tabBody } from '../../../src/artifacts/document/tabs';
import { openMemoryHandle, whenSynced } from '../../../src/artifacts/document/editor/memory-host';
import type { DocumentHandle } from '../../../src/artifacts/document/editor/host-types';
import { TAB, World, doc, para, endOf } from '../../../src/artifacts/document/editor/test-world';
import { UndoManager } from '../../../src/artifacts/yjs/document';
import { relativePositionsToResolvedPositions, resolvedPositionsToRelativePositions, ySyncPluginKey, yUndoPluginKey } from '../../../src/artifacts/yjs/prosemirror';
import { el, errText, frames, harness, insertBefore, moveBefore, sleep, until } from './util';

type UM = InstanceType<typeof UndoManager>;
let n = 0;

function makeEditor(handle: DocumentHandle, element: HTMLElement, name: string): Editor {
  return new Editor({
    element,
    coreExtensionOptions,
    extensions: [
      ...extensions({ generateID: () => `${name}${++n}` }),
      Collaboration.configure({ ytype: tabBody(handle.doc, TAB)!, awareness: handle.awareness, user: { name, color: '#c33' }, hold: handle, onRestored: (l) => handle.onRestored(l) }),
    ],
  });
}

const pluginUM = (editor: Editor): UM | null => (yUndoPluginKey.getState(editor.state) as { undoManager?: UM } | undefined)?.undoManager ?? null;
const storageUM = (editor: Editor): UM | null => (editor.storage as unknown as { collaboration: { undoManager: UM | null } }).collaboration.undoManager;
/** The binding's own manager is made at mount and swapped in a microtask later. */
const ready = (editor: Editor) => until(() => storageUM(editor) != null && pluginUM(editor) === storageUM(editor) && editor.state.doc.childCount > 1);
const listening = (um: UM) => {
  const observers = (um.doc as unknown as { _observers?: Map<string, Set<unknown>> })._observers;
  return observers?.get('afterTransaction')?.has((um as unknown as { afterTransactionHandler: unknown }).afterTransactionHandler) ?? false;
};
const textOf = (editor: Editor, id: string) => {
  let t: string | null = null;
  editor.state.doc.forEach((node) => {
    if (node.attrs.id === id) t = node.textContent;
  });
  return t;
};
const startOf = (editor: Editor, id: string) => endOf(editor, id) - (textOf(editor, id)?.length ?? 0);

async function type(editor: Editor, text: string, id: string) {
  const before = textOf(editor, id);
  await harness.insertText(text);
  const ok = await until(() => textOf(editor, id) !== before, 1500);
  await sleep(20);
  return ok;
}

/** ⌘Z through a trusted keyDown; falls back to a synthetic keydown on the view (recorded) if the trusted one does nothing. */
async function cmdZ(editor: Editor, watch: () => unknown) {
  const before = JSON.stringify(watch());
  await harness.key('z', ['meta']);
  if (await until(() => JSON.stringify(watch()) !== before, 600)) return 'trusted';
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true, cancelable: true }));
  if (await until(() => JSON.stringify(watch()) !== before, 600)) return 'synthetic';
  return 'none';
}

function snapshot(editor: Editor, scroller: HTMLElement, view: Editor['view'], um: UM | null) {
  const { from, to, empty } = editor.state.selection;
  return {
    sameEditorView: editor.view === view,
    viewDestroyed: view.isDestroyed,
    pmSelection: { from, to, empty },
    domSelection: getSelection()?.toString() ?? null,
    viewHasFocus: editor.view.hasFocus(),
    pmFocusedFlag: (editor.view as unknown as { focused: boolean }).focused,
    activeElementIsView: document.activeElement === editor.view.dom,
    scrollTop: scroller.scrollTop,
    undoDepth: um?.undoStack.length ?? null,
    redoDepth: um?.redoStack.length ?? null,
  };
}

function body(paneId: string) {
  const pane = document.getElementById(paneId)!;
  const host = el('div', { class: 'ed-host' }); // the moved node: a keeper's host holds the body's root
  const scroller = el('div', { class: 'ed-scroller' });
  const element = el('div');
  scroller.append(element);
  host.append(scroller);
  pane.append(host);
  return { host, scroller, element };
}

const paragraphs = () => Array.from({ length: 60 }, (_, i) => para(`p${i + 1}`, `Paragraph ${i + 1} lorem ipsum dolor sit amet, consectetur adipiscing elit.`));
const firstBlocks = (editor: Editor) => [1, 2, 3, 4].map((i) => textOf(editor, `p${i}`));

async function reparent(world: World) {
  const handle = openMemoryHandle(world.host, { log: () => {} });
  await whenSynced(handle);
  const { host, scroller, element } = body('ed-A');
  const editor = makeEditor(handle, element, 'r');
  await ready(editor);
  const view = editor.view;
  const um = pluginUM(editor);
  const out: Record<string, unknown> = {};
  const arrange = async (id: string) => {
    const at = startOf(editor, id);
    editor.view.focus();
    editor.commands.setTextSelection({ from: at, to: at + 9 }); // "Paragraph"
    scroller.scrollTop = 400;
    await frames(2);
  };

  editor.view.focus();
  editor.commands.setTextSelection(endOf(editor, 'p2'));
  out.typedAlpha = await type(editor, ' alpha', 'p2');
  await sleep(700); // past the manager's 500 ms capture window: a second undo step
  out.typedBeta = await type(editor, ' beta', 'p2');

  // (a) moveBefore alone.
  await arrange('p3');
  out.before = snapshot(editor, scroller, view, um);
  moveBefore(document.getElementById('ed-B')!, host);
  out.syncAfterMoveBefore = snapshot(editor, scroller, view, um);
  await frames(3);
  await sleep(100);
  out.afterMoveBefore = snapshot(editor, scroller, view, um);

  // (b) moveBefore, then the view writes its own selection back to the DOM at once (view.focus() runs
  // selectionToDOM), before the collapsed DOM selection's selectionchange reaches ProseMirror; the scroll offset set back.
  await arrange('p3');
  out.beforeMoveBeforeResync = snapshot(editor, scroller, view, um);
  const savedScroll = scroller.scrollTop;
  moveBefore(document.getElementById('ed-A')!, host);
  editor.view.focus();
  out.syncAfterMoveBeforeResync = snapshot(editor, scroller, view, um);
  scroller.scrollTop = savedScroll; // and the scroll fix-up (a focused descendant costs the container its offset)
  await frames(3);
  await sleep(600); // a separate undo step for what follows
  out.afterMoveBeforeResync = snapshot(editor, scroller, view, um);
  out.typedAfterMove = await type(editor, '!!', 'p3');
  out.blocksAfterTyping = firstBlocks(editor);
  out.afterTyping = snapshot(editor, scroller, view, um);
  out.cmdZ1 = await cmdZ(editor, () => editor.getText());
  out.blocksAfterCmdZ1 = firstBlocks(editor);
  out.cmdZ2 = await cmdZ(editor, () => editor.getText());
  out.blocksAfterCmdZ2 = firstBlocks(editor);
  out.afterUndos = snapshot(editor, scroller, view, um);

  // (c) Contrast: the same body moved with insertBefore (a remove and an insert).
  await arrange('p4');
  out.beforeInsertBefore = snapshot(editor, scroller, view, um);
  insertBefore(document.getElementById('ed-B')!, host);
  out.syncAfterInsertBefore = snapshot(editor, scroller, view, um);
  await frames(3);
  await sleep(100);
  out.afterInsertBefore = snapshot(editor, scroller, view, um);
  out.typedAfterInsertBeforeNoRefocus = await type(editor, '??', 'p4');
  out.blocksAfterInsertBeforeTyping = firstBlocks(editor);
  editor.destroy();
  host.remove();
  handle.close();
  return out;
}

async function remount(world: World, external: boolean) {
  const handle = openMemoryHandle(world.host, { log: () => {} });
  await whenSynced(handle);
  const out: Record<string, unknown> = {};
  const first = body('ed-A');
  let editor = makeEditor(handle, first.element, external ? 'x' : 'c');
  await ready(editor);
  const own1 = storageUM(editor)!;
  let um: UM = own1;
  if (external) {
    um = new UndoManager(tabBody(handle.doc, TAB)!, { trackedOrigins: new Set() });
    editor.view.dispatch(editor.state.tr.setMeta(yUndoPluginKey, { undoManager: um }));
    out.swappedIn = pluginUM(editor) === um;
    out.syncPluginTracked = um.trackedOrigins.has(ySyncPluginKey.get(editor.state));
  }
  const id = external ? 'p5' : 'p6';
  editor.view.focus();
  editor.commands.setTextSelection(endOf(editor, id));
  out.typedOne = await type(editor, ' one', id);
  await sleep(700);
  out.typedTwo = await type(editor, ' two', id);
  out.textBefore = textOf(editor, id);
  const s7 = startOf(editor, 'p7');
  editor.commands.setTextSelection({ from: s7 + 2, to: s7 + 12 });
  first.scroller.scrollTop = 500;
  await frames(2);
  out.before = snapshot(editor, first.scroller, editor.view, um);

  // The explicit transfer's capture: scroll, and the selection as Y relative positions (they survive remote edits).
  const sel = editor.state.selection;
  const saved = { scrollTop: first.scroller.scrollTop, rel: resolvedPositionsToRelativePositions(editor.view, [sel.$anchor, sel.$head]) };

  editor.destroy();
  first.host.remove();
  out.afterDestroy = {
    managerUndoDepth: um.undoStack.length,
    managerStillListening: listening(um),
    managerTrackedOrigins: um.trackedOrigins.size,
    bindingOwnManagerStillListening: listening(own1),
  };

  const second = body('ed-B');
  editor = makeEditor(handle, second.element, external ? 'y' : 'd');
  await ready(editor);
  if (external) {
    editor.view.dispatch(editor.state.tr.setMeta(yUndoPluginKey, { undoManager: um }));
    out.swappedInAgain = pluginUM(editor) === um;
    out.pluginHasUndoOps = (yUndoPluginKey.getState(editor.state) as { hasUndoOps: boolean }).hasUndoOps;
  } else {
    um = storageUM(editor)!;
  }
  // The explicit transfer's restore.
  second.scroller.scrollTop = saved.scrollTop;
  let restoredSelection: unknown = null;
  try {
    const [anchor, head] = relativePositionsToResolvedPositions(editor.view, saved.rel);
    if (anchor && head) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor.pos, head.pos)).setMeta('addToHistory', false));
    restoredSelection = { from: editor.state.selection.from, to: editor.state.selection.to };
  } catch (e) {
    restoredSelection = errText(e);
  }
  editor.view.focus();
  await frames(2);
  out.afterRemount = { ...snapshot(editor, second.scroller, editor.view, um), restoredSelection };

  out.cmdZ1 = await cmdZ(editor, () => textOf(editor, id));
  out.textAfterCmdZ1 = textOf(editor, id);
  out.selectionAfterCmdZ1 = { from: editor.state.selection.from, to: editor.state.selection.to, endOfBlock: endOf(editor, id) };
  out.cmdZ2 = await cmdZ(editor, () => textOf(editor, id));
  out.textAfterCmdZ2 = textOf(editor, id);
  if (external) {
    editor.commands.setTextSelection(endOf(editor, id));
    await sleep(600);
    out.typedThree = await type(editor, ' three', id);
    out.cmdZ3 = await cmdZ(editor, () => textOf(editor, id));
    out.textAfterCmdZ3 = textOf(editor, id);
  }
  out.undoDepthEnd = um.undoStack.length;
  editor.destroy();
  second.host.remove();
  if (external) um.destroy();
  handle.close();
  return out;
}

export async function editorSuite() {
  const panes = el('div', { id: 'ed-panes' }, el('div', { class: 'pane', id: 'ed-A' }), el('div', { class: 'pane', id: 'ed-B' }));
  document.body.prepend(panes); // on screen at the top: scroll and caret are real layout
  const world = new World(doc(...paragraphs()));
  const out: Record<string, unknown> = {};
  try {
    out.reparent = await reparent(world);
  } catch (e) {
    out.reparentError = errText(e) + '\n' + (e as Error).stack;
  }
  try {
    out.remountControl = await remount(world, false);
  } catch (e) {
    out.remountControlError = errText(e) + '\n' + (e as Error).stack;
  }
  try {
    out.remountExternalManager = await remount(world, true);
  } catch (e) {
    out.remountExternalError = errText(e) + '\n' + (e as Error).stack;
  }
  world.destroy();
  panes.remove();
  return out;
}
