// P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "O4's surfaces: leases, the window, delivery on the
// machine", "Consent and the client port"): Send to for another machine's artifact, through the renderer's real client:
// every step goes to the artifact's machine, which exports and sends it with its own connections; what it needs first is
// done there (Connect, sign-in, gws's setup greyed, "Connect Drive on <machine>"); a refusal there is said in its words, a
// machine that doesn't offer it greys Send to; its receipts are that machine's.
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeliveryStatus } from '@shared/ipc/schema/delivery';
import type { MachineRef } from '@shared/machine/ref';
import type { MachineState } from '@shared/ipc/schema/machines';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { recordArtifactMachine, resetArtifactMachines } from '../artifacts/machines';
import { connectRemoteSurfaces, REMOTE_SURFACE_WORDS as W, resetRemoteSurfaces } from '../artifacts/remote-surfaces';
import { ipc } from '../ipc/client';
import { resetExportFormats } from '../library/export';
import { useMachines } from '../stores/machines';
import { preloadOf } from '../test-support/preload-of';
import { SEND_TO_COPY as C } from './copy';
import { useSendToAction } from './header';
import { SendToHost } from './SendToSheet';
import { closeSendTo, connectDelivery, latestReceipt, openSendTo, receiptKey, resetDelivery, useDelivery } from './store';

const ART = '00000000-0000-4000-8000-000000000001'; // on OTHER_MACHINE ("mini")
const HERE = '00000000-0000-4000-8000-000000000002'; // this Mac's
const SOURCE = { key: '00000000-0000-4000-8000-0000000000aa', server: 'notion', scope: 'user' as const, transport: 'http' as const, file: '/Users/me/.claude.json' };
const NOTION_READY: DeliveryStatus = { target: 'notion', state: 'ready', connection: 'connected', source: SOURCE };
const receipt = (artifactId: string, target: 'notion' | 'drive', at: number) => ({ artifactId, target, at, name: 'Plan', url: 'https://www.notion.so/Plan-0123456789abcdef0123456789abcdef', format: 'md' as const, revision: 4, destination: { kind: 'default' as const } });
const subject = { artifactId: ART, kind: 'document' as const, title: 'Plan' };

let fake: FakeClient;
const install = (given: Parameters<typeof fakeClient>[0]) => {
  fake = fakeClient({ 'library.exportFormats': { formats: ['md', 'pdf'] }, 'delivery.cancel': { cancelled: true }, ...given });
  window.maws = preloadOf(fake);
};
const openSheet = async (target: 'notion' | 'drive' = 'notion') => {
  render(<SendToHost />);
  act(() => openSendTo(subject, target));
  await waitFor(() => expect(screen.queryByText(C.checking[target])).toBeNull());
};
const status = () => document.querySelector('[data-send-to-status]')!.textContent;
const elsewhere = () => document.querySelector('[data-send-to-elsewhere]')?.textContent ?? null;
const disabled = (name: string) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;

beforeEach(() => {
  resetDelivery();
  resetExportFormats();
  recordArtifactMachine(ART, OTHER_MACHINE, TEST_MACHINE);
  useMachines.setState({ machines: new Map<MachineRef, MachineState>([[OTHER_MACHINE, { ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-11-02T00:00:00Z', generation: 1 }]]) });
});
afterEach(() => {
  cleanup();
  resetArtifactMachines();
  resetRemoteSurfaces();
  useMachines.setState({ machines: new Map() });
});

describe('Send to for another machine’s artifact', () => {
  it('reads, sends and cancels on the artifact’s machine', async () => {
    install({ 'delivery.status': NOTION_READY, 'delivery.send': { ok: true, receipt: receipt(ART, 'notion', 1) } });
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(screen.getByText(C.sent('notion', 'Plan'))).toBeTruthy());
    expect(fake.machines('delivery.status')).toEqual([OTHER_MACHINE]);
    expect(fake.machines('delivery.send')).toEqual([OTHER_MACHINE]);
    expect(latestReceipt(useDelivery.getState(), ART, OTHER_MACHINE)).toMatchObject({ artifactId: ART, target: 'notion' });
    expect(latestReceipt(useDelivery.getState(), ART, null)).toBeNull();
    cleanup();

    install({ 'delivery.status': NOTION_READY }); // the send waits
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(fake.pending('delivery.send')).toBe(1));
    act(() => closeSendTo(useDelivery.getState().sheet!.run));
    await waitFor(() => expect(fake.machines('delivery.cancel')).toEqual([OTHER_MACHINE]));
  });

  it('greys what is done first on the machine, with “Connect <service> on <machine>”, and asks nothing of it', async () => {
    install({ 'delivery.status': (input: { target: string }): DeliveryStatus => (input.target === 'notion' ? { target: 'notion', state: 'signIn', source: SOURCE } : { target: 'drive', state: 'signedOut' }) });
    await openSheet();
    expect(disabled(C.connect)).toBe(true);
    expect(elsewhere()).toBe(W.connectOn('Notion', 'mini'));
    await act(() => useDelivery.getState().sheet!.run.connect()); // reached anyway: the run asks nothing
    expect(fake.invoked('delivery.connect')).toEqual([]);
    fireEvent.click(screen.getByRole('radio', { name: 'Google Drive' }));
    await waitFor(() => expect(elsewhere()).toBe('Connect Drive on mini'));
    expect(disabled(C.signIn)).toBe(true);
    cleanup();

    install({ 'delivery.status': { target: 'drive', state: 'absent' } });
    await openSheet('drive');
    expect(disabled(C.installInTerminal)).toBe(true);
    expect(elsewhere()).toBe('Connect Drive on mini');
  });

  it('says this Mac’s own Connect as before', async () => {
    resetArtifactMachines();
    install({ 'delivery.status': { target: 'notion', state: 'signIn', source: SOURCE } });
    await openSheet();
    expect(disabled(C.connect)).toBe(false);
    expect(elsewhere()).toBeNull();
    expect(fake.machines('delivery.status')).toEqual([TEST_MACHINE]);
  });

  it('says a machine that doesn’t offer it, and greys the header’s Send to from then on', async () => {
    const stop = connectRemoteSurfaces(ipc);
    install({});
    const header = renderHook(() => useSendToAction(subject));
    expect(header.result.current?.disabled).toBeUndefined();
    render(<SendToHost />);
    act(() => openSendTo(subject));
    await waitFor(() => expect(fake.pending('delivery.status')).toBe(1));
    await act(() => fake.fail('delivery.status', 'delivery.status: refused not-offered by machine mini', 'internal', { refusal: 'not-offered' }));
    expect(status()).toBe(W.notOffered('mini'));
    expect(disabled('Send')).toBe(true);
    header.rerender();
    expect(header.result.current?.disabled).toBe(true);
    stop();
  });

  it('says a send the machine refused in its words', async () => {
    install({ 'delivery.status': NOTION_READY });
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(fake.pending('delivery.send')).toBe(1));
    await act(() => fake.fail('delivery.send', 'delivery.send: refused grade by machine mini', 'internal', { refusal: 'grade' }));
    expect(status()).toBe(W.noRight('mini'));
  });
});

describe('receipts, by machine', () => {
  it('reads another machine’s at each opening of its feed, keeps one heard meanwhile, and shows each only for its machine', async () => {
    install({});
    const stop = connectDelivery(ipc);
    await fake.reply('delivery.receipts', { receipts: [] }); // this Mac's
    expect(fake.machines('delivery.receipts')).toEqual([TEST_MACHINE]);

    act(() => fake.event('artifacts.resync', {}, OTHER_MACHINE));
    expect(fake.machines('delivery.receipts')).toEqual([TEST_MACHINE, OTHER_MACHINE]);
    act(() => fake.event('delivery.receipt', receipt(ART, 'notion', 20), OTHER_MACHINE)); // while the read is out
    await act(() => fake.reply('delivery.receipts', { receipts: [receipt(ART, 'drive', 10), receipt(HERE, 'notion', 5)] }));
    const state = useDelivery.getState();
    expect(Object.keys(state.receipts).sort()).toEqual([receiptKey(ART, 'drive', OTHER_MACHINE), receiptKey(ART, 'notion', OTHER_MACHINE), receiptKey(HERE, 'notion', OTHER_MACHINE)].sort());
    expect(latestReceipt(state, ART, OTHER_MACHINE)).toMatchObject({ target: 'notion', at: 20 });
    expect(latestReceipt(state, HERE, null)).toBeNull(); // another machine naming this Mac's artifact says nothing of it

    act(() => fake.event('delivery.receipt', receipt(HERE, 'drive', 30)));
    expect(latestReceipt(useDelivery.getState(), HERE, null)).toMatchObject({ target: 'drive', at: 30 });

    // the next opening's answer stands in place of what was kept of that machine
    act(() => fake.event('artifacts.resync', {}, OTHER_MACHINE));
    await act(() => fake.reply('delivery.receipts', { receipts: [] }));
    expect(latestReceipt(useDelivery.getState(), ART, OTHER_MACHINE)).toBeNull();
    expect(latestReceipt(useDelivery.getState(), HERE, null)).toMatchObject({ at: 30 });
    stop();
  });
});
