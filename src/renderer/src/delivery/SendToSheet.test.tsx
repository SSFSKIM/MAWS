// P4-B5: the Send to sheet and its run (./SendToSheet.tsx, ./run.ts, ./store.ts) over a fake main: every step is a
// `delivery.*` command, never a session's or a prompt's. Notion's connection is named ("Connected through MAWS"), a
// connector that needs the owner's Connect offers it; Drive's gws state is said as it is (absent: its install, never a
// Send; signed out: its own login; a refused login: said, still signed out); the destination link is read; the send
// ends on the receipt with Open, and the header's Send to reads "Sent to …"; closing the sheet cancels what runs.
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandName } from '@shared/ipc/schema';
import type { DeliveryStatus } from '@shared/ipc/schema/delivery';
import type { ArtifactExportFormat } from '@shared/maws/tools';
import { resetExportFormats } from '../library/export';
import { useNotices } from '../stores/notices';
import { deferred, fail, installFakeMain, ok } from '../test-support/code';
import { CONNECT_FAILURE, GWS_INSTALL, MAYBE_SENT, SEND_TO_COPY as C, sendFailure } from './copy';
import { useSendToAction } from './header';
import { SendToHost } from './SendToSheet';
import { connectDelivery, openSendTo, resetDelivery, sendingTo, useDelivery, type SendToSubject } from './store';

const ART = '00000000-0000-4000-8000-000000000001';
const SOURCE = { key: '00000000-0000-4000-8000-0000000000aa', server: 'notion', scope: 'user' as const, transport: 'http' as const, file: '/Users/me/.claude.json' };
const RECEIPT = { artifactId: ART, target: 'notion' as const, at: Date.now(), name: 'Plan', url: 'https://www.notion.so/Plan-0123456789abcdef0123456789abcdef', format: 'md' as const, revision: 4, destination: { kind: 'default' as const } };
const NOTION_READY: DeliveryStatus = { target: 'notion', state: 'ready', connection: 'connected', source: SOURCE };
const subject = { artifactId: ART, kind: 'document' as const, title: 'Plan' };

type Handler = (name: CommandName, input: Record<string, unknown>) => unknown;
let status: Record<string, DeliveryStatus | null>; // null: main's read fails at the IPC level
let formats: ArtifactExportFormat[];
let cancelled: boolean;
let extra: Handler;
let main: ReturnType<typeof installFakeMain>;

beforeEach(() => {
  resetDelivery();
  resetExportFormats();
  useNotices.setState({ notices: [] });
  status = { notion: NOTION_READY, drive: { target: 'drive', state: 'ready', user: 'me@example.com' } };
  formats = ['md', 'html', 'docx', 'pdf'];
  cancelled = true;
  extra = () => fail('unscripted');
  main = installFakeMain((name, input) => {
    if (name === 'library.exportFormats') return ok({ formats });
    if (name === 'delivery.status') return status[input.target as string] ? ok(status[input.target as string]) : fail('main is gone');
    if (name === 'delivery.receipts') return ok({ receipts: [] });
    if (name === 'delivery.cancel') return ok({ cancelled });
    return extra(name, input) as never;
  });
});
afterEach(() => cleanup());

const openSheet = async (target?: 'notion' | 'drive', of: SendToSubject = subject) => {
  render(<SendToHost />);
  act(() => openSendTo(of, target));
  await waitFor(() => expect(screen.queryByText(C.checking[target ?? 'notion'])).toBeNull());
};
const sendButton = () => screen.getByRole('button', { name: /^Send/ });

describe('the Send to sheet: Notion', () => {
  it('names MAWS’s own connection and sends the shown artifact with no session, ending on the receipt', async () => {
    extra = (name) => (name === 'delivery.send' ? ok({ ok: true, receipt: RECEIPT }) : fail('unscripted'));
    await openSheet();
    expect(screen.getByText(C.notionReady(SOURCE, 'connected'))).toBeTruthy();
    expect(screen.getByText(C.direct)).toBeTruthy();
    fireEvent.click(sendButton());
    await waitFor(() => expect(screen.getByText(C.sent('notion', 'Plan'))).toBeTruthy());
    const [sent] = main.callsOf('delivery.send');
    expect(sent).toMatchObject({ target: 'notion', artifactId: ART, format: 'md', destination: { kind: 'default' }, source: SOURCE.key });
    expect(main.calls.map((call) => call.name).filter((name) => name.startsWith('session.') || name.startsWith('engine.'))).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: C.open('notion') }));
    expect(main.callsOf('layout.openExternal')).toEqual([{ url: RECEIPT.url }]);
    expect(useDelivery.getState().receipts[`${ART}\0notion`]).toEqual(RECEIPT);
  });

  it('offers Connect when Notion needs MAWS’s sign-in, and reads the state again after it', async () => {
    status.notion = { target: 'notion', state: 'signIn', source: SOURCE };
    const connected = deferred<unknown>();
    extra = (name) => (name === 'delivery.connect' ? connected.promise : fail('unscripted'));
    await openSheet();
    expect((sendButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: C.connect }));
    await waitFor(() => expect(screen.getByText(C.connecting)).toBeTruthy());
    expect(main.callsOf('delivery.connect')[0]).toMatchObject({ target: 'notion', source: SOURCE.key });
    status.notion = NOTION_READY;
    connected.resolve(ok({ ok: true }));
    await waitFor(() => expect((sendButton() as HTMLButtonElement).disabled).toBe(false));
  });

  it('offers app-configured Notion with no session and describes the app settings rather than project settings', async () => {
    status.notion = { target: 'notion', state: 'ready', connection: 'connected', source: { ...SOURCE, scope: 'app', file: '/app/settings.json' } };
    await openSheet();
    expect(screen.getByText(/Connected through MAWS:.*MAWS settings/)).toBeTruthy();
    expect((sendButton() as HTMLButtonElement).disabled).toBe(false);
    expect(main.calls.map((call) => call.name).filter((name) => name.startsWith('session.') || name.startsWith('engine.'))).toEqual([]);
  });

  it.each(['noSession', 'notFound'] as const)('offers app configuration without asking for a chat when no connector is found (%s)', async (why) => {
    status.notion = { target: 'notion', state: 'none', why };
    await openSheet();
    expect(screen.getByText(/Settings.*Engine.*MCP servers/)).toBeTruthy();
    expect(screen.queryByText(/start.*session/i)).toBeNull();
    expect((sendButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends inside a page the owner pastes, and refuses a link that is no page', async () => {
    extra = (name) => (name === 'delivery.send' ? ok({ ok: true, receipt: RECEIPT }) : fail('unscripted'));
    await openSheet();
    fireEvent.click(screen.getByLabelText(C.notionInside, { selector: 'input[type=radio]' }));
    const field = screen.getByLabelText(C.notionInside, { selector: 'input:not([type=radio])' });
    fireEvent.change(field, { target: { value: 'https://example.com/x' } });
    expect(screen.getByText(C.notionInsideInvalid)).toBeTruthy();
    expect((sendButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'https://www.notion.so/acme/Team-0123456789abcdef0123456789abcdef' } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(main.callsOf('delivery.send')).toHaveLength(1));
    expect(main.callsOf('delivery.send')[0]!.destination).toEqual({ kind: 'inside', id: '0123456789abcdef0123456789abcdef' });
  });

  it('a failure that may follow the write says the page may exist', async () => {
    extra = (name) => (name === 'delivery.send' ? ok({ ok: false, why: 'timeout', maybeSent: true }) : fail('unscripted'));
    await openSheet();
    fireEvent.click(sendButton());
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Notion may have received it'));
  });

  it('closing the sheet while it sends cancels the run (main refuses once written)', async () => {
    const sending = deferred<unknown>();
    extra = (name) => (name === 'delivery.send' ? sending.promise : fail('unscripted'));
    await openSheet();
    fireEvent.click(sendButton());
    await waitFor(() => expect(sendingTo(useDelivery.getState(), ART)).toBe('notion'));
    fireEvent.click(screen.getByRole('button', { name: C.cancel }));
    expect(main.callsOf('delivery.cancel')).toEqual([{ runId: main.callsOf('delivery.send')[0]!.runId }]);
    sending.resolve(ok({ ok: true, receipt: RECEIPT })); // it had written: the receipt still lands
    await waitFor(() => expect(useDelivery.getState().receipts[`${ART}\0notion`]).toEqual(RECEIPT));
    expect(sendingTo(useDelivery.getState(), ART)).toBeNull();
    expect(useNotices.getState().notices).toEqual([]);
  });

  // P4-B5 review: main refused the cancel, so the send's later failure is said where the owner is, its words kept
  it('a send’s failure after its sheet closed is a warning toast; a cancel main accepted says nothing', async () => {
    cancelled = false;
    const sending = deferred<unknown>();
    extra = (name) => (name === 'delivery.send' ? sending.promise : fail('unscripted'));
    await openSheet();
    fireEvent.click(sendButton());
    await waitFor(() => expect(main.callsOf('delivery.send')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: C.cancel }));
    sending.resolve(ok({ ok: false, why: 'timeout', maybeSent: true }));
    await waitFor(() => expect(useNotices.getState().notices).toHaveLength(1));
    expect(useNotices.getState().notices[0]).toMatchObject({ kind: 'toast', level: 'warning', text: C.closedFailure('Plan', 'notion', `${sendFailure('timeout', 'notion')} ${MAYBE_SENT('notion')}`) });

    cancelled = true;
    const later = deferred<unknown>();
    extra = (name) => (name === 'delivery.send' ? later.promise : fail('unscripted'));
    act(() => openSendTo(subject, 'notion'));
    await waitFor(() => expect((sendButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sendButton());
    await waitFor(() => expect(main.callsOf('delivery.send')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: C.cancel }));
    later.resolve(ok({ ok: false, why: 'cancelled' }));
    await act(async () => {});
    expect(useNotices.getState().notices).toHaveLength(1);
  });

  it('a Connect refused for a source main no longer keeps reads the state again and says so (P4-B5 review)', async () => {
    status.notion = { target: 'notion', state: 'signIn', source: SOURCE };
    extra = (name) => (name === 'delivery.connect' ? ok({ ok: false, why: 'source' }) : fail('unscripted'));
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: C.connect }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(CONNECT_FAILURE.source));
    expect(main.callsOf('delivery.status')).toHaveLength(2);
  });

  it('a state main could not read is said once, in the target’s words, with Check again (P4-B5 review)', async () => {
    status.notion = null;
    await openSheet();
    expect(screen.getAllByText(C.checkFailed.notion)).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe(C.checkFailed.notion);
    status.notion = NOTION_READY;
    fireEvent.click(screen.getByRole('button', { name: C.checkAgain }));
    await waitFor(() => expect(screen.getByText(C.notionReady(SOURCE, 'connected'))).toBeTruthy());
  });
});

describe('the Send to sheet: Drive through gws', () => {
  it('with gws absent shows its install and never sends', async () => {
    status.drive = { target: 'drive', state: 'absent' };
    await openSheet('drive');
    expect(screen.getByText(C.driveAbsent)).toBeTruthy();
    expect(screen.getByText(GWS_INSTALL)).toBeTruthy();
    expect(screen.getByRole('button', { name: C.installInTerminal })).toBeTruthy();
    expect((sendButton() as HTMLButtonElement).disabled).toBe(true);
    expect(main.callsOf('delivery.send')).toEqual([]);
  });

  it('signed out offers gws’s own login; a refused login is said and the state stays signed out', async () => {
    status.drive = { target: 'drive', state: 'signedOut' };
    extra = (name) => (name === 'delivery.connect' ? ok({ ok: false, why: 'refused', message: 'OAuth flow failed: access_denied' }) : fail('unscripted'));
    await openSheet('drive');
    expect(screen.getByText(C.driveSignedOut)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: C.signIn }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('The sign-in was refused. OAuth flow failed: access_denied'));
    expect(main.callsOf('delivery.connect')[0]).toMatchObject({ target: 'drive', artifactId: ART });
    expect(screen.getByRole('button', { name: C.signIn })).toBeTruthy(); // still signed out, the login offered again
    expect((sendButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('words a failure in Drive’s name, not Notion’s (P4-B5 review)', async () => {
    extra = (name) => (name === 'delivery.send' ? ok({ ok: false, why: 'timeout', maybeSent: true }) : fail('unscripted'));
    await openSheet('drive');
    await waitFor(() => expect((sendButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sendButton());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Google Drive didn’t answer in time. Google Drive may have received it: check there before sending again.'));
  });

  it('sends a design’s PNG at the board its header names, and a PDF of every board (P4-B5 review)', async () => {
    formats = ['png', 'pdf'];
    extra = (name) => (name === 'delivery.send' ? ok({ ok: false, why: 'failed' }) : fail('unscripted'));
    await openSheet('drive', { artifactId: ART, kind: 'design', title: 'Screens', board: 'b2' });
    await waitFor(() => expect((screen.getByLabelText(C.format) as HTMLSelectElement).value).toBe('pdf'));
    fireEvent.click(sendButton());
    await waitFor(() => expect(main.callsOf('delivery.send')).toHaveLength(1));
    expect(main.callsOf('delivery.send')[0]).not.toHaveProperty('board');
    await waitFor(() => expect((sendButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText(C.format), { target: { value: 'png' } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(main.callsOf('delivery.send')).toHaveLength(2));
    expect(main.callsOf('delivery.send')[1]).toMatchObject({ format: 'png', board: 'b2' });
  });

  it('sends in the owner’s format (an Office file first), into a pasted folder', async () => {
    extra = (name) => (name === 'delivery.send' ? ok({ ok: true, receipt: { ...RECEIPT, target: 'drive', format: 'docx', name: 'Plan.docx', url: 'https://drive.google.com/file/d/f/view' } }) : fail('unscripted'));
    await openSheet('drive');
    await waitFor(() => expect((screen.getByLabelText(C.format) as HTMLSelectElement).value).toBe('docx'));
    fireEvent.change(screen.getByLabelText(C.format), { target: { value: 'pdf' } });
    fireEvent.click(screen.getByLabelText(C.driveInside, { selector: 'input[type=radio]' }));
    fireEvent.change(screen.getByLabelText(C.driveInside, { selector: 'input:not([type=radio])' }), { target: { value: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp' } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(screen.getByText(C.sent('drive', 'Plan.docx'))).toBeTruthy());
    expect(main.callsOf('delivery.send')[0]).toMatchObject({ target: 'drive', format: 'pdf', destination: { kind: 'inside', id: '1AbCdEfGhIjKlMnOp' } });
  });
});

describe('the header’s Send to', () => {
  it('is pinned, labelled by the artifact’s delivery state, and opens the sheet on the last target', async () => {
    const stop = connectDelivery();
    const { result } = renderHook(() => useSendToAction(subject));
    expect(result.current).toMatchObject({ id: 'sendTo', label: C.action, pinned: true });
    act(() => useDelivery.setState({ sending: { [ART]: { 'run-1': 'notion' } } }));
    expect(result.current?.label).toBe(C.actionSending('notion'));
    act(() => {
      useDelivery.setState({ sending: {} });
      main.emit('delivery.receipt', { ...RECEIPT, target: 'drive', format: 'docx' });
    });
    await waitFor(() => expect(result.current?.label).toBe(C.actionSent('drive')));
    act(() => result.current!.onSelect());
    expect(useDelivery.getState().sheet?.run.state.getState().target).toBe('drive');
    stop();
  });

  // P4-B5 review: each run marks and clears its own, so the header names the latest still running
  it('keeps a running send’s mark through a second run’s busy and another target’s send ending first', async () => {
    const notion = deferred<unknown>();
    const answers: unknown[] = [notion.promise, ok({ ok: false, why: 'busy' }), ok({ ok: true, receipt: { ...RECEIPT, target: 'drive', format: 'docx', name: 'Plan.docx', url: null } })];
    extra = (name) => (name === 'delivery.send' ? answers.shift() : fail('unscripted'));
    const { result } = renderHook(() => useSendToAction(subject));
    await openSheet();
    fireEvent.click(sendButton());
    await waitFor(() => expect(result.current?.label).toBe(C.actionSending('notion')));
    act(() => openSendTo(subject, 'notion')); // the first sheet closed; its send runs on
    await waitFor(() => expect((sendButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sendButton());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(sendFailure('busy', 'notion')));
    expect(result.current?.label).toBe(C.actionSending('notion'));
    act(() => openSendTo(subject, 'drive'));
    await waitFor(() => expect((sendButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sendButton());
    await waitFor(() => expect(screen.getByText(C.sent('drive', 'Plan.docx'))).toBeTruthy());
    expect(result.current?.label).toBe(C.actionSending('notion'));
    notion.resolve(ok({ ok: true, receipt: { ...RECEIPT, at: RECEIPT.at + 1 } }));
    await waitFor(() => expect(result.current?.label).toBe(C.actionSent('notion')));
  });

  it('a bridge that cannot answer the receipts read leaves none, nothing thrown', async () => {
    const stop = connectDelivery(installFakeMain(() => Promise.reject(new Error('unexpected delivery.receipts'))).bridge);
    await act(async () => {});
    expect(useDelivery.getState().receipts).toEqual({});
    stop();
  });
});
