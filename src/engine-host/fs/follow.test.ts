import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, SessionId } from '@shared/graph/ids';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import { FIXTURE_DIR, TRANSCRIPT_FIXTURE_DIR } from '../../../test/support/fixtures';
import type { ReadRange } from '../../../test/support/memory-reader';
import { StoreFixture } from '../../../test/support/store-fixture';
import type { FileReader } from './chain-follower';
import { FsFileReader } from './follow';
import { FsService } from './service';
import { DEBOUNCE_MS, SETTLE_MS } from './watcher';

const S1 = '11111111-1111-4111-8111-111111111111';
const SIDECARS = join(FIXTURE_DIR, 'subagent-sidecars');
const WORKFLOW_DISK = join(FIXTURE_DIR, 'pass2/workflow-disk');

describe('the fs FileReader opens the file per read', () => {
  let fixture: StoreFixture;
  beforeEach(async () => {
    fixture = await StoreFixture.create();
  });
  afterEach(async () => {
    await fixture.dispose();
  });

  it('reports a missing or unlocated file as absent, reads exact ranges, and sees a rename-over as a new inode', async () => {
    let located: string | null = null;
    const reader = new FsFileReader(() => located);
    expect(await reader.stat()).toBeNull(); // not located yet: a MAWS-launched session before its first record
    located = `${fixture.paths.projects}/-work-a/${S1}.jsonl`;
    expect(await reader.stat()).toBeNull(); // located, not written yet

    const path = await fixture.addTranscript('/work/a', S1, ['{"a":1}', '{"b":2}']);
    expect(path).toBe(located);
    const first = await reader.stat();
    expect(first).toEqual({ ino: expect.any(Number), size: 16 });
    expect((await reader.read(8, 8)).toString()).toBe('{"b":2}\n');
    expect((await reader.read(13, 100)).toString()).toBe('2}\n'); // a read past the end returns what there is

    await fixture.rewriteFile(path, ['{"c":3}']);
    const second = await reader.stat();
    expect(second?.ino).not.toBe(first?.ino);
    expect(second?.size).toBe(8);
  });
});

// ---- following through the service (M3 pins) ------------------------------------------------------------------------

const REWIND = 'bdb23713-2f6c-40f3-8b18-b41a667a64e3' as SessionId;
const REWIND_DIR = '/private/tmp/maws-probe2-FIiJVW';
const PARENT = '9a1d4262-0b43-46ad-acb9-5982f31d209c' as SessionId;
const APP = 'app-rewind' as AppSessionId;
const rewindLines = readFileSync(join(TRANSCRIPT_FIXTURE_DIR, 'rewind-real.jsonl'), 'utf8').split('\n').filter((line) => line.length > 0);
const lineOf = (prefix: string) => rewindLines.findIndex((line) => line.includes(`"uuid":"${prefix}`));

type Emitted = { [N in EventName]: { name: N; payload: EventPayload<N> } }[EventName];

// The real `fs` reader with every stat and read recorded, so the tailer's reads can be asserted on the real file.
class RecordingReader implements FileReader {
  readonly ranges: ReadRange[] = [];
  stats = 0;
  private readonly inner: FsFileReader;
  constructor(locate: () => string | null) {
    this.inner = new FsFileReader(locate);
  }
  get path() {
    return this.inner.path;
  }
  stat() {
    this.stats += 1;
    return this.inner.stat();
  }
  read(offset: number, length: number) {
    this.ranges.push({ offset, length });
    return this.inner.read(offset, length);
  }
  // The tailer's invariant over the whole backfill: contiguous, ascending, disjoint, union exactly [0, size).
  assertContiguousTo(size: number) {
    let next = 0;
    for (const range of this.ranges) {
      expect(range.offset).toBe(next);
      next += range.length;
    }
    expect(next).toBe(size);
  }
}

describe('a followed session backfills, then tails its transcript', () => {
  let fixture: StoreFixture;
  let service: FsService | null;
  let emitted: Emitted[];
  let readers: RecordingReader[];
  beforeEach(async () => {
    fixture = await StoreFixture.create();
    service = null;
    emitted = [];
    readers = [];
  });
  afterEach(async () => {
    service?.stop();
    await fixture.dispose();
  });

  const start = async (options: { reconcileMs?: number } = {}) => {
    service = new FsService({
      paths: fixture.paths,
      emit: (name, payload) => {
        const checked = validateEventPayload(name, payload);
        if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
        emitted.push({ name, payload } as Emitted);
      },
      openReader: (locate) => {
        const reader = new RecordingReader(locate);
        readers.push(reader);
        return reader;
      },
      reconcileMs: options.reconcileMs,
    });
    await service.start();
    await settled();
    return service;
  };
  const events = <N extends EventName>(name: N) => emitted.filter((e) => e.name === name).map((e) => e.payload as EventPayload<N>);
  const delivered = (app: AppSessionId = APP) => events('session.eventBatch').filter((b) => b.appSessionId === app).flatMap((b) => b.events);
  const lastState = (app: AppSessionId = APP, agentId: string | null = null) => events('fs.followState').filter((s) => s.appSessionId === app && s.agentId === agentId).at(-1);
  const settled = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS + DEBOUNCE_MS + 50));
  const ids = (list: SessionEvent[]) => list.map((e) => e.id);

  it('backfills 26 lines, shrinks at the rewound anchor, and rejoins the continuation with no boundary', async () => {
    const path = await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines.slice(0, 26));
    const fs = await start();
    fs.bind([{ sessionId: REWIND, appSessionId: APP }]);

    const snapshot = await fs.eventsSnapshot(APP, null);
    expect(snapshot.complete).toBe(true);
    const backfill = lastState();
    expect(backfill).toMatchObject({ state: 'following', leafUuid: expect.stringMatching(/^57525d04/), gap: null });
    expect(ids(delivered())).toEqual(ids(snapshot.events));
    expect(delivered().some((e) => e.kind === 'assistant.block.complete' && e.messageUuid.startsWith('57525d04'))).toBe(true);
    const states = events('fs.followState').map((s) => s.state);
    expect(states.indexOf('following')).toBeGreaterThan(states.indexOf('backfilling'));

    const anchorAt = Date.now();
    await fixture.appendLines(path, [rewindLines[26]]);
    await expect.poll(() => delivered().some((e) => e.kind === 'boundary.rewind'), { interval: 5, timeout: 1000 }).toBe(true);
    expect(Date.now() - anchorAt).toBeLessThan(300);
    const rewind = delivered().find((e) => e.kind === 'boundary.rewind');
    expect(rewind).toMatchObject({ precedingAssistantUuid: expect.stringMatching(/^edf0f954/), prefillText: 'Also remember the word BANANA. Reply OK.' });
    await expect.poll(() => lastState()?.chainLength).toBe(backfill!.chainLength - 3);

    await fixture.appendLines(path, rewindLines.slice(27));
    await expect.poll(() => lastState()?.leafUuid).toMatch(/^7c05f769/);
    const all = delivered();
    expect(all.filter((e) => e.kind === 'boundary.rewind')).toHaveLength(1);
    expect(all.filter((e) => e.kind === 'boundary.retraction' || e.kind === 'notice.posted')).toEqual([]);
    expect(new Set(ids(all)).size).toBe(all.length);
  });

  it('delivers a record split across two writes once, reading exactly the two appended ranges; a reconcile poke on an unchanged file reads nothing', async () => {
    const path = await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines);
    const fs = await start({ reconcileMs: 40 });
    fs.bind([{ sessionId: REWIND, appSessionId: APP }]);
    await fs.eventsSnapshot(APP, null);
    const reader = readers[0];
    const size = statSync(path).size;
    reader.assertContiguousTo(size);

    // Unchanged file: the reconcile timer stats it and reads nothing.
    reader.ranges.length = 0;
    const stats = reader.stats;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(reader.stats).toBeGreaterThan(stats + 2);
    expect(reader.ranges).toEqual([]);

    const leaf = lastState()!.leafUuid!;
    const record = Buffer.from(
      JSON.stringify({ type: 'assistant', uuid: 'c4-m3-split', parentUuid: leaf, timestamp: '2026-09-28T10:00:00.000Z', message: { id: 'msg_split', model: 'm', content: [{ type: 'text', text: 'split in two' }] } }) + '\n',
    );
    const cut = 40;
    const before = delivered().length;
    await fixture.appendBytes(path, record.subarray(0, cut));
    await expect.poll(() => reader.ranges.length).toBe(1);
    expect(delivered().length).toBe(before);
    await fixture.appendBytes(path, record.subarray(cut));
    await expect.poll(() => delivered().length).toBe(before + 1);
    expect(delivered().at(-1)).toMatchObject({ kind: 'assistant.block.complete', messageUuid: 'c4-m3-split' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(delivered().length).toBe(before + 1);
    expect(reader.ranges).toEqual([
      { offset: size, length: cut },
      { offset: size + cut, length: record.length - cut },
    ]);
  });

  it('reloads a rewritten transcript (the GC shape) to the same chain with no duplicate event ids', async () => {
    const path = await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines);
    const fs = await start();
    fs.bind([{ sessionId: REWIND, appSessionId: APP }]);
    await fs.eventsSnapshot(APP, null);
    const before = lastState()!;
    expect(before.leafUuid).toMatch(/^7c05f769/);
    const count = events('fs.followState').length;

    const abandoned = new Set([lineOf('36a2aa44'), lineOf('57525d04')]);
    await fixture.rewriteFile(path, rewindLines.filter((_, i) => !abandoned.has(i)));
    await expect.poll(() => events('fs.followState').slice(count).map((s) => s.state)).toEqual(['reloading', 'following']);
    expect(lastState()).toMatchObject({ chainLength: before.chainLength, leafUuid: before.leafUuid });
    const all = delivered();
    expect(new Set(ids(all)).size).toBe(all.length);
    expect(all.filter((e) => e.kind === 'boundary.retraction')).toEqual([]);
  });

  it('answers a second snapshot while following with every event once and complete, and stops on fs.unfollow', async () => {
    const path = await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines);
    const fs = await start();
    fs.bind([{ sessionId: REWIND, appSessionId: APP }]);
    const first = await fs.eventsSnapshot(APP, null);
    const second = await fs.eventsSnapshot(APP, null);
    expect(second.complete).toBe(true);
    expect(ids(second.events)).toEqual(ids(first.events));
    expect(new Set(ids(second.events)).size).toBe(second.events.length);
    expect(events('fs.followState').filter((s) => s.state === 'backfilling')).toHaveLength(1); // one follower
    expect(fs.state().followed).toEqual([{ appSessionId: APP, agentId: null }]);

    await fs.unfollow(APP, null);
    expect(lastState()?.state).toBe('stopped');
    expect(fs.state().followed).toEqual([]);
    const count = emitted.length;
    await fixture.appendLines(path, [JSON.stringify({ type: 'user', uuid: 'after', parentUuid: lastState()!.leafUuid, message: { role: 'user', content: 'x' } })]);
    await settled();
    expect(emitted.slice(count).filter((e) => e.name === 'session.eventBatch' || e.name === 'fs.followState')).toEqual([]);
  });

  it('follows an app session whose transcript does not exist yet, and picks it up when it appears', async () => {
    const fs = await start();
    fs.bind([{ sessionId: REWIND, appSessionId: APP }]);
    expect(await fs.eventsSnapshot(APP, null)).toEqual({ events: [], complete: true });
    await fixture.addTranscript(REWIND_DIR, REWIND, rewindLines);
    await expect.poll(() => lastState()?.leafUuid).toMatch(/^7c05f769/);
    expect(delivered().length).toBeGreaterThan(5);
  });

  it('refuses every fs.* command for an app session id main has not bound', async () => {
    const fs = await start();
    const unknown = 'app-unbound' as AppSessionId;
    const message = 'unknown app session: app-unbound';
    await expect(fs.eventsSnapshot(unknown, null)).rejects.toThrow(message);
    await expect(fs.unfollow(unknown, null)).rejects.toThrow(message);
    await expect(fs.subagents(unknown)).rejects.toThrow(message);
    await expect(fs.agentEvents(unknown, 'a1' as AgentId)).rejects.toThrow(message);
    await expect(fs.workflows(unknown)).rejects.toThrow(message);
  });

  it('lists subagents as their sidecars appear, parses a meta written late, and follows an agent with its attribution', async () => {
    const parentLines = readFileSync(join(TRANSCRIPT_FIXTURE_DIR, 'subagent-parent.jsonl'), 'utf8').split('\n').filter(Boolean);
    const parent = await fixture.addTranscript('/private/tmp/maws-probe-WmHZ2j', PARENT, parentLines);
    const fs = await start();
    const app = 'app-parent' as AppSessionId;
    fs.bind([{ sessionId: PARENT, appSessionId: app }]);
    const agentId = 'ad286defbc77bc090' as AgentId;

    await fixture.addSidecar(PARENT, `subagents/agent-${agentId}.jsonl`, readFileSync(join(SIDECARS, `agent-${agentId}.jsonl`), 'utf8'));
    await expect.poll(() => events('fs.subagentsChanged').at(-1)?.agents.map((a) => a.agentId)).toEqual([agentId]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await fixture.addSidecar(PARENT, `subagents/agent-${agentId}.meta.json`, readFileSync(join(SIDECARS, `agent-${agentId}.meta.json`), 'utf8'));
    await expect.poll(() => events('fs.subagentsChanged').at(-1)?.agents[0].meta?.toolUseId).toBe('toolu_01CYiK6ncgQLFUQ2iqC1b4oB');
    expect(events('fs.subagentsChanged').at(-1)).toMatchObject({
      appSessionId: app,
      agents: [{ agentId, runId: null, transcriptPath: join(dirname(parent), PARENT, 'subagents', `agent-${agentId}.jsonl`) }],
    });
    expect((await fs.subagents(app)).agents.map((a) => a.agentId)).toEqual([agentId]);

    const child = await fs.agentEvents(app, agentId);
    expect(child.complete).toBe(true);
    expect(child.events.length).toBeGreaterThan(5);
    for (const event of child.events) expect([event.agentId, event.parentToolUseId]).toEqual([agentId, 'toolu_01CYiK6ncgQLFUQ2iqC1b4oB']);
    expect(delivered(app).every((e) => e.agentId === agentId)).toBe(true);
    expect(lastState(app, agentId)).toMatchObject({ state: 'following' });
    await expect(fs.agentEvents(app, 'no-such-agent' as AgentId)).rejects.toThrow('unknown agent: no-such-agent');

    // The parent's backfill starts the listed agent through the sidecar meta.
    const parentEvents = (await fs.eventsSnapshot(app, null)).events;
    expect(parentEvents.flatMap((e) => (e.kind === 'subagent.started' ? [e.taskId] : []))).toEqual([agentId]);
    expect(fs.state().followed).toEqual(expect.arrayContaining([{ appSessionId: app, agentId }, { appSessionId: app, agentId: null }]));
    await fs.unfollow(app, null); // the session and its agents
    expect(fs.state().followed).toEqual([]);
  });

  it('reads workflow runs, and a followed session emits one workflow.progress per snapshot change', async () => {
    const session = 'bac6130b-8eb8-499e-aeb1-89e7624a52cd' as SessionId;
    const app = 'app-workflow' as AppSessionId;
    await fixture.addTranscript('/private/tmp/maws-probe2-1RzDNs', session, [
      JSON.stringify({ type: 'user', uuid: 'w1', parentUuid: null, cwd: '/private/tmp/maws-probe2-1RzDNs', message: { role: 'user', content: 'run it' } }),
    ]);
    const fs = await start();
    fs.bind([{ sessionId: session, appSessionId: app }]);
    await fs.eventsSnapshot(app, null);

    const run = 'wf_7cacbb2d-902';
    const snapshot = readFileSync(join(WORKFLOW_DISK, `${run}.json`), 'utf8');
    await fixture.addSidecar(session, `subagents/workflows/${run}/journal.jsonl`, readFileSync(join(WORKFLOW_DISK, 'journal.jsonl'), 'utf8'));
    await fixture.addSidecar(session, `subagents/workflows/${run}/agent-a014f6be436bed86b.meta.json`, readFileSync(join(WORKFLOW_DISK, 'agent-a014f6be436bed86b.meta.json'), 'utf8'));
    await fixture.addSidecar(session, `workflows/scripts/maws-probe-${run}.js`, readFileSync(join(WORKFLOW_DISK, `maws-probe-${run}.js`), 'utf8'));
    await fixture.addSidecar(session, `workflows/${run}.json`, snapshot);
    await expect.poll(() => delivered(app).filter((e) => e.kind === 'workflow.progress')).toHaveLength(1);
    await expect.poll(() => events('fs.workflowChanged')).toContainEqual({ appSessionId: app, runId: run });
    const progress = delivered(app).find((e) => e.kind === 'workflow.progress');
    expect(progress).toMatchObject({ taskId: 'wayue3on6', workflowName: 'maws-probe', progress: JSON.parse(snapshot).workflowProgress });

    const { runs } = await fs.workflows(app);
    expect(runs).toHaveLength(1);
    expect(runs[0].snapshot?.agentCount).toBe(2);
    expect(runs[0].journal).toHaveLength(5);

    // A rewrite that changes nothing a consumer sees emits no second progress; one that advances it does.
    await fixture.addSidecar(session, `workflows/${run}.json`, snapshot);
    await settled();
    expect(delivered(app).filter((e) => e.kind === 'workflow.progress')).toHaveLength(1);
    await fixture.addSidecar(session, `workflows/${run}.json`, { ...JSON.parse(snapshot), workflowProgress: [] });
    await expect.poll(() => delivered(app).filter((e) => e.kind === 'workflow.progress')).toHaveLength(2);
    const [firstId, secondId] = delivered(app).flatMap((e) => (e.kind === 'workflow.progress' ? [e.id] : []));
    expect(secondId).not.toBe(firstId);
    // Back to the first progress: a new occurrence of its id, never the same id twice in one follow.
    await fixture.addSidecar(session, `workflows/${run}.json`, snapshot);
    await expect.poll(() => delivered(app).flatMap((e) => (e.kind === 'workflow.progress' ? [e.id] : []))).toEqual([firstId, secondId, `${firstId}@2`]);
    const second = await fs.eventsSnapshot(app, null);
    expect(second.events.filter((e) => e.kind === 'workflow.progress')).toHaveLength(3); // the snapshot carries them too
  });

  it('tells main a task list changed and reads it on request', async () => {
    const fs = await start();
    await fixture.addTask('team-a', { id: '1', subject: 'One', description: 'd', status: 'pending', blocks: [], blockedBy: [] });
    await expect.poll(() => events('fs.tasksChanged')).toContainEqual({ listId: 'team-a' });
    expect((await fs.tasks('team-a')).tasks.map((t) => t.subject)).toEqual(['One']);
  });
});
