// P5 O7 M3 ("Forwarding"): a tab whose page is on the local listener of a forward this page opened carries "forwarded
// from <machine>" beside its title, for as long as its page is there; every other tab carries nothing.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import { OTHER_MACHINE } from '../../../../../../test/support/machine';
import { useMachines } from '../../../stores/machines';
import { browserTab, T1, T2 } from '../../../test-support/browser';
import { forwards, resetForwards } from '../forward';
import { TabStrip } from './TabStrip';

const R = addressOf(OTHER_MACHINE, 'session-r' as AppSessionId);

afterEach(() => {
  cleanup();
  resetForwards();
  useMachines.setState({ machines: new Map() });
});

describe('the tab strip’s forwarded mark', () => {
  it('marks a tab on a forward’s local port with the machine’s name beside its title, and no other tab', () => {
    useMachines.setState({ machines: new Map([[OTHER_MACHINE, { name: 'mini' } as MachineState]]) });
    forwards.setState({ ports: new Map([[54321, { machine: OTHER_MACHINE, port: 5173 }]]) });
    const forwarded = browserTab(T1, R, { url: 'http://127.0.0.1:54321/app', title: 'Vite App' });
    const plain = browserTab(T2, R, { url: 'https://example.com/a' });
    render(<TabStrip appSessionId={R} surface="panel" tabs={[forwarded, plain]} shownId={T1} />);
    const marks = document.querySelectorAll('[data-forward-mark]');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('forwarded from mini');
    expect(marks[0]!.getAttribute('title')).toBe('Port 5173 on mini, forwarded to this Mac');
    expect(marks[0]!.closest('[data-browser-chip]')?.getAttribute('data-browser-chip')).toBe(T1);
    expect(screen.getByRole('tab', { name: /Vite App/ })).toBeTruthy();
  });

  it('drops the mark once the tab’s page leaves the listener', () => {
    forwards.setState({ ports: new Map([[54321, { machine: OTHER_MACHINE, port: 5173 }]]) });
    render(<TabStrip appSessionId={R} surface="panel" tabs={[browserTab(T1, R, { url: 'https://accounts.example.com/login' })]} shownId={T1} />);
    expect(document.querySelector('[data-forward-mark]')).toBeNull();
  });
});
