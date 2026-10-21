// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md D17): the session's one replica hold for two reasons,
// an input method composing and a gesture dragging. A drag holds the replica's remote frames from its start; its drop
// releases them before the step's closing cut and runs the gesture's re-assert after that flush, in the gesture's step;
// a composition outliving the drop keeps the hold, and the re-assert waits for its flush; a throw leaves no hold, no
// open step and no drag. What the re-assert writes is the gestures' (transform.dom.test.tsx and
// DesignWorkbench.dom.test.tsx).
import { describe, expect, it, vi } from 'vitest';
import { newDoc, transact } from '../../yjs';
import { importSlide, writeDeckKeys } from '../model';
import { loadSlide } from '../parse';
import { DeckSession } from './session';

function deck() {
  const doc = newDoc();
  const l = loadSlide('<section id="s"><p id="p" style="font-size:32px">Text</p></section>');
  if (!l.ok) throw new Error(l.held.reasons.join('; '));
  transact(doc, () => {
    writeDeckKeys(doc, { v: 4, title: 'T', order: ['s'] });
    importSlide(doc, l.slide, 'a0');
  });
  return doc;
}

/** A session whose replica hold and undo cuts are written to one log, in the order they happen. */
function logged(holdRemote: (on: boolean) => void = () => {}) {
  const log: string[] = [];
  const session = new DeckSession(deck(), 0, {
    holdRemote: (on) => {
      log.push(on ? 'hold' : 'release');
      holdRemote(on);
    },
  });
  const cut = session.undo.cut;
  vi.spyOn(session.undo, 'cut').mockImplementation(() => {
    log.push('cut');
    cut();
  });
  return { session, log, reassert: () => log.push('reassert') };
}

describe('the gesture hold (D17)', () => {
  it('a drag holds the remote frames from its start; its drop releases them, re-asserts, then cuts its step', () => {
    const { session, log, reassert } = logged();
    session.beginDrag();
    expect(log).toEqual(['cut', 'hold']);
    expect(session.snapshot().dragging).toBe(true);
    log.length = 0;
    session.endDrag(reassert);
    expect(log).toEqual(['release', 'reassert', 'cut']);
    expect(session.snapshot().dragging).toBe(false);
  });

  it('a composition outliving the drop keeps the hold; its end releases it, the drop’s re-assert after that flush in a step of its own', () => {
    const { session, log, reassert } = logged();
    session.holdRemote(true); // the text box: an input method composing
    session.beginDrag();
    expect(log).toEqual(['hold', 'cut', 'hold']); // set again for the gesture: the provider's 5 s cap restarts
    log.length = 0;
    session.endDrag(reassert);
    expect(log).toEqual(['cut']);
    expect(session.snapshot().dragging).toBe(false);
    log.length = 0;
    session.holdRemote(false);
    expect(log).toEqual(['release', 'cut', 'reassert', 'cut']);
  });

  it('a drag outliving a composition keeps the hold until its drop', () => {
    const { session, log, reassert } = logged();
    session.beginDrag();
    session.holdRemote(true);
    session.holdRemote(false);
    expect(log).toEqual(['cut', 'hold', 'hold']);
    log.length = 0;
    session.endDrag(reassert);
    expect(log).toEqual(['release', 'reassert', 'cut']);
  });

  it('a drop re-asserts nothing once the session takes no writes', () => {
    const { session, log, reassert } = logged();
    session.beginDrag();
    session.holdWrites(true);
    log.length = 0;
    session.endDrag(reassert);
    expect(log).toEqual(['release', 'cut']);
  });

  it('a throw in the re-assert or the release still releases the hold, cuts the step and ends the drag', () => {
    const { session, log } = logged();
    session.beginDrag();
    log.length = 0;
    expect(() =>
      session.endDrag(() => {
        throw new Error('the re-assert');
      }),
    ).toThrow('the re-assert');
    expect(log).toEqual(['release', 'cut']);
    expect(session.snapshot().dragging).toBe(false);
    // the next composition holds and releases on its own: no gesture reason was left standing
    log.length = 0;
    session.holdRemote(true);
    session.holdRemote(false);
    expect(log).toEqual(['hold', 'release']);

    let fail = true;
    const throwing = logged((on) => {
      if (!on && fail) throw new Error('a listener of the flush');
    });
    throwing.session.beginDrag();
    throwing.log.length = 0;
    expect(() => throwing.session.endDrag(throwing.reassert)).toThrow('a listener of the flush');
    expect(throwing.log).toEqual(['release', 'reassert', 'cut']); // the provider applied its frames before the listener threw
    expect(throwing.session.snapshot().dragging).toBe(false);
    fail = false;
    throwing.log.length = 0;
    throwing.session.holdRemote(true);
    throwing.session.holdRemote(false);
    expect(throwing.log).toEqual(['hold', 'release']);
  });

  it('a drop with no drag begun releases nothing (a composition’s hold stands)', () => {
    const { session, log, reassert } = logged();
    session.holdRemote(true);
    log.length = 0;
    session.endDrag(reassert);
    expect(log).toEqual(['cut']);
    log.length = 0;
    session.holdRemote(false);
    expect(log).toEqual(['release']);
  });

  it('dispose releases a hold a drag or a composition left standing, and re-asserts nothing', () => {
    const { session, log, reassert } = logged();
    session.holdRemote(true);
    session.beginDrag();
    session.endDrag(reassert); // waits for the composition's flush
    log.length = 0;
    session.dispose();
    expect(log).toEqual(['release']);
    session.holdRemote(false); // the text box unmounting after: nothing left to release
    expect(log).toEqual(['release']);
  });

  it('dispose finishes its cleanup when the release’s flush throws, then lets the error through', () => {
    const { session } = logged((on) => {
      if (!on) throw new Error('a listener of the flush');
    });
    const destroy = vi.spyOn(session.undo, 'destroy');
    session.beginDrag();
    expect(() => session.dispose()).toThrow('a listener of the flush');
    expect(destroy).toHaveBeenCalled();
  });
});
