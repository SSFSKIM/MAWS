// The failed setup's retained tab, end to end in the renderer (C10 M6 finding 1): C7's composer bound by C10's own
// `useSetupIntent` over an intent that failed (C3 keeps the failed launch's exited status; rollback removed the record),
// so the chips are editable, the typed draft reaches the intent, and closing the tab asks before discarding it.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import type { SetupIntentPatch } from '@shared/sessions/intent';
import { status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { Composer } from '../composer/Composer';
import { resetDockedCards } from '../composer/docked/registry';
import { registerSetupIntentHook } from '../composer/setup-intent';
import { resetComposerStore } from '../stores/composer';
import { resetQueueStore } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { ID, intent, putIntent, REPO, resetSetupStore, resources, trustState } from '../test-support/setup-intents';
import { resetShellStores } from '../test-support/shell-stores';
import { closeDialog, useDialogs } from './dialogs';
import { beforeCloseUnstarted } from './setup-actions';
import { useSetup } from './store';
import { useSetupIntent } from './useSetupIntent';

let fake: FakeClient;
let dispose: () => void;

beforeEach(() => {
  resetShellStores();
  resetSetupStore();
  resetComposerStore();
  resetQueueStore();
  resetDockedCards();
  fake = fakeClient({
    'session.trust.check': trustState({ trusted: true, source: 'trustKey', keyKind: 'directory' }),
    'engine.models': { models: [], source: 'builtin', at: null },
    'session.queue.list': { entries: [], paused: false, pauseReason: null },
    'session.history.list': { entries: [] },
    'session.intent.patch': ({ patch }: { patch: SetupIntentPatch }) => ({ ...useSetup.getState().intents.get(ID)!, ...patch, updatedAt: new Date().toISOString() }),
    'session.intent.discard': { leftover: null },
  });
  window.maws = fake.client;
  dispose = registerSetupIntentHook(useSetupIntent);
});
afterEach(() => {
  cleanup();
  closeDialog();
  dispose();
  delete (window as { maws?: MawsBridge }).maws;
});

describe("a failed setup's retained tab", () => {
  it('binds the hook (an exited status, no record): its chips are editable, its draft reaches the intent, and closing it asks', async () => {
    putIntent(intent({ progress: { ...intent().progress, lastFailure: { at: '2026-09-29T10:00:01.000Z', phase: 'launching', message: 'the engine exited before it was ready', resources: resources() } } }));
    useSessions.setState({ engine: new Map([[ID, { ...status(ID), process: 'exited' }]]) });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Composer appSessionId={ID} paneIndex={0} />
      </QueryClientProvider>,
    );
    const location = await screen.findByRole('button', { name: `Location ${REPO}` });
    expect(location.title, 'the intent’s chip, not the live one').toBe(REPO);
    const editor = screen.getByRole('textbox', { name: 'Message', hidden: true }) as HTMLElement & { editor: { commands: { insertContent(text: string): boolean } } };
    act(() => void editor.editor.commands.insertContent('typed after the failure'));
    const control = document.querySelector<HTMLButtonElement>('[data-submit-state]')!;
    await waitFor(() => expect(control.disabled).toBe(false));
    expect(control.textContent).toBe('Send');
    await waitFor(() => expect(JSON.stringify(useSetup.getState().intents.get(ID)?.draft ?? null)).toContain('typed after the failure'), { timeout: 3_000 });
    expect(fake.invoked('session.drafts.set')).toEqual([]);

    const closing = beforeCloseUnstarted(ID);
    await waitFor(() => expect(useDialogs.getState().open).toMatchObject({ kind: 'confirm', title: 'Discard this unstarted session?' }));
    act(() => closeDialog());
    expect(await closing).toBe('kept');
    expect(fake.invoked('session.intent.discard')).toEqual([]);
  });
});
