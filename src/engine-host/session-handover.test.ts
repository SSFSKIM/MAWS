// P5 O16 M3b (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3 and Interfaces §D; D9, D34, D41): a session under
// a session host, frozen for the handover and detached. Scripted: the engine's `maws` call in flight at the freeze, its
// answer let through the writer while the engine's later request stays unread (the successor's, from the ring), the
// drain settling only at the answer's `applied`, then the detach: the `host_detach` row after the answer's `out` row, the
// connection ended with the final ack, and no exit. The real session host and a successor adopting are handover.test.ts's.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RequestId } from '@shared/graph/ids';
import type { StdinFrame } from '@shared/wire/frames';
import { scriptedSession } from './conformance/session-harness';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => boolean, what: string, ms = 5_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'maws-handover-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const OPENED = { kind: 'panel-tool', toolId: 'terminal', tabId: 'terminal:1', title: 'Terminal' } as const;
const responseTo = (frame: StdinFrame): string | undefined => (frame.type === 'control_response' ? (frame as { response: { request_id: string } }).response.request_id : undefined);

// A hosted session whose answer writes can be held, as the host's `applied` is.
async function hostedSession() {
  const holds = new Map<string, () => void>();
  let holdAnswers = false;
  const run = scriptedSession({
    spec: { cwd }, session: { appVersion: '0.9.0' },
    transport: {
      holder: { pid: 4100, holderId: 'L-handover', fence: 1 },
      holdWrite: (frame) => (holdAnswers && responseTo(frame) !== undefined ? new Promise<void>((resolve) => holds.set(responseTo(frame)!, resolve)) : null),
    },
  });
  const shows: { requestId: RequestId }[] = [];
  run.session.on('paneShow', (request) => void shows.push(request));
  await run.session.start();
  let n = 0;
  const showPane = (): RequestId => {
    const id = `mcp-${++n}` as RequestId;
    run.transport.push({ type: 'control_request', request_id: id, request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: n, method: 'tools/call', params: { name: 'show_pane', arguments: { pane: 'terminal' }, _meta: { 'claudecode/toolUseId': `toolu_${n}` } } } } });
    return id;
  };
  const journaled = (needle: string) => run.journal.rows.filter((row) => JSON.stringify(row.frame).includes(needle));
  return { ...run, shows, showPane, journaled, holds, holdAnswers: () => void (holdAnswers = true) };
}

describe('the handover of a hosted session', () => {
  it('a frozen row reads nothing more, lets its call’s answer through, drains at the answer’s applied and detaches with the final ack', async () => {
    const run = await hostedSession();
    expect(run.session.hosted).toBe(true);
    const call = run.showPane();
    await until(() => run.shows.length === 1, 'the pane request');

    run.session.freeze();
    expect(run.session.inFlightThroughDelivery()).toBe(1);
    let drained = false;
    void run.session.drained().then(() => void (drained = true));
    // the engine's request after the freeze: never journaled, never dispatched (the successor replays it from the ring)
    run.transport.push({ type: 'control_request', request_id: 'perm-after-freeze', request: { subtype: 'can_use_tool', tool_name: 'Bash', display_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_after' } });
    await sleep(30);
    expect(run.journaled('perm-after-freeze')).toEqual([]);
    expect(run.session.brokerItems()).toEqual([]);
    expect(run.events.some((e) => e.kind === 'permission.requested')).toBe(false);
    // a frame that is not an answer is refused by the writer
    await expect(run.session.send({ text: 'after the freeze' } as never)).rejects.toThrow();

    run.holdAnswers();
    expect(run.session.answerPane(call, { ok: true, opened: OPENED })).toBe('delivered');
    await until(() => run.holds.has(call), 'the answer on its way');
    await sleep(20);
    expect(drained).toBe(false); // written, not yet applied
    expect(run.session.inFlightThroughDelivery()).toBe(1);
    run.holds.get(call)!();
    await until(() => drained, 'the drain');
    expect(run.session.inFlightThroughDelivery()).toBe(0);

    await run.session.detach('handover');
    const answerRow = run.journal.rows.findIndex((row) => row.direction === 'out' && JSON.stringify(row.frame).includes(call));
    const detachRow = run.journal.rows.findIndex((row) => (row.frame as { event?: string }).event === 'host_detach');
    expect(answerRow).toBeGreaterThan(-1);
    expect(detachRow).toBe(run.journal.rows.length - 1);
    expect(run.journal.rows[detachRow]!.frame).toEqual({ event: 'host_detach', reason: 'handover', holderId: 'L-handover', fence: 1 });
    expect(run.transport.calls).toContain('detach:ack');
    expect(run.transport.calls.some((c) => c.startsWith('kill:') || c === 'endInput')).toBe(false); // the engine runs on
    expect(run.session.lifecycle).not.toBe('exited');
    expect(run.journal.closed).toBe(true);
  });

  it('a call the engine withdrew before the freeze retires from the drain when its tool settles', async () => {
    const run = await hostedSession();
    const call = run.showPane();
    await until(() => run.shows.length === 1, 'the pane request');
    run.transport.push({ type: 'control_cancel_request', request_id: call });
    await sleep(20);
    run.session.freeze();
    await run.session.drained(); // the pane bridge settles at the abort; no answer is written
    expect(run.transport.writes.some((w) => responseTo(w) === call)).toBe(false);
    expect(run.session.inFlightThroughDelivery()).toBe(0);
  });

  it('an engine that exits while frozen ends the drain, and its exit is left for the successor to journal', async () => {
    const run = await hostedSession();
    run.showPane();
    await until(() => run.shows.length === 1, 'the pane request');
    run.session.freeze();
    run.transport.exit(0);
    await run.session.drained();
    await run.session.detach('handover');
    expect(run.journal.rows.some((row) => (row.frame as { event?: string }).event === 'exit')).toBe(false);
    expect(run.session.lifecycle).not.toBe('exited');
  });

  // fix wave 1: a release is not the owner's act: it waits for the successor; a deliberate stop takes the row back from
  // the handover and runs the ladder (process-table.test.ts runs it to the exit)
  it('a release asked of a frozen row runs no ladder; a deliberate stop takes it back and runs it', async () => {
    const run = await hostedSession();
    run.session.freeze();
    await run.session.stop('idle');
    expect(run.transport.requestsOf('end_session')).toEqual([]);
    expect(run.transport.calls.some((c) => c.startsWith('kill:') || c === 'endInput')).toBe(false);
    expect(run.logs.some((line) => line.includes('left to the successor'))).toBe(true);
    const stopped = run.session.stop('stop');
    await until(() => run.transport.requestsOf('end_session').length === 1, 'the ladder’s end_session');
    expect(run.logs.some((line) => line.includes('taken back from the handover'))).toBe(true);
    run.transport.exit(0);
    await stopped;
    expect(run.session.status().exit).toMatchObject({ reason: 'stop' });
    await run.session.detach('handover'); // taken back: never detached
    expect(run.transport.calls).not.toContain('detach:ack');
  });
});
