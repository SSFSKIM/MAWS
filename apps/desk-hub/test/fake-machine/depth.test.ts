// The fake machine's producer (fake-machine/session.ts) on its own, no hub: DX4's rules over the committed recording
// (a real haiku session through DC2's bridge) and over one synthesized from its transcripts. A reader subscribed before
// anything played sees everything live; one that subscribes later, with the replay racing its snapshot and the live
// part handed what the snapshot holds, must end with the same rows and the same text in every block it saw stream.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRecording, TWO_SUBAGENTS, type Recording, type Step } from '../../fake-machine';
import { SessionDepth } from '../../fake-machine/session';
import type { SessionMessage } from '../../src/protocol/session';
import { Dx4Reader } from '../support/dx4-reader';

const where = { project: '6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f', machine: 'fake' };

/** A session depth over `recording`, whose messages go to the reader holding each sub. */
function depthOf(recording: Recording) {
  const readers = new Map<string, Dx4Reader>();
  const sent: SessionMessage[] = [];
  const depth = new SessionDepth(recording.session, recording, (m) => {
    sent.push(m);
    if (m.sub) readers.get(m.sub)?.read(m);
  }, where);
  let cursor = 0;
  const play = (until?: (s: Step) => boolean) => {
    while (cursor < recording.steps.length) {
      const step = recording.steps[cursor++];
      depth.apply(step);
      if (until?.(step)) return step;
    }
    return null;
  };
  const reader = async (sub: string, agentId: string | null, options = {}) => {
    const r = new Dx4Reader(agentId);
    readers.set(sub, r);
    await depth.subscribe(sub, agentId, options);
    return r;
  };
  const stepTo = (index: number) => {
    while (cursor < index) depth.apply(recording.steps[cursor++]);
  };
  return { depth, play, reader, sent, steps: recording.steps, step: () => depth.apply(recording.steps[cursor++]), stepTo };
}

const recording = loadRecording(TWO_SUBAGENTS);
const agents = Object.keys(recording.rows.agents);

describe('the committed recording', () => {
  it('is a real session: bridge chunks, two subagents, a permission and a question answered from the web, an aborted turn', () => {
    expect(recording.chunks).toBe('bridge');
    expect(agents).toHaveLength(2);
    expect(Object.keys(recording.meta).sort()).toEqual([...agents].sort());
    const raised = recording.steps.filter((s) => s.k === 'raised');
    expect(raised.map((s) => s.k === 'raised' && s.draft.tool)).toEqual(['Bash', 'AskUserQuestion']);
    const settled = recording.steps.flatMap((s) => (s.k === 'settled' ? [s.draft] : []));
    expect(settled.map((s) => [s.winner, s.outcome, s.by])).toEqual([
      ['web', 'allow', recording.member],
      ['web', 'answered', recording.member],
    ]);
    expect(recording.steps.some((s) => s.k === 'turn-end' && s.agentId === null && s.reason === 'aborted')).toBe(true);
    expect(recording.steps.some((s) => s.k === 'log' && s.event.kind === 'message')).toBe(true);
  });
});

describe('a subscription to the replay', () => {
  it('from the start reproduces the transcript, each subagent’s, and a step-end after every block-row of its step', async () => {
    const t = depthOf(recording);
    const main = await t.reader('main', null);
    // An agent's subscription opens once the tree shows it, as a browser's does.
    const subs: Dx4Reader[] = [];
    for (const a of agents) {
      t.play((s) => s.k === 'agent' && s.agentId === a);
      subs[agents.indexOf(a)] = await t.reader(`agent-${a}`, a);
    }
    t.play();
    expect(main.faults).toEqual([]);
    expect(main.uuids).toEqual(recording.rows.main.map((r) => r.uuid));
    for (const [i, a] of agents.entries()) {
      expect(subs[i].faults).toEqual([]);
      expect(subs[i].uuids).toEqual(recording.rows.agents[a].map((r) => r.uuid));
    }
    // Nothing is left drawn as streaming once the session is idle.
    expect([...main.partial.keys()]).toEqual([]);
    // Every step's block-rows precede its step-end, in every subscription.
    const order = t.sent.filter((m) => m.sub === 'main' && (m.kind === 'block-row' || m.kind === 'step-end'));
    const ended = new Set<string>();
    for (const m of order) {
      const b = m.body as { turnId: string; agentId: string | null; step: number };
      const key = `${b.turnId}/${b.agentId}/${b.step}`;
      if (m.kind === 'step-end') ended.add(key);
      else expect(ended.has(key), `a block-row after its step's end (${key})`).toBe(false);
    }
    // The main scope carries the subagents' stream and its tree; an agent's carries its own stream only.
    expect(t.sent.some((m) => m.sub === 'main' && m.kind === 'chunk' && m.body.agentId !== null)).toBe(true);
    expect(t.sent.filter((m) => m.sub === 'main' && m.kind === 'subagents').at(-1)?.body).toEqual({ subagents: agents.map((a) => ({ agentId: a, meta: recording.meta[a] })) });
    expect(t.sent.some((m) => m.sub === `agent-${agents[0]}` && m.kind === 'chunk' && m.body.agentId !== agents[0])).toBe(false);
    expect(t.sent.some((m) => m.sub === 'main' && m.kind === 'usage')).toBe(true);
    expect(t.sent.some((m) => m.sub !== 'main' && m.kind === 'usage')).toBe(false);
  });

  it('taken mid-response, with the replay racing its snapshot and the live part handed what the snapshot holds, ends with no gap and no duplicated text', async () => {
    // A reference that saw everything live, and a race at every 10th chunk of the main loop.
    const chunkAt = recording.steps.flatMap((s, i) => (s.k === 'chunk' && s.agentId === null && s.chunk.kind === 'text' ? [i] : []));
    for (const at of chunkAt.filter((_, i) => i % 10 === 5)) {
      const t = depthOf(recording);
      const reference = await t.reader('ref', null);
      for (let i = 0; i < at; i++) t.step();
      const late = await t.reader('late', null, { overlap: true, duringSnapshot: async () => void t.step() });
      const lateAgent = await t.reader('late-agent', agents[1], { overlap: true, duringSnapshot: async () => void t.step() });
      t.play();
      expect(late.faults).toEqual([]);
      expect(lateAgent.faults).toEqual([]);
      expect(late.uuids).toEqual(reference.uuids);
      expect(lateAgent.uuids).toEqual(recording.rows.agents[agents[1]].map((r) => r.uuid));
      // A block the late reader saw streaming carries exactly the reference's text: nothing missed, nothing twice.
      expect(late.assembled.size).toBeGreaterThan(0);
      for (const [id, text] of late.assembled) expect(text, id).toBe(reference.assembled.get(id));
    }
  });

  it('taken while a subagent streams, with the replay racing its snapshot, ends with no gap and no duplicated text in that agent’s scope', async () => {
    const agent = agents[1];
    const agentChunks = recording.steps.flatMap((s, i) => (s.k === 'chunk' && s.agentId === agent && s.chunk.kind !== 'stop' ? [i] : []));
    expect(agentChunks.length).toBeGreaterThan(1);
    for (const at of agentChunks.slice(1)) {
      const t = depthOf(recording);
      t.play((s) => s.k === 'agent' && s.agentId === agent);
      const reference = await t.reader('ref', agent);
      t.stepTo(at);
      const late = await t.reader('late', agent, { overlap: true, duringSnapshot: async () => void t.step() });
      const snapshot = t.sent.find((m) => m.sub === 'late' && m.kind === 'snapshot');
      expect(snapshot?.kind === 'snapshot' && snapshot.body.streaming.map((m) => m.agentId)).toEqual([agent]);
      t.play();
      expect(late.faults).toEqual([]);
      expect(late.uuids).toEqual(reference.uuids);
      for (const [id, text] of late.assembled) expect(text, id).toBe(reference.assembled.get(id));
    }
  });

  it('drops an aborted block that never got a block-row at its step’s end, from the reader and from every later snapshot', async () => {
    const turnId = 't-aborted';
    const aborted: Recording = {
      ...recording,
      rows: { main: [], agents: {} },
      steps: [
        { at: 0, k: 'turn-start', turnId, agentId: null },
        { at: 1, k: 'step-start', turnId, agentId: null, step: 0 },
        { at: 2, k: 'chunk', turnId, agentId: null, step: 0, chunkIndex: 0, chunk: { kind: 'text', index: 0, text: 'Hel' } },
        { at: 3, k: 'chunk', turnId, agentId: null, step: 0, chunkIndex: 1, chunk: { kind: 'text', index: 0, text: 'lo' } },
        { at: 4, k: 'step-end', body: { turnId, agentId: null, step: 0 } },
        { at: 5, k: 'turn-end', turnId, agentId: null, reason: 'aborted' },
      ],
    };
    const t = depthOf(aborted);
    t.step();
    t.step();
    t.step();
    const during = await t.reader('during', null);
    expect([...during.partial.values()].map((b) => b.text)).toEqual(['Hel']);
    t.play();
    expect(during.partial.size).toBe(0);
    expect(during.assembled.get(`${turnId}//0#0`)).toBe('Hello');
    const after = await t.reader('after', null);
    const snapshot = t.sent.find((m) => m.sub === 'after' && m.kind === 'snapshot');
    expect(snapshot?.kind === 'snapshot' && snapshot.body.streaming).toEqual([]);
    expect(during.faults).toEqual([]);
    expect(after.faults).toEqual([]);
  });

  it('drops a block from the snapshot at its block-row, and its whole message at its step’s end, aborted or not', async () => {
    const t = depthOf(recording);
    // The interrupted turn: stop right after its first text chunk, take a snapshot that shows it streaming.
    const aborted = recording.steps.find((s) => s.k === 'turn-end' && s.agentId === null && s.reason === 'aborted') as Extract<Step, { k: 'turn-end' }>;
    t.play((s) => s.k === 'chunk' && s.turnId === aborted.turnId && s.chunk.kind === 'text');
    const during = await t.reader('during', null);
    const snapshot = t.sent.find((m) => m.sub === 'during' && m.kind === 'snapshot');
    expect(snapshot?.kind === 'snapshot' && snapshot.body.streaming.map((m) => m.turnId)).toEqual([aborted.turnId]);
    t.play((s) => s.k === 'step-end' && s.body.turnId === aborted.turnId);
    const after = await t.reader('after', null);
    const later = t.sent.find((m) => m.sub === 'after' && m.kind === 'snapshot');
    expect(later?.kind === 'snapshot' && later.body.streaming).toEqual([]);
    expect([...during.partial.keys()]).toEqual([]);
    expect(during.faults).toEqual([]);
    expect(after.faults).toEqual([]);
  });

  it('settles a subagent’s block at once in a main-scope subscription, which never carries the subagent’s rows', async () => {
    const t = depthOf(recording);
    const main = await t.reader('main', null);
    t.play();
    const agentRows = new Set(agents.flatMap((a) => recording.rows.agents[a].map((r) => r.uuid)));
    expect(main.uuids.some((u) => agentRows.has(u))).toBe(false);
    const agentBlockRows = t.sent.filter((m) => m.sub === 'main' && m.kind === 'block-row' && m.body.agentId !== null);
    expect(agentBlockRows.length).toBeGreaterThan(0);
    expect([...main.partial.keys()]).toEqual([]);
  });

  it('pages older rows newest first, and ends a subscription at the next n, or at n 0 for an unknown subagent', async () => {
    const t = depthOf(recording);
    t.play();
    const r = await t.reader('s', null, { budget: 64 * 1024 });
    const snapshot = t.sent.find((m) => m.sub === 's' && m.kind === 'snapshot')!;
    if (snapshot.kind !== 'snapshot') throw new Error('no snapshot');
    expect(snapshot.body.more).toBe(true); // the budget is smaller than the recording's transcript
    const oldest = snapshot.body.rows.at(-1)!;
    t.depth.page('s', String(oldest.uuid), 1000);
    const page = t.sent.find((m) => m.sub === 's' && m.kind === 'rows');
    expect(page?.kind === 'rows' && [...page.body.rows].reverse().concat([...snapshot.body.rows].reverse()).map((x) => x.uuid)).toEqual(recording.rows.main.map((x) => x.uuid));
    t.depth.end('s', 'discontinuity');
    expect(r.ended).toEqual({ reason: 'discontinuity', n: 2 });
    const none = await t.reader('none', 'a-missing-agent');
    expect(none.ended).toEqual({ reason: 'error', n: 0 });
  });
});

describe('the reader the suites check the stream with', () => {
  it('keeps a paired block drawn past its step’s end until the row its block-row named arrives', () => {
    const r = new Dx4Reader(null);
    const env = { project: where.project, machine: where.machine, session: 's', sub: 'x' } as const;
    const m = { turnId: 't', agentId: null, step: 0 };
    r.read({ ...env, kind: 'snapshot', n: 0, body: { rows: [], more: false, subagents: [], presence: { record: null, bridge: true }, streaming: [] } });
    r.read({ ...env, kind: 'chunk', n: 1, body: { ...m, chunkIndex: 0, chunk: { kind: 'text', index: 0, text: 'Hi' } } });
    r.read({ ...env, kind: 'chunk', n: 2, body: { ...m, chunkIndex: 1, chunk: { kind: 'text', index: 1, text: 'cut' } } });
    r.read({ ...env, kind: 'block-row', n: 3, body: { ...m, uuid: 'u0', index: 0 } });
    r.read({ ...env, kind: 'step-end', n: 4, body: m });
    expect([...r.partial.keys()]).toEqual(['t//0#0']); // the unpaired block 1 is dropped; block 0 waits for its row
    r.read({ ...env, kind: 'row', n: 5, body: { row: { uuid: 'u0', type: 'assistant' }, agentId: null } });
    expect(r.partial.size).toBe(0);
    expect(r.faults).toEqual([]);
  });
});

describe('a recording without the bridge’s stream', () => {
  it('has its chunks synthesized from the transcript, and replays to the same rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-synth-'));
    try {
      cpSync(TWO_SUBAGENTS, dir, { recursive: true });
      rmSync(join(dir, 'events.jsonl'));
      const synthesized = loadRecording(dir);
      expect(synthesized.chunks).toBe('synthesized');
      const t = depthOf(synthesized);
      const main = await t.reader('main', null);
      t.play((s) => s.k === 'agent' && s.agentId === agents[0]);
      const agent = await t.reader('agent', agents[0]);
      t.play();
      expect(main.faults).toEqual([]);
      expect(main.uuids).toEqual(recording.rows.main.map((r) => r.uuid));
      expect(agent.uuids).toEqual(recording.rows.agents[agents[0]].map((r) => r.uuid));
      // The streamed text of each text block is its row's text.
      const text = recording.rows.main
        .filter((r) => r.type === 'assistant')
        .flatMap((r) => (r.message as { content: Array<{ type: string; text?: string }> }).content.filter((b) => b.type === 'text').map((b) => b.text));
      expect(text.length).toBeGreaterThan(0);
      const streamed = [...main.assembled.values()];
      for (const t of text.filter((x) => x && x.length > 20)) expect(streamed).toContain(t);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
