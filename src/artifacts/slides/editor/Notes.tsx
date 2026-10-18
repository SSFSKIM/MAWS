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
//
// P3-F (L203): that refused text is the tab's (`DeckSession.notesDraft`), not this body's, so the field mounting again
// (another slide and back, a version shown and left, a tab switch) shows it again with its refusal, carried onto the
// notes as they are now.
import { useEffect, useRef, useState } from 'react';
import * as Y from '../../yjs/slides';
import { mapCaret, rebaseText } from '../caret';
import { setNotes } from '../model';
import { SLIDE_LIMITS } from '../parse';
import { DECK_COPY as C } from './copy';
import type { DeckSession } from './session';

/** L203: the refused notes the session keeps for the slide, carried onto its notes as they are now; null without any. */
function keptDraft(session: DeckSession, slideId: string): string | null {
  const draft = session.notesDraft(slideId);
  if (draft === null) return null;
  const now = Y.readNotes(session.doc, slideId);
  return draft.from === now ? draft.text : rebaseText(draft.from, draft.text, now);
}

export function Notes({ session, slideId, token, readOnly }: { session: DeckSession; slideId: string; token: object; readOnly: boolean }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const composingFrom = useRef<string | null>(null); // the model's notes when a composition began
  const shownFrom = useRef(''); // the model's notes the field's text derives from
  // the length of text refused, while the field holds it (L203: the session's kept text, at mount)
  const [refused, setRefused] = useState<number | null>(() => {
    const kept = keptDraft(session, slideId);
    return kept !== null && kept.length > SLIDE_LIMITS.notes ? kept.length : null;
  });
  const doc = session.doc;

  const write = (value: string) => {
    if (readOnly) return;
    if (value.length > SLIDE_LIMITS.notes) {
      setRefused(value.length);
      session.keepNotesDraft(slideId, { text: value, from: shownFrom.current }); // L203
      return;
    }
    setRefused(null);
    session.keepNotesDraft(slideId, null); // L203
    session.typing(`notes:${slideId}`, (origin) => setNotes(doc, slideId, value, origin));
    shownFrom.current = value;
  };

  // the field follows the model: at mount, and at each change of the notes made elsewhere
  useEffect(() => {
    const el = field.current!;
    const notes = Y.readNotes(doc, slideId);
    el.value = keptDraft(session, slideId) ?? notes; // L203
    shownFrom.current = notes;
    composingFrom.current = null;
    const stop = Y.observeSlide(doc, slideId, (changes, origin) => {
      if (composingFrom.current !== null || origin === session.origin) return;
      if (!changes.some((c) => c.kind === 'notes')) return;
      const next = Y.readNotes(doc, slideId);
      const before = el.value;
      // text the model refused stays the owner's, carried onto the change
      const shown = before === shownFrom.current ? next : rebaseText(shownFrom.current, before, next);
      if (session.notesDraft(slideId)) session.keepNotesDraft(slideId, { text: shown, from: next }); // L203: carried too
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
