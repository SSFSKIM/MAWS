// E7 (M2): the rows of messages between sessions and agents and of a listing, and the Reply composer under them (E7
// execution document, Design §4): real rows from the model, a spy `replyToPeer`, a hand-held `peerReplies` source.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { record, status } from '../../../../../../test/support/builders';
import { useSessions } from '../../../stores/sessions';
import { rowsOf, withAllExpanded } from '../../model/derive';
import { applyEvents, createState } from '../../model/reduce';
import type { Row } from '../../model/rows';
import { builder, uuid } from '../../model/test-events';
import type { PeerReply, PeerReplies, TranscriptActions } from '../context';
import { renderRow, spyActions } from './test-support';

const A = 'A' as AppSessionId;
const B = 'uds:/tmp/cc-socks/1.sock';
type Message = Extract<Row, { kind: 'agent_message' }>;

const derived = (build: (b: ReturnType<typeof builder>) => void) => {
  const b = builder();
  build(b);
  return rowsOf(withAllExpanded(applyEvents(createState(null, null), b.events)));
};
const inbound = (text = 'hello from B') =>
  derived((b) => {
    b.emit('turn.started', { userMessageUuid: null, origin: 'peer' });
    b.emit('peer.message', { messageUuid: uuid('p1'), from: B, fromSession: null, fromName: 'repo-b', fromMode: null, fromPlugin: null, hopChain: [], text, midTurn: false, lineage: 'peer', replyable: true });
  }).find((row): row is Message => row.kind === 'agent_message')!;

// A peerReplies source the test moves by hand, keyed by address.
function replies() {
  const map = new Map<string, PeerReply>();
  const listeners = new Set<() => void>();
  const source: PeerReplies = {
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    get: (_appSessionId, address) => map.get(address),
    dismiss: vi.fn((_appSessionId, address: string) => {
      map.delete(address);
      listeners.forEach((l) => l());
    }),
  };
  const put = (address: string, reply: PeerReply) =>
    act(() => {
      map.set(address, reply);
      listeners.forEach((l) => l());
    });
  return { source, put };
}

const live = () => useSessions.setState({ engine: new Map([[A, status(A)]]), records: new Map([[A, record(A, { title: { text: 'Session A', source: 'user' } })]]) });

beforeEach(() => useSessions.setState({ engine: new Map(), records: new Map() }));
afterEach(cleanup);

describe('a message from another session', () => {
  it('reads @ sender with the address as its tooltip and the preview; Reply opens the composer, which sends through replyToPeer', async () => {
    live();
    const { source } = replies();
    const actions: TranscriptActions = { ...spyActions(), peerReplies: source };
    renderRow(inbound(), { storeKey: A, actions });
    expect(screen.getByText('@ repo-b').getAttribute('title')).toBe(B);
    expect(screen.getByText('hello from B')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const box = screen.getByRole('textbox', { name: 'Reply via Session A' });
    expect(box.getAttribute('placeholder')).toBe('Reply to repo-b…');
    fireEvent.change(box, { target: { value: '  on it  ' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    expect(actions.replyToPeer).toHaveBeenCalledExactlyOnceWith(A, { address: B, name: 'repo-b', mode: 'reply' }, 'on it');
    expect((box as HTMLTextAreaElement).value).toBe('');
  });

  it('is closed with the reason when the session is not running here', () => {
    renderRow(inbound(), { storeKey: A });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const box = screen.getByRole('textbox');
    expect((box as HTMLTextAreaElement).disabled).toBe(true);
    expect(box.getAttribute('placeholder')).toBe('Replying needs the session running here');
  });

  it('walks the ask on the line: asked (and closed meanwhile), replying, replied; a failure puts the text back and an edit clears it', () => {
    live();
    const { source, put } = replies();
    renderRow(inbound(), { storeKey: A, actions: { ...spyActions(), peerReplies: source } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    put(B, { text: 'on it', state: { kind: 'asked', sentAt: new Date().toISOString(), parentTurnOpenAtSend: false } });
    expect(screen.getByRole('status').textContent).toBe('Asked Session A to reply · 0s');
    expect(screen.getByRole('textbox').getAttribute('placeholder')).toBe('Waiting for the last reply');
    put(B, { text: 'on it', state: { kind: 'asked', sentAt: new Date().toISOString(), parentTurnOpenAtSend: true } });
    expect(screen.getByRole('status').textContent).toBe('Asked Session A to reply · 0s · Session A sends it at its next tool boundary or when this turn ends');
    put(B, { text: 'on it', state: { kind: 'forwarded' } });
    expect(screen.getByRole('status').textContent).toBe('Session A is replying with SendMessage');
    put(B, { text: 'on it', state: { kind: 'sent' } });
    expect(screen.getByRole('status').textContent).toBe('Session A replied with SendMessage');
    put(B, { text: 'on it', state: { kind: 'failed', message: 'the engine discarded it before starting it' } });
    expect(screen.getByRole('status').textContent).toBe('Reply failed: the engine discarded it before starting it');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('on it');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'on it again' } });
    expect(source.dismiss).toHaveBeenCalledWith(A, B);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the whole message behind its disclosure when the preview cut it, and offers no Reply when the sender cannot be reached', () => {
    const row = inbound('first line\nsecond line');
    renderRow({ ...row, peer: { ...row.peer!, replyTo: null } }, { storeKey: A });
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(screen.queryByText(/second line/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the whole message' }));
    expect(screen.getByText(/second line/).textContent).toBe('first line\nsecond line');
  });
});

describe('a message sent to another session, and a subagent’s report', () => {
  it('reads To @ recipient with the send’s state, and the engine’s reason when it could not send', () => {
    const rows = derived((b) => {
      b.turn('u1');
      b.toolUse('s1', 'SendMessage', { to: 'nobody', message: 'hi' });
      b.result('s1', '{}', { structured: { success: false, message: "No agent named 'nobody' is reachable." } });
      b.toolUse('s2', 'SendMessage', { to: 'peer-c', message: 'waiting' });
    }).filter((row): row is Message => row.kind === 'agent_message');
    renderRow(rows[0]!, { storeKey: A });
    expect(screen.getByText('To @ nobody')).toBeTruthy();
    expect(screen.getByText('Not sent')).toBeTruthy();
    expect(screen.getByText("No agent named 'nobody' is reachable.")).toBeTruthy();
    cleanup();
    renderRow(rows[1]!, { storeKey: A });
    expect(screen.getByText('Sending')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });

  it('folds a hand-back’s report under Report from its agent', () => {
    const [row] = derived((b) => {
      b.emit('turn.started', { userMessageUuid: null, origin: 'peer' });
      b.emit('subagent.message', { direction: 'from_child', fromAgentId: 'a1' as never, toAgentId: null, text: '[Subagent hand-back] Framed. The report follows:\n  all done' });
    }).filter((row): row is Message => row.kind === 'agent_message');
    renderRow(row!, { storeKey: A });
    expect(screen.getByText('Report from a1')).toBeTruthy();
    expect(screen.queryByText('all done')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the report' }));
    expect(screen.getByText('all done')).toBeTruthy();
  });
});

describe('a ListAgents listing', () => {
  it('lists each section with its count, names, refs and extras; Message opens the composer addressed to the name', async () => {
    live();
    const row = derived((b) => {
      b.turn('u1');
      b.toolUse('l1', 'ListAgents', {});
      b.result('l1', 'This session is repo-a [1] — x.\n\nPeer sessions (1):\n  repo-b [61303a]  ·  interactive  ·  idle\n  (… 2 more not shown)');
    }).find((r): r is Extract<Row, { kind: 'agent_list' }> => r.kind === 'agent_list')!;
    const actions = spyActions();
    renderRow(row, { storeKey: A, actions });
    expect(screen.getByText('This session is repo-a [1]')).toBeTruthy();
    expect(screen.getByText('Peer sessions · 1')).toBeTruthy();
    expect(screen.getByText('repo-b')).toBeTruthy();
    expect(screen.getByText('61303a')).toBeTruthy();
    expect(screen.getByText('interactive · idle')).toBeTruthy();
    expect(screen.getByText('(… 2 more not shown)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Message repo-b' }));
    const box = screen.getByRole('textbox', { name: 'Message via Session A' });
    expect(box.getAttribute('placeholder')).toBe('Message repo-b…');
    fireEvent.change(box, { target: { value: 'ping' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })));
    expect(actions.replyToPeer).toHaveBeenCalledExactlyOnceWith(A, { address: 'repo-b', name: 'repo-b', mode: 'message' }, 'ping');
  });

  it('says it is listing until the result arrives', () => {
    const row = derived((b) => {
      b.turn('u1');
      b.toolUse('l1', 'ListAgents', {});
    }).find((r): r is Extract<Row, { kind: 'agent_list' }> => r.kind === 'agent_list')!;
    renderRow(row, { storeKey: A });
    expect(screen.getByText('Listing the agents and sessions…')).toBeTruthy();
  });
});
