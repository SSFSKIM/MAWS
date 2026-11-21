// The repair window's page (P5 O15 M2, docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, acceptance 2,
// Interfaces §B): each kind's headline, body and actions in the document's words, the first action the default; the
// actions disabled while an attempt runs, which the page says; the daemon's last log lines, selectable.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RepairAction, RepairBridge, RepairKind, RepairState } from '@shared/repair';
import { RepairPage } from './RepairPage';

afterEach(cleanup);

function bridge(initial: RepairState) {
  let listener: ((state: RepairState) => void) | null = null;
  const acted: RepairAction[] = [];
  const fake: RepairBridge = {
    state: async () => initial,
    onState: (next) => ((listener = next), () => (listener = null)),
    act: (action) => void acted.push(action),
  };
  return { fake, acted, push: (state: RepairState) => act(() => listener?.(state)) };
}
const state = (kind: RepairKind, over: Partial<RepairState> = {}): RepairState => ({ kind, why: 'launchctl kickstart failed (1): Operation not permitted', packaged: true, attempting: false, log: null, ...over });
const shown = async (s: RepairState) => {
  const b = bridge(s);
  render(<RepairPage bridge={b.fake} />);
  await screen.findByRole('heading');
  return b;
};
const actions = () => screen.getAllByRole('button').map((button) => button.textContent);

describe('the repair page', () => {
  // the word cut (C166): each body gives the cause and the fix, no word about the background process mawsd
  it('no-unit: names pnpm dev:scratch; Quit MAWS first, then Try Again', async () => {
    await shown(state('no-unit', { packaged: false }));
    expect(screen.getByRole('heading').textContent).toBe('This development build has no machine daemon for your main profile');
    expect(document.body.textContent).toContain('Only an installed MAWS.app sets it up for the main profile. Run this build on a profile of its own with pnpm dev:scratch, or install MAWS.app and open this build again.');
    expect(document.body.textContent).not.toContain('mawsd');
    expect(screen.getByText('pnpm dev:scratch').tagName).toBe('CODE');
    expect(actions()).toEqual(['Quit MAWS', 'Try Again']);
  });

  it('not-loaded: says where to turn MAWS on; Open Login Items… first', async () => {
    await shown(state('not-loaded', { packaged: false }));
    expect(screen.getByRole('heading').textContent).toBe("MAWS's machine daemon is turned off");
    expect(document.body.textContent).toContain('macOS has not loaded it. In System Settings › General › Login Items & Extensions, turn MAWS on and come back.');
    expect(document.body.textContent).not.toContain('mawsd');
    expect(actions()).toEqual(['Open Login Items…', 'Try Again', 'Quit MAWS']);
  });

  it('install-refused: carries launchctl’s words; Open Login Items…, Reinstall and Start, Quit MAWS', async () => {
    await shown(state('install-refused'));
    expect(screen.getByRole('heading').textContent).toBe('macOS did not let MAWS set up or start its machine daemon');
    expect(document.body.textContent).toContain(
      'launchctl kickstart failed (1): Operation not permitted. If MAWS is off in System Settings › General › Login Items & Extensions, turn it on and come back.',
    );
    expect(actions()).toEqual(['Open Login Items…', 'Reinstall and Start', 'Quit MAWS']);
  });

  // Fix wave 1 (the architect's condition a): a development build never installs a unit, so its retry is Try Again
  it('install-refused on a development build: Open Login Items…, Try Again, Quit MAWS', async () => {
    await shown(state('install-refused', { packaged: false }));
    expect(actions()).toEqual(['Open Login Items…', 'Try Again', 'Quit MAWS']);
  });

  it('not-started: the wait’s answer and the log; the retry labelled by the build', async () => {
    const log = { path: '/p/mawsd/mawsd.log', lines: ['[mawsd] starting', '[mawsd] the lock is held by pid 4100'] };
    await shown(state('not-started', { why: 'no mawsd welcomed a hello on machine.sock within 10 s', log }));
    expect(screen.getByRole('heading').textContent).toBe("MAWS's machine daemon did not start");
    expect(screen.getByRole('heading').nextElementSibling?.textContent).toBe('It did not answer within 10 seconds: no mawsd welcomed a hello on machine.sock within 10 s.');
    expect(actions()).toEqual(['Reinstall and Start', 'Show Log in Finder', 'Quit MAWS']);
    const lines = screen.getByLabelText('/p/mawsd/mawsd.log');
    expect(lines.textContent).toBe('[mawsd] starting\n[mawsd] the lock is held by pid 4100');
    cleanup();
    await shown(state('not-started', { packaged: false, log }));
    expect(actions()).toEqual(['Try Again', 'Show Log in Finder', 'Quit MAWS']);
  });

  it('acts each button’s action, the first the default', async () => {
    const b = await shown(state('not-loaded', { packaged: false }));
    expect(document.activeElement?.textContent).toBe('Open Login Items…');
    for (const button of screen.getAllByRole('button')) act(() => button.click());
    expect(b.acted).toEqual(['open-login-items', 'retry', 'quit']);
  });

  it('while an attempt runs: says Starting… and disables every action; each change of state is drawn', async () => {
    const b = await shown(state('not-loaded', { packaged: false }));
    b.push(state('not-loaded', { packaged: false, attempting: true }));
    expect(screen.getByRole('status').textContent).toBe('Starting…'); // the word cut (C168)
    expect(screen.getAllByRole('button').every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    b.push(state('not-started', { packaged: false, why: 'no welcome' }));
    expect(screen.getByRole('heading').textContent).toBe("MAWS's machine daemon did not start");
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getAllByRole('button').some((button) => (button as HTMLButtonElement).disabled)).toBe(false);
  });

  it('shows no log section when there are no lines', async () => {
    await shown(state('not-started'));
    expect(screen.queryByRole('region', { name: /log/i })).toBeNull();
    expect(document.querySelector('pre')).toBeNull();
  });
});

