// E4a (Task 3.2): the window's cover as main is told it (Design §3 "Cover"): `browser.view.cover { covered: true }` when
// the first layer that can overlap a pane opens, `false` when the last closes, and only while a pane is mounted. The
// layers are the DOM's (cover.test.ts), the floating Overview while open, and the chrome's own address suggestions.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { installFakeMain, ok } from '../../test-support/code';
import { useLayout } from '../../stores/layout';
import { coverPane, holdCover, resetCovering } from './covering';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const RECT = { x: 0, y: 0, width: 300, height: 200 };

let main: ReturnType<typeof installFakeMain>;
const sent = () => main.callsOf('browser.view.cover').map((input) => input.covered);

beforeEach(() => {
  resetCovering();
  useLayout.setState({ regions: LAYOUT_DEFAULTS.regions, main: LAYOUT_DEFAULTS.main, overviewOpen: false });
  main = installFakeMain(() => ok());
});
afterEach(() => resetCovering());

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
});
