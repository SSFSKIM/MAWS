import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
import { replayedSession, scriptedSession } from './conformance/session-harness';
import { bashCommand } from './bash-mode';

const ofKind = <K extends SessionEvent['kind']>(events: SessionEvent[], kind: K) => events.filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);
const flush = () => new Promise((r) => setImmediate(r));

afterEach(() => {
  vi.useRealTimers();
});

describe('bash mode echo and receipt', () => {
  it('pass2/bash-context-echoed through a session: answered at the bash_command write, the echo written from the replayed output, its receipt no turn and no release', async () => {
    const answered: { commandUuid: MessageUuid }[] = [];
    let prompt: MessageUuid | null = null;
    const run = await replayedSession('pass2', 'bash-context-echoed', (row, { session, transport, ready }) => {
      const frame = row.frame as { type: string; shouldQuery?: boolean; message?: { content: string } };
      if (frame.type === 'bash_command') void ready().then(() => bashCommand(session, 'printf MAWS_BASH_8823')).then((r) => answered.push(r));
      else if (frame.type === 'user' && frame.shouldQuery === false) return; // the session writes the echo itself
      else if (frame.type === 'user') void session.send(frame.message!.content).then((r) => (prompt = r.messageUuid));
      else transport.kill('SIGTERM');
    });
    expect(run.journal.rows.filter((r) => r.direction === 'meta' && (r.frame as { event: string }).event === 'replay_mismatch')).toEqual([]);

    const outs = run.journal.rows.filter((r) => r.direction === 'out' && (r.frame as { type: string }).type !== 'control_request').map((r) => r.frame as Record<string, unknown>);
    expect(outs[0]).toEqual({ type: 'bash_command', command: 'printf MAWS_BASH_8823', cwd: '/tmp/maws-session', uuid: answered[0]!.commandUuid });
    const echo = outs[1]!;
    expect(echo).toEqual({
      type: 'user', uuid: echo.uuid, shouldQuery: false, parent_tool_use_id: null, origin: { kind: 'human' },
      message: { role: 'user', content: '<bash-input>printf MAWS_BASH_8823</bash-input>\n<bash-stdout>MAWS_BASH_8823</bash-stdout><bash-stderr></bash-stderr><bash-exit-code>0</bash-exit-code>' },
    });
    expect(outs[2]).toMatchObject({ type: 'user', uuid: prompt, message: { content: expect.stringContaining('What exactly did it print?') } });

    const users = ofKind(run.events, 'user.message');
    expect(users.slice(0, 3).map((u) => [u.bash?.part ?? null, u.origin, u.isSynthetic])).toEqual([['input', null, false], ['output', null, false], [null, 'bash_echo', true]]);
    expect(users[2]!.messageUuid).toBe(echo.uuid);
    const ended = ofKind(run.events, 'turn.ended');
    expect(ended.map((e) => e.isEchoReceipt)).toEqual([true, false]);
    expect(ofKind(run.events, 'turn.started')).toMatchObject([{ origin: 'human', userMessageUuid: prompt }]);
    // the receipt released nothing: the only queue rows are the recovery's (P2-C) and the prompt's own submission
    const queueRows = run.journal.rows.filter((r) => r.direction === 'meta' && (r.frame as { event: string }).event === 'queue').map((r) => r.frame as { action: string; trigger: string });
    expect(queueRows).toEqual([{ event: 'queue', action: 'recovered' }, { event: 'queue', action: 'release', trigger: 'send', queueId: expect.any(String), messageUuid: prompt }]);
    expect(run.rebuilt()).toEqual(run.events);
  });

  it('no replayed output within 30 s: a warning notice and no echo', async () => {
    vi.useFakeTimers();
    const s = scriptedSession();
    await s.session.start();
    const { commandUuid } = await s.session.bash('sleep 100');
    expect(s.transport.writes.at(-1)).toEqual({ type: 'bash_command', command: 'sleep 100', cwd: '/tmp/maws-session', uuid: commandUuid });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(ofKind(s.events, 'notice.posted')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ofKind(s.events, 'notice.posted')).toMatchObject([{ level: 'warning', key: `bash:no_output:${commandUuid}` }]);
    s.transport.push({ type: 'user', message: { role: 'user', content: '<bash-input>sleep 100</bash-input>' }, session_id: 's', parent_tool_use_id: null, uuid: 'b-1', isReplay: true });
    s.transport.push({ type: 'user', message: { role: 'user', content: '<bash-stdout></bash-stdout><bash-stderr></bash-stderr><bash-exit-code>0</bash-exit-code>' }, session_id: 's', parent_tool_use_id: null, uuid: 'b-2', isReplay: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.transport.writes.filter((w) => w.type === 'user')).toEqual([]);
  });

  it('uses the engine\'s canonical cwd once system/init reported it', async () => {
    const s = scriptedSession();
    await s.session.start();
    s.transport.push({ type: 'system', subtype: 'init', cwd: '/private/tmp/maws-session', session_id: 's', tools: [], mcp_servers: [], model: 'm', permissionMode: 'auto', slash_commands: [], claude_code_version: '2.1.283', output_style: 'default', uuid: 'i-1' });
    await flush();
    await s.session.bash('pwd');
    expect(s.transport.writes.at(-1)).toMatchObject({ type: 'bash_command', cwd: '/private/tmp/maws-session' });
  });
});
