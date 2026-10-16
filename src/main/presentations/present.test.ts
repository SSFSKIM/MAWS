// P3-C M6 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D13): main's presenter: an audience window full
// screen on an external display when there is one (else on the asking window's display), a presenter window on the
// primary display beside it, each loading the renderer's `present` route; the two close together; a new show ends the
// one before it.
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {} }));

import { createPresenter, presentQuery, type PresentDisplay, type PresentWindowSpec } from './present';

const DECK = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const display = (id: number, x: number): PresentDisplay => ({ id, bounds: { x, y: 0, width: 1920, height: 1080 } });

function world(displays: PresentDisplay[], primary = displays[0]!) {
  const opened: (PresentWindowSpec & { closed: boolean; close(): void; fire(): void })[] = [];
  const presenter = createPresenter({
    displays: () => displays,
    primary: () => primary,
    nearest: () => displays[displays.length - 1]!,
    open: (spec) => {
      const listeners: (() => void)[] = [];
      const win = {
        ...spec,
        closed: false,
        close() {
          if (win.closed) return;
          win.closed = true;
          listeners.splice(0).forEach((l) => l());
        },
        fire() {
          win.close();
        },
      };
      opened.push(win);
      return { close: () => win.close(), isDestroyed: () => win.closed, onClosed: (listener: () => void) => listeners.push(listener) };
    },
  });
  return { presenter, opened };
}

describe('the presenter', () => {
  it('with one display opens the audience window alone, full screen on the display the deck was presented from', () => {
    const { presenter, opened } = world([display(1, 0)]);
    expect(presenter.present({ artifactId: DECK, slideId: 's2' }, null)).toEqual({ opened: 'audience' });
    expect(opened.map((w) => [w.role, w.bounds.x, w.paired, w.slideId])).toEqual([['audience', 0, false, 's2']]);
  });

  it('with two displays opens the audience on the external one and the presenter on the primary, paired', () => {
    const { presenter, opened } = world([display(1, 0), display(2, 1920)]);
    expect(presenter.present({ artifactId: DECK }, null)).toEqual({ opened: 'audience+presenter' });
    expect(opened.map((w) => [w.role, w.bounds.x, w.paired, w.slideId])).toEqual([
      ['audience', 1920, true, null],
      ['presenter', 0, true, null],
    ]);
  });

  it('closes both windows when either closes, and ends the show before it when a new one starts', () => {
    const { presenter, opened } = world([display(1, 0), display(2, 1920)]);
    presenter.present({ artifactId: DECK }, null);
    opened[1]!.fire();
    expect(opened.map((w) => w.closed)).toEqual([true, true]);
    presenter.present({ artifactId: DECK }, null);
    presenter.present({ artifactId: DECK }, null);
    expect(opened.map((w) => w.closed)).toEqual([true, true, true, true, false, false]);
    presenter.end();
    expect(opened.every((w) => w.closed)).toBe(true);
  });

  it('loads the route with the deck, the role, the slide, whether it is paired and the e2e mark', () => {
    expect(presentQuery({ artifactId: DECK, role: 'presenter', slideId: 's1', paired: true }, { MAWS_E2E: '1' })).toEqual({ present: '1', artifact: DECK, role: 'presenter', slide: 's1', paired: '1', e2e: '1' });
    expect(presentQuery({ artifactId: DECK, role: 'audience', slideId: null, paired: false }, {})).toEqual({ present: '1', artifact: DECK, role: 'audience' });
  });
});
