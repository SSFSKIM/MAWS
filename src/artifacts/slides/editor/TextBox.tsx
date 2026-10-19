// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Text in place", "Undo"; M5): a text element edited
// in place. The canvas hands over the element's own node (so the editor takes the element's font, size, colour and
// alignment) and stops redrawing its text; a Tiptap editor mounts in it, bound by @y/prosemirror 2 to the element's
// `<doc>` node (`bindSlideText`), so typing writes the model character by character and another replica's change
// arrives in the editor. On the end the canvas takes the node back and draws it from the model.
//
// Undo is the deck's one stack: the binding's origin is tracked for the text box's lifetime, a burst of typing in this
// box is one step (`noteTyping` before each of the owner's writes), a format change is a step of its own, and ⌘Z goes to
// the stack, never to the browser's or the binding's own undo. While an IME composes, remote frames wait (the
// provider's hold, parent Decision Log 33 to 35) until ProseMirror has ended the composition.
//
// P4-B2's spike S-IME (./armed.ts): with the prototype on, a text box also mounts ARMED, on a selected text element
// before any edit: focused with its caret hidden and no mark bar, its first key turning it into the edit in place.
import { Editor, Extension } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type FormEvent, type KeyboardEvent, type Ref, type SyntheticEvent } from 'react';
import type { Node as PmNode } from '@tiptap/pm/model';
import { isBindingTransaction, onUpdate, type Doc } from '../../yjs';
import { readFlat } from '../model';
import { SLIDE_LIMITS, textCost } from '../parse';
import { bindSlideText } from '../../yjs/slide-text';
import type { SlideCanvas } from '../canvas';
import type { DeckSession } from './session';
import { hexColor, httpsHref, slideTextExtensions, type Gesture } from './text-schema';
import { armedMode, registerArmed } from './armed';
import './textbox.css';

export const TEXTBOX_COPY = {
  bar: 'Text formatting',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  link: 'Link',
  removeLink: 'Remove link',
  linkAddress: 'Link address',
  applyLink: 'Apply link',
  httpsOnly: 'Links must start with https://',
  colour: 'Colour',
  defaultColour: 'Default colour',
  hexColour: 'Hex colour',
  applyColour: 'Apply colour',
  hexOnly: 'Enter a colour as #rrggbb',
  tooMuchText: (max: number, would: number) => `A slide holds at most ${max.toLocaleString('en-US')} characters of text; this would make ${would.toLocaleString('en-US')}.`,
  tooManyMarks: (max: number, would: number) => `A slide holds at most ${max} formatted runs of text; this would make ${would}.`,
} as const;
const C = TEXTBOX_COPY;

/** The colour swatches: the design system's roles, so a theme change recolours the text. */
const SWATCHES = [
  { label: 'Text colour', color: 'var(--ds-color-text)' },
  { label: 'Muted colour', color: 'var(--ds-color-text-muted)' },
  { label: 'Accent colour', color: 'var(--ds-color-accent)' },
] as const;

// An element without a text node gains an empty one under this origin: never undone (undoing it would pull the node
// out from under the binding), and equal to no text in every reading of the model.
const ENSURE_ORIGIN = { textBox: 'ensure' };
// ProseMirror ends a composition 20 ms after compositionend (it flushes the composed DOM then); the hold outlasts it.
const COMPOSE_SETTLE_MS = 30;
const BAR_GAP = 8;

export interface TextBoxProps {
  session: DeckSession;
  canvas: SlideCanvas;
  slideId: string;
  elementId: string;
  readOnly?: boolean;
  /** P4-B2 spike: mounted ARMED (the element selected, not yet edited); false once a key or a press began the edit. */
  armed?: boolean;
}

export function TextBox({ session, canvas, slideId, elementId, readOnly = false, armed = false }: TextBoxProps) {
  const [mounted, setMounted] = useState<{ editor: Editor; node: HTMLElement } | null>(null);
  // read by the editor's listeners without making the box mount again: ARMED turning into the edit is a flag's flip
  const armedNow = useRef(armed);
  useLayoutEffect(() => {
    armedNow.current = armed;
  }, [armed]);
  const bar = useRef<HTMLDivElement>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  // fix wave 1: an edit the slide's text budget refuses, shown until the next edit that fits
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => {
    const node = canvas.beginTextEdit(elementId);
    const binding = node && bindSlideText(session.doc, slideId, elementId, readOnly ? null : ENSURE_ORIGIN);
    if (!node || !binding) {
      canvas.endTextEdit(elementId);
      session.editText(null);
      return;
    }
    const untrack = readOnly ? () => {} : session.trackOrigin(binding.origin);
    const budget = textBudget(session.doc, slideId, elementId, binding.origin);
    const target = `text:${elementId}`;
    // a format change is one step: cut before the binding writes it and after
    const gesture: Gesture = (command) => {
      let ran = false;
      session.step(() => (ran = command()));
      return ran;
    };
    const undo = () => (session.undoStep(), true);
    const redo = () => (session.redoStep(), true);
    node.replaceChildren();
    const editor = new Editor({
      element: node,
      editable: !readOnly,
      injectCSS: false, // textbox.css: Tiptap's sheet would turn ligatures off, unlike the drawn slide
      enableCoreExtensions: { delete: false, drop: false },
      editorProps: {
        attributes: { class: 'deck-textbox', spellcheck: 'true' },
        handleDOMEvents: {
          // the Edit menu's undo and redo reach a contenteditable as these; the deck's stack takes them
          beforeinput: (_view, event) => {
            const type = (event as InputEvent).inputType;
            if (type !== 'historyUndo' && type !== 'historyRedo') return false;
            event.preventDefault();
            if (type === 'historyUndo') undo();
            else redo();
            return true;
          },
        },
      },
      extensions: [
        ...slideTextExtensions(binding.kind, gesture),
        Extension.create({
          name: 'deckTextBox',
          priority: 300,
          addKeyboardShortcuts: () => ({
            'Mod-z': undo,
            'Shift-Mod-z': redo,
            'Mod-y': redo,
            Escape: () => (session.editText(null), true),
          }),
          addProseMirrorPlugins: () => [
            ...binding.plugins,
            new Plugin({
              // before the binding writes the owner's change: a change past the slide's text budget is refused (the
              // loader would hold the slide), and one burst of typing in this box is one undo step
              filterTransaction: (tr) => {
                if (!tr.docChanged || isBindingTransaction(tr)) return true;
                const over = budget.over(tr.doc);
                setRefused(over);
                if (over) return false;
                session.noteTyping(target);
                return true;
              },
            }),
          ],
        }),
      ],
    });
    binding.bind(editor.view);
    // the text selected, so a fresh placeholder is typed over (P4-B2 spike: armed in mode `clear`, the caret at the start)
    armSelection(editor, armedNow.current);
    editor.view.focus();
    // P4-B2 spike: the armed box's acts, which the stage's keys reach while it is armed
    const unregister = registerArmed(session, {
      elementId,
      root: editor.view.dom,
      armed: () => armedNow.current && !editor.isDestroyed,
      replace: () => {
        const size = editor.state.doc.content.size;
        // the first block kept, emptied: the key's own insertion or composition then lands in it
        if (armedMode() === 'clear' && size > 2) editor.view.dispatch(editor.state.tr.delete(1, size - 1));
        session.editText(elementId);
      },
      editAll: () => {
        armSelection(editor, false);
        session.editText(elementId);
      },
    });
    // P3-F F9: the keys the owner typed on the selected element before this box took the focus, typed over that
    // selection as a typed key replaces it; and any that reach the stage while the box is open, at its selection
    const typeIn = () => {
      const typed = session.takeTyped(elementId);
      if (typed !== null && !editor.isDestroyed && editor.isEditable) editor.view.dispatch(editor.state.tr.insertText(typed).scrollIntoView());
    };
    typeIn();
    const stopTyped = session.subscribe(typeIn);

    let holding = false;
    const hold = (on: boolean) => {
      if (holding === on) return;
      holding = on;
      session.holdRemote(on);
    };
    let settle: ReturnType<typeof setTimeout> | undefined;
    const dom = editor.view.dom;
    const onCompositionStart = () => {
      clearTimeout(settle);
      hold(true);
    };
    const onCompositionEnd = () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        if (!editor.isDestroyed && !editor.view.composing) hold(false);
      }, COMPOSE_SETTLE_MS);
    };
    dom.addEventListener('compositionstart', onCompositionStart);
    dom.addEventListener('compositionend', onCompositionEnd);
    // a press anywhere but the element and the mark bar ends the edit
    const document = node.ownerDocument;
    const onPointerDown = (event: Event) => {
      const at = event.target as Node | null;
      // P4-B2 spike: a press in the armed box begins the edit, the caret at the press (T3, roughly: no drag from it); a
      // press elsewhere on the stage is the stage's, whose selection ends the edit (ending it here first would arm the
      // box again for the moment between, writing its selection while a composition may still be ending)
      if (at && armedNow.current && node.contains(at)) return session.editText(elementId);
      if (at && (node.contains(at) || bar.current?.contains(at))) return;
      if (at && armedMode() !== null && node.closest('[data-stage-surface]')?.contains(at)) return;
      session.editText(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    editor.on('transaction', redraw);
    const View = document.defaultView?.ResizeObserver;
    const resize = View ? new View(() => redraw()) : null;
    resize?.observe(node);
    setMounted({ editor, node });

    return () => {
      unregister();
      stopTyped();
      clearTimeout(settle);
      resize?.disconnect();
      document.removeEventListener('pointerdown', onPointerDown, true);
      dom.removeEventListener('compositionstart', onCompositionStart);
      dom.removeEventListener('compositionend', onCompositionEnd);
      editor.destroy();
      untrack();
      budget.dispose();
      hold(false);
      canvas.endTextEdit(elementId);
    };
  }, [session, canvas, slideId, elementId, readOnly]);

  // P4-B2 spike: armed again after an edit (Escape), its selection as it is armed (the effect above set it at the mount)
  const wasArmed = useRef(armed);
  useEffect(() => {
    if (armed && !wasArmed.current && mounted && !mounted.editor.isDestroyed && !mounted.editor.view.composing) armSelection(mounted.editor, true);
    wasArmed.current = armed;
  }, [armed, mounted]);

  // the bar above the element (below it when the element is at the top), in the overlay's pixels
  useLayoutEffect(() => {
    const el = bar.current;
    const host = el?.parentElement;
    if (!el || !host || !mounted) return;
    const box = mounted.node.getBoundingClientRect();
    const origin = host.getBoundingClientRect();
    const above = box.top - origin.top;
    const below = above < el.offsetHeight + BAR_GAP;
    el.style.left = `${Math.max(0, box.left - origin.left)}px`;
    el.style.top = `${below ? box.bottom - origin.top + BAR_GAP : above - BAR_GAP}px`;
    el.dataset.side = below ? 'below' : 'above';
  });

  if (!mounted || readOnly || armed) return null;
  return <MarkBar ref={bar} editor={mounted.editor} node={mounted.node} session={session} refused={refused} />;
}

/** The selection a box opens with: all its text, or (P4-B2 spike, armed in mode `clear`) the caret at its start. */
function armSelection(editor: Editor, armed: boolean): void {
  const { doc } = editor.state;
  const caret = armed && armedMode() === 'clear';
  editor.view.dispatch(editor.state.tr.setSelection(caret ? TextSelection.create(doc, 1) : TextSelection.create(doc, 1, Math.max(1, doc.content.size - 1))));
}

/**
 * The slide's text budget for one text box (fix wave 1): the loader holds a slide past `SLIDE_LIMITS.textChars`
 * characters or `.marks` marked runs, counted as the loader counts them (`textCost`). The rest of the slide's text is
 * read once and again only after another writer's change (this box's own writes cannot change it).
 */
function textBudget(doc: Doc, slideId: string, elementId: string, own: unknown) {
  let rest: { chars: number; marks: number } | null = null;
  const off = onUpdate(doc, (_update, origin) => {
    if (origin !== own) rest = null;
  });
  const others = () => {
    if (rest) return rest;
    const blocks = readFlat(doc, slideId).flatMap((e) => (e.id === elementId ? [] : (e.text ?? [])));
    rest = textCost(blocks);
    return rest;
  };
  return {
    /** The reason `next` (the box's document after a change) would take the slide past its budget, or null. */
    over(next: PmNode): string | null {
      let chars = 0;
      let marks = 0;
      next.descendants((n) => {
        if (!n.isText) return;
        chars += [...(n.text ?? '')].length;
        if (n.marks.length) marks++;
      });
      const r = others();
      if (r.chars + chars > SLIDE_LIMITS.textChars) return C.tooMuchText(SLIDE_LIMITS.textChars, r.chars + chars);
      if (r.marks + marks > SLIDE_LIMITS.marks) return C.tooManyMarks(SLIDE_LIMITS.marks, r.marks + marks);
      return null;
    },
    dispose: off,
  };
}

type Panel = 'link' | 'colour' | null;

function MarkBar({ ref, editor, node, session, refused }: { ref: Ref<HTMLDivElement>; editor: Editor; node: HTMLElement; session: DeckSession; refused: string | null }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (editor.isDestroyed) return null;
  const { empty } = editor.state.selection;
  const inLink = editor.isActive('a');

  const run = (command: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => {
    session.step(() => void command(editor.chain().focus()).run());
  };
  const open = (next: Panel) => {
    setPanel(panel === next ? null : next);
    setValue(next === 'link' && inLink ? ((editor.getAttributes('a').href as string | undefined) ?? '') : '');
    setError(null);
  };
  const close = () => {
    setPanel(null);
    setError(null);
    editor.commands.focus();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (panel === 'link') {
      const href = httpsHref(value);
      if (!href) return setError(C.httpsOnly);
      run((chain) => (empty ? chain.extendMarkRange('a') : chain).setMark('a', { href }));
    } else {
      const color = hexColor(value);
      if (!color) return setError(C.hexOnly);
      run((chain) => chain.setMark('span', { color }));
    }
    setPanel(null);
    setError(null);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  // the bar never takes focus from the editor; only its fields do
  const keepFocus = (event: SyntheticEvent) => {
    if (!(event.target as Element).closest('input')) event.preventDefault();
  };
  const computed = node.ownerDocument.defaultView?.getComputedStyle(node);
  const preview = (color: string) => computed?.getPropertyValue(color.slice(4, -1)).trim() || undefined;

  const toggle = (name: 'b' | 'i' | 'u', label: string, glyph: string) => (
    <button type="button" className="deck-markbar-button" data-mark={name} aria-label={label} title={label} aria-pressed={editor.isActive(name)} onClick={() => run((chain) => chain.toggleMark(name))}>
      {glyph}
    </button>
  );

  return (
    <div ref={ref} className="deck-markbar" role="toolbar" aria-label={C.bar} onPointerDown={keepFocus} onMouseDown={keepFocus}>
      <div className="deck-markbar-row">
        {toggle('b', C.bold, 'B')}
        {toggle('i', C.italic, 'I')}
        {toggle('u', C.underline, 'U')}
        <span className="deck-markbar-divider" />
        <button type="button" className="deck-markbar-button" aria-label={C.link} title={C.link} aria-pressed={inLink} aria-expanded={panel === 'link'} disabled={empty && !inLink} onClick={() => open('link')}>
          ↗
        </button>
        {inLink && (
          <button type="button" className="deck-markbar-button" aria-label={C.removeLink} title={C.removeLink} onClick={() => run((chain) => chain.extendMarkRange('a').unsetMark('a'))}>
            ⌫
          </button>
        )}
        <button type="button" className="deck-markbar-button" aria-label={C.colour} title={C.colour} aria-pressed={editor.isActive('span')} aria-expanded={panel === 'colour'} onClick={() => open('colour')}>
          <span className="deck-markbar-swatch" style={{ background: (editor.getAttributes('span').color as string | undefined) ?? 'currentColor' }} />
        </button>
      </div>
      {panel === 'colour' && (
        <div className="deck-markbar-row">
          <button type="button" className="deck-markbar-button" aria-label={C.defaultColour} title={C.defaultColour} onClick={() => (run((chain) => chain.unsetMark('span')), setPanel(null))}>
            <span className="deck-markbar-swatch" data-default />
          </button>
          {SWATCHES.map((s) => (
            <button key={s.color} type="button" className="deck-markbar-button" aria-label={s.label} title={s.label} onClick={() => (run((chain) => chain.setMark('span', { color: s.color })), setPanel(null))}>
              <span className="deck-markbar-swatch" style={{ background: preview(s.color) }} />
            </button>
          ))}
        </div>
      )}
      {panel !== null && (
        <form className="deck-markbar-row" onSubmit={submit}>
          <input
            className="deck-markbar-field"
            aria-label={panel === 'link' ? C.linkAddress : C.hexColour}
            aria-invalid={error !== null || undefined}
            placeholder={panel === 'link' ? 'https://' : '#rrggbb'}
            value={value}
            spellCheck={false}
            autoFocus={panel === 'link'}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="submit" className="deck-markbar-button deck-markbar-apply">
            {panel === 'link' ? C.applyLink : C.applyColour}
          </button>
          {error && (
            <p role="alert" className="deck-markbar-error">
              {error}
            </p>
          )}
        </form>
      )}
      {refused && (
        <p role="alert" className="deck-markbar-error" data-text-refused>
          {refused}
        </p>
      )}
    </div>
  );
}
