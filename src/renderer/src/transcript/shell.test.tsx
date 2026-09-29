// C6's registration into C5's shell: the `transcript` slot resolves to the real transcript, a session tab renders its
// rows over the session's IPC source (not C5's fallback), and a path chip opens C5's file tab.
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { record } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { resetSlots, useSlot } from '../app/slots';
import { SessionPane } from '../session/SessionPane';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../stores/transcript';
import { resetShellStores } from '../test-support/shell-stores';
import { builder } from './model/test-events';
import { connectTranscript, ShellTranscript } from './shell';
import { DEFAULT_ACTIONS } from './view/context';
import { registeredActions } from './view/registry';

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  // happy-dom has no layout: a viewport for the scroller and a height per row, so the virtualiser mounts rows.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-transcript-scroller') ? 2000 : this.hasAttribute('data-index') ? 40 : 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

let disconnect: () => void = () => {};
beforeEach(() => {
  resetShellStores();
  disconnect = connectTranscript();
});
afterEach(() => {
  cleanup();
  disconnect();
  resetSlots();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  delete (window as { maws?: MawsBridge }).maws;
});

function history() {
  const b = builder();
  b.turn('u1', 'Open the file');
  b.text('m1', 0, 'See [the file](src/a.ts).');
  b.end(['u1']);
  return b.events;
}

describe('the transcript slot', () => {
  it('resolves to the shell transcript once connected, and C5’s fallback again after a reset', () => {
    expect(renderHook(() => useSlot('transcript')).result.current).toBe(ShellTranscript);
    resetSlots();
    expect(renderHook(() => useSlot('transcript')).result.current).not.toBe(ShellTranscript);
  });

  it('a session tab renders the session’s rows over its IPC source, not the fallback', async () => {
    const APP = 'app-shell-1' as AppSessionId;
    const fake = fakeClient({ 'session.events': { events: history(), lastSeq: 3, complete: true }, 'attention.request': { event: null } });
    window.maws = fake.client;
    useSessions.setState({ records: new Map([[APP, record(APP)]]) });
    render(<SessionPane appSessionId={APP} paneIndex={0} />);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Your message' })).toBeTruthy());
    expect(fake.invoked('session.events')).toEqual([{ appSessionId: APP, afterSeq: null, limit: null }]);
    expect(document.querySelector('[data-kind="assistant_text"]')?.textContent).toContain('See the file');
    expect(screen.queryByText('Transcript arrives with C6')).toBeNull();
  });

  it('a path chip opens C5’s file tab; links keep the default layout.openExternal', async () => {
    const APP = 'app-shell-2' as AppSessionId;
    window.maws = fakeClient({ 'session.events': { events: history(), lastSeq: 3, complete: true } }).client;
    expect(registeredActions().openExternal).toBe(DEFAULT_ACTIONS.openExternal);
    render(<ShellTranscript appSessionId={APP} agentId={null} paneIndex={0} />);
    await waitFor(() => expect(document.querySelector('[data-chip="path"]')).toBeTruthy());
    fireEvent.click(document.querySelector<HTMLElement>('[data-chip="path"]')!);
    const pane = useLayout.getState().main.panes[0];
    expect(pane.tabs.find((tab) => tab.id === pane.activeTabId)).toMatchObject({ kind: 'file', path: 'src/a.ts', line: null, appSessionId: null });
  });
});
