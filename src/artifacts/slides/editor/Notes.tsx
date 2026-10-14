// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Notes"; M4): the current slide's speaker notes, a
// plain-text field under the stage bound to the slide's `notes` node by character diff (`setNotes`, S6's `patchNotes`),
// so another replica's edit to other words survives. A remote change re-maps the owner's caret. While the owner composes
// (an IME's syllable in progress) nothing is written and remote changes wait, so a composition is never split or
// doubled; when it ends, the owner's change is carried onto what arrived meanwhile and written once. A burst of typing
// is one undo step.
//
// Fix wave 1: the editor never writes what the loader would refuse. Notes past the dialect's 4,000 characters
// (`SLIDE_LIMITS.notes`; the loader would hold the slide) are not written: the owner's text stays in the field, the
// refusal says why, and the field writes again once it is short enough. While the field holds text the model refused,
// remote changes are carried onto it as onto a composition.
import { useEffect, useRef, useState } from 'react';
import * as Y from '../../yjs/slides';
import { mapCaret, rebaseText } from '../caret';
import { setNotes } from '../model';
import { SLIDE_LIMITS } from '../parse';
import { DECK_COPY as C } from './copy';
import type { DeckSession } from './session';

export function Notes({ session, slideId, token, readOnly }: { session: DeckSession; slideId: string; token: object; readOnly: boolean }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const composingFrom = useRef<string | null>(null); // the model's notes when a composition began
  const shownFrom = useRef(''); // the model's notes the field's text derives from
  const [refused, setRefused] = useState<number | null>(null); // the length of text refused, while the field holds it
  const doc = session.doc;

  const write = (value: string) => {
    if (readOnly) return;
    if (value.length > SLIDE_LIMITS.notes) {
      setRefused(value.length);
      return;
    }
    setRefused(null);
    session.typing(`notes:${slideId}`, (origin) => setNotes(doc, slideId, value, origin));
    shownFrom.current = value;
  };

  // the field follows the model: at mount, and at each change of the notes made elsewhere
  useEffect(() => {
    const el = field.current!;
    el.value = Y.readNotes(doc, slideId);
    shownFrom.current = el.value;
    composingFrom.current = null;
    const stop = Y.observeSlide(doc, slideId, (changes, origin) => {
      if (composingFrom.current !== null || origin === session.origin) return;
      if (!changes.some((c) => c.kind === 'notes')) return;
      const next = Y.readNotes(doc, slideId);
      const before = el.value;
      // text the model refused stays the owner's, carried onto the change
      const shown = before === shownFrom.current ? next : rebaseText(shownFrom.current, before, next);
      shownFrom.current = next;
      if (shown === before) return;
      const focused = el.ownerDocument.activeElement === el;
      const [start, end] = [el.selectionStart, el.selectionEnd];
      el.value = shown;
      if (focused) el.setSelectionRange(mapCaret(before, shown, start), mapCaret(before, shown, end));
    });
    return stop;
  }, [doc, slideId, token, session]);

  return (
    <div className="deck-notes">
      <textarea
        ref={field}
        className="deck-notes-field"
        aria-label={C.notes}
        aria-invalid={refused !== null || undefined}
        placeholder={C.notesPlaceholder}
        readOnly={readOnly}
        spellCheck
        onInput={(event) => {
          if (composingFrom.current === null) write(event.currentTarget.value);
        }}
        onCompositionStart={() => (composingFrom.current = Y.readNotes(doc, slideId))}
        onCompositionEnd={(event) => {
          const el = event.currentTarget;
          const base = composingFrom.current ?? el.value;
          composingFrom.current = null;
          const current = Y.readNotes(doc, slideId);
          const merged = current === base ? el.value : rebaseText(base, el.value, current);
          if (merged !== el.value) {
            const caret = mapCaret(el.value, merged, el.selectionStart);
            el.value = merged;
            el.setSelectionRange(caret, caret);
          }
          shownFrom.current = current;
          write(merged);
        }}
      />
      {refused !== null && (
        <p role="alert" className="deck-notes-refused">
          {C.notesTooLong(refused, SLIDE_LIMITS.notes)}
        </p>
      )}
    </div>
  );
}
