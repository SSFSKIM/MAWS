// The computer-use strip as a session's pane draws it (the UX wave's U12a, Interfaces §E, §G): what it reads from the
// stores (the transcript, the waiting permission requests, the process's liveness, the session's status, the controls
// port's turn), and its Stop: the composer's interrupt, enabled or disabled from the helper's sentence and the port's
// capability alone, busy once pressed, and enabled again with the refusal's message when refused.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { digest, item, status, T0 } from '../../../../test/support/builders';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import type { Capability, SessionControls } from '../session/controls/types';
import { useAttention } from '../stores/attention';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../stores/transcript';
import { applyEvents, createState } from '../transcript/model/reduce';
import { builder, tool, uuid, type Builder } from '../transcript/model/test-events';
import { COMPUTER_USE_COPY } from './copy';
import { ComputerUseStrip } from './Strip';
import { COMPUTER_USE_SETTLE_MS } from './strip-state';

const port = vi.hoisted(() => ({ controls: null as SessionControls | null, unavailable: null as string | null }));
vi.mock('../session/controls/controls-for', () => ({ useSessionControls: () => port.controls }));
vi.mock('../lane-b/remote-unavailable', () => ({ useRemoteUnavailable: () => port.unavailable }));

const ID = 'app-strip' as AppSessionId;
const JS = 'mcp__plugin_cua_cua_repl__js';
const CONNECTED = [{ name: 'plugin:cua:cua_repl', status: 'connected', source: null }];

type InterruptResult = CommandResult<'session.interrupt'>;
function fakePort(over: { capability?: Capability; turn?: { running: boolean } | null } = {}) {
  const answers: ((result: InterruptResult) => void)[] = [];
  const interrupt = vi.fn(() => new Promise<InterruptResult>((resolve) => answers.push(resolve)));
  const controls = { capability: () => over.capability ?? { available: true }, turn: () => over.turn ?? null, interrupt } as unknown as SessionControls;
  return { controls, interrupt, answer: (result: InterruptResult) => answers.shift()!(result) };
}
const ANSWERED = { ok: true, value: { stillQueued: [], cancelled: [] } } as InterruptResult;
const REFUSED = { ok: false, error: { code: 'internal', message: 'The session’s engine did not answer' } } as InterruptResult;

const show = (b: Builder, appSessionId: AppSessionId = ID) =>
  act(() => {
    const state = applyEvents(createState(null, null), b.events);
    useTranscriptStore.setState({ entries: { [appSessionId]: { state, rows: [], phase: 'live', error: null, following: true, sendFollowRequest: 0, working: true, clock: null, jump: null } } });
  });
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const running = () => {
  const b = builder();
  b.turn('u1');
  b.toolUse('j1', JS, { code: 'await cua.click()' });
  return b;
};
const line = () => screen.queryByRole('status');
const stop = () => screen.getByRole('button', { name: COMPUTER_USE_COPY.stop });
const withStatus = (mcpServers: { name: string; status: string; source: string | null }[], appSessionId: AppSessionId = ID) =>
  act(() => useSessions.setState({ engine: new Map([[appSessionId, { ...status(appSessionId), mcpServers }]]) }));

beforeEach(() => {
  vi.useFakeTimers();
  port.controls = fakePort().controls;
  port.unavailable = null;
  useTranscriptStore.setState({ entries: {}, live: {} });
  useAttention.setState({ bySession: new Map(), version: useAttention.getState().version + 1 });
  useSessions.setState({ engine: new Map(), digests: new Map() });
  useNotices.setState({ notices: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the computer-use strip', () => {
  it('reads "Computer use running" with Stop 250 ms after a call starts, and nothing before', () => {
    render(<ComputerUseStrip appSessionId={ID} />);
    show(running());
    advance(COMPUTER_USE_SETTLE_MS - 1);
    expect(line()).toBeNull();
    advance(1);
    expect(line()!.textContent).toContain(COMPUTER_USE_COPY.running);
    expect((stop() as HTMLButtonElement).disabled).toBe(false);
  });

  it('is not drawn while a waiting permission request names the call, and is for another call’s request', () => {
    const asking = (toolUseId: string) =>
      act(() => useAttention.setState({ bySession: new Map([[ID, [item(ID, 'permission', T0, { request: { requestId: 'req-1' as never, toolUseId: tool(toolUseId), taskId: null, agentId: null } })]]]), version: useAttention.getState().version + 1 }));
    render(<ComputerUseStrip appSessionId={ID} />);
    asking('j1');
    show(running());
    advance(60_000);
    expect(line()).toBeNull();
    asking('other');
    advance(COMPUTER_USE_SETTLE_MS);
    expect(line()!.textContent).toContain(COMPUTER_USE_COPY.running);
  });

  it('is not drawn while the controls port says no turn runs; once the store says the turn does not tick, the running line gives way to the lingering one', () => {
    withStatus(CONNECTED);
    port.controls = fakePort({ turn: { running: false } }).controls;
    const { rerender } = render(<ComputerUseStrip appSessionId={ID} />);
    show(running());
    advance(60_000);
    expect(line()).toBeNull();
    port.controls = fakePort({ turn: { running: true } }).controls;
    rerender(<ComputerUseStrip appSessionId={ID} />);
    advance(COMPUTER_USE_SETTLE_MS);
    expect(line()!.textContent).toContain(COMPUTER_USE_COPY.running);
    act(() => useTranscriptStore.getState().setLive(ID, false)); // no running turn any more, and no word that the process exited
    expect(line()!.textContent).toContain(COMPUTER_USE_COPY.lingering);
  });
});

describe('a prompt queued behind the running call and then dropped', () => {
  const queuedThenCancelled = () => {
    const b = running();
    b.emit('user.message', { messageUuid: uuid('u2'), content: 'queued', isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    b.emit('command.lifecycle', { commandUuid: uuid('u2'), state: 'cancelled' });
    return b;
  };

  it('leaves the running line and its Stop as they are, and never turns it to the lingering line', () => {
    withStatus(CONNECTED);
    render(<ComputerUseStrip appSessionId={ID} />);
    show(running());
    advance(COMPUTER_USE_SETTLE_MS);
    show(queuedThenCancelled());
    advance(60 * 60_000);
    expect(line()!.textContent).toContain(COMPUTER_USE_COPY.running);
    expect((stop() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: COMPUTER_USE_COPY.dismiss })).toBeNull();
  });

  it('still shows the line when the drop comes inside the 250 ms wait', () => {
    render(<ComputerUseStrip appSessionId={ID} />);
    show(running());
    advance(100);
    show(queuedThenCancelled());
    advance(COMPUTER_USE_SETTLE_MS - 100);
    expect(line()!.textContent).toContain(COMPUTER_USE_COPY.running);
  });
});

describe('its Stop', () => {
  it('sends the composer’s interrupt once and is disabled and busy while it is unanswered; a refusal enables it again and shows its message', async () => {
    const fake = fakePort();
    port.controls = fake.controls;
    render(<ComputerUseStrip appSessionId={ID} />);
    show(running());
    advance(COMPUTER_USE_SETTLE_MS);
    fireEvent.click(stop());
    fireEvent.click(stop());
    expect(fake.interrupt).toHaveBeenCalledTimes(1);
    expect(fake.interrupt).toHaveBeenCalledWith({ cancelEngineQueued: false, holdEngineQueued: true });
    expect((stop() as HTMLButtonElement).disabled).toBe(true);
    expect(stop().getAttribute('aria-busy')).toBe('true');
    await act(async () => fake.answer(REFUSED));
    expect((stop() as HTMLButtonElement).disabled).toBe(false);
    expect(stop().hasAttribute('aria-busy')).toBe(false);
    expect(useNotices.getState().notices).toMatchObject([{ kind: 'toast', level: 'warning', text: 'The session’s engine did not answer' }]);
  });

  it('stays busy after an answer, until its line goes', async () => {
    const fake = fakePort();
    port.controls = fake.controls;
    render(<ComputerUseStrip appSessionId={ID} />);
    show(running());
    advance(COMPUTER_USE_SETTLE_MS);
    fireEvent.click(stop());
    await act(async () => fake.answer(ANSWERED));
    expect((stop() as HTMLButtonElement).disabled).toBe(true);
    expect(useNotices.getState().notices).toEqual([]);
  });

  it('is enabled for a session on another machine whose helper gives no sentence, and sends the interrupt there', () => {
    const remote = addressOf(OTHER_MACHINE, 'sess-remote') as AppSessionId;
    const fake = fakePort();
    port.controls = fake.controls;
    render(<ComputerUseStrip appSessionId={remote} />);
    show(running(), remote);
    advance(COMPUTER_USE_SETTLE_MS);
    expect((stop() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(stop());
    expect(fake.interrupt).toHaveBeenCalledTimes(1);
  });

  it('is disabled with the helper’s sentence, or else the port’s reason, as its tooltip and its description', () => {
    port.unavailable = 'Stopping isn’t offered for a session on that machine';
    const { rerender } = render(<ComputerUseStrip appSessionId={ID} />);
    show(running());
    advance(COMPUTER_USE_SETTLE_MS);
    expect((stop() as HTMLButtonElement).disabled).toBe(true);
    expect(stop().getAttribute('title')).toBe(port.unavailable);
    expect(stop().getAttribute('aria-description')).toBe(port.unavailable);
    port.unavailable = null;
    port.controls = fakePort({ capability: { available: false, reason: 'The session has ended' } }).controls;
    rerender(<ComputerUseStrip appSessionId={ID} />);
    expect((stop() as HTMLButtonElement).disabled).toBe(true);
    expect(stop().getAttribute('title')).toBe('The session has ended');
    expect(stop().getAttribute('aria-description')).toBe('The session has ended');
  });

  it('is absent without a controls port, and the line stands alone', () => {
    port.controls = null;
    render(<ComputerUseStrip appSessionId={ID} />);
    show(running());
    advance(COMPUTER_USE_SETTLE_MS);
    expect(line()!.textContent).toContain(COMPUTER_USE_COPY.running);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('the lingering line', () => {
  const withdrawn = () => {
    const b = running();
    b.result('j1', 'The user doesn’t want to proceed with this tool use.', { isError: true, denial: 'user-rejected' });
    b.end(['u1']);
    return b;
  };

  it('follows a withdrawn call the strip showed, with Dismiss, which takes it away', () => {
    withStatus(CONNECTED);
    render(<ComputerUseStrip appSessionId={ID} />);
    show(running());
    advance(COMPUTER_USE_SETTLE_MS);
    show(withdrawn());
    expect(line()!.textContent).toContain(COMPUTER_USE_COPY.lingering);
    expect(screen.queryByRole('button', { name: COMPUTER_USE_COPY.stop })).toBeNull();
    advance(60 * 60_000);
    expect(line()!.textContent).toContain(COMPUTER_USE_COPY.lingering);
    fireEvent.click(screen.getByRole('button', { name: COMPUTER_USE_COPY.dismiss }));
    expect(line()).toBeNull();
  });

  it('leaves when the session’s status lists no connected computer-use server, and stays while one is connected', () => {
    withStatus(CONNECTED);
    render(<ComputerUseStrip appSessionId={ID} />);
    show(running());
    advance(COMPUTER_USE_SETTLE_MS);
    show(withdrawn());
    withStatus([{ name: 'cua_repl', status: 'connected', source: null }]);
    expect(line()).not.toBeNull();
    withStatus([{ name: 'plugin:cua:cua_repl', status: 'failed', source: null }]);
    expect(line()).toBeNull();
  });

  it('leaves when the session’s status says its process exited', () => {
    withStatus(CONNECTED);
    render(<ComputerUseStrip appSessionId={ID} />);
    show(running());
    advance(COMPUTER_USE_SETTLE_MS);
    show(withdrawn());
    expect(line()).not.toBeNull();
    act(() => useSessions.setState({ engine: new Map([[ID, { ...status(ID, { process: 'exited' }), mcpServers: CONNECTED }]]) })); // its last server list, as it stood
    expect(line()).toBeNull();
  });

  it('leaves when the session’s digest says it exited', () => {
    withStatus(CONNECTED);
    render(<ComputerUseStrip appSessionId={ID} />);
    show(running());
    advance(COMPUTER_USE_SETTLE_MS);
    show(withdrawn());
    expect(line()).not.toBeNull();
    act(() => useSessions.setState({ digests: new Map([[ID, digest(ID, { phase: 'exited' })]]) }));
    expect(line()).toBeNull();
  });
});

// The branch review's findings (2026-11-13), each as its own sequence through the stores: what is evidence that the
// withdrawn call's cell is over, read as the rule has it ("where two readings are possible, the line stays").
describe('the evidence the lingering line reads', () => {
  const MARKER = '[Request interrupted by user for tool use]';
  const marker = (b: Builder) => b.emit('user.message', { messageUuid: uuid(`marker-${b.events.length}`), content: [{ type: 'text', text: MARKER }], isReplay: false, isSynthetic: false, origin: null, bash: null });
  const lingeringAfterStop = () => {
    const b = running();
    b.result('j1', 'The user doesn’t want to proceed with this tool use.', { isError: true, denial: 'user-rejected' });
    b.end(['u1']);
    withStatus(CONNECTED);
    render(<ComputerUseStrip appSessionId={ID} />);
    show(running());
    advance(COMPUTER_USE_SETTLE_MS);
    show(b);
    expect(line()!.textContent).toContain(COMPUTER_USE_COPY.lingering);
    return b;
  };
  const failing = () =>
    act(() => {
      useSessions.setState({ digests: new Map([[ID, digest(ID, { phase: 'failed' })]]) });
      useTranscriptStore.getState().setLive(ID, false); // what the shell tells the store for the phase `failed`
    });

  it('stays after a later call the plugin answered before queuing a cell (an empty source), an error result', () => {
    const b = lingeringAfterStop();
    b.turn('u2');
    b.toolUse('j2', JS, { code: '' });
    b.result('j2', 'js expects non-empty JavaScript source', { isError: true });
    b.end(['u2']);
    show(b);
    expect(line()!.textContent).toContain(COMPUTER_USE_COPY.lingering);
  });

  it('stays after a later call that ran and threw', () => {
    const b = lingeringAfterStop();
    b.turn('u2');
    b.toolUse('j2', JS, { code: 'await page.click("#go")' });
    b.result('j2', 'ReferenceError: page is not defined', { isError: true });
    b.end(['u2']);
    show(b);
    expect(line()!.textContent).toContain(COMPUTER_USE_COPY.lingering);
  });

  it('leaves at a later call’s ordinary result', () => {
    const b = lingeringAfterStop();
    b.turn('u2');
    b.toolUse('j2', JS, { code: 'await cua.screenshot()' });
    b.result('j2', 'ok');
    show(b);
    expect(line()).toBeNull();
  });

  it('never lingers for a js call that ended with an error when a later Bash call of the turn is interrupted', () => {
    withStatus(CONNECTED);
    render(<ComputerUseStrip appSessionId={ID} />);
    const b = running();
    show(b);
    advance(COMPUTER_USE_SETTLE_MS);
    b.result('j1', 'ReferenceError: page is not defined', { isError: true });
    b.toolUse('b1', 'Bash', { command: 'sleep 30' });
    show(b);
    advance(2_000); // inside the pause
    b.result('b1', 'The user doesn’t want to proceed with this tool use.', { isError: true }); // as a transcript file gives it
    marker(b);
    b.end(['u1'], { isError: true, terminalReason: 'aborted_tools' });
    show(b);
    expect(line()).toBeNull();
  });

  it('stays when a later, unrelated turn fails while the process and its computer-use server live on', () => {
    const b = lingeringAfterStop();
    b.turn('u2');
    b.toolUse('r1', 'Read', { file_path: '/work/notes.txt' });
    b.result('r1', 'notes');
    b.end(['u2'], { isError: true, terminalReason: 'error_during_execution' });
    show(b);
    failing();
    expect(line()!.textContent).toContain(COMPUTER_USE_COPY.lingering);
  });

  it('stays when the turn the call was withdrawn in fails while the process lives', () => {
    withStatus(CONNECTED);
    render(<ComputerUseStrip appSessionId={ID} />);
    const b = running();
    show(b);
    advance(COMPUTER_USE_SETTLE_MS);
    b.end(['u1'], { isError: true, terminalReason: 'error_during_execution' }); // closed with the call unanswered
    show(b);
    failing();
    expect(line()!.textContent).toContain(COMPUTER_USE_COPY.lingering);
  });
});
