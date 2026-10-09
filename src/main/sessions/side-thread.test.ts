// A side thread opened from a comment or from answered side questions (E3 execution document, Design §3, §5 and §9):
// C10's fork path with a guard of its own (a running turn does not refuse it), lineage from the intent, the anchored
// first message, the thread named by its anchor, and `side.thread.opened` in the parent's stream; and C10's own Fork
// now carrying `fork` lineage.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anchoredMessage, promotionMessage } from '@shared/anchor/message';
import type { Anchor } from '@shared/anchor/anchor';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import { sessionIdFor, summary } from '../../../test/support/index-fixture';
import { SessionHarness } from '../../../test/support/session-harness';
import { InvalidSideInput } from '../side/invalid';
import { ScreenshotRefused } from '../side/screenshot';

vi.mock('electron', () => {
  throw new Error('SessionService must not load Electron');
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const SID = sessionIdFor(0x5e);
const TURN = { id: 'x', origin: 'human', startedAt: '', acceptedAt: null, userMessageUuids: [] } as never;

describe('side threads', () => {
  let h: SessionHarness;
  let anchor: Anchor;
  beforeEach(async () => {
    h = await new SessionHarness().start();
    anchor = { kind: 'file-line', locator: `${h.work}/src/x.ts#L42`, label: 'src/x.ts:42', path: `${h.work}/src/x.ts`, line: 42 };
  });
  afterEach(() => h.dispose());

  const parentRecord = (title: string | null = 'Plan') => {
    h.trustDirectory(h.work);
    const record = h.index.sessions.upsertFromSummary(summary({ sessionId: SID, directory: h.work, customTitle: title })).record;
    h.writeTranscript(h.work, SID);
    return record;
  };
  const sent = (appSessionId: string) => h.host.calls.filter((c) => c.name === 'session.send' && (c.input as { appSessionId: string }).appSessionId === appSessionId).map((c) => (c.input as { content: unknown }).content);
  const parentEvents = (parent: AppSessionId) =>
    h.events.filter((e) => e.name === 'session.eventBatch' && (e.payload as { appSessionId: string }).appSessionId === parent).flatMap((e) => (e.payload as { events: SessionEvent[] }).events);

  it('forks a parent mid-turn (C10’s Fork still refuses it busy), with lineage, the anchored first message and the thread named by its label', async () => {
    const parent = parentRecord();
    h.host.reserve(parent.appId, { cwd: h.work, turn: TURN });
    expect(await h.service.fork(parent.appId, { kind: 'inPlace' }, { message: null, rewindTo: null })).toMatchObject({ status: 'refused', reason: 'busy' });

    const withShot = { ...anchor, screenshot: { path: '/elsewhere/shot.png', width: 2, height: 2 } }; // a producer's stray field: never used
    const outcome = await h.service.openSideThread(parent.appId, { kind: 'comment', anchor: withShot, text: '  Why is this null-checked twice? ', screenshot: null });
    expect(outcome).toMatchObject({ status: 'starting' });
    const child = outcome.appSessionId;
    expect(await h.settled(child)).toMatchObject({ phase: 'ready', outcome: { firstTurn: 'sent' } });

    const spec = h.host.launches.find((s: LaunchSpec) => s.appSessionId === child)!;
    expect(spec).toMatchObject({ cwd: h.work, resume: { sessionId: SID, fork: true }, inheritGrantsFrom: parent.appId });
    const text = anchoredMessage({ anchor, text: 'Why is this null-checked twice?', destination: 'thread', screenshot: false });
    expect(sent(child)).toEqual([[{ type: 'text', text }]]);
    const lineage = { kind: 'side-thread', parentAppSessionId: parent.appId, parentEngineSessionId: SID, anchor, openedBy: 'comment' };
    expect(h.index.sessions.get(child)!.lineage).toEqual(lineage);
    expect(h.host.calledWith('session.renameSession')).toEqual([{ appSessionId: child, title: 'src/x.ts:42' }]);
    // M5: until the engine's title is read back, the record is titled by the same name, never by the anchored prompt
    expect(h.index.sessions.get(child)!.title).toEqual({ text: 'src/x.ts:42', source: 'none' });

    const opened = parentEvents(parent.appId);
    expect(opened).toEqual([
      {
        id: `${parent.appId}:side-thread:${child}:opened`, sessionId: SID, at: h.index.sideThreads.get(child)!.openedAt, seq: null, agentId: null, parentToolUseId: null,
        kind: 'side.thread.opened', childAppSessionId: child, childEngineSessionId: h.index.sessions.get(child)!.engineSessionId, anchor, openedBy: 'comment',
      },
    ]);
    expect(h.index.sideThreads.of(parent.appId).map((row) => row.childAppSessionId)).toEqual([child]);
    expect(h.host.calledWith('session.send').filter((c) => (c as { appSessionId: string }).appSessionId === parent.appId)).toEqual([]); // the main conversation got nothing
  });

  it('continues answered side questions as a thread titled "Side question", with the promotion as its first prompt', async () => {
    const parent = parentRecord();
    const exchanges = [{ question: 'What word did I ask you to remember?', response: 'ZEBRA' }];
    const outcome = await h.service.openSideThread(parent.appId, { kind: 'btw', exchanges, text: 'Spell it backwards.' });
    const child = outcome.appSessionId;
    await h.settled(child);
    expect(sent(child)).toEqual([[{ type: 'text', text: promotionMessage(exchanges, 'Spell it backwards.') }]]);
    expect(h.index.sessions.get(child)!.lineage).toEqual({ kind: 'side-thread', parentAppSessionId: parent.appId, parentEngineSessionId: SID, openedBy: 'btw' });
    expect(h.host.calledWith('session.renameSession')).toEqual([{ appSessionId: child, title: 'Side question' }]);
    expect(h.index.sessions.get(child)!.title).toEqual({ text: 'Side question', source: 'none' }); // M5
    expect(parentEvents(parent.appId)).toEqual([expect.objectContaining({ kind: 'side.thread.opened', anchor: null, openedBy: 'btw' })]);
  });

  it('refuses a promotion larger than a send may be before anything is created', async () => {
    const parent = parentRecord();
    const exchanges = Array.from({ length: 11 }, (_, i) => ({ question: `q${i}`, response: 'r'.repeat(100_000) }));
    const refused = h.service.openSideThread(parent.appId, { kind: 'btw', exchanges, text: null });
    await expect(refused).rejects.toBeInstanceOf(InvalidSideInput);
    await expect(refused).rejects.toMatchObject({ path: [] }); // the `from` input as a whole
    expect(await h.service.listIntents()).toEqual([]);
    expect(h.host.launches).toEqual([]);
  });

  it('sends a screenshot under userData as the image before the text; one outside every root is refused with its reason', async () => {
    const parent = parentRecord();
    mkdirSync(join(h.userData, 'captures'));
    const shot = join(h.userData, 'captures', 'shot.png');
    writeFileSync(shot, PNG);
    const outcome = await h.service.openSideThread(parent.appId, { kind: 'comment', anchor, text: 'Look', screenshot: { path: shot, width: 1, height: 1 } });
    await h.settled(outcome.appSessionId);
    expect(sent(outcome.appSessionId)).toEqual([
      [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } },
        { type: 'text', text: anchoredMessage({ anchor, text: 'Look', destination: 'thread', screenshot: true }) },
      ],
    ]);

    const away = join(h.root, 'away.png');
    writeFileSync(away, PNG);
    const launches = h.host.launches.length;
    const refused = h.service.openSideThread(parent.appId, { kind: 'comment', anchor, text: 'Look', screenshot: { path: away, width: 1, height: 1 } });
    await expect(refused).rejects.toBeInstanceOf(ScreenshotRefused);
    await expect(refused).rejects.toMatchObject({ path: ['screenshot'] });
    await expect(refused).rejects.toThrow('screenshot: not under an allowed root');
    expect(h.host.launches).toHaveLength(launches);
    expect(await h.service.listIntents()).toEqual([]);
  });

  it('names the thread in the index when the engine refuses the rename', async () => {
    const parent = parentRecord();
    h.host.renameError = 'rename refused';
    const outcome = await h.service.openSideThread(parent.appId, { kind: 'comment', anchor, text: 'Why?', screenshot: null });
    await h.settled(outcome.appSessionId);
    expect(h.index.sessions.get(outcome.appSessionId)!.title).toEqual({ text: 'src/x.ts:42', source: 'user' });
  });

  // E11 (tracker row E3 "quit before finishBinding leaves a side thread unrenamed"): binding recovery at launch
  describe('a quit after the first message reached C3 and before the thread was bound', () => {
    const quitBeforeBinding = async (keep: boolean) => {
      const parent = parentRecord();
      h.hangPut = (intent) => intent.progress.send !== null; // the app dies as it records the handoff
      const outcome = await h.service.openSideThread(parent.appId, { kind: 'comment', anchor, text: 'Why?', screenshot: null });
      const child = outcome.appSessionId;
      await h.until(() => h.gateReached);
      expect(h.host.calledWith('session.renameSession')).toEqual([]);
      expect(h.index.sideThreads.get(child)).toBeNull();
      await h.restart({ keep });
      return { parent: parent.appId, child };
    };

    it('renames the thread and records and shows its opened row once the next start hands it off', async () => {
      const { parent, child } = await quitBeforeBinding(false);
      expect(h.host.calledWith('session.renameSession')).toEqual([{ appSessionId: child, title: 'src/x.ts:42' }]);
      expect(h.index.sideThreads.of(parent).map((row) => row.childAppSessionId)).toEqual([child]);
      expect(parentEvents(parent)).toContainEqual(expect.objectContaining({ kind: 'side.thread.opened', childAppSessionId: child, id: `${parent}:side-thread:${child}:opened` }));
      expect(await h.service.listIntents()).toEqual([]);
      expect(h.host.disk.queues.get(child)).toHaveLength(1); // sent once, before the quit (C3's queue)
      expect(sent(child)).toEqual([]); // and not again
    });

    it('does the same for a thread a kept supervisor still runs', async () => {
      const { parent, child } = await quitBeforeBinding(true);
      expect(h.host.calledWith('session.renameSession')).toEqual([{ appSessionId: child, title: 'src/x.ts:42' }]);
      expect(h.index.sideThreads.of(parent).map((row) => row.childAppSessionId)).toEqual([child]);
      expect(await h.service.listIntents()).toEqual([]);
    });
  });

  it('refuses a parent that is gone or was never bound, as a fork is refused', async () => {
    const parent = parentRecord();
    expect(await h.service.openSideThread('5d1b5a0e-1111-4222-8333-444444444444' as AppSessionId, { kind: 'comment', anchor, text: 'x', screenshot: null })).toMatchObject({ status: 'refused', reason: 'unknown_session' });
    h.index.sessions.unbindEngineId(parent.appId);
    expect(await h.service.openSideThread(parent.appId, { kind: 'comment', anchor, text: 'x', screenshot: null })).toMatchObject({ status: 'refused', reason: 'no_engine_session' });
    expect(h.host.launches).toEqual([]);
    expect(await h.service.listIntents()).toEqual([]);
  });

  it('C10’s Fork carries fork lineage on its record', async () => {
    const parent = parentRecord();
    const outcome = await h.service.fork(parent.appId, { kind: 'inPlace' }, { message: null, rewindTo: null });
    await h.settled(outcome.appSessionId);
    expect(h.index.sessions.get(outcome.appSessionId)!.lineage).toEqual({ kind: 'fork', parentAppSessionId: parent.appId, parentEngineSessionId: SID, openedBy: 'fork' });
    expect(parentEvents(parent.appId)).toEqual([]); // a fork is no side thread: no row in the parent
  });

  // P2-E1 start (2026-10-09): the artifact scope beside the launch spec (D10)
  describe('the artifact scope (P2-E1 G4)', () => {
    const launchOf = (appSessionId: string) => h.host.calledWith('session.launch').filter((input) => (input as { spec: LaunchSpec }).spec.appSessionId === appSessionId) as { spec: LaunchSpec; artifactScope?: AppSessionId[] }[];

    it('a side thread launches with its ancestors nearest first, a thread of a thread through its parent thread to the root; a fork with none', async () => {
      const parent = parentRecord();
      const first = await h.service.openSideThread(parent.appId, { kind: 'comment', anchor, text: 'Why?', screenshot: null });
      await h.settled(first.appSessionId);
      expect(launchOf(first.appSessionId).map((input) => input.artifactScope)).toEqual([[parent.appId]]);
      const nested = await h.service.openSideThread(first.appSessionId, { kind: 'btw', exchanges: [{ question: 'Q?', response: 'A' }], text: 'More.' });
      await h.settled(nested.appSessionId);
      expect(launchOf(nested.appSessionId).map((input) => input.artifactScope)).toEqual([[first.appSessionId, parent.appId]]);
      const fork = await h.service.fork(parent.appId, { kind: 'inPlace' }, { message: null, rewindTo: null });
      await h.settled(fork.appSessionId);
      expect(launchOf(fork.appSessionId)).toEqual([{ spec: expect.anything() }]); // no artifactScope key at all
    });

    it("a side thread's resume launches with its scope again; a root's resume with none", async () => {
      const parent = parentRecord();
      const thread = await h.service.openSideThread(parent.appId, { kind: 'comment', anchor, text: 'Why?', screenshot: null });
      await h.settled(thread.appSessionId);
      h.host.table.clear(); // both exited
      expect(await h.service.startSession(thread.appSessionId, { message: null, options: {} })).toMatchObject({ status: 'starting' });
      expect(await h.settled(thread.appSessionId, 2)).toMatchObject({ phase: 'ready' });
      expect(launchOf(thread.appSessionId).map((input) => input.artifactScope)).toEqual([[parent.appId], [parent.appId]]);
      await h.service.startSession(parent.appId, { message: null, options: {} });
      expect(await h.settled(parent.appId)).toMatchObject({ phase: 'ready' });
      expect(launchOf(parent.appId)).toEqual([{ spec: expect.anything() }]);
    });
  });
  // P2-E1 end
});
