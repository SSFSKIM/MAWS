// E4a (Task 3.2): the window's cover as main is told it (Design §3 "Cover"): `browser.view.cover { covered: true }` when
// the first layer that can overlap a pane opens, `false` when the last closes, and only while a pane is mounted. The
// layers are the DOM's (cover.test.ts), the floating Overview while open, and the chrome's own address suggestions.
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { installFakeMain, ok } from '../../test-support/code';
import { useLayout } from '../../stores/layout';
import { useNotices } from '../../stores/notices';
import { coverAcknowledged, coverPane, holdCover, resetCovering } from './covering';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const RECT = { x: 0, y: 0, width: 300, height: 200 };

let main: ReturnType<typeof installFakeMain>;
const sent = () => main.callsOf('browser.view.cover').map((input) => input.covered);

beforeEach(() => {
  resetCovering();
  useLayout.setState({ regions: LAYOUT_DEFAULTS.regions, main: LAYOUT_DEFAULTS.main, overviewOpen: false });
  main = installFakeMain(() => ok());
});
afterEach(() => {
  resetCovering();
  document.body.querySelectorAll('[data-test-layer]').forEach((element) => element.remove());
  useNotices.setState({ notices: [], toastHolds: 0 });
  vi.restoreAllMocks();
});

describe('the window’s cover', () => {
  it('the Overview covers while open, once for every pane', async () => {
    const one = coverPane(() => RECT);
    const two = coverPane(() => RECT);
    useLayout.setState({ overviewOpen: true });
    useLayout.setState({ overviewOpen: false });
    await settle();
    expect(sent()).toEqual([true, false]);
    one.release();
    two.release();
  });

  it('the chrome’s suggestions hold the cover until released', async () => {
    const pane = coverPane(() => RECT);
    const release = holdCover();
    expect(sent()).toEqual([true]);
    release();
    release(); // twice is once
    await settle();
    expect(sent()).toEqual([true, false]);
    pane.release();
  });

  // P3-G (the M4 review's ruling 4): Mark-up's overlay waits for main's answer to the cover it asked, which main gives
  // once the page is hidden behind its picture; with the window already covered, for the answer to that request
  it('coverAcknowledged waits for main’s answer to the window’s cover, and is at once with nothing covered', async () => {
    const answers: (() => void)[] = [];
    main = installFakeMain(() => new Promise((resolve) => answers.push(() => resolve(ok()))));
    let done = false;
    await coverAcknowledged(); // nothing covered: nothing to wait for
    const pane = coverPane(() => RECT);
    const release = holdCover();
    const acknowledged = coverAcknowledged().then(() => (done = true));
    const again = holdCover(); // the window is covered already: the same answer is awaited
    const second = coverAcknowledged();
    await settle();
    expect(sent()).toEqual([true]);
    expect(done).toBe(false);
    answers.shift()!();
    await acknowledged;
    await second;
    expect(done).toBe(true);
    release();
    again();
    pane.release();
  });

  it('with no pane mounted nothing is said; the last pane leaving under a layer lifts the cover', async () => {
    useLayout.setState({ overviewOpen: true });
    expect(sent()).toEqual([]);
    const pane = coverPane(() => RECT);
    expect(sent()).toEqual([true]); // a pane mounting under an open layer
    pane.release();
    useLayout.setState({ overviewOpen: false });
    useLayout.setState({ overviewOpen: true });
    await settle();
    expect(sent()).toEqual([true, false]);
  });

  // The DOM watch carried through to main (cover.test.ts pins the classifier itself). happy-dom lays nothing out, so a
  // layer's rect comes from its `data-rect`, and the pane's is RECT.
  describe('the DOM’s layers', () => {
    const OVER = { left: 10, top: 10, right: 100, bottom: 100 };
    beforeEach(() => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const r = this.matches('[data-rect]') || this.querySelector('[data-rect]') ? OVER : { left: 0, top: 0, right: 0, bottom: 0 };
        return { ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r } as DOMRect;
      });
    });
    const frames = async (n = 3) => {
      for (let i = 0; i < n; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    };
    const layer = (attributes: Record<string, string>, parent: Element = document.body) => {
      const element = document.createElement('div');
      for (const [name, value] of Object.entries({ 'data-test-layer': '', 'data-rect': 'over', ...attributes })) element.setAttribute(name, value);
      parent.append(element);
      return element;
    };

    it('a body layer over an owning pane covers through browser.view.cover, and lifts when it leaves', async () => {
      const pane = coverPane(() => RECT);
      const popup = layer({});
      await frames();
      expect(sent()).toEqual([true]);
      popup.remove();
      await frames();
      expect(sent()).toEqual([true, false]);
      pane.release();
    });

    it('a popper over a pane that does not own its view (shown elsewhere, or not yet claimed) covers nothing', async () => {
      const pane = coverPane(() => null);
      layer({ 'data-radix-popper-content-wrapper': '' });
      await frames();
      expect(sent()).toEqual([]);
      pane.release();
    });

    it('the toast viewport remounting after a hold is found again on the notices’ change', async () => {
      const root = Object.assign(document.createElement('div'), { id: 'root' });
      root.setAttribute('data-test-layer', '');
      document.body.append(root);
      const viewport = () => {
        const ol = document.createElement('ol');
        ol.setAttribute('data-toast-viewport', '');
        root.append(ol);
        return ol;
      };
      const pane = coverPane(() => RECT);
      const first = viewport();
      act(() => void useNotices.getState().toast({ level: 'info', text: 'one', actions: [], dismissible: true }));
      await frames();
      layer({}, first); // the toast's li, as the host renders it
      await frames();
      expect(sent()).toEqual([true]);
      first.remove(); // a hold: the host renders nothing
      act(() => void useNotices.getState().holdToasts());
      await frames();
      expect(sent()).toEqual([true, false]);
      const second = viewport(); // released: a new viewport element, its toast within
      layer({}, second);
      act(() => useNotices.setState({ toastHolds: 0 }));
      await frames();
      expect(sent()).toEqual([true, false, true]);
      pane.release();
    });
  });
});
