import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { Draft } from '@shared/ipc/schema/session';
import { fakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { closeDialog, useDialogs } from '../../sessions/dialogs';
import { beforeCloseUnstarted } from '../../sessions/setup-actions';
import { ID, intent, putIntent, resetSetupStore } from '../../test-support/setup-intents';
import { resetShellStores } from '../../test-support/shell-stores';
import { docOf, paragraph, textNode } from './doc';
import { Editor, type EditorHandle } from './Editor';

const APP = at(ID); // P5 O6 M2: the page's id of setup-intents' `ID`

beforeEach(() => { resetShellStores(); resetSetupStore(); });
afterEach(() => { cleanup(); closeDialog(); delete (window as { maws?: PreloadBridge }).maws; });

it('confirms closing text typed before the draft writer debounce has saved', async () => {
  const fake = fakeClient({ 'session.intent.discard': () => ({ leftover: null }), 'session.history.list': () => ({ entries: [] }) });
  window.maws = fake.client as unknown as PreloadBridge;
  putIntent(intent({ appSessionId: APP }));
  const save = vi.fn();
  const handle = createRef<EditorHandle>();
  render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} client={fake.client} drafts={{ load: async () => null, save }} handle={handle} />);
  await act(async () => handle.current!.insertText('just typed'));
  expect(save).not.toHaveBeenCalled();
  const closing = beforeCloseUnstarted(APP);
  expect(useDialogs.getState().open?.kind).toBe('confirm');
  closeDialog();
  expect(await closing).toBe('kept');
  expect(fake.invoked('session.intent.discard')).toEqual([]);
});

it.each(['image', 'document'] as const)('confirms closing a persisted attachment-only %s draft', async (kind) => {
  const fake = fakeClient({ 'session.intent.discard': () => ({ leftover: null }) });
  window.maws = fake.client as unknown as PreloadBridge;
  putIntent(intent({ appSessionId: APP, draft: { doc: { ...docOf([paragraph()]), attrs: { attachments: [{ id: 'a', kind, name: kind === 'image' ? 'screenshot.png' : 'paper.pdf', mediaType: kind === 'image' ? 'image/png' : 'application/pdf', bytes: 3, data: 'YWJj', persisted: true }] } }, attachments: [], updatedAt: '2026-10-02T00:00:00.000Z' } }));
  const closing = beforeCloseUnstarted(APP);
  expect(useDialogs.getState().open?.kind).toBe('confirm');
  closeDialog();
  expect(await closing).toBe('kept');
  expect(fake.invoked('session.intent.discard')).toEqual([]);
});

it('keeps the stored close guard after empty Enter while the draft is loading', async () => {
  const fake = fakeClient({ 'session.intent.discard': () => ({ leftover: null }), 'session.history.list': () => ({ entries: [] }) });
  window.maws = fake.client as unknown as PreloadBridge;
  const draft: Draft = { doc: docOf([paragraph(textNode('stored thought'))]), attachments: [], updatedAt: '2026-10-02T00:00:00.000Z' };
  putIntent(intent({ appSessionId: APP, draft }));
  let loaded!: (draft: Draft | null) => void;
  const { container } = render(<Editor appSessionId={APP} cwd="/repo" sessionId={null} client={fake.client} drafts={{ load: () => new Promise((resolve) => { loaded = resolve; }), save: vi.fn() }} />);
  fireEvent.keyDown(container.querySelector('[contenteditable]')!, { key: 'Enter' });
  const closing = beforeCloseUnstarted(APP);
  const dialog = useDialogs.getState().open?.kind;
  closeDialog();
  const outcome = await closing;
  await act(async () => loaded(draft));
  expect(dialog).toBe('confirm');
  expect(outcome).toBe('kept');
  expect(fake.invoked('session.intent.discard')).toEqual([]);
});
