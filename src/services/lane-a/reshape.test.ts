// DX5 to DX4 (P5 O9 M2, Interfaces §B): the reshaper turns one bridge subscription's events into the session-plane
// messages sminos's own plane makes of them, tracking each loop's open steps from the snapshot on.
import { describe, expect, it } from 'vitest';
import type { PlaneMessage } from '@shared/ipc/schema/lane-a';
import { validateEventPayload } from '@shared/ipc/validate';
import { Reshaper } from './reshape';

const ctx = { machine: 'machine-ref-0123456789', session: 'sess-1', sub: 'watch-1' };
const list = (out: PlaneMessage[] | 'discontinuity'): PlaneMessage[] => {
  if (out === 'discontinuity') throw new Error('a discontinuity');
  return out;
};
const kinds = (out: PlaneMessage[] | 'discontinuity') => list(out).map((m) => m.kind);
const bodies = (out: PlaneMessage[] | 'discontinuity') => list(out).map((m) => m.body);

const snap = (over: Record<string, unknown> = {}) => ({
  type: 'snapshot', session: 'sess-1', turns: [], streaming: [], usage: null, pending: [], settled: [], override: null, ...over,
});

describe('the reshaper', () => {
  it('sends the snapshot as one snapshot of streaming and usage, then a raised per pending request', () => {
    const r = new Reshaper(ctx);
    const streaming = [{ turnId: 't1', agentId: null, step: 1, upTo: 3, blocks: [{ index: 0, kind: 'text', text: 'Hel', upTo: 3 }] }];
    const out = r.snapshot(snap({
      streaming,
      usage: { context: { window: 200000 }, cost: null },
      pending: [{ request: 'toolu_1', tool: 'Bash', input: { command: 'ls' }, agentId: null, deadline: 1_700_000_000_000, t: 5 }],
      rows: [{ never: 'sent' }],
    }));
    expect(kinds(out)).toEqual(['snapshot', 'raised']);
    expect(out[0]).toEqual({ project: '', machine: ctx.machine, session: 'sess-1', kind: 'snapshot', sub: 'watch-1', n: 0, body: { streaming, usage: { context: { window: 200000 }, cost: null }, jobs: [], subagents: [] } });
    expect(out[1]).toEqual({
      project: '', machine: ctx.machine, session: 'sess-1', kind: 'raised', sub: null, n: null,
      body: { request: 'toolu_1', session: 'sess-1', tool: 'Bash', input: { command: 'ls' }, deadline: new Date(1_700_000_000_000).toISOString(), t: 5 },
    });
  });

  it('numbers its subscription messages from 1 after the snapshot, and passes chunks and block-rows through', () => {
    const r = new Reshaper(ctx);
    r.snapshot(snap());
    const chunk = r.event({ n: 1, type: 'chunk', turnId: 't1', agentId: null, step: 1, chunkIndex: 0, chunk: { index: 0, delta: { text: 'Hi' } }, t: 9 });
    const row = r.event({ n: 2, type: 'block-row', uuid: 'u1', turnId: 't1', agentId: null, step: 1, index: 0, t: 10 });
    expect(chunk).toEqual([{ project: '', machine: ctx.machine, session: 'sess-1', kind: 'chunk', sub: 'watch-1', n: 1, body: { turnId: 't1', agentId: null, step: 1, chunkIndex: 0, chunk: { index: 0, delta: { text: 'Hi' } }, t: 9 } }]);
    expect(row).toEqual([{ project: '', machine: ctx.machine, session: 'sess-1', kind: 'block-row', sub: 'watch-1', n: 2, body: { uuid: 'u1', turnId: 't1', agentId: null, step: 1, index: 0 } }]);
    expect(r.event({ type: 'row-seen', uuid: 'u2', agentId: null })).toEqual([]);
  });

  // UX wave U8d M2 (Interfaces §B): the session's subagents ride beside its jobs, in DX4's body
  it('carries the session’s jobs and subagents in its snapshot, and each change of them as a numbered subagents message', () => {
    const r = new Reshaper(ctx);
    const job = { taskId: 'bsleep01', kind: 'shell' as const, toolUseId: 'toolu_1', startedAt: 'T1', description: 'sleep', command: 'sleep 60', outputFile: null, status: 'running' as const };
    const agent = { agentId: 'a0b1c2d3e4f500001', meta: { agentType: 'general-purpose' }, status: 'running' as const, evidence: 'rows' as const, outcome: { status: 'running' as const, raw: 'async_launched', at: 'T1' }, startedAt: 'T1' };
    expect(bodies(r.snapshot(snap(), { jobs: [job], subagents: [agent] }))).toEqual([{ streaming: [], usage: null, jobs: [job], subagents: [agent] }]);
    r.event({ type: 'chunk', turnId: 't1', agentId: null, step: 1, chunkIndex: 0, chunk: {} });
    const ended = { ...job, status: 'stopped' as const, endedAt: 'T2' };
    const done = { ...agent, status: 'completed' as const, outcome: { status: 'completed' as const, raw: 'completed', at: 'T2' } };
    expect(r.subagents({ jobs: [ended], subagents: [done] })).toEqual({ project: '', machine: ctx.machine, session: 'sess-1', kind: 'subagents', sub: 'watch-1', n: 2, body: { subagents: [done], jobs: [ended], mcp: [] } });
    expect(bodies(new Reshaper(ctx).snapshot(snap()))).toEqual([{ streaming: [], usage: null, jobs: [], subagents: [] }]); // nothing followed yet
  });

  // The fence review's ruling (point 1): the origin rides inside the body, beside the agents list, a key the registered
  // event types as unknown. A reader that does not know it, the event's own schema first (every build's window applies
  // it), reads past it and keeps it; the older builds' windows read `jobs` of the body and nothing else.
  it('carries the body’s origin beside the agents list, in its snapshot and its subagents messages, which the registered event keeps as it is', () => {
    const r = new Reshaper(ctx);
    const agent = { agentId: 'a0b1c2d3e4f500001', meta: { agentType: 'general-purpose' }, status: 'running' as const, evidence: 'rows' as const, startedAt: 'T1' };
    const [snapshot] = r.snapshot(snap(), { jobs: [], subagents: [agent], origin: 'terminal:4242' });
    expect(snapshot!.body).toEqual({ streaming: [], usage: null, jobs: [], subagents: [agent], origin: 'terminal:4242' });
    const message = r.subagents({ jobs: [], subagents: [agent], origin: 'background_job:4242:job-1' });
    expect(message.body).toEqual({ subagents: [agent], jobs: [], mcp: [], origin: 'background_job:4242:job-1' });
    const checked = validateEventPayload('laneA.plane', { appSessionId: 'app-1', watch: 'watch-1', messages: [snapshot!, message] });
    expect(checked.ok).toBe(true);
    expect((checked as { value: { messages: PlaneMessage[] } }).value.messages.map((m) => (m.body as { origin?: unknown }).origin)).toEqual(['terminal:4242', 'background_job:4242:job-1']);
  });

  it('closes a step at its end, and every step of a turn still open at its completion', () => {
    const r = new Reshaper(ctx);
    r.snapshot(snap());
    expect(r.event({ type: 'step', phase: 'start', turnId: 't1', agentId: null, step: 1 })).toEqual([]);
    expect(bodies(r.event({ type: 'step', phase: 'end', turnId: 't1', agentId: null, step: 1 }))).toEqual([{ turnId: 't1', agentId: null, step: 1 }]);
    r.event({ type: 'step', phase: 'start', turnId: 't1', agentId: null, step: 2 });
    r.event({ type: 'step', phase: 'start', turnId: 't1', agentId: 'a1', step: 1 });
    r.event({ type: 'step', phase: 'start', turnId: 't2', agentId: null, step: 1 });
    const out = r.event({ type: 'turn', phase: 'complete', turnId: 't1', agentId: null });
    expect(kinds(out)).toEqual(['step-end', 'step-end']);
    expect(bodies(out)).toEqual([{ turnId: 't1', agentId: null, step: 2 }, { turnId: 't1', agentId: 'a1', step: 1 }]);
    expect(r.event({ type: 'turn', phase: 'complete', turnId: 't1', agentId: null })).toEqual([]); // nothing left open
  });

  // P5 O9 (the sitting's fix wave): the bridge's own time of a step's end, which the renderer reads to place what an
  // interrupt cut in the disk turn running then (the engine stamps that turn's rows on the same clock)
  it('carries the bridge’s time on a step-end, from the step’s end or its turn’s completion', () => {
    const r = new Reshaper(ctx);
    r.snapshot(snap());
    r.event({ type: 'step', phase: 'start', turnId: 't1', agentId: null, step: 1, t: 100 });
    expect(bodies(r.event({ type: 'step', phase: 'end', turnId: 't1', agentId: null, step: 1, t: 200 }))).toEqual([{ turnId: 't1', agentId: null, step: 1, t: 200 }]);
    r.event({ type: 'step', phase: 'start', turnId: 't1', agentId: null, step: 2, t: 300 });
    expect(bodies(r.event({ type: 'turn', phase: 'complete', turnId: 't1', agentId: null, reason: 'aborted', t: 400 }))).toEqual([{ turnId: 't1', agentId: null, step: 2, t: 400 }]);
  });

  it('seeds its open steps from the snapshot, so a turn that aborts with no step end closes the step it never saw start', () => {
    const r = new Reshaper(ctx);
    r.snapshot(snap({ streaming: [{ turnId: 't9', agentId: null, step: 3, upTo: 0, blocks: [] }] }));
    expect(bodies(r.event({ type: 'turn', phase: 'complete', turnId: 't9', agentId: null, reason: 'aborted' }))).toEqual([{ turnId: 't9', agentId: null, step: 3 }]);
  });

  it('opens a step on a chunk whose start it missed', () => {
    const r = new Reshaper(ctx);
    r.snapshot(snap());
    r.event({ type: 'chunk', turnId: 't1', agentId: null, step: 4, chunkIndex: 0, chunk: {} });
    expect(bodies(r.event({ type: 'turn', phase: 'complete', turnId: 't1', agentId: null }))).toEqual([{ turnId: 't1', agentId: null, step: 4 }]);
  });

  it('makes usage, catalog, raised, settled, op and compact messages, and drops the kinds the plane has no use for', () => {
    const r = new Reshaper(ctx);
    r.snapshot(snap());
    expect(r.event({ type: 'usage', context: { tokens: 5, window: 10 }, cost: { usd: 1 }, t: 1 })[0]).toMatchObject({ kind: 'usage', sub: 'watch-1', body: { context: { tokens: 5, window: 10 }, cost: { usd: 1 } } });
    expect(r.event({ type: 'catalog', fingerprint: 'f', commands: [], models: { options: [], aliases: {} }, measured: 'M', t: 1 })[0]).toMatchObject({ kind: 'catalog', body: { fingerprint: 'f', commands: [], models: { options: [], aliases: {} }, measured: 'M' } });
    expect(r.event({ type: 'raised', request: 'q1', tool: 'AskUserQuestion', input: {}, agentId: 'a1', async: true })[0]).toEqual({
      project: '', machine: ctx.machine, session: 'sess-1', kind: 'raised', sub: null, n: null, body: { request: 'q1', session: 'sess-1', tool: 'AskUserQuestion', input: {}, agentId: 'a1', async: true },
    });
    expect(r.event({ type: 'settled', request: 'q1', winner: 'terminal', outcome: 'answered', by: 'terminal', t: 3 })[0]).toMatchObject({ kind: 'settled', sub: null, n: null, body: { request: 'q1', session: 'sess-1', winner: 'terminal', outcome: 'answered', by: 'terminal', t: 3 } });
    expect(r.event({ type: 'run', phase: 'start', id: 'cmd-1', name: 'rename', args: 'x' })[0]).toMatchObject({ kind: 'op', sub: null, body: { rpc: 'cmd-1', op: 'command', phase: 'start', id: 'cmd-1', name: 'rename', args: 'x' } });
    expect(r.event({ type: 'btw', phase: 'end', id: 'cmd-2', text: 'answer' })[0]).toMatchObject({ kind: 'op', body: { rpc: 'cmd-2', op: 'btw', phase: 'end', id: 'cmd-2', text: 'answer' } });
    expect(r.event({ type: 'media', phase: 'end', upload: 'up1', index: 0, state: 'read', attachments: [] })[0]).toMatchObject({ kind: 'op', body: { rpc: 'up1', op: 'media', phase: 'end', id: 'up1', upload: 'up1', index: 0, state: 'read' } });
    expect(r.event({ type: 'compact', phase: 'end', id: 'cmd-3', tokensBefore: 10, tokensAfter: 2 })[0]).toEqual({
      project: '', machine: ctx.machine, session: 'sess-1', kind: 'compact', sub: null, n: null, body: { rpc: 'cmd-3', phase: 'end', tokensBefore: 10, tokensAfter: 2 },
    });
    for (const type of ['model', 'delivered', 'heartbeat', 'agent', 'kept', 'result', 'command', 'session']) expect(r.event({ type, phase: 'start' }), type).toEqual([]);
    expect(r.event({ type: 'turn', phase: 'start', turnId: 't5', agentId: null })).toEqual([]);
  });

  it('reads a gap, or a snapshot or resync mid-stream, as a discontinuity', () => {
    const r = new Reshaper(ctx);
    r.snapshot(snap());
    expect(r.event({ type: 'gap', dropped: 3 })).toBe('discontinuity');
    expect(r.event({ type: 'resync' })).toBe('discontinuity');
    expect(r.event({ type: 'snapshot' })).toBe('discontinuity');
  });
});
