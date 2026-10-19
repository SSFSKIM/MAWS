// The node view every atom of the document schema draws through (math, diagrams, images, chips, placeholders; M3 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md): a non-editable element holding the drawing and, for an atom
// with an editable attribute, a field shown while the node is selected. The field writes its attribute with an
// attribute step, which moves no position, so the node stays selected while the person types; ProseMirror ignores the
// field's events and the view's own mutations. A remote change to the node redraws it, never under a focused field.
import type { Editor, NodeViewRenderer, NodeViewRendererProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';

export interface AtomField {
  attr: string;
  label: string;
  kind: 'text' | 'textarea' | 'date';
}

export interface AtomSpec {
  inline: boolean;
  /** Draws the node into `into` (emptied first); P3-E: may answer the drawing's disposer, called before the next draw and when the view goes. */
  draw(into: HTMLElement, node: PMNode): void | (() => void);
  field?: AtomField;
  /** The interactive element inside the drawing whose events are its own (a dropdown's select). */
  interactive?: (dom: HTMLElement) => HTMLElement | null;
}

/** Writes one attribute of the node at `getPos()` as one undoable change. */
export function setAttr(editor: Editor, getPos: NodeViewRendererProps['getPos'], attr: string, value: unknown): void {
  const pos = getPos();
  if (typeof pos !== 'number' || !editor.isEditable) return;
  editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, attr, value));
}

export const atomView =
  (spec: AtomSpec): NodeViewRenderer =>
  ({ editor, node: initial, getPos }) => {
    let node = initial;
    const tag = spec.inline ? 'span' : 'div';
    const dom = document.createElement(tag);
    dom.className = `doc-atom doc-${node.type.name}`;
    dom.dataset.node = node.type.name;
    dom.contentEditable = 'false';
    const drawing = document.createElement(tag);
    drawing.className = 'doc-atom-view';
    dom.append(drawing);
    let release = spec.draw(drawing, node); // P3-E: the drawing's disposer, if it answered one

    let panel: HTMLElement | null = null;
    let input: HTMLInputElement | HTMLTextAreaElement | null = null;
    const field = spec.field;
    if (field) {
      panel = document.createElement(tag);
      panel.className = 'doc-atom-field';
      panel.hidden = true;
      const control = field.kind === 'textarea' ? document.createElement('textarea') : document.createElement('input');
      if (control instanceof HTMLInputElement) control.type = field.kind === 'date' ? 'date' : 'text';
      control.setAttribute('aria-label', field.label);
      control.spellcheck = false;
      const shown = () => String(node.attrs[field.attr] ?? '');
      control.value = shown();
      control.addEventListener('input', () => {
        // P3-F (sitting candidate 16): a date the field cannot read (a segment cleared) writes nothing, so the chip
        // keeps its last date rather than emptying
        if (field.kind === 'date' && !control.value) return;
        setAttr(editor, getPos, field.attr, control.value);
      });
      (control as HTMLElement).addEventListener('keydown', (event: KeyboardEvent) => {
        // an input method's key is its own (P3-F, wave S review of c16): macOS Korean input ends a composition with a
        // composing Return and then a plain one; leaving on the first would hand the second to the page, splitting the line
        if (event.isComposing) return;
        // Escape, or Enter in a one-line field, hands the caret back to the document after the node: right after an
        // inline atom, in the nearest text after a block one (before it, or the atom itself, when nothing follows)
        const done = event.key === 'Escape' || (event.key === 'Enter' && !(control instanceof HTMLTextAreaElement && !event.metaKey && !event.ctrlKey));
        if (!done) return;
        // P3-F: the field's key, kept from the page and from any surface around it
        event.preventDefault();
        event.stopPropagation();
        if (field.kind === 'date') {
          // Enter commits the date the field shows; Escape, or a field that reads no date, shows the chip's again
          if (event.key === 'Enter' && control.value && control.value !== shown()) setAttr(editor, getPos, field.attr, control.value);
          else control.value = shown();
        }
        const pos = getPos();
        if (typeof pos !== 'number') return;
        // the page takes the keyboard now (P3-F), not on the frame after, which the hidden field would leave to nothing
        editor.view.focus();
        editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(pos + node.nodeSize))).scrollIntoView());
      });
      input = control;
      panel.append(control);
      dom.append(panel);
    }

    const view: NodeView = {
      dom,
      update(next) {
        if (next.type !== node.type) return false;
        const changed = next.attrs !== node.attrs && JSON.stringify(next.attrs) !== JSON.stringify(node.attrs);
        node = next;
        if (changed) {
          release?.(); // P3-E
          drawing.replaceChildren();
          release = spec.draw(drawing, node);
        }
        if (input && field && document.activeElement !== input) input.value = String(node.attrs[field.attr] ?? '');
        return true;
      },
      selectNode() {
        dom.classList.add('ProseMirror-selectednode');
        if (panel) panel.hidden = !editor.isEditable;
      },
      deselectNode() {
        dom.classList.remove('ProseMirror-selectednode');
        if (panel) panel.hidden = true;
      },
      stopEvent(event) {
        const target = event.target as globalThis.Node | null;
        if (!target) return false;
        return (panel?.contains(target) ?? false) || (spec.interactive?.(dom)?.contains(target) ?? false);
      },
      ignoreMutation: () => true,
      // P3-E: the drawing released when the node leaves the document or the editor goes
      destroy() {
        release?.();
        release = undefined;
      },
    };
    return view;
  };
