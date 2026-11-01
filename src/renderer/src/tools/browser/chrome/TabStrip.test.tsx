// P5 O7 M3 ("Forwarding"; M3c fix wave 1): a tab main opened at a forward's listener carries `tab.forward`, and while its
// page is on that listener (`127.0.0.1:<forward.localPort>`) its chip says "forwarded from <machine>" beside its title;
// every other tab, and the same tab once its page left the listener, carries nothing.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import { OTHER_MACHINE } from '../../../../../../test/support/machine';
import { useMachines } from '../../../stores/machines';
import { browserTab, T1, T2 } from '../../../test-support/browser';
import { TabStrip } from './TabStrip';

const R = addressOf(OTHER_MACHINE, 'session-r' as AppSessionId);
const FORWARD = { machine: OTHER_MACHINE, port: 5173, localPort: 54321 };

afterEach(() => {
  cleanup();
  useMachines.setState({ machines: new Map() });
});

describe('the tab strip’s forwarded mark', () => {
  it('marks a tab main keeps a forward for, on that forward’s listener, with the machine’s name beside its title', () => {
    useMachines.setState({ machines: new Map([[OTHER_MACHINE, { name: 'mini' } as MachineState]]) });
    const forwarded = browserTab(T1, R, { url: 'http://127.0.0.1:54321/app', title: 'Vite App', forward: FORWARD });
    const plain = browserTab(T2, R, { url: 'http://127.0.0.1:54321/app' }); // the same address with no forward: not marked
    render(<TabStrip appSessionId={R} surface="panel" tabs={[forwarded, plain]} shownId={T1} />);
    const marks = document.querySelectorAll('[data-forward-mark]');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('forwarded from mini');
    expect(marks[0]!.getAttribute('title')).toBe('Port 5173 on mini, forwarded to this Mac');
    expect(marks[0]!.closest('[data-browser-chip]')?.getAttribute('data-browser-chip')).toBe(T1);
    expect(screen.getByRole('tab', { name: /Vite App/ })).toBeTruthy();
  });

  it('drops the mark while the tab’s page is off the forward’s listener', () => {
    const tabs = [
      browserTab(T1, R, { url: 'https://accounts.example.com/login', forward: FORWARD }),
      browserTab(T2, R, { url: 'http://127.0.0.1:60000/', forward: FORWARD }), // another local port
    ];
    render(<TabStrip appSessionId={R} surface="panel" tabs={tabs} shownId={T1} />);
    expect(document.querySelector('[data-forward-mark]')).toBeNull();
  });
});
