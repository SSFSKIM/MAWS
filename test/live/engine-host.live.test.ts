// The live suite (C3 execution document, Acceptance item 3; M6): the pinned binary through ClaudeUsage's relay, in
// auto mode with the owner's setting sources, Sonnet, `--max-budget-usd 0.50` per process, one scratch git repository
// per case, run serially. Every case but 3.18 goes through the X2 surface the renderer uses (C1's host runtime serving
// registerEngineIpc; support/live-host.ts); 3.18 builds the EngineSession the launcher would, because host hooks have no
// X2 path in P0. Skipped, never failed, when the gate says so. `MAWS_LIVE=1 pnpm test:live`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { RequestAnswer } from '@shared/engine/answers';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { getHooksListing } from '../../src/engine-host/controls';
import { HostHookRegistry } from '../../src/engine-host/host-hooks';
import { GATEWAY_AUTH_TOKEN, RELAY_URL } from '../../src/engine-host/launch';
import { ENGINE_BIN, ENGINE_VERSION } from '../support/engine-pin'; // W13: the live suite runs the fixtures' engine
import * as nodePty from 'node-pty'; // W7: the terminal-style second writer
import { holderAuthority } from '../../src/main/sessions/holders'; // W7: main's resume guard, over this host
import { releaseHolder } from '../../src/main/sessions/take-over'; // W7: "Take over here", over this host
import { ChainFollower } from '../../src/engine-host/fs/chain-follower'; // W7: the pre-W7 follower, beside the product's
import { FsFileReader } from '../../src/engine-host/fs/follow';
import { HolderRegistry } from '../../src/engine-host/fs/holders';
import { resolveStorePaths } from '../../src/engine-host/fs/paths';
import { exportFixture, frameInventory, LiveLedger, liveGate, liveSpec, redactJournal, scratchConfigHome, turnAttribution, withRawProcess, type LiveContext, type Provenance } from './support/live';
import { LiveHost, startDirectSession } from './support/live-host';

const REPO_ROOT = resolve(__dirname, '../..');
const TURN_MS = 120_000;
const LONG_CASE_MS = 300_000;
const COST_CAP_USD = 5; // the owner's stop-and-report line for one run

interface StatusSection {
  title: string;
  rows: { label?: string; value: string }[];
}

type Kind = SessionEvent['kind'];
type Ev<K extends Kind> = Extract<SessionEvent, { kind: K }>;
const ofKind = <K extends Kind>(events: SessionEvent[], kind: K): Ev<K>[] => events.filter((e): e is Ev<K> => e.kind === kind);
const mainTurnsEnded = (events: SessionEvent[]) => ofKind(events, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);
const text = (content: unknown): string => (typeof content === 'string' ? content : JSON.stringify(content));
const launchOf = (event: SessionEvent) => event.id.split(':')[1];
const seqOf = (event: { seq: number | null }): number => event.seq ?? -1; // every live event derives from a row

const ledger = new LiveLedger(COST_CAP_USD);
// 3.1 and 3.2 share one process: `system/init` arrives only after the first user frame (every fixture of both passes),
// so 3.1's session-id check rides 3.2's turn and no extra turn is paid for it.
let shared: { host: LiveHost; spec: LaunchSpec } | null = null;
async function releaseShared(): Promise<void> {
  const held = shared;
  shared = null;
  if (held && 'userData' in gate) await withHost(gate, '3.1', async () => {}, held.host);
}
const subtypeSeen = new Map<string, string>(); // system subtype → first `journal:seq`
const typeSeen = new Map<string, string>();
const unknownFrames: string[] = [];
const misattributed: string[] = []; // reported, not asserted beyond 3.7 (the engine reorders prompts; see the M6 report)
const exports: string[] = [];
let gate: { skip: string } | LiveContext;

beforeAll(async () => {
  gate = await liveGate();
});

afterAll(async () => {
  if ('skip' in gate) return;
  await releaseShared(); // a run filtered to 3.1 alone leaves its process for 3.2
  console.log(`   system subtypes observed: ${[...subtypeSeen].map(([s, at]) => `${s} (${at})`).join(', ')}`);
  console.log(`   frame types observed: ${[...typeSeen].map(([s, at]) => `${s} (${at})`).join(', ')}`);
  console.log(`   frame.unknown: ${unknownFrames.length === 0 ? 'none' : unknownFrames.join('; ')}`);
  console.log(`   turn attribution: ${misattributed.length === 0 ? 'every human turn closed by its own result' : misattributed.join('; ')}`);
  for (const line of exports) console.log(`   exported fixture: ${line}`);
  console.log(ledger.summary());
});

function live(ctx: TestContext): LiveContext {
  if ('skip' in gate) {
    console.log(`↓ ${gate.skip}`);
    ctx.skip(gate.skip);
  }
  ledger.assertUnderCap();
  return gate as LiveContext;
}

function readJournal(path: string): JournalRow[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseJournalRow(JSON.parse(line)));
}

// Books one launch's journal: cost, the frame inventory, and the path the acceptance asks every case to print.
// `sessionKey`: the engine session id, which a non-fork resume keeps (the ledger counts a session's cumulative figure once).
function book(label: string, journalPath: string, events: SessionEvent[], sessionKey: string): JournalRow[] {
  const rows = readJournal(journalPath);
  const { costUsd, turns } = ledger.add(label, journalPath, rows, sessionKey);
  const { systemSubtypes, types } = frameInventory(rows);
  for (const [subtype, seqs] of systemSubtypes) if (!subtypeSeen.has(subtype)) subtypeSeen.set(subtype, `${journalPath}:${seqs[0]}`);
  for (const [type, seqs] of types) if (!typeSeen.has(type)) typeSeen.set(type, `${journalPath}:${seqs[0]}`);
  for (const e of ofKind(events, 'frame.unknown')) unknownFrames.push(`${journalPath}:${e.seq} ${e.frameType}/${e.subtype}`);
  for (const line of turnAttribution(events)) misattributed.push(`${journalPath}: ${line}`);
  console.log(`   journal: ${journalPath} (total_cost_usd ${costUsd.toFixed(4)}, ${turns} turns)`);
  return rows;
}

// One host per case; at the end every launch it made is ended and booked, whatever the case's outcome.
// `host` is passed when another case made the launch (3.1's process, used by 3.2).
async function withHost(ctx: LiveContext, label: string, fn: (host: LiveHost) => Promise<void>, host = new LiveHost({ userData: ctx.userData })): Promise<void> {
  try {
    await fn(host);
  } finally {
    await host.shutdown().catch((error: unknown) => console.log(`   shutdown failed: ${String(error)}`));
    const byPath = new Map<string, { events: SessionEvent[]; sessionKey: string }>();
    const ids = new Set(host.emitted.map((e) => (e.payload as { appSessionId?: string }).appSessionId).filter((id): id is string => typeof id === 'string'));
    for (const id of ids) {
      const events = host.events(id);
      for (const status of host.statuses(id)) {
        if (!byPath.has(status.journalPath)) byPath.set(status.journalPath, { events: events.filter((e) => launchOf(e) === status.launchId), sessionKey: status.engineSessionId ?? status.journalPath });
      }
    }
    for (const [path, { events, sessionKey }] of byPath) book(label, path, events, sessionKey);
  }
}

// The per-session view a case works with.
function sessionView(host: LiveHost, spec: LaunchSpec) {
  const id = spec.appSessionId;
  const events = () => host.events(id);
  const wait = <K extends Kind>(kind: K, what: string, pred: (e: Ev<K>) => boolean = () => true, ms = TURN_MS) =>
    host.waitFor(() => ofKind(events(), kind).find(pred), `${id} ${kind} ${what}`, ms);
  return {
    id,
    events,
    wait,
    waitTurns: (n: number, ms = TURN_MS) => host.waitFor(() => mainTurnsEnded(events())[n - 1], `${id} turn ${n} ended`, ms),
    send: (content: string) => host.call('session.send', { appSessionId: id, content }),
    status: () => host.status(id)!,
    journal: () => readJournal(host.status(id)!.journalPath),
    answer: (requestId: string, answer: RequestAnswer) => host.call('session.answer', { appSessionId: id, requestId, answer }),
  };
}

const outFrames = (rows: JournalRow[]) => rows.filter((r) => r.direction === 'out').map((r) => ({ seq: r.seq, frame: r.frame as Record<string, unknown> }));
const answerRow = (rows: JournalRow[], requestId: string) =>
  outFrames(rows).find((r) => r.frame.type === 'control_response' && (r.frame.response as { request_id?: string }).request_id === requestId);
const queueRows = (rows: JournalRow[]) => rows.filter((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === 'queue') as (JournalRow & { frame: { action: string; trigger?: string; queueId?: string; reason?: string } })[];

const SLOW_COUNT = (sleep: number) =>
  `Count to 8 with separate Bash sleep ${sleep} calls: for each number n from 1 to 8, make exactly one Bash call \`sleep ${sleep} && echo n\`, one call at a time, never in parallel. Then reply COUNTED.`;
const ASK_RULE = { permissions: { ask: ['Bash(git log:*)'] } };

describe('engine host live', () => {
  it('M1 initialize only, routed', async (ctx) => {
    const g = live(ctx);
    const spec = liveSpec(g.scratch());
    const { journalPath, rows } = await withRawProcess(g, spec, async (p) => {
      expect(p.plan.args).toContain('--session-id');
      expect(p.plan.env.ANTHROPIC_BASE_URL).toBe(RELAY_URL);

      const init = await p.request('initialize', { supportedDialogKinds: ['auto_mode_server_fallback', 'refusal_fallback_prompt'], perTaskStopAffordance: true }, 15_000);
      expect(init.subtype).toBe('success');
      const initResponse = (init as { response: Record<string, unknown> }).response;
      expect(initResponse.current_permission_mode).toBe('auto');
      expect(Array.isArray(initResponse.models)).toBe(true);
      expect(Array.isArray(initResponse.commands)).toBe(true);

      const status = await p.request('get_status', {}, 15_000);
      expect(status.subtype).toBe('success');
      const sections = (status as { response: { sections: StatusSection[] } }).response.sections;
      const session = sections.find((s) => s.title === 'Session');
      expect(session).toBeDefined();
      const baseUrl = session!.rows.find((r) => r.label === 'Anthropic base URL')?.value ?? null;
      console.log(`   get_status Anthropic base URL = ${baseUrl}`);
      expect(baseUrl).toBe(RELAY_URL);
      expect(session!.rows.find((r) => r.label === 'Session ID')?.value).toBe(spec.sessionId);
      expect(session!.rows.find((r) => r.label === 'Version')?.value).toBe(ENGINE_VERSION);
      const environment = sections.find((s) => s.title === 'Environment');
      expect(environment?.rows.find((r) => r.label === 'Auto mode server')?.value).toBe('Enabled');

      // No user frame was sent, so every `in` row is a control response or a startup system frame; no model turn ran.
      expect(p.rows.filter((r) => r.direction === 'out').every((r) => (r.frame as { type: string }).type === 'control_request')).toBe(true);
      expect(p.rows.some((r) => r.direction === 'in' && (r.frame as { type: string }).type === 'result')).toBe(false);
    });

    // The journal on disk: X8 rows with consecutive seq, the spawn meta row first, every frame in and out present.
    expect(journalPath).toContain(`/engine-host/journal/${spec.appSessionId}/`);
    const onDisk = readJournal(journalPath);
    expect(onDisk.map((r) => r.seq)).toEqual(rows.map((r) => r.seq));
    expect(onDisk[0]).toMatchObject({ seq: 1, direction: 'meta', frame: { event: 'spawn', args: expect.arrayContaining(['--session-id', spec.sessionId]) } });
    const outbound = onDisk.filter((r) => r.direction === 'out').map((r) => (r.frame as { request: { subtype: string } }).request.subtype);
    expect(outbound).toEqual(['initialize', 'get_status']);
    expect(onDisk.at(-1)).toMatchObject({ direction: 'meta', frame: { event: 'exit' } });
  });


  it('3.1 launch routed auto', async (ctx) => {
    const g = live(ctx);
    const host = new LiveHost({ userData: g.userData });
    const spec = liveSpec(g.scratch());
    shared = { host, spec };
    const { status, readyMs } = await host.launch(spec);
    console.log(`   ready in ${readyMs} ms; engineSessionId ${status.engineSessionId}; gateway ${JSON.stringify(status.gateway)}; mode ${status.permissionMode.effective}`);
    expect(readyMs).toBeLessThan(15_000);
    expect(status.engineSessionId).toBe(spec.sessionId);
    expect(status.permissionMode.effective).toBe('auto');
    expect(status.gateway).toMatchObject({ mode: 'gateway', verified: 'routed', baseUrl: RELAY_URL, autoModeServer: 'enabled' });
    expect(status.engineVersion).toBe(ENGINE_VERSION);
  });

  it('3.2 streamed reply', async (ctx) => {
    const g = live(ctx);
    let host = shared?.host;
    let spec = shared?.spec;
    shared = null; // 3.2 books the process from here on
    if (!host || !spec || host.status(spec.appSessionId)?.process !== 'ready') {
      host = new LiveHost({ userData: g.userData });
      spec = liveSpec(g.scratch());
      await host.launch(spec);
    }
    await withHost(g, '3.1+3.2', async (h) => {
      const s = sessionView(h, spec!);
      const sent = await s.send('Reply with exactly OK, then think briefly about why.');
      expect(sent.disposition).toBe('sent');
      const ended = await s.waitTurns(1);
      const init = ofKind(s.events(), 'session.init')[0]!;
      console.log(`   3.1 system/init.session_id = ${init.sessionId} (seq ${init.seq}); pinned ${spec!.sessionId}`);
      expect(init.sessionId).toBe(spec!.sessionId);
      const deltas = ofKind(s.events(), 'assistant.block.delta');
      const textDeltas = deltas.filter((d) => d.textDelta !== null);
      console.log(`   ${textDeltas.length} textDelta, ${deltas.filter((d) => d.thinkingDelta !== null).length} thinkingDelta; turn.ended seq ${ended.seq} resultText ${JSON.stringify(ended.resultText)} origin ${ended.origin}`);
      expect(textDeltas.length).toBeGreaterThan(0);
      expect(ended.resultText).toContain('OK');
      expect(ended.origin).toBe('human');
    }, host);
  });

  it('3.3 ask rule, allow once, session scope downgraded', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.3', async (host) => {
      const spec = liveSpec(g.scratch(), { extraSettings: ASK_RULE });
      await host.launch(spec);
      const s = sessionView(host, spec);
      const asks = () => ofKind(s.events(), 'permission.requested');

      await s.send('Use Bash to run exactly `git log --oneline` (nothing else), then reply DONE.');
      const first = await host.waitFor(() => asks()[0], 'first permission.requested', TURN_MS);
      console.log(`   first ask seq ${first.seq}: ${first.toolName} ${JSON.stringify(first.input)} decisionReasonType ${first.decisionReasonType}`);
      expect(first.decisionReasonType).toBe('rule');
      const pendingItem = await host.waitFor(() => host.brokerItems(s.id).at(-1)?.find((i) => i.kind === 'permission' && i.request.requestId === first.requestId), 'broker item', 5_000);
      expect(pendingItem.state).toBe('pending');
      expect(await s.answer(first.requestId, { kind: 'permission', decision: 'allow', scope: 'once' })).toEqual({ outcome: 'delivered' });
      const result = await s.wait('tool.result', 'for the first ask', (e) => e.toolUseId === first.toolUseId);
      console.log(`   tool.result seq ${result.seq} denial ${result.denial}`);
      expect(result.denial).toBeNull();
      await host.waitFor(() => host.brokerItems(s.id).some((items) => items.some((i) => i.request.requestId === first.requestId && i.state === 'confirmed')), 'the item confirmed', 5_000);
      await s.waitTurns(1);

      await s.send('Run exactly `git log --oneline` with Bash once more (nothing else), then reply DONE.');
      const second = await host.waitFor(() => asks()[1], 'second permission.requested', TURN_MS);
      expect(second.decisionReasonType).toBe('rule');
      expect(await s.answer(second.requestId, { kind: 'permission', decision: 'allow', scope: 'session' })).toEqual({ outcome: 'delivered' });
      const resolved = await s.wait('permission.resolved', 'for the second ask', (e) => e.requestId === second.requestId);
      console.log(`   second ask seq ${second.seq}; resolved seq ${resolved.seq} message ${JSON.stringify(resolved.message)}`);
      expect(resolved.message).toContain('scope downgraded: ask rule');
      const wire = answerRow(s.journal(), second.requestId)!;
      console.log(`   control_response seq ${wire.seq}: ${JSON.stringify(wire.frame.response)}`);
      expect(JSON.stringify(wire.frame)).not.toContain('updatedPermissions');
      expect(s.status().grants).toEqual([]);
      await s.waitTurns(2);

      await s.send('Run exactly `git log --oneline` with Bash a third time (nothing else), then reply DONE.');
      const third = await host.waitFor(() => asks()[2], 'third permission.requested', TURN_MS);
      console.log(`   third ask seq ${third.seq} decisionReasonType ${third.decisionReasonType}; grants ${JSON.stringify(s.status().grants)}`);
      expect(third.decisionReasonType).toBe('rule');
      await s.answer(third.requestId, { kind: 'permission', decision: 'allow', scope: 'once' });
      await s.waitTurns(3);
    });
  }, LONG_CASE_MS);

  it('3.4 AskUserQuestion round trip', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.4', async (host) => {
      const spec = liveSpec(g.scratch());
      await host.launch(spec);
      const s = sessionView(host, spec);
      await s.send(
        "Use the AskUserQuestion tool exactly once to ask me two questions in one call: 'Which color do you prefer?' with options Red and Blue, and 'Which fruit do you like?' with options Apple and Pear. After I answer, reply with my two answers.",
      );
      const q = await s.wait('question.requested', 'two questions');
      expect(q.questions).toHaveLength(2);
      const answers = Object.fromEntries(q.questions.map((question, i) => [question.question, question.options[i === 0 ? 0 : 1]!.label]));
      expect(await s.answer(q.requestId, { kind: 'question', answers })).toEqual({ outcome: 'delivered' });
      const result = await s.wait('tool.result', 'for the questions', (e) => e.toolUseId === q.toolUseId);
      const content = text(result.content);
      console.log(`   question.requested seq ${q.seq}; tool.result seq ${result.seq}: ${content.slice(0, 300)}`);
      expect(content).toContain('Your questions have been answered');
      for (const value of Object.values(answers)) expect(content).toContain(value);
      await s.waitTurns(1);
    });
  }, LONG_CASE_MS);

  it('3.5 two subagents', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.5', async (host) => {
      const spec = liveSpec(g.scratch());
      await host.launch(spec);
      const s = sessionView(host, spec);
      await s.send(
        'Use the Agent tool to dispatch two general-purpose subagents in parallel, in a single message. The first must reply with exactly ALPHA and the second with exactly BETA; neither may use any tools. Then tell me what each replied.',
      );
      await host.waitFor(() => ofKind(s.events(), 'subagent.finished').length >= 2 && ofKind(s.events(), 'subagent.finished'), 'two subagent.finished', LONG_CASE_MS - 60_000);
      // the parent's closing turn (human or engine-initiated) after the children finished, then an idle session
      await host.waitFor(() => {
        const lastFinish = seqOf(ofKind(s.events(), 'subagent.finished').at(-1)!);
        return mainTurnsEnded(s.events()).some((t) => seqOf(t) > lastFinish) && s.status().turn === null;
      }, 'the closing turn', TURN_MS);
      const events = s.events();
      const started = ofKind(events, 'subagent.started');
      const finished = ofKind(events, 'subagent.finished');
      const childCompletes = ofKind(events, 'assistant.block.complete').filter((e) => e.parentToolUseId !== null);
      const childDeltas = ofKind(events, 'assistant.block.delta').filter((e) => e.parentToolUseId !== null);
      console.log(`   subagent.started seq ${started.map((e) => e.seq).join(',')} (${started.map((e) => e.subagentType).join(',')}); subagent.finished seq ${finished.map((e) => `${e.seq}:${e.status}`).join(',')}`);
      console.log(`   child completes ${childCompletes.length} (agentIds ${[...new Set(childCompletes.map((e) => e.agentId))].join(',')}); child deltas ${childDeltas.length}; turns ${mainTurnsEnded(events).map((t) => `${t.seq}:${t.origin}`).join(',')}`);
      expect(started).toHaveLength(2);
      expect(finished).toHaveLength(2);
      expect(childCompletes.length).toBeGreaterThan(0);
      for (const e of childCompletes) expect(e.agentId).not.toBeNull();
      expect(childDeltas).toEqual([]);
    });
  }, LONG_CASE_MS);

  it('3.6 queue during a turn, released at its end', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.6', async (host) => {
      const spec = liveSpec(g.scratch());
      await host.launch(spec);
      const s = sessionView(host, spec);
      expect((await s.send(SLOW_COUNT(1))).disposition).toBe('sent');
      const queued = await s.send('Reply with exactly QUEUED_OK');
      expect(queued).toMatchObject({ disposition: 'queued', messageUuid: null });
      const shown = await host.waitFor(() => host.queues(s.id).find((q) => q.entries.some((e) => e.queueId === queued.queueId)), 'the queue event', 5_000);
      expect(shown.entries.filter((e) => e.state === 'queued').map((e) => e.queueId)).toEqual([queued.queueId]);
      const first = await s.waitTurns(1, LONG_CASE_MS - 60_000);
      await host.waitFor(() => host.queues(s.id).some((q) => q.entries.some((e) => e.queueId === queued.queueId && e.state === 'released')), 'the entry released', 10_000);
      const second = await s.waitTurns(2);
      const release = queueRows(s.journal()).find((r) => r.frame.action === 'release' && r.frame.queueId === queued.queueId)!;
      console.log(`   turn 1 ended seq ${first.seq} (${JSON.stringify(first.resultText)}); release row seq ${release.seq} trigger ${release.frame.trigger}; turn 2 ended seq ${second.seq} ${JSON.stringify(second.resultText)}`);
      expect(release.seq).toBeGreaterThan(seqOf(first));
      expect(release.frame.trigger).toBe('turn_ended');
      expect(second.resultText).toContain('QUEUED_OK');
    });
  }, LONG_CASE_MS);

  it('3.7 steer during a turn', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.7', async (host) => {
      const spec = liveSpec(g.scratch());
      await host.launch(spec);
      const s = sessionView(host, spec);
      await s.send(SLOW_COUNT(1));
      await s.wait('tool.result', 'the first count');
      const queued = await s.send('Reply with exactly AFTER');
      expect(queued.disposition).toBe('queued');
      const { messageUuid: steer } = await host.call('session.steer', { appSessionId: s.id, content: 'Stop counting and reply STEERED' });
      const frame = outFrames(s.journal()).find((r) => r.frame.type === 'user' && r.frame.uuid === steer)!;
      console.log(`   steer out seq ${frame.seq} priority ${String(frame.frame.priority)}`);
      expect(frame.frame.priority).toBe('now');
      const steered = await host.waitFor(() => mainTurnsEnded(s.events()).find((t) => t.userMessageUuids.includes(steer as MessageUuid)), 'a result naming the steer', TURN_MS);
      const after = await host.waitFor(() => mainTurnsEnded(s.events()).find((t) => t.resultText?.includes('AFTER')), 'the queued reply', TURN_MS);
      const release = queueRows(s.journal()).find((r) => r.frame.action === 'release' && r.frame.queueId === queued.queueId)!;
      console.log(`   turn.ended seq ${steered.seq} userMessageUuids ${JSON.stringify(steered.userMessageUuids)} resultText ${JSON.stringify(steered.resultText)}; queued release seq ${release.seq}; AFTER turn seq ${after.seq}`);
      expect(steered.seq).toBeLessThan(release.seq);
    });
  }, LONG_CASE_MS);

  // Fix wave (coordinator ruling on 3.7): what the engine does with `priority: 'next'` sent while a turn runs; the
  // journal becomes pass3/steer-next.jsonl.
  it('3.7n steer with priority next during a turn', async (ctx) => {
    const g = live(ctx);
    let journalPath = '';
    await withHost(g, '3.7n', async (host) => {
      const spec = liveSpec(g.scratch());
      const { status } = await host.launch(spec);
      journalPath = status.journalPath;
      const s = sessionView(host, spec);
      const first = await s.send(SLOW_COUNT(1));
      await s.wait('tool.result', 'the first count');
      const { messageUuid: next } = await host.call('session.steer', { appSessionId: s.id, content: 'Reply NEXT_OK', priority: 'next' });
      const frame = outFrames(s.journal()).find((r) => r.frame.type === 'user' && r.frame.uuid === next)!;
      const answered = await host.waitFor(() => mainTurnsEnded(s.events()).find((t) => t.userMessageUuids.includes(next as MessageUuid)), 'a result naming the next steer', LONG_CASE_MS - 60_000);
      await host.waitFor(() => s.status().turn === null && s.status().queue.length === 0, 'an idle session', TURN_MS);
      const events = s.events();
      const name = (u: string | null) => (u === first.messageUuid ? 'first' : u === next ? 'next' : String(u));
      const log: string[] = [];
      for (const e of events) {
        if (e.parentToolUseId !== null) continue;
        if (e.kind === 'turn.started') log.push(`start ${e.seq} ${name(e.userMessageUuid)}`);
        else if (e.kind === 'turn.ended' && !e.isEchoReceipt) log.push(`end ${e.seq} ${e.terminalReason} [${e.userMessageUuids.map(name).join(',')}] ${JSON.stringify(e.resultText?.slice(-30))}`);
        else if (e.kind === 'command.lifecycle') log.push(`lifecycle ${e.seq} ${e.state} ${name(e.commandUuid)}`);
      }
      console.log(`   next steer out seq ${frame.seq} priority ${String(frame.frame.priority)}`);
      console.log(`   ${log.join(' | ')}`);
      const firstEnd = mainTurnsEnded(events).find((t) => t.userMessageUuids.includes(first.messageUuid!))!;
      console.log(`   first turn ended seq ${firstEnd.seq} ${firstEnd.terminalReason}; next answered seq ${answered.seq} ${JSON.stringify(answered.resultText)}`);
      expect(frame.frame.priority).toBe('next');
      // observed (first live run, journal live-bfacd45b/ta23iwcd.jsonl): `next` folds into the running turn at its next
      // tool boundary: its `started` arrives mid-turn, the model answers it there and goes on, and the one result names both
      const nextStarted = ofKind(events, 'command.lifecycle').find((e) => e.commandUuid === next && e.state === 'started')!;
      const reply = ofKind(events, 'assistant.block.complete').find((e) => e.parentToolUseId === null && seqOf(e) > seqOf(nextStarted) && JSON.stringify(e.block).includes('NEXT_OK'));
      console.log(`   next started seq ${nextStarted.seq} inside the turn opened at ${ofKind(events, 'turn.started')[0]?.seq}; NEXT_OK block seq ${reply?.seq}`);
      expect(answered.userMessageUuids).toEqual([first.messageUuid, next]);
      expect(seqOf(nextStarted)).toBeLessThan(seqOf(answered));
      expect(reply).toBeDefined();
      expect(ofKind(events, 'turn.started').filter((e) => e.parentToolUseId === null)).toHaveLength(1); // no turn of its own
      expect(turnAttribution(events)).toEqual([]);
    });
    exportTo('steer-next', journalPath, g);
  }, LONG_CASE_MS);

  it('3.8 interrupt, then resume the queue', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.8', async (host) => {
      const spec = liveSpec(g.scratch());
      await host.launch(spec);
      const s = sessionView(host, spec);
      await s.send(SLOW_COUNT(3));
      const use = await s.wait('tool.use', 'the first Bash call', (e) => e.toolName === 'Bash');
      const answer = await host.call('session.interrupt', { appSessionId: s.id, cancelEngineQueued: false });
      const ended = await s.waitTurns(1);
      const aborted = await s.wait('tool.result', 'the aborted call', (e) => e.toolUseId === use.toolUseId, 10_000);
      const paused = s.status().queue.paused;
      console.log(`   interrupt answer ${JSON.stringify(answer)}; turn.ended seq ${ended.seq} terminalReason ${ended.terminalReason}; tool.result seq ${aborted.seq} denial ${aborted.denial}; queue.paused ${paused}`);
      expect(['aborted_streaming', 'aborted_tools']).toContain(ended.terminalReason);
      expect(aborted.denial).toBe('user-rejected');
      expect(paused).toBe(true);
      await host.call('session.queue.setPaused', { appSessionId: s.id, paused: false });
      await s.send('Reply RESUMED');
      const resumed = await s.waitTurns(2);
      console.log(`   turn.ended seq ${resumed.seq} ${JSON.stringify(resumed.resultText)}`);
      expect(resumed.resultText).toContain('RESUMED');
    });
  }, LONG_CASE_MS);

  // The owner's user-level PreToolUse guardrail (~/.claude/hooks/bash-guardrail.sh) allows every non-destructive Bash
  // command, so pass 2's `touch granted.txt` never reaches a prompt under the real setting sources; a command the
  // guardrail defers on (`rm -rf` of a directory inside the scratch repository) takes the same default-mode path.
  it('3.9 session grant survives stop and resume', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.9', async (host) => {
      const cwd = g.scratch();
      mkdirSync(join(cwd, 'granted-dir'));
      writeFileSync(join(cwd, 'granted-dir', 'x.txt'), 'x\n');
      const spec = liveSpec(cwd, { permissionMode: 'default' });
      await host.launch(spec);
      const s = sessionView(host, spec);
      await s.send('Use Bash to run exactly `rm -rf granted-dir` (nothing else), then reply DONE.');
      const ask = await s.wait('permission.requested', 'rm -rf granted-dir');
      console.log(`   permission.requested seq ${ask.seq} decisionReasonType ${ask.decisionReasonType} input ${JSON.stringify(ask.input)} suggestions ${JSON.stringify(ask.suggestions)}`);
      expect(ask.decisionReasonType).toBeNull();
      // hold the queue so the second ask waits for the resumed process
      await host.call('session.queue.setPaused', { appSessionId: s.id, paused: true });
      const queued = await s.send('Run exactly `rm -rf granted-dir` with Bash again now, even though you ran it before (nothing else), then reply DONE.');
      expect(queued.disposition).toBe('queued');
      expect(await s.answer(ask.requestId, { kind: 'permission', decision: 'allow', scope: 'session' })).toEqual({ outcome: 'delivered' });
      const wire = answerRow(s.journal(), ask.requestId)!;
      const updated = (wire.frame.response as { response: { updatedPermissions?: { rules: { ruleContent?: string }[] }[] } }).response.updatedPermissions;
      console.log(`   control_response seq ${wire.seq} updatedPermissions ${JSON.stringify(updated)}`);
      const ruleContent = updated?.[0]?.rules[0]?.ruleContent;
      expect(updated).toEqual([{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent }], behavior: 'allow', destination: 'session' }]);
      expect(ruleContent).toMatch(/^rm -rf granted-dir/);
      const grant = `Bash(${ruleContent})`;
      await host.waitFor(() => s.status().grants.length > 0, 'the grant', 5_000);
      expect(s.status().grants).toEqual([grant]);
      await s.waitTurns(1);

      const stopped = await host.call('session.stop', { appSessionId: s.id, reason: 'stop' });
      const exited = await s.wait('process.exited', 'stop', () => true, 10_000);
      console.log(`   stop ${JSON.stringify(stopped)}; process.exited seq ${exited.seq} reason ${exited.reason}`);
      expect(exited.reason).toBe('stop');

      const resumeSpec: LaunchSpec = { ...spec, sessionId: null, resume: { sessionId: spec.sessionId!, fork: false } };
      const { status } = await host.launch(resumeSpec);
      const launch2 = status.launchId;
      const reconnects = ofKind(s.events(), 'session.reconnect').filter((e) => launchOf(e) === launch2);
      console.log(`   session.reconnect ${reconnects.map((e) => `${e.seq}:${e.phase}`).join(', ')}`);
      expect(reconnects.map((e) => e.phase)).toEqual(['attempting', 'reconnected']);
      const list = await host.call('session.queue.list', { appSessionId: s.id });
      console.log(`   queue.list ${JSON.stringify(list.entries.map((e) => [e.queueId, e.state]))} paused ${list.paused}`);
      expect(list.entries.map((e) => e.queueId)).toEqual([queued.queueId]);
      const rows2 = readJournal(status.journalPath);
      const outs = outFrames(rows2);
      const apply = outs.find((r) => (r.frame.request as { subtype?: string } | undefined)?.subtype === 'apply_flag_settings')!;
      const firstUser = outs.find((r) => r.frame.type === 'user');
      console.log(`   apply_flag_settings seq ${apply.seq}: ${JSON.stringify(apply.frame.request)}; first user frame ${firstUser ? `seq ${firstUser.seq}` : 'none yet'}`);
      expect(apply.frame.request).toEqual({ subtype: 'apply_flag_settings', settings: { permissions: { allow: [grant] } } });
      expect(firstUser).toBeUndefined();
      const rules = await host.call('session.listPermissionRules', { appSessionId: s.id });
      const rule = (rules.state.rules as { rule: string; source: string }[]).find((r) => r.rule === grant);
      console.log(`   listPermissionRules ${JSON.stringify(rule)}`);
      expect(rule).toMatchObject({ source: 'flagSettings' });

      await host.call('session.queue.setPaused', { appSessionId: s.id, paused: false });
      const ended = await host.waitFor(() => mainTurnsEnded(s.events()).find((t) => launchOf(t) === launch2), 'the resumed turn', TURN_MS);
      const inLaunch2 = s.events().filter((e) => launchOf(e) === launch2);
      const bash = ofKind(inLaunch2, 'tool.use').filter((e) => e.toolName === 'Bash');
      console.log(`   resumed turn.ended seq ${ended.seq}; Bash uses ${bash.map((e) => JSON.stringify(e.input)).join(', ')}; permission.requested ${ofKind(inLaunch2, 'permission.requested').length}`);
      expect(bash.length).toBeGreaterThan(0);
      expect(ofKind(inLaunch2, 'permission.requested')).toEqual([]);
    });
  }, LONG_CASE_MS);

  it('3.10 background task, queue, engine-initiated turns', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.10', async (host) => {
      const spec = liveSpec(g.scratch());
      await host.launch(spec);
      const s = sessionView(host, spec);
      await s.send(
        'Run in the background: start two background Bash commands with run_in_background, `sleep 15 && echo BG_ONE` and `sleep 16 && echo BG_TWO`. Do not wait for them and do not check on them; reply STARTED right away.',
      );
      const a = await s.send('Reply with exactly QUEUED_A');
      expect(a.disposition).toBe('queued');
      const human = await s.waitTurns(1);
      await host.waitFor(() => mainTurnsEnded(s.events()).find((t) => t.resultText?.includes('QUEUED_A')), 'QUEUED_A answered', TURN_MS);
      // Decision Log (M4, open for M6): a message queued during the first engine-initiated turn, with a second engine
      // turn due a second later (two background tasks), shows what the engine does with a head released at an engine turn's end.
      const engineStart = await s.wait('turn.started', 'an engine-initiated turn', (e) => e.origin === 'engine', TURN_MS);
      const b = await s.send('Reply with exactly QUEUED_B');
      const bEnded = await host.waitFor(() => mainTurnsEnded(s.events()).find((t) => t.resultText?.includes('QUEUED_B')), 'QUEUED_B answered', TURN_MS);
      await host.waitFor(() => ofKind(s.events(), 'task.notification').length >= 2 && s.status().turn === null && s.status().queue.length === 0, 'both notifications and an idle session', TURN_MS);
      await new Promise((r) => setTimeout(r, 3_000)); // any trailing engine turn
      const events = s.events();
      const rows = s.journal();
      const releases = queueRows(rows).filter((r) => r.frame.action === 'release');
      const turns = ofKind(events, 'turn.started').filter((e) => e.parentToolUseId === null);
      const ends = mainTurnsEnded(events);
      console.log(`   b send ${b.disposition} at engine turn seq ${engineStart.seq}`);
      console.log(`   turns: ${turns.map((t) => `start ${t.seq}:${t.origin}`).concat(ends.map((t) => `end ${t.seq}:${t.origin}:${JSON.stringify(t.resultText?.slice(0, 40))}:${JSON.stringify(t.userMessageUuids)}`)).join(' | ')}`);
      console.log(`   release rows: ${releases.map((r) => `${r.seq}:${r.frame.trigger}:${r.frame.queueId}`).join(', ')}; pause rows: ${queueRows(rows).filter((r) => r.frame.action === 'pause').map((r) => `${r.seq}:${r.frame.reason}`).join(', ') || 'none'}`);
      console.log(`   task.notification ${ofKind(events, 'task.notification').map((e) => `${e.seq}:${e.status}`).join(', ')}; B turn.ended seq ${bEnded.seq} origin ${bEnded.origin}`);
      const released = releases.filter((r) => r.frame.trigger === 'turn_ended');
      const releaseA = released.find((r) => r.frame.queueId === a.queueId)!;
      expect(releaseA.seq).toBeGreaterThan(seqOf(human));
      expect(turns.filter((t) => t.origin === 'engine' && seqOf(t) > seqOf(human) && seqOf(t) < releaseA.seq)).toEqual([]); // A at the human turn's end, before any engine turn
      expect(ends.some((t) => t.origin === 'task-notification')).toBe(true);
      // nothing is ever released into an engine-initiated turn: every release row sits where no main-lane turn is open
      const intervals = turns.map((t) => ({ start: seqOf(t), origin: t.origin, end: ends.find((e) => seqOf(e) > seqOf(t))?.seq ?? Infinity }));
      for (const r of released) expect(intervals.filter((i) => i.origin === 'engine' && i.start < r.seq && r.seq < i.end).map((i) => `${r.seq} inside engine turn ${i.start}-${i.end}`)).toEqual([]);
    });
  }, LONG_CASE_MS);

  it('3.11 rewind the conversation', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.11', async (host) => {
      const spec = liveSpec(g.scratch());
      await host.launch(spec);
      const s = sessionView(host, spec);
      await s.send('Remember the word APPLE. Reply OK.');
      await s.waitTurns(1);
      const second = await s.send('Also remember the word BANANA. Reply OK.');
      await s.waitTurns(2);
      const out = await host.call('session.rewind', { appSessionId: s.id, targetMessageUuid: second.messageUuid!, lastSeenMessageUuid: second.messageUuid!, files: false });
      const boundary = await s.wait('boundary.rewind', 'the boundary', () => true, 5_000);
      console.log(`   RewindOutcome ${JSON.stringify(out)}; boundary.rewind seq ${boundary.seq} target ${boundary.targetMessageUuid}`);
      expect(out).toMatchObject({ rewound: true, prefillText: 'Also remember the word BANANA. Reply OK.' });
      expect(boundary.targetMessageUuid).toBe(second.messageUuid);
      await s.send('List every word I asked you to remember. Reply with only the words, comma separated.');
      const third = await s.waitTurns(3);
      console.log(`   turn 3 seq ${third.seq} ${JSON.stringify(third.resultText)}`);
      expect(third.resultText).toContain('APPLE');
      expect(third.resultText).not.toContain('BANANA');
    });
  }, LONG_CASE_MS);

  it('3.12 rewind with file checkpointing', async (ctx) => {
    const g = live(ctx);
    const variant = process.env.MAWS_LIVE_CHECKPOINT_SETTING === '1';
    let journalPath = '';
    let finding: string | null = null;
    await withHost(g, '3.12', async (host) => {
      const cwd = g.scratch();
      const spec = liveSpec(cwd, { extraSettings: variant ? { fileCheckpointingEnabled: true } : null });
      const { status } = await host.launch(spec);
      journalPath = status.journalPath;
      const s = sessionView(host, spec);
      await s.send('Use the Write tool to create notes.txt containing exactly the word ALPHA.');
      await s.waitTurns(1);
      const second = await s.send('Use the Edit tool to change notes.txt so it says BETA instead of ALPHA.');
      await s.waitTurns(2);
      const notes = join(realpathSync(cwd), 'notes.txt');
      console.log(`   notes.txt before the rewind: ${JSON.stringify(readFileSync(notes, 'utf8'))}`);
      const dry = await host.call('session.rewindFiles', { appSessionId: s.id, userMessageUuid: second.messageUuid!, dryRun: true });
      console.log(`   rewindFiles dry run ${JSON.stringify(dry)}${variant ? ' (fileCheckpointingEnabled variant)' : ''}`);
      if (!dry.enabled) {
        finding = `rewind_files dry run answered ${JSON.stringify(dry.message)}${variant ? ' with fileCheckpointingEnabled: true as well' : ''}`;
        return;
      }
      expect(dry).toEqual({ ok: true, enabled: true, message: null, dryRun: true, changedFiles: [notes], insertions: 1, deletions: 1, skippedLinks: null });
      const out = await host.call('session.rewind', { appSessionId: s.id, targetMessageUuid: second.messageUuid!, lastSeenMessageUuid: second.messageUuid!, files: true });
      const boundary = await s.wait('boundary.rewind', 'the boundary', () => true, 5_000);
      const onDisk = readFileSync(notes, 'utf8');
      console.log(`   RewindOutcome ${JSON.stringify(out)}; boundary.rewind seq ${boundary.seq}; notes.txt now ${JSON.stringify(onDisk)}`);
      expect(out).toMatchObject({ rewound: true, files: { canRewind: true, skippedLinks: 0, error: null } });
      expect(onDisk.trim()).toBe('ALPHA');
    });
    if (finding) {
      console.log(`   [finding] ${finding}`);
      ctx.skip(finding);
      return;
    }
    exportTo('rewind-files', journalPath, g);
  }, LONG_CASE_MS);

  it('3.13 direct launch', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.13', async (host) => {
      const spec = liveSpec(g.scratch(), { gateway: 'direct' });
      const { status } = await host.launch(spec);
      console.log(`   gateway ${JSON.stringify(status.gateway)}`);
      expect(status.gateway).toMatchObject({ mode: 'direct', verified: 'direct', baseUrl: null });
      const got = await host.call('session.getStatus', { appSessionId: spec.appSessionId });
      const session = got.sections.find((sec) => sec.title === 'Session')!;
      console.log(`   get_status Session rows: ${session.rows.map((r) => r.label).join(', ')}`);
      expect(session.rows.some((r) => r.label === 'Anthropic base URL')).toBe(false);
      const rows = readJournal(status.journalPath);
      const spawn = rows[0]!.frame as { event: string; args: string[]; envKeys: string[] };
      expect(spawn.event).toBe('spawn');
      const settings = JSON.parse(spawn.args[spawn.args.indexOf('--settings') + 1]!) as { env?: Record<string, string> };
      console.log(`   spawn --settings ${JSON.stringify(settings)}; envKeys has ANTHROPIC_BASE_URL: ${spawn.envKeys.includes('ANTHROPIC_BASE_URL')}`);
      expect(settings.env).toEqual({ ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '' });
      expect(spawn.envKeys).not.toContain('ANTHROPIC_BASE_URL');
      expect(outFrames(rows).filter((r) => r.frame.type === 'user')).toEqual([]);
    });
  });

  it('3.14 kill -9 with a pending approval, then resume', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.14', async (host) => {
      const spec = liveSpec(g.scratch(), { extraSettings: ASK_RULE });
      await host.launch(spec);
      const s = sessionView(host, spec);
      await s.send('Use Bash to run exactly `git log --oneline` (nothing else), then reply DONE.');
      const ask = await s.wait('permission.requested', 'the ask');
      const pid = s.status().pid!;
      process.kill(pid, 'SIGKILL');
      const exited = await s.wait('process.exited', 'the kill', () => true, 15_000);
      const items = host.brokerItems(s.id).at(-1) ?? [];
      console.log(`   kill -9 ${pid}; process.exited seq ${exited.seq} ${JSON.stringify({ reason: exited.reason, lostAttentionCount: exited.lostAttentionCount, signal: exited.signal })}; last brokerItems ${JSON.stringify(items.map((i) => [i.request.requestId, i.state]))}`);
      expect(exited).toMatchObject({ reason: 'crash', lostAttentionCount: 1 });
      expect(items.filter((i) => i.request.requestId === ask.requestId && (i.state === 'pending' || i.state === 'delivered'))).toEqual([]);

      const { status } = await host.launch({ ...spec, sessionId: null, resume: { sessionId: spec.sessionId!, fork: false } });
      await s.send('Reply OK');
      const ended = await host.waitFor(() => mainTurnsEnded(s.events()).find((t) => launchOf(t) === status.launchId), 'the resumed turn', TURN_MS);
      const asks = ofKind(s.events(), 'permission.requested').filter((e) => launchOf(e) === status.launchId);
      console.log(`   resumed turn.ended seq ${ended.seq} ${JSON.stringify(ended.resultText)}; permission.requested after resume: ${asks.length}`);
      expect(asks.filter((e) => e.toolUseId === ask.toolUseId)).toEqual([]);
      expect(asks).toEqual([]);
    });
  }, LONG_CASE_MS);

  it('3.15 bash mode echo and receipt', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.15', async (host) => {
      const spec = liveSpec(g.scratch());
      await host.launch(spec);
      const s = sessionView(host, spec);
      const { commandUuid } = await host.call('session.bash', { appSessionId: s.id, command: 'printf MAWS_BASH_LIVE' });
      const receipt = await s.wait('turn.ended', 'the echo receipt', (e) => e.isEchoReceipt);
      const messages = ofKind(s.events(), 'user.message');
      const input = messages.find((m) => m.bash?.part === 'input');
      const output = messages.find((m) => m.bash?.part === 'output');
      const echo = messages.find((m) => m.origin === 'bash_echo');
      console.log(`   bash ${commandUuid}: input seq ${input?.seq} ${JSON.stringify(input?.bash)}; output seq ${output?.seq} ${JSON.stringify(output?.bash)}; echo seq ${echo?.seq} synthetic ${echo?.isSynthetic}; receipt seq ${receipt.seq}`);
      expect(input?.bash).toEqual({ part: 'input', command: 'printf MAWS_BASH_LIVE' });
      expect(output?.bash).toMatchObject({ part: 'output', stdout: 'MAWS_BASH_LIVE', exitCode: 0 });
      expect(echo).toMatchObject({ isSynthetic: true });
      expect(seqOf(receipt)).toBeGreaterThan(seqOf(echo!));
      const echoFrame = outFrames(s.journal()).find((r) => r.frame.shouldQuery === false)!;
      console.log(`   echo out seq ${echoFrame.seq}: ${JSON.stringify((echoFrame.frame.message as { content: unknown }).content)}`);
      await s.send('What did my ! command print? Reply with only that text.');
      const ended = await s.waitTurns(1);
      console.log(`   turn.ended seq ${ended.seq} ${JSON.stringify(ended.resultText)}`);
      expect(ended.resultText).toContain('MAWS_BASH_LIVE');
    });
  }, LONG_CASE_MS);

  it('3.16 # memory append', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.16', async (host) => {
      const cwd = g.scratch();
      const spec = liveSpec(cwd);
      await host.launch(spec);
      const out = await host.call('session.memoryAppend', { appSessionId: spec.appSessionId, text: 'MAWS live test note', target: { kind: 'project', path: null } });
      const body = readFileSync(out.path, 'utf8');
      console.log(`   memoryAppend ${JSON.stringify(out)}; file ends ${JSON.stringify(body.slice(-40))}`);
      expect(realpathSync(out.path)).toBe(join(realpathSync(cwd), 'CLAUDE.md'));
      expect(body.trimEnd().endsWith('- MAWS live test note')).toBe(true);
    });
  });

  it('3.17 every structured read', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.17', async (host) => {
      const cwd = g.scratch();
      const spec = liveSpec(cwd);
      await host.launch(spec);
      const id = spec.appSessionId;
      const reads = [
        ['session.getUsage', {}], ['session.getContextUsage', { detail: 'summary' }], ['session.getSettings', {}], ['session.listPermissionRules', {}],
        ['session.getHooksListing', {}], ['session.getMemoryDialog', {}], ['session.getSkillsDialog', {}], ['session.getSandboxDialog', {}],
        ['session.getWorkspaceDiff', {}], ['session.exportConversation', {}], ['session.getStatus', {}], ['session.mcpStatus', {}],
        ['session.listModels', {}], ['session.getSessionCost', {}], ['session.getBinaryVersion', {}],
      ] as const;
      const answers = new Map<string, unknown>();
      for (const [name, extra] of reads) {
        const res = await host.callRaw(name, { appSessionId: id, ...extra } as never);
        console.log(`   ${name}: ${res.ok ? 'ok' : `error ${JSON.stringify(res.error)}`} in ${res.ms} ms`);
        expect(res.ok, name).toBe(true);
        expect(res.ms).toBeLessThan(8_000);
        if (res.ok) answers.set(name, res.value);
      }
      const settings = answers.get('session.getSettings') as { effective: { dialogExpiry?: unknown } };
      expect(settings.effective.dialogExpiry).toBe('never');
      const models = (answers.get('session.listModels') as { models: { value: string; supportsAutoMode?: unknown }[] }).models;
      console.log(`   listModels supportsAutoMode: ${models.map((m) => `${m.value}=${String(m.supportsAutoMode)}`).join(', ')}`);
      // the wire omits the flag where auto mode is unsupported (haiku here, as in pass2/auto-routed seq 143 models[4])
      for (const m of models) expect(['boolean', 'undefined'], m.value).toContain(typeof m.supportsAutoMode);
      expect(models.find((m) => m.value === 'sonnet')?.supportsAutoMode).toBe(true);
      expect(answers.get('session.getBinaryVersion')).toMatchObject({ version: ENGINE_VERSION });
      console.log(`   getSessionCost ${JSON.stringify(answers.get('session.getSessionCost'))}`);
      console.log(`   getWorkspaceDiff ${JSON.stringify(answers.get('session.getWorkspaceDiff')).slice(0, 300)}`);

      // Wire claims with no fixture before M6 (M5): observed, not asserted beyond answering.
      const observe = async (name: Parameters<LiveHost['callRaw']>[0], input: unknown) => {
        const res = await host.callRaw(name, input as never);
        console.log(`   observe ${name} ${JSON.stringify(input)} → ${JSON.stringify(res.ok ? res.value ?? null : res.error)}`);
        return res;
      };
      const effort = (await observe('session.setEffort', { appSessionId: id, effort: 'low' })).ok;
      const afterLow = await host.call('session.getSettings', { appSessionId: id });
      await observe('session.setEffort', { appSessionId: id, effort: null });
      const afterNull = await host.call('session.getSettings', { appSessionId: id });
      console.log(`   effortLevel after low: ${JSON.stringify((afterLow.effective as { effortLevel?: unknown }).effortLevel)}; after null: ${JSON.stringify((afterNull.effective as { effortLevel?: unknown }).effortLevel)} (setEffort ok ${effort})`);
      await observe('session.setThinking', { appSessionId: id, maxThinkingTokens: 4096, display: 'summarized' });
    });
    // `set_cwd` with trust records the directory as trusted in the config home's `.claude.json`: it persists, so it runs
    // under a scratch config home only (M6 review; the coordinator's live-acceptance rule). No model turn.
    await withHost(g, '3.17 (set_cwd trust, scratch home)', async (host) => {
      const cwd = g.scratch();
      const spec = liveSpec(cwd);
      await host.launch(spec);
      const sub = join(realpathSync(cwd), 'sub');
      mkdirSync(sub);
      const res = await host.callRaw('session.setCwd', { appSessionId: spec.appSessionId, path: sub, trust: { accepted: true, directory: sub } });
      console.log(`   observe session.setCwd (scratch home) → ${JSON.stringify(res.ok ? res.value : res.error)}`);
      expect(res).toMatchObject({ ok: true, value: { status: 'ok', cwd: sub } });
    }, new LiveHost({ userData: g.userData, configHome: scratchConfigHome(), controls: ['set_cwd:trust'] }));
  });

  it('3.18 host hook round trip', async (ctx) => {
    const g = live(ctx);
    const hooks = new HostHookRegistry();
    const seen: unknown[] = [];
    const callbackId = hooks.register('PreToolUse', 'Bash', (input) => {
      seen.push(input);
      return { continue: true, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'MAWS host hook saw this call.' } };
    }, 15);
    const spec = liveSpec(g.scratch());
    const { session, events } = await startDirectSession(g.userData, spec, hooks);
    try {
      await session.send('Use Bash to run exactly `echo HOOKED` (nothing else), then reply DONE.');
      const until = async <T,>(probe: () => T | undefined, what: string) => {
        const deadline = Date.now() + TURN_MS;
        for (;;) {
          const v = probe();
          if (v) return v;
          if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
          await new Promise((r) => setTimeout(r, 25));
        }
      };
      const requested = await until(() => ofKind(events, 'hook.callback_requested')[0], 'hook.callback_requested');
      const resolved = await until(() => ofKind(events, 'hook.callback_resolved')[0], 'hook.callback_resolved');
      const result = await until(() => ofKind(events, 'tool.result').find((e) => text(e.content).includes('HOOKED')), 'the Bash result');
      await until(() => mainTurnsEnded(events)[0], 'the turn');
      const listing = await getHooksListing(session.control!, {});
      console.log(`   hook.callback_requested seq ${requested.seq} ${requested.callbackId} ${requested.hookEvent}; resolved seq ${resolved.seq}; tool.result seq ${result.seq}; listing mentions ${callbackId}: ${JSON.stringify(listing).includes(callbackId)}`);
      expect(requested.callbackId).toBe(callbackId);
      expect(resolved.callbackId).toBe(callbackId);
      expect(seen).toHaveLength(1);
      expect(JSON.stringify(listing)).not.toContain(callbackId);
    } finally {
      await session.stop('stop');
      book('3.18', session.status().journalPath, events, spec.sessionId!);
    }
  }, LONG_CASE_MS);

  it('3.19 MCP elicitation round trip', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.19', async (host) => {
      const server = join(REPO_ROOT, 'spikes/protocol-probe/scenarios/pass2/elicit-mcp-server.mjs');
      const spec = liveSpec(g.scratch(), { mcpConfig: { mcpServers: { 'maws-elicit': { type: 'stdio', command: process.execPath, args: [server] } } } });
      await host.launch(spec, 30_000);
      const s = sessionView(host, spec);
      await s.send('Call the mcp__maws-elicit__ask_color tool once, then reply with the color it returned.');
      const first = await host.waitFor<Ev<'elicitation.requested'> | Ev<'permission.requested'>>(() => ofKind(s.events(), 'elicitation.requested')[0] ?? ofKind(s.events(), 'permission.requested')[0], 'the elicitation', TURN_MS);
      if (first.kind === 'permission.requested') {
        console.log(`   the MCP call asked permission first (seq ${first.seq}, ${first.decisionReasonType}); allowing once`);
        await s.answer(first.requestId, { kind: 'permission', decision: 'allow', scope: 'once' });
      }
      const elicitation = await s.wait('elicitation.requested', 'the form');
      expect(elicitation.mode).toBe('form');
      expect(await s.answer(elicitation.requestId, { kind: 'elicitation', action: 'accept', content: { color: 'teal' } })).toEqual({ outcome: 'delivered' });
      const result = await s.wait('tool.result', 'the MCP result', (e) => text(e.content).includes('teal'));
      console.log(`   elicitation.requested seq ${elicitation.seq} mode ${elicitation.mode} server ${elicitation.mcpServerName}; tool.result seq ${result.seq} ${text(result.content).slice(0, 120)}`);
      await s.waitTurns(1);
    });
  }, LONG_CASE_MS);

  // The owner's user settings deny ExitPlanMode and EnterPlanMode (`permissions.deny`), so under the real setting
  // sources the plan tool does not exist and no plan approval can happen (a live 3.20 run: the model found no
  // ExitPlanMode through ToolSearch and wrote its plan to a file instead). The case checks that first, with no model
  // turn, and then runs its three outcomes in a process whose user settings layer is a scratch CLAUDE_CONFIG_DIR, the
  // launch line and everything else unchanged (flag settings cannot lift a deny: deny rules union across sources).
  it('3.20 plan approval: keep planning, implement, clear and implement', async (ctx) => {
    const g = live(ctx);
    let journalPath = '';
    let denied = false;
    await withHost(g, '3.20 (owner settings)', async (host) => {
      const spec = liveSpec(g.scratch());
      await host.launch(spec);
      const settings = await host.call('session.getSettings', { appSessionId: spec.appSessionId });
      const deny = ((settings.effective as { permissions?: { deny?: string[] } }).permissions?.deny ?? []).filter((rule) => /PlanMode/.test(rule));
      denied = deny.includes('ExitPlanMode');
      console.log(`   owner settings deny ${JSON.stringify(deny)}${denied ? ': plan approval cannot occur under them; running under a scratch user config' : ''}`);
    });
    const scratchHost = new LiveHost({ userData: g.userData, configHome: denied ? scratchConfigHome() : null });
    await withHost(g, '3.20', async (host) => {
      const spec = liveSpec(g.scratch());
      const { status } = await host.launch(spec);
      journalPath = status.journalPath;
      const s = sessionView(host, spec);
      const plans = () => ofKind(s.events(), 'plan.requested');
      const setPlan = async () => {
        const mode = await host.call('session.setPermissionMode', { appSessionId: s.id, mode: 'plan' });
        console.log(`   setPermissionMode(plan) ${JSON.stringify(mode)}`);
        expect(mode.effective).toBe('plan');
      };
      const PLAN = (file: string, word: string) =>
        `Plan how to create a file named ${file} containing the single word ${word}. The repository is tiny: do not explore it and do not launch agents. Present the plan with ExitPlanMode right away.`;

      await setPlan();
      await s.send(PLAN('plan.txt', 'PLANNED'));
      const p1 = await host.waitFor(() => plans()[0], 'the first plan', TURN_MS);
      const feedback = 'Also state that the file must end with a newline.';
      await s.answer(p1.requestId, { kind: 'plan', outcome: 'keep_planning', feedback });
      const r1 = await s.wait('plan.resolved', 'keep planning', (e) => e.requestId === p1.requestId);
      const t1 = await s.wait('tool.result', 'the feedback', (e) => e.toolUseId === p1.toolUseId);
      console.log(`   plan.requested seq ${p1.seq}; plan.resolved seq ${r1.seq} ${r1.outcome}; tool.result seq ${t1.seq} ${text(t1.content).slice(0, 200)}`);
      expect(r1.outcome).toBe('keep_planning');
      expect(text(t1.content)).toContain(feedback);
      const p2 = await host.waitFor(() => plans()[1], 'the second plan', TURN_MS);
      await s.answer(p2.requestId, { kind: 'plan', outcome: 'implement', feedback: null });
      const r2 = await s.wait('plan.resolved', 'implement', (e) => e.requestId === p2.requestId);
      const t2 = await s.waitTurns(1);
      console.log(`   plan.requested seq ${p2.seq}; plan.resolved seq ${r2.seq} ${r2.outcome}; turn.ended seq ${t2.seq}; status mode ${s.status().permissionMode.effective}`);
      expect(r2.outcome).toBe('implement');
      await s.send('Reply with exactly MODE_OK');
      await s.waitTurns(2);
      const inits = ofKind(s.events(), 'session.init');
      const lastInit = inits.at(-1)!;
      console.log(`   session.init after implement: seq ${lastInit.seq} permissionMode ${lastInit.permissionMode}`);
      expect(lastInit.permissionMode).toBe('auto');

      await setPlan();
      await s.send(PLAN('second.txt', 'SECOND'));
      const p3 = await host.waitFor(() => plans()[2], 'the third plan', TURN_MS);
      const turnsBefore = ofKind(s.events(), 'turn.started').length;
      await s.answer(p3.requestId, { kind: 'plan', outcome: 'clear_and_implement', feedback: null });
      const r3 = await s.wait('plan.resolved', 'clear and implement', (e) => e.requestId === p3.requestId);
      const reset = await s.wait('boundary.reset', 'the reset');
      const implement = await host.waitFor(
        () => ofKind(s.events(), 'user.message').find((m) => seqOf(m) > seqOf(reset) && m.origin === 'human' && text(m.content).startsWith('Implement this plan:')),
        'the implement prompt',
        TURN_MS,
      );
      const started = ofKind(s.events(), 'turn.started').slice(turnsBefore).find((t) => t.userMessageUuid === implement.messageUuid);
      const done = await host.waitFor(() => mainTurnsEnded(s.events()).find((t) => t.userMessageUuids.includes(implement.messageUuid!)), 'the implement turn', TURN_MS);
      console.log(`   plan.requested seq ${p3.seq}; plan.resolved seq ${r3.seq} ${r3.outcome}; boundary.reset seq ${reset.seq}; implement user.message seq ${implement.seq}; turn.started seq ${started?.seq}; turn.ended seq ${done.seq}`);
      expect(r3.outcome).toBe('clear_and_implement');
      expect(started).toBeDefined();
    }, scratchHost);
    exportTo('plan-outcomes', journalPath, g);
  }, LONG_CASE_MS);

  it('3.21 shutdown', async (ctx) => {
    const g = live(ctx);
    await withHost(g, '3.21', async (host) => {
      const a = liveSpec(g.scratch());
      const b = liveSpec(g.scratch());
      const pa = (await host.launch(a)).status.pid!;
      const pb = (await host.launch(b)).status.pid!;
      const started = Date.now();
      const answer = await host.call('engine.shutdown', { graceMs: 5_000 });
      const ms = Date.now() - started;
      const exits = [a, b].map((spec) => ofKind(host.events(spec.appSessionId), 'process.exited')[0]);
      console.log(`   engine.shutdown ${JSON.stringify(answer)} in ${ms} ms; exits ${JSON.stringify(exits.map((e) => e && { seq: e.seq, reason: e.reason, code: e.code }))}`);
      expect(answer).toEqual({ stopped: 2, forced: 0 });
      expect(ms).toBeLessThan(8_000);
      for (const e of exits) expect(e?.reason).toBe('quit');
      let listed: string;
      try {
        listed = execFileSync('/bin/ps', ['-p', `${pa},${pb}`, '-o', 'pid='], { encoding: 'utf8' });
      } catch {
        listed = ''; // ps exits 1 when no process matched
      }
      console.log(`   ps -p ${pa},${pb}: ${JSON.stringify(listed.trim())}`);
      expect(listed.trim()).toBe('');
    });
  });

  // W1 (UX fundamentals wave W1): what the engine does with a `next` steer around an interrupt and a `now` steer, what a
  // delivered `next` writes to the main transcript, and /compact on the wire and on disk. Each case runs under a scratch
  // config home and exports its journal and its main transcript (redacted) with the run's other exports; its
  // assertions record what the live run showed (they document the engine, they do not gate the product).
  // W1
  it('W1 next steer at an interrupt', async (ctx) => {
    const g = live(ctx);
    const configHome = scratchConfigHome();
    let journalPath = '';
    let engineSessionId = '';
    await withHost(g, 'W1 next at interrupt', async (host) => {
      const spec = liveSpec(g.scratch());
      const { status } = await host.launch(spec);
      journalPath = status.journalPath;
      engineSessionId = spec.sessionId!;
      const s = sessionView(host, spec);
      const first = await s.send(SLOW_COUNT(6));
      const use = await s.wait('tool.use', 'the first Bash call', (e) => e.toolName === 'Bash');
      const { messageUuid: steer } = await host.call('session.steer', { appSessionId: s.id, content: 'Reply STEER_A', priority: 'next' });
      await delay(500);
      const answer = await host.call('session.interrupt', { appSessionId: s.id, cancelEngineQueued: false });
      const names: Record<string, string> = { [first.messageUuid!]: 'first', [steer]: 'steer' };
      const ended = await s.waitTurns(1);
      console.log(`   first Bash tool.use seq ${use.seq}; interrupt answer ${JSON.stringify(answer)}; turn 1 ended seq ${ended.seq} ${ended.terminalReason} [${ended.userMessageUuids.map((u) => names[u] ?? u).join(',')}]`);
      await w1Quiet(host, s.id, 20_000, 120_000);
      const namedBefore = mainTurnsEnded(s.events()).some((t) => t.userMessageUuids.includes(steer));
      console.log(`   after 20 s quiet: steer lifecycle [${w1Lifecycle(s.events(), steer).join(',')}]; a result named the steer: ${namedBefore}; queue ${JSON.stringify(s.status().queue)}`);
      await host.call('session.queue.setPaused', { appSessionId: s.id, paused: false });
      const plain = await s.send('Reply PLAIN');
      names[plain.messageUuid!] = 'plain';
      await host.waitFor(() => mainTurnsEnded(s.events()).find((t) => t.userMessageUuids.includes(plain.messageUuid!)), 'a result naming the plain message', TURN_MS);
      await w1Quiet(host, s.id, 10_000, 120_000);
      console.log(`   steer lifecycle at the end [${w1Lifecycle(s.events(), steer).join(',')}]`);
      const events = s.events();
      for (const line of w1Timeline(events, names)) console.log(`   ${line}`);
      const steerOut = outFrames(s.journal()).find((r) => r.frame.type === 'user' && r.frame.uuid === steer)!;
      expect(steerOut.frame.priority).toBe('next');
      // observed (first run, pass3/steer-next-interrupted): the interrupt leaves the undelivered `next` steer in the
      // engine's queue (still_queued names it), the aborted turn's result names only the first prompt, whose lifecycle
      // then turns `cancelled`, and the engine at once starts the steer as a turn of its own, with no further user frame
      expect(answer).toEqual({ stillQueued: [steer], cancelled: [] });
      expect(ended.terminalReason).toBe('aborted_tools');
      expect(ended.userMessageUuids).toEqual([first.messageUuid]);
      expect(ofKind(events, 'command.lifecycle').filter((e) => e.commandUuid === first.messageUuid).map((e) => e.state)).toEqual(['queued', 'started', 'cancelled']);
      expect(ofKind(events, 'command.lifecycle').filter((e) => e.commandUuid === steer).map((e) => e.state)).toEqual(['queued', 'started', 'completed']);
      const steerTurn = mainTurnsEnded(events).find((t) => t.userMessageUuids.includes(steer))!;
      expect(namedBefore).toBe(true);
      expect(steerTurn.userMessageUuids).toEqual([steer]);
      expect(steerTurn.resultText).toContain('STEER_A');
      expect(ofKind(events, 'turn.started').find((e) => e.userMessageUuid === steer)?.origin).toBe('human');
    }, new LiveHost({ userData: g.userData, configHome }));
    exportTo('steer-next-interrupted', journalPath, g);
    const records = exportTranscript('w1-steer-next-interrupted', configHome, engineSessionId, g);
    // on disk the steer is an ordinary user record after the interrupt marker, not a queued_command attachment
    const steerRecord = records.find((r) => r.type === 'user' && r.message?.content === 'Reply STEER_A');
    expect(records.find((r) => r.uuid === steerRecord?.parentUuid)?.message?.content).toEqual([{ type: 'text', text: '[Request interrupted by user for tool use]' }]);
    expect(records.filter((r) => r.attachment?.type === 'queued_command')).toEqual([]);
  }, LONG_CASE_MS);

  // W1
  it('W1 next steer then now steer', async (ctx) => {
    const g = live(ctx);
    const configHome = scratchConfigHome();
    let journalPath = '';
    let engineSessionId = '';
    await withHost(g, 'W1 next then now', async (host) => {
      const spec = liveSpec(g.scratch());
      const { status } = await host.launch(spec);
      journalPath = status.journalPath;
      engineSessionId = spec.sessionId!;
      const s = sessionView(host, spec);
      const first = await s.send(SLOW_COUNT(6));
      const use = await s.wait('tool.use', 'the first Bash call', (e) => e.toolName === 'Bash');
      // the call is running: the message carrying it has stopped (a first run sent both steers before that, while the
      // message still streamed, and `now` aborted the stream: terminal reason aborted_streaming, the call never ran)
      await host.waitFor(() => s.journal().some((r) => r.seq > seqOf(use) && (r.frame as { event?: { type?: string } }).event?.type === 'message_stop'), 'the message carrying the call stopped', 10_000);
      await delay(500);
      const { messageUuid: a } = await host.call('session.steer', { appSessionId: s.id, content: 'Reply STEER_A', priority: 'next' });
      const { messageUuid: b } = await host.call('session.steer', { appSessionId: s.id, content: 'Reply STEER_B', priority: 'now' });
      const names: Record<string, string> = { [first.messageUuid!]: 'first', [a]: 'A(next)', [b]: 'B(now)' };
      const settled = (u: string) => mainTurnsEnded(s.events()).some((t) => t.userMessageUuids.includes(u as MessageUuid)) || ofKind(s.events(), 'command.lifecycle').some((e) => e.commandUuid === u && e.state !== 'queued' && e.state !== 'started');
      await host.waitFor(() => settled(a) && settled(b) && settled(first.messageUuid!), 'a fate for both steers and the first prompt', LONG_CASE_MS - 90_000);
      await w1Quiet(host, s.id, 15_000, 120_000);
      console.log(`   first Bash tool.use seq ${use.seq}; A lifecycle [${w1Lifecycle(s.events(), a).join(',')}]; B lifecycle [${w1Lifecycle(s.events(), b).join(',')}]`);
      const events = s.events();
      for (const line of w1Timeline(events, names)) console.log(`   ${line}`);
      const out = outFrames(s.journal()).filter((r) => r.frame.type === 'user' && (r.frame.uuid === a || r.frame.uuid === b));
      expect(out.map((r) => r.frame.priority)).toEqual(['next', 'now']);
      // observed (pass3/steer-next-then-now): `now` aborts the running call and the turn (no interrupt marker on the
      // wire); `now` then runs as its own turn first, and the earlier `next` as another turn after it, each result naming
      // only its own prompt; neither folds into the other's turn
      const turns = mainTurnsEnded(events);
      const lifecycle = (u: string) => ofKind(events, 'command.lifecycle').filter((e) => e.commandUuid === u);
      expect(turns.map((t) => t.userMessageUuids)).toEqual([[first.messageUuid], [b], [a]]);
      expect(turns[0]!.terminalReason).toBe('aborted_tools');
      expect(ofKind(events, 'tool.result').find((e) => e.toolUseId === use.toolUseId)).toMatchObject({ isError: true, content: '<error>Command was aborted before completion</error>' });
      expect(lifecycle(first.messageUuid!).map((e) => e.state)).toEqual(['queued', 'started', 'cancelled']);
      expect(lifecycle(a).map((e) => e.state)).toEqual(['queued', 'started', 'completed']);
      expect(lifecycle(b).map((e) => e.state)).toEqual(['queued', 'started', 'completed']);
      expect(seqOf(lifecycle(b)[1]!)).toBeLessThan(seqOf(lifecycle(a)[1]!));
      expect([turns[1]!.resultText, turns[2]!.resultText]).toEqual(['STEER_B', 'STEER_A']);
      expect(ofKind(events, 'user.message').filter((m) => m.origin === 'interrupt-marker')).toEqual([]);
    }, new LiveHost({ userData: g.userData, configHome }));
    exportTo('steer-next-then-now', journalPath, g);
    const records = exportTranscript('w1-steer-next-then-now', configHome, engineSessionId, g);
    expect(records.filter((r) => r.type === 'user' && typeof r.message?.content === 'string').map((r) => r.message!.content).slice(1)).toEqual(['Reply STEER_B', 'Reply STEER_A']);
  }, LONG_CASE_MS);

  // W1
  it('W1 delivered next steer on disk', async (ctx) => {
    const g = live(ctx);
    const configHome = scratchConfigHome();
    let journalPath = '';
    let engineSessionId = '';
    await withHost(g, 'W1 next on disk', async (host) => {
      const spec = liveSpec(g.scratch());
      const { status } = await host.launch(spec);
      journalPath = status.journalPath;
      engineSessionId = spec.sessionId!;
      const s = sessionView(host, spec);
      const first = await s.send(SLOW_COUNT(1));
      await s.wait('tool.result', 'the first count');
      const { messageUuid: next } = await host.call('session.steer', { appSessionId: s.id, content: 'Reply NEXT_OK', priority: 'next' });
      const names: Record<string, string> = { [first.messageUuid!]: 'first', [next]: 'next' };
      const answered = await host.waitFor(() => mainTurnsEnded(s.events()).find((t) => t.userMessageUuids.includes(next as MessageUuid)), 'a result naming the next steer', LONG_CASE_MS - 90_000);
      await w1Quiet(host, s.id, 5_000, TURN_MS);
      for (const line of w1Timeline(s.events(), names)) console.log(`   ${line}`);
      expect(answered.userMessageUuids).toEqual([first.messageUuid, next]); // 3.7n's fold, again
      expect(ofKind(s.events(), 'turn.started').filter((e) => e.parentToolUseId === null)).toHaveLength(1);
    }, new LiveHost({ userData: g.userData, configHome }));
    exportTo('steer-next-disk-live', journalPath, g);
    const records = exportTranscript('w1-steer-next-disk', configHome, engineSessionId, g);
    // observed (test/fixtures/transcripts/w1-steer-next-disk.jsonl): the folded steer is written only as a
    // `queued_command` attachment chained under the tool result it rode in with (no user record carries its uuid), with
    // a queue-operation enqueue and a `remove` for reason absorbed_mid_turn
    const steerUuid = outFrames(readJournal(journalPath)).find((r) => r.frame.type === 'user' && r.frame.priority === 'next')!.frame.uuid;
    const queued = records.filter((r) => r.attachment?.type === 'queued_command');
    expect(queued.map((r) => r.attachment)).toEqual([{ type: 'queued_command', prompt: 'Reply NEXT_OK', source_uuid: steerUuid, commandMode: 'prompt', origin: { kind: 'human' }, timestamp: expect.any(String), humanTurn: true }]);
    expect(records.filter((r) => r.uuid === steerUuid)).toEqual([]);
    const parent = records.find((r) => r.uuid === queued[0]!.parentUuid);
    expect(parent?.type).toBe('user');
    expect((parent?.message?.content as { type?: string }[])[0]?.type).toBe('tool_result');
    expect(records.filter((r) => r.type === 'queue-operation' && r.content === 'Reply NEXT_OK').map((r) => [r.operation, r.reason])).toEqual([['enqueue', undefined], ['remove', 'absorbed_mid_turn']]);
  }, LONG_CASE_MS);

  // Blocking hooks from the user settings layer MAWS launches with (the scratch home's settings.json, so no project
  // trust is involved): a UserPromptSubmit hook that blocks a prompt naming BLOCKME (exit 2, its reason on stderr), and
  // a Stop hook that blocks the first stop of each session with a reason on stdout and lets every later stop through.
  // W1
  it('W1 blocking hooks', async (ctx) => {
    const g = live(ctx);
    const configHome = scratchConfigHome();
    const gate = join(configHome, 'prompt-gate.sh');
    const stopOnce = join(configHome, 'stop-once.sh');
    writeFileSync(gate, '#!/bin/sh\n# exit 2 with a reason on stderr when the prompt names BLOCKME\nif grep -q BLOCKME; then echo BLOCKED_BY_TEST_HOOK >&2; exit 2; fi\nexit 0\n', { mode: 0o755 });
    writeFileSync(
      stopOnce,
      `#!/bin/sh\n# block the first stop of each session, let every later one through\ninput=$(cat)\nsid=$(printf '%s' "$input" | sed -n 's/.*"session_id" *: *"\\([^"]*\\)".*/\\1/p')\nmarker="$(dirname "$0")/stop-fired-$sid"\nif [ ! -e "$marker" ]; then : > "$marker"; echo '{"decision":"block","reason":"Say REPROMPTED and stop"}'; fi\nexit 0\n`,
      { mode: 0o755 },
    );
    writeFileSync(join(configHome, 'settings.json'), `${JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: gate }] }], Stop: [{ hooks: [{ type: 'command', command: stopOnce }] }] } }, null, 2)}\n`);
    let journalPath = '';
    let engineSessionId = '';
    await withHost(g, 'W1 hooks', async (host) => {
      const spec = liveSpec(g.scratch());
      const { status } = await host.launch(spec);
      journalPath = status.journalPath;
      engineSessionId = spec.sessionId!;
      const s = sessionView(host, spec);
      const one = await s.send('Reply ONE');
      const names: Record<string, string> = { [one.messageUuid!]: 'ONE' };
      await host.waitFor(() => mainTurnsEnded(s.events()).find((t) => t.userMessageUuids.includes(one.messageUuid!)), 'a result naming ONE', TURN_MS);
      await w1Quiet(host, s.id, 5_000, TURN_MS);
      const blocked = await s.send('BLOCKME please reply TWO');
      names[blocked.messageUuid!] = 'BLOCKME';
      const fate = () =>
        mainTurnsEnded(s.events()).some((t) => t.userMessageUuids.includes(blocked.messageUuid!)) ||
        ofKind(s.events(), 'command.lifecycle').some((e) => e.commandUuid === blocked.messageUuid && e.state !== 'queued' && e.state !== 'started');
      await host.waitFor(fate, 'a fate for the BLOCKME prompt', 60_000).catch((error: unknown) => console.log(`   ${String(error)}`));
      await w1Quiet(host, s.id, 8_000, 60_000);
      console.log(`   BLOCKME send ${JSON.stringify({ disposition: blocked.disposition })}; lifecycle [${w1Lifecycle(s.events(), blocked.messageUuid!).join(',')}]; status turn ${JSON.stringify(s.status().turn)} queue ${JSON.stringify(s.status().queue)}`);
      const events = s.events();
      for (const line of w1Timeline(events, names)) console.log(`   ${line}`);
      const hookFrames = s.journal().filter((r) => r.direction === 'in' && /^hook_/.test(String((r.frame as { subtype?: unknown }).subtype)));
      for (const r of hookFrames) console.log(`   ${r.seq} ${JSON.stringify(r.frame).slice(0, 500)}`);
      expect(hookFrames.length).toBeGreaterThan(0); // the engine loaded the user-layer hooks
      // observed (pass3/hooks-blocking): the Stop hook's block keeps the turn going inside the same result (a synthetic
      // user frame carries "Stop hook feedback:" and the reason, a `notification` notice follows, the model answers, the
      // Stop hook runs again); the blocked prompt starts a turn (started lifecycle, system/init) that ends in a
      // zero-turn success result carrying the block message, with no replayed user frame and no assistant message
      const finished = ofKind(events, 'hook.finished');
      expect(finished.map((e) => [e.hookEvent, e.outcome, e.exitCode])).toEqual([['UserPromptSubmit', 'success', 0], ['Stop', 'success', 0], ['Stop', 'success', 0], ['UserPromptSubmit', 'error', 2]]);
      expect(finished[1]!.stdout).toBe('{"decision":"block","reason":"Say REPROMPTED and stop"}\n');
      expect(finished[3]!.stderr).toBe('BLOCKED_BY_TEST_HOOK\n');
      const feedback = ofKind(events, 'user.message').find((m) => m.isSynthetic && text(m.content).includes('Stop hook feedback:'));
      expect(text(feedback?.content)).toContain('Say REPROMPTED and stop');
      const [oneTurn, blockedTurn] = mainTurnsEnded(events);
      expect(oneTurn).toMatchObject({ userMessageUuids: [one.messageUuid], terminalReason: 'completed', numTurns: 2 });
      expect(blockedTurn).toMatchObject({ userMessageUuids: [blocked.messageUuid], isError: false, numTurns: 0, terminalReason: null });
      expect(blockedTurn!.resultText).toContain('UserPromptSubmit operation blocked by hook:');
      expect(blockedTurn!.resultText).toContain('BLOCKED_BY_TEST_HOOK');
      expect(ofKind(events, 'turn.started').find((e) => e.userMessageUuid === blocked.messageUuid)).toBeDefined();
      expect(w1Lifecycle(events, blocked.messageUuid!).map((st) => st.split('@')[0])).toEqual(['queued', 'started', 'completed']);
      expect(ofKind(events, 'assistant.block.complete').filter((e) => seqOf(e) > seqOf(ofKind(events, 'turn.started').at(-1)!))).toEqual([]);
    }, new LiveHost({ userData: g.userData, configHome }));
    exportTo('hooks-blocking', journalPath, g);
    const records = exportTranscript('w1-hooks-blocking', configHome, engineSessionId, g);
    // on disk: the Stop block is a meta user record, a hook_blocking_error attachment and a stop_hook_summary; the
    // blocked prompt leaves no user record, only its queue operations and a system/informational record
    expect(records.filter((r) => r.type === 'user' && r.isMeta === true).map((r) => r.message?.content)).toEqual(['Stop hook feedback:\nSay REPROMPTED and stop']);
    expect(records.filter((r) => r.attachment?.type === 'hook_blocking_error')).toHaveLength(1);
    expect(records.filter((r) => r.type === 'system' && r.subtype === 'stop_hook_summary')).toHaveLength(2);
    expect(records.filter((r) => r.type === 'user' && JSON.stringify(r.message?.content).includes('BLOCKME'))).toEqual([]);
    expect(records.filter((r) => r.type === 'system' && r.subtype === 'informational').map((r) => r.preventContinuation)).toEqual([true]);
  }, LONG_CASE_MS);

  // Debt wave 7 (C4): W1's blocking hooks with the forms flipped, for the disk records C4's backfill reads a hook that
  // got in the way from: a Stop hook that blocks the first stop of each session by exiting 2 (its reason on stderr), and
  // a UserPromptSubmit hook that blocks by JSON (`decision: block`), once with the original prompt kept and once with
  // `suppressOriginalPrompt`; then an ordinary prompt, to see where the next turn hangs on the chain after a block.
  it('debt wave 7: blocking hooks, forms flipped', async (ctx) => {
    const g = live(ctx);
    const configHome = scratchConfigHome();
    const gate = join(configHome, 'prompt-gate.sh');
    const stopOnce = join(configHome, 'stop-once.sh');
    writeFileSync(
      gate,
      `#!/bin/sh\n# block by JSON a prompt naming BLOCKQUIET (suppressing the prompt) or BLOCKME\ninput=$(cat)\nif printf '%s' "$input" | grep -q BLOCKQUIET; then echo '{"decision":"block","reason":"QUIET_BLOCK","hookSpecificOutput":{"hookEventName":"UserPromptSubmit","suppressOriginalPrompt":true}}'; exit 0; fi\nif printf '%s' "$input" | grep -q BLOCKME; then echo '{"decision":"block","reason":"BLOCKED_BY_JSON_HOOK"}'; exit 0; fi\nexit 0\n`,
      { mode: 0o755 },
    );
    writeFileSync(
      stopOnce,
      `#!/bin/sh\n# block the first stop of each session by exiting 2, let every later one through\ninput=$(cat)\nsid=$(printf '%s' "$input" | sed -n 's/.*"session_id" *: *"\\([^"]*\\)".*/\\1/p')\nmarker="$(dirname "$0")/stop-fired-$sid"\nif [ ! -e "$marker" ]; then : > "$marker"; echo 'REPROMPT_BY_EXIT_2' >&2; exit 2; fi\nexit 0\n`,
      { mode: 0o755 },
    );
    writeFileSync(join(configHome, 'settings.json'), `${JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: gate }] }], Stop: [{ hooks: [{ type: 'command', command: stopOnce }] }] } }, null, 2)}\n`);
    let journalPath = '';
    let engineSessionId = '';
    let events: SessionEvent[] = [];
    await withHost(g, 'DW7 hooks flipped', async (host) => {
      const spec = liveSpec(g.scratch());
      const { status } = await host.launch(spec);
      journalPath = status.journalPath;
      engineSessionId = spec.sessionId!;
      const s = sessionView(host, spec);
      const names: Record<string, string> = {};
      for (const [name, prompt] of [['ONE', 'Reply ONE'], ['BLOCKME', 'BLOCKME please reply TWO'], ['BLOCKQUIET', 'BLOCKQUIET please reply THREE'], ['FOUR', 'Reply FOUR']] as const) {
        const sent = await s.send(prompt);
        names[sent.messageUuid!] = name;
        await host.waitFor(() => mainTurnsEnded(s.events()).find((t) => t.userMessageUuids.includes(sent.messageUuid!)), `a result naming ${name}`, TURN_MS);
        await w1Quiet(host, s.id, 5_000, TURN_MS);
      }
      events = s.events();
      for (const line of w1Timeline(events, names)) console.log(`   ${line}`);
    }, new LiveHost({ userData: g.userData, configHome }));
    exportTo('hooks-flipped', journalPath, g, DW7_PROVENANCE);
    const records = exportTranscript('dw7-hooks-flipped', configHome, engineSessionId, g);
    // on the wire, as W1 saw the other forms: the exit-2 Stop hook reads `error` with exit 2, the JSON prompt blocks `success`
    const finished = ofKind(events, 'hook.finished');
    expect(finished.map((e) => [e.hookEvent, e.outcome, e.exitCode])).toEqual([
      ['UserPromptSubmit', 'success', 0], ['Stop', 'error', 2], ['Stop', 'success', 0],
      ['UserPromptSubmit', 'success', 0], ['UserPromptSubmit', 'success', 0],
      ['UserPromptSubmit', 'success', 0], ['Stop', 'success', 0],
    ]);
    expect(finished[1]!.stderr).toBe('REPROMPT_BY_EXIT_2\n');
    expect(finished[3]!.stdout).toBe('{"decision":"block","reason":"BLOCKED_BY_JSON_HOOK"}\n');
    // observed (test/fixtures/transcripts/dw7-hooks-flipped.jsonl): an exit-2 Stop block is a meta user record
    // "Stop hook feedback:\n[<command>]: <stderr>" and a stop_hook_summary listing it, with no hook_blocking_error
    // attachment (the engine writes that for a JSON block only); a JSON prompt block's informational carries the reason
    // with no command, and "Original prompt:" only when the hook did not suppress it; the next prompt hangs on the
    // last block's informational record
    const feedback = records.filter((r) => r.type === 'user' && r.isMeta === true && String(r.message?.content).startsWith('Stop hook feedback:'));
    expect(feedback.map((r) => r.message?.content)).toEqual([`Stop hook feedback:\n[${stopOnce}]: REPROMPT_BY_EXIT_2\n`]);
    expect(records.filter((r) => r.attachment?.type === 'hook_blocking_error')).toEqual([]);
    const informational = records.filter((r) => r.type === 'system' && r.subtype === 'informational');
    expect(informational.map((r) => r.content)).toEqual([
      'UserPromptSubmit operation blocked by hook:\nBLOCKED_BY_JSON_HOOK\n\nOriginal prompt: BLOCKME please reply TWO',
      'UserPromptSubmit operation blocked by hook:\nQUIET_BLOCK',
    ]);
    expect(records.filter((r) => r.type === 'user' && JSON.stringify(r.message?.content).includes('BLOCK'))).toEqual([]);
    const four = records.find((r) => r.type === 'user' && r.message?.content === 'Reply FOUR');
    expect(four?.parentUuid).toBe(informational[1]!.uuid);
  }, LONG_CASE_MS);

  // "Hold until the turn ends" on a pending `next` steer: cancel_async_message withdraws it from the engine's queue. No
  // X2 command wraps the control, so the case drives the session's control client raw. The engine reads the steer's
  // uuid from `message_uuid`; the first request is sent in the shape src/shared/wire/control.ts declares
  // (CancelAsyncMessageRequest `{ uuid }`) to record what that shape does. After the turn, a delivered uuid is cancelled.
  // W1
  it('W1 next steer withdrawn by cancel_async_message', async (ctx) => {
    const g = live(ctx);
    const configHome = scratchConfigHome();
    let journalPath = '';
    let engineSessionId = '';
    let steerUuid = '';
    await withHost(g, 'W1 next cancelled', async (host) => {
      const spec = liveSpec(g.scratch());
      const { status } = await host.launch(spec);
      journalPath = status.journalPath;
      engineSessionId = spec.sessionId!;
      const s = sessionView(host, spec);
      const control = host.ipc.table.get(spec.appSessionId as AppSessionId)!.control!;
      const cancel = (payload: Record<string, unknown>) => control.requestRaw('cancel_async_message', payload).catch((error: unknown) => ({ error: String(error) }));
      const first = await s.send(SLOW_COUNT(6));
      const use = await s.wait('tool.use', 'the first Bash call', (e) => e.toolName === 'Bash');
      await host.waitFor(() => s.journal().some((r) => r.seq > seqOf(use) && (r.frame as { event?: { type?: string } }).event?.type === 'message_stop'), 'the message carrying the call stopped', 10_000);
      await delay(500);
      const { messageUuid: steer } = await host.call('session.steer', { appSessionId: s.id, content: 'Reply STEER_A', priority: 'next' });
      steerUuid = steer;
      await delay(1_000);
      const declaredShape = await cancel({ uuid: steer });
      const withdrawn = await cancel({ message_uuid: steer });
      console.log(`   cancel_async_message { uuid } → ${JSON.stringify(declaredShape)}; { message_uuid } → ${JSON.stringify(withdrawn)}; steer lifecycle [${w1Lifecycle(s.events(), steer).join(',')}]`);
      const ended = await s.waitTurns(1, LONG_CASE_MS - 90_000);
      await w1Quiet(host, s.id, 10_000, TURN_MS);
      const delivered = await cancel({ message_uuid: first.messageUuid });
      await w1Quiet(host, s.id, 5_000, TURN_MS);
      const names: Record<string, string> = { [first.messageUuid!]: 'first', [steer]: 'steer' };
      const events = s.events();
      console.log(`   delivered uuid { message_uuid } → ${JSON.stringify(delivered)}; first lifecycle [${w1Lifecycle(events, first.messageUuid!).join(',')}]; steer lifecycle [${w1Lifecycle(events, steer).join(',')}]`);
      for (const line of w1Timeline(events, names)) console.log(`   ${line}`);
      const rows = s.journal();
      for (const r of rows.filter((row) => JSON.stringify(row.frame).includes(steer) || (row.frame as { request?: { subtype?: string } }).request?.subtype === 'cancel_async_message')) console.log(`   ${r.seq} ${r.direction} ${JSON.stringify(r.frame).slice(0, 400)}`);
      // observed (pass3/steer-next-cancelled): the declared `{ uuid }` shape cancels nothing; `{ message_uuid }` withdraws
      // the queued steer (a `cancelled` lifecycle, never started), and the running turn goes on to its end without it;
      // a delivered uuid answers cancelled: false
      expect(declaredShape).toEqual({ cancelled: false });
      expect(withdrawn).toEqual({ cancelled: true });
      expect(delivered).toEqual({ cancelled: false });
      expect(ofKind(events, 'command.lifecycle').filter((e) => e.commandUuid === steer).map((e) => e.state)).toEqual(['queued', 'cancelled']);
      expect(ended).toMatchObject({ userMessageUuids: [first.messageUuid], terminalReason: 'completed' });
      expect(ended.resultText).toContain('COUNTED');
      expect(rows.filter((r) => r.direction === 'in' && JSON.stringify(r.frame).includes('STEER_A'))).toEqual([]);
      expect(mainTurnsEnded(events)).toHaveLength(1);
    }, new LiveHost({ userData: g.userData, configHome }));
    exportTo('steer-next-cancelled', journalPath, g);
    const records = exportTranscript('w1-steer-next-cancelled', configHome, engineSessionId, g);
    // on disk the withdrawn steer is its `enqueue` and then a bare `dequeue` (no content, no reason: the same record a
    // delivered prompt's dequeue writes) and nothing else: no user record, no queued_command
    const ops = records.filter((r) => r.type === 'queue-operation');
    const at = ops.findIndex((r) => r.content === 'Reply STEER_A');
    expect(ops.slice(at, at + 2).map((r) => [r.operation, r.content ?? null, r.reason ?? null])).toEqual([['enqueue', 'Reply STEER_A', null], ['dequeue', null, null]]);
    expect(records.filter((r) => JSON.stringify(r).includes('STEER_A'))).toHaveLength(1);
    expect(records.filter((r) => r.attachment?.type === 'queued_command')).toEqual([]);
    expect(records.filter((r) => r.uuid === steerUuid)).toEqual([]);
  }, LONG_CASE_MS);

  // W1
  it('W1 compact between two turns', async (ctx) => {
    const g = live(ctx);
    const configHome = scratchConfigHome();
    let journalPath = '';
    let engineSessionId = '';
    let compactUuid = '';
    await withHost(g, 'W1 compact', async (host) => {
      const spec = liveSpec(g.scratch());
      const { status } = await host.launch(spec);
      journalPath = status.journalPath;
      engineSessionId = spec.sessionId!;
      const s = sessionView(host, spec);
      const one = await s.send('Reply ONE');
      await s.waitTurns(1);
      const compact = await s.send('/compact');
      compactUuid = compact.messageUuid!;
      console.log(`   /compact send ${JSON.stringify({ disposition: compact.disposition, messageUuid: compact.messageUuid })}`);
      const boundary = await s.wait('boundary.compaction', 'the compaction', () => true, LONG_CASE_MS - 120_000);
      await w1Quiet(host, s.id, 5_000, TURN_MS);
      const activities = [...new Set(host.statuses(s.id).map((st) => st.activity))];
      console.log(`   boundary.compaction seq ${boundary.seq} ${boundary.trigger} pre ${boundary.preTokens} post ${boundary.postTokens}; status activities seen ${JSON.stringify(activities)}`);
      const two = await s.send('Reply TWO');
      const names: Record<string, string> = { [one.messageUuid!]: 'ONE', [compact.messageUuid!]: '/compact', [two.messageUuid!]: 'TWO' };
      await host.waitFor(() => mainTurnsEnded(s.events()).find((t) => t.userMessageUuids.includes(two.messageUuid!)), 'a result naming TWO', TURN_MS);
      await w1Quiet(host, s.id, 5_000, TURN_MS);
      const events = s.events();
      for (const line of w1Timeline(events, names)) console.log(`   ${line}`);
      // observed (pass3/compact): /compact opens a turn of its own (started lifecycle, turn.started) that the zero-turn
      // `local_command: compact` result closes; between them status `compacting`, then status null with
      // compact_result success, system/init, compact_boundary, a synthetic user frame carrying the summary (no
      // isCompactSummary on the wire), the replayed <local-command-stdout>, and the replayed <command-name> record
      expect(compact.disposition).toBe('sent');
      expect(boundary).toMatchObject({ trigger: 'manual', historical: false });
      expect(boundary.logicalParentUuid).not.toBeNull();
      expect(activities).toContain('compacting');
      const compactTurn = mainTurnsEnded(events).find((t) => t.userMessageUuids.includes(compact.messageUuid!))!;
      expect(compactTurn).toMatchObject({ userMessageUuids: [compact.messageUuid], numTurns: 0, terminalReason: null, isEchoReceipt: false });
      expect(ofKind(events, 'turn.started').find((e) => e.userMessageUuid === compact.messageUuid)).toBeDefined();
      const after = ofKind(events, 'user.message').filter((m) => seqOf(m) > seqOf(boundary) && seqOf(m) < seqOf(compactTurn));
      expect(after.map((m) => [m.isSynthetic, m.isReplay, m.origin])).toEqual([[true, false, null], [false, true, 'local-command']]);
      expect(text(after[0]!.content)).toMatch(/^This session is being continued from a previous conversation/);
      expect(text(after[1]!.content)).toMatch(/^Compacted/); // the normaliser unwraps the wire's <local-command-stdout>
      expect(mainTurnsEnded(events).at(-1)!.resultText).toContain('TWO');
    }, new LiveHost({ userData: g.userData, configHome }));
    exportTo('compact', journalPath, g);
    const records = exportTranscript('w1-compact', configHome, engineSessionId, g);
    // on disk: the boundary (parentUuid null, logicalParentUuid), the summary user record under it (isCompactSummary,
    // isVisibleInTranscriptOnly), the local-command caveat (isMeta), the <command-name>/compact record (the send's uuid)
    // and the <local-command-stdout> record, chained in that order; no system/local_command record
    const at = records.findIndex((r) => r.type === 'system' && r.subtype === 'compact_boundary');
    const chain = records.slice(at, at + 5);
    expect(chain[0]).toMatchObject({ parentUuid: null, compactMetadata: { trigger: 'manual' } });
    expect(chain[1]).toMatchObject({ type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true, parentUuid: chain[0]!.uuid });
    expect(chain[2]).toMatchObject({ type: 'user', isMeta: true, parentUuid: chain[1]!.uuid });
    expect(chain[3]).toMatchObject({ type: 'user', uuid: compactUuid, parentUuid: chain[2]!.uuid });
    expect(String(chain[3]!.message?.content)).toMatch(/^<command-name>\/compact<\/command-name>/);
    expect(chain[4]).toMatchObject({ type: 'user', parentUuid: chain[3]!.uuid });
    expect(String(chain[4]!.message?.content)).toMatch(/^<local-command-stdout>Compacted/);
    expect(records.filter((r) => r.type === 'system' && r.subtype === 'local_command')).toEqual([]);
  }, LONG_CASE_MS);

  // W7 F1 (docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md; charter §4.3's resume-while-live line as amended
  // 2026-10-01): the owner's collision. MAWS's engine host holds a session (C3's launch, Haiku through the relay, a
  // scratch home that also serves C4's fs.* with a disk follow of the session, as a tailing pane would), and the pinned
  // binary resumes the same id interactively in a PTY, the way `claude --resume <id>` in a terminal does. A turn in each,
  // twice, interleaved; then MAWS's process stops; then main's resume guard is asked (the Send); then the terminal exits
  // and MAWS resumes the id and asks what it remembers. Beside the product (the host's fs.* as W7 wires it) the case runs
  // the pre-W7 rules over the same files: a registry with no own-record rule and a follower with no pin, so one run
  // records the collision as it was and as it is now. The notes, the transcript and both registry records are written
  // under the run's exports for spikes/protocol-probe/fixtures/pass3/.
  it('W7 a terminal resumes a session MAWS holds', async (ctx) => {
    const g = live(ctx);
    const configHome = scratchConfigHome();
    const repo = realpathSync(g.scratch());
    writeFileSync(join(configHome, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
    const exportsDir = join(g.userData, 'exports');
    const diskDir = join(exportsDir, 'w7-collision-disk');
    mkdirSync(diskDir, { recursive: true });
    const notes: Record<string, unknown>[] = [];
    const note = (event: string, fields: Record<string, unknown> = {}) => {
      notes.push({ at: new Date().toISOString(), event, ...fields });
      console.log(`   ${event} ${JSON.stringify(fields).slice(0, 900)}`);
    };
    const sessionsDir = join(configHome, 'sessions');
    const registry = (): Record<string, unknown>[] =>
      existsSync(sessionsDir) ? readdirSync(sessionsDir).filter((f) => /^\d+\.json$/.test(f)).map((f) => ({ pid: Number(f.split('.')[0]), ...(JSON.parse(readFileSync(join(sessionsDir, f), 'utf8')) as Record<string, unknown>) })) : [];
    const keptRecords: Record<string, Record<string, unknown>> = {};
    let terminalExit: { exitCode: number; signal?: number } | null = null;
    let mawsJournal = '';
    let guard: unknown = null;
    // the pre-W7 rules over the same store: every live record a holder, and a follower that flips on every sibling branch
    const before = { holders: [] as { holder: unknown; pid: unknown }[], events: [] as SessionEvent[] };
    const beforeRegistry = new HolderRegistry(resolveStorePaths({ CLAUDE_CONFIG_DIR: configHome }), (_sessionId, holder, record) => void before.holders.push({ holder, pid: record?.pid ?? null }));
    let beforeFollower: ChainFollower | null = null;
    await withHost(g, 'W7 collision', async (host) => {
      const spec = liveSpec(repo, { model: 'haiku', permissionMode: 'default', subagentModel: null });
      const sessionId = spec.sessionId!;
      const transcript = join(configHome, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
      const disk = () => (existsSync(transcript) ? readFileSync(transcript, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TranscriptRecord) : []);
      const s = sessionView(host, spec);
      const named = <T,>(name: string) => host.emitted.filter((e) => e.name === name).map((e) => e.payload as T);
      const afterDisk = () => s.events().filter((e) => e.seq === null && !e.id.startsWith(`${s.id}:`));
      beforeFollower = new ChainFollower(new FsFileReader(() => transcript), sessionId as never, null, (e) => void (e.t === 'events' && before.events.push(...e.events)), { holders: () => 2 });
      // what each rule saw since the last mark
      let mark = { afterDisk: 0, afterHolders: 0, foreignWrites: 0, beforeDisk: 0, beforeHolders: 0 };
      const since = async () => {
        await beforeFollower!.poke();
        await beforeRegistry.refresh();
        const out = {
          before: { holderEvents: before.holders.slice(mark.beforeHolders), follower: before.events.slice(mark.beforeDisk).filter(flipOrNotice).map(diskEventNote) },
          after: {
            holderEvents: named<{ holder: unknown }>('fs.holderChanged').slice(mark.afterHolders).map((p) => p.holder),
            foreignWrites: named('fs.foreignWrite').slice(mark.foreignWrites),
            follower: afterDisk().slice(mark.afterDisk).filter(flipOrNotice).map(diskEventNote),
          },
        };
        mark = { afterDisk: afterDisk().length, afterHolders: named('fs.holderChanged').length, foreignWrites: named('fs.foreignWrite').length, beforeDisk: before.events.length, beforeHolders: before.holders.length };
        return out;
      };
      const { status } = await host.launch(spec);
      mawsJournal = status.journalPath;
      note('maws_launched', { appSessionId: s.id, sessionId, pid: status.pid, launchId: status.launchId });
      await s.send('Reply with exactly the word MAWS_ONE');
      await s.waitTurns(1);
      await host.call('fs.bind', { bindings: [{ sessionId: sessionId as never, appSessionId: s.id as never }] });
      await host.fs!.eventsSnapshot(s.id as AppSessionId, null); // a pane tailing the transcript
      await beforeRegistry.start();
      await beforeFollower.start();
      await delay(2_500); // a registry poll
      for (const r of registry()) keptRecords[`maws-${String(r.pid)}`] = r;
      note('registry_maws_only', { records: registry(), ...(await since()) });

      // The second writer: the pinned binary, interactive, resuming the id under the same scratch home; its updater off,
      // so it touches nothing outside that home.
      const aliases = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => /^ANTHROPIC_DEFAULT_[A-Z]+_MODEL$/.test(k) && v)) as Record<string, string>;
      const base = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG'].filter((k) => process.env[k]).map((k) => [k, process.env[k]!]));
      const env = { ...base, TERM: 'xterm-256color', CLAUDE_CONFIG_DIR: configHome, DISABLE_AUTOUPDATER: '1', ...aliases, ANTHROPIC_BASE_URL: RELAY_URL, ANTHROPIC_AUTH_TOKEN: GATEWAY_AUTH_TOKEN };
      const term = nodePty.spawn(ENGINE_BIN, ['--resume', sessionId, '--model', 'haiku'], { name: 'xterm-256color', cols: 140, rows: 45, cwd: repo, env });
      let screen = '';
      term.onData((d) => void (screen += d));
      const exited = new Promise<{ exitCode: number; signal?: number }>((r) => term.onExit((e) => r(e)));
      // eslint-disable-next-line no-control-regex -- the terminal's escape sequences are what this strips
      const plain = () => screen.replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]/g, '');
      const typeLine = async (line: string) => {
        term.write(line);
        await delay(500);
        term.write('\r');
      };
      const terminalTurn = async (word: string) => {
        const started = Date.now();
        await typeLine(`Reply with exactly the word ${word}`);
        await host.waitFor(() => disk().some((r) => r.type === 'assistant' && JSON.stringify(r.message?.content).includes(word)), `the terminal's ${word} on disk`, TURN_MS);
        await host.waitFor(() => disk().some((r) => r.type === 'system' && r.subtype === 'turn_duration' && Date.parse(String(r.timestamp)) > started), `the terminal's ${word} turn ended`, 30_000);
        await delay(1_500);
      };
      try {
        note('terminal_spawned', { pid: term.pid, args: ['--resume', sessionId, '--model', 'haiku'] });
        await host.waitFor(() => /for shortcuts|❯/.test(plain()) && plain(), 'the terminal prompt', 60_000);
        await delay(3_000); // its registry record, and a poll
        for (const r of registry()) keptRecords[r.pid === term.pid ? `terminal-${String(r.pid)}` : `maws-${String(r.pid)}`] = r;
        note('registry_both', { records: registry(), fsHolders: (await host.call('fs.holders', { sessionIds: [sessionId as never], directories: null })).holders.map((h) => h.holder), ...(await since()) });

        await terminalTurn('TERMINAL_ONE');
        note('terminal_turn_one', await since());

        await s.send('Reply with exactly the word MAWS_TWO');
        await s.waitTurns(2);
        await delay(2_000);
        note('maws_turn_two', await since());

        await terminalTurn('TERMINAL_TWO');
        note('terminal_turn_two', await since());

        // MAWS's process exits (Stop, quit, a budget release or W7's yield all end it the same way).
        await host.call('session.stop', { appSessionId: s.id, reason: 'stop' });
        await s.wait('process.exited', 'the stop', () => true, 15_000);
        await delay(3_000); // a registry poll
        const exitRow = readJournal(mawsJournal).find((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === 'exit');
        const afterExit = await host.call('session.events', { appSessionId: s.id, afterSeq: null, limit: null });
        note('maws_exited', { exitRow: exitRow?.frame, registry: registry(), heldElsewhere: host.fs!.heldElsewhere(s.id as AppSessionId), sessionEventsAnswer: { lastSeq: afterExit.lastSeq, events: afterExit.events.length, fromDisk: afterExit.lastSeq === 0 }, ...(await since()) });

        // Send in MAWS: main's resume guard, over this host.
        const dispatch = (async (_owner: string, name: string, input: unknown) => host.callRaw(name as never, input as never)) as never;
        const verdict = await holderAuthority({ dispatch, sessions: { list: () => [] } }, { engineSessionId: sessionId as never, appSessionId: s.id as AppSessionId });
        note('send_guard', { verdict, terminalPid: term.pid });
        guard = verdict;

        await typeLine('/exit');
        terminalExit = await Promise.race([exited, delay(20_000).then(() => null)]);
        await delay(4_000); // the registry's unlink, a poll, the re-fold
        note('terminal_exited', { exit: terminalExit, registry: registry(), ...(await since()) });
      } finally {
        if (terminalExit === null) {
          term.kill();
          terminalExit = await Promise.race([exited, delay(5_000).then(() => ({ exitCode: -1, signal: 9 }))]);
        }
        beforeRegistry.stop();
        beforeFollower.stop();
        writeFileSync(join(exportsDir, 'w7-terminal-screen.txt'), plain());
      }

      // The transcript's branches: every record with more than one child that is not a progress record.
      const records = disk();
      const children = new Map<string, TranscriptRecord[]>();
      for (const r of records) if (typeof r.uuid === 'string' && typeof r.parentUuid === 'string') children.set(r.parentUuid, [...(children.get(r.parentUuid) ?? []), r]);
      const forks = [...children]
        .filter(([, kids]) => kids.filter((k) => k.type !== 'progress').length > 1)
        .map(([parent, kids]) => ({ parent, children: kids.map((k) => ({ uuid: k.uuid, type: k.type, entrypoint: k.entrypoint, text: JSON.stringify(k.message?.content ?? k.attachment ?? '').slice(0, 120) })) }));
      const prompts = records.filter((r) => r.type === 'user' && typeof r.message?.content === 'string').map((r) => ({ uuid: r.uuid, parentUuid: r.parentUuid, entrypoint: r.entrypoint, text: String(r.message?.content).slice(0, 80) }));
      note('transcript_branches', { records: records.length, forks, prompts });

      // Send after the terminal closed: MAWS resumes the id; what does the model remember?
      await host.call('fs.unfollow', { appSessionId: s.id, agentId: null }); // main unfollows an id that goes live
      await host.launch({ ...spec, sessionId: null, resume: { sessionId: sessionId as never, fork: false } });
      const ask = await s.send('List, comma separated, every word you were asked to reply with earlier in this conversation. Nothing else.');
      const ended = await host.waitFor(() => mainTurnsEnded(s.events()).find((t) => t.userMessageUuids.includes(ask.messageUuid!)), 'the recall turn', TURN_MS);
      const askRecord = disk().find((r) => r.uuid === ask.messageUuid);
      note('maws_resumed_recall', { answer: ended.resultText, askParent: askRecord?.parentUuid ?? null });

      // what the run shows, before W7 and with it
      const at = (event: string) => notes.find((n) => n.event === event) as { before: { holderEvents: { holder: { kind: string; pid?: number } }[]; follower: { kind: string; key?: string }[] }; after: { holderEvents: { kind: string }[]; foreignWrites: unknown[]; follower: { kind: string; key?: string }[] } };
      expect(at('registry_maws_only').before.holderEvents.map((e) => e.holder)).toEqual([{ kind: 'terminal', pid: status.pid }]); // pre-W7: MAWS's own record read as a terminal
      expect(at('registry_maws_only').after.holderEvents).toEqual([]);
      expect(at('registry_both').after.holderEvents).toEqual([{ kind: 'terminal', pid: term.pid }]);
      expect(at('terminal_turn_one').after.foreignWrites).toHaveLength(1);
      expect(at('maws_turn_two').before.follower.map((e) => e.kind)).toEqual(['boundary.retraction']); // FX8: a parent mismatch alone posts no warning
      expect(at('terminal_turn_two').before.follower.map((e) => e.kind)).toEqual(['boundary.retraction']); // MAWS_TWO vanishes
      expect(at('terminal_turn_two').after.follower.map((e) => e.key ?? e.kind)).toEqual(['transcript_branch_held']); // MAWS_TWO stays
      expect(at('maws_exited').before.holderEvents).toEqual([]); // pre-W7: nothing re-emitted at MAWS's exit
      // the terminal's exit re-folds onto its branch (or, when its last records land after the registry cleared, the
      // follower flips to it as before): either way MAWS_TWO leaves the view once, with the terminal gone
      expect(at('terminal_exited').after.follower.map((e) => e.kind)).toContain('boundary.retraction');
      expect((notes.find((n) => n.event === 'maws_exited') as { sessionEventsAnswer: { fromDisk: boolean } }).sessionEventsAnswer.fromDisk).toBe(true);
      expect(guard).toMatchObject({ live: 'foreign', holder: { kind: 'terminal', pid: term.pid } });
    }, new LiveHost({ userData: g.userData, configHome, fs: true }));

    // Exports: the notes as a pass-3 record, MAWS's first journal, the transcript and the registry records.
    const provenance = { event: 'provenance', charter: 'docs/charter.md', child: 'C4', wave: 'W7', item: 'F1', document: 'docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md', pin: W7_PIN, engine: ENGINE_VERSION, configHome };
    const exitCode = (terminalExit as { exitCode: number } | null)?.exitCode ?? null;
    const rows = [{ at: (notes[0]?.at as string | undefined) ?? new Date().toISOString(), ...provenance }, ...notes, { at: new Date().toISOString(), event: 'exit', code: exitCode, process: 'terminal' }];
    writeFileSync(join(exportsDir, 'w7-collision.jsonl'), redactJournal(`${rows.map(({ at, ...frame }, i) => JSON.stringify({ seq: i + 1, direction: 'meta', at, frame })).join('\n')}\n`));
    if (mawsJournal) writeFileSync(join(exportsDir, 'w7-collision-maws.jsonl'), redactJournal(`${JSON.stringify({ seq: 0, direction: 'meta', at: rows[0].at, frame: provenance })}\n${readFileSync(mawsJournal, 'utf8')}`));
    for (const [name, record] of Object.entries(keptRecords)) writeFileSync(join(diskDir, `registry-${name}.json`), `${redactJournal(JSON.stringify(record, null, 2))}\n`);
    exportTranscript('w7-collision-disk/transcript', configHome, notes.find((n) => n.event === 'maws_launched')!.sessionId as string, g);
    console.log(`   exports: ${exportsDir}`);
  }, 10 * 60_000);

  // W7 F2 (charter D-12 as amended 2026-10-01): "Take over here" on a session a terminal holds, the signal path live. The
  // holder is a terminal-style process this case starts itself (the pinned binary resuming the id in a PTY under the
  // scratch home); main's release (`src/main/sessions/take-over.ts`) runs over this host with the real SIGTERM, and
  // then MAWS resumes the id the usual way and runs a turn on top of the terminal's.
  it('W7 take over a session a terminal holds', async (ctx) => {
    const g = live(ctx);
    const configHome = scratchConfigHome();
    const repo = realpathSync(g.scratch());
    writeFileSync(join(configHome, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
    const exportsDir = join(g.userData, 'exports');
    mkdirSync(exportsDir, { recursive: true });
    const notes: Record<string, unknown>[] = [];
    const note = (event: string, fields: Record<string, unknown> = {}) => {
      notes.push({ at: new Date().toISOString(), event, ...fields });
      console.log(`   ${event} ${JSON.stringify(fields).slice(0, 900)}`);
    };
    const sessionsDir = join(configHome, 'sessions');
    const registry = (): Record<string, unknown>[] =>
      existsSync(sessionsDir) ? readdirSync(sessionsDir).filter((f) => /^\d+\.json$/.test(f)).map((f) => ({ pid: Number(f.split('.')[0]), ...(JSON.parse(readFileSync(join(sessionsDir, f), 'utf8')) as Record<string, unknown>) })) : [];
    let terminalExit: { exitCode: number; signal?: number } | null = null;
    await withHost(g, 'W7 take over', async (host) => {
      const spec = liveSpec(repo, { model: 'haiku', permissionMode: 'default', subagentModel: null });
      const sessionId = spec.sessionId!;
      const transcript = join(configHome, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
      const disk = () => (existsSync(transcript) ? readFileSync(transcript, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TranscriptRecord) : []);
      const s = sessionView(host, spec);
      await host.launch(spec);
      await s.send('Reply with exactly the word BEFORE');
      await s.waitTurns(1);
      await host.call('fs.bind', { bindings: [{ sessionId: sessionId as never, appSessionId: s.id as never }] });
      await host.call('session.stop', { appSessionId: s.id, reason: 'stop' });
      await s.wait('process.exited', 'the stop', () => true, 15_000);
      note('maws_stopped', { appSessionId: s.id, sessionId });

      const aliases = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => /^ANTHROPIC_DEFAULT_[A-Z]+_MODEL$/.test(k) && v)) as Record<string, string>;
      const base = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG'].filter((k) => process.env[k]).map((k) => [k, process.env[k]!]));
      const env = { ...base, TERM: 'xterm-256color', CLAUDE_CONFIG_DIR: configHome, DISABLE_AUTOUPDATER: '1', ...aliases, ANTHROPIC_BASE_URL: RELAY_URL, ANTHROPIC_AUTH_TOKEN: GATEWAY_AUTH_TOKEN };
      const term = nodePty.spawn(ENGINE_BIN, ['--resume', sessionId, '--model', 'haiku'], { name: 'xterm-256color', cols: 140, rows: 45, cwd: repo, env });
      let screen = '';
      term.onData((d) => void (screen += d));
      const exited = new Promise<{ exitCode: number; signal?: number }>((r) => term.onExit((e) => r(e)));
      // eslint-disable-next-line no-control-regex -- the terminal's escape sequences are what this strips
      const plain = () => screen.replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]/g, '');
      try {
        await host.waitFor(() => /for shortcuts|❯/.test(plain()) && plain(), 'the terminal prompt', 60_000);
        const started = Date.now();
        term.write('Reply with exactly the word TERMINAL');
        await delay(500);
        term.write('\r');
        await host.waitFor(() => disk().some((r) => r.type === 'system' && r.subtype === 'turn_duration' && Date.parse(String(r.timestamp)) > started), 'the terminal turn ended', TURN_MS);
        await delay(2_000);
        const before = await host.call('fs.holders', { sessionIds: [sessionId as never], directories: null });
        note('terminal_holds', { pid: term.pid, holders: before.holders.map((h) => h.holder), registry: registry().map((r) => ({ pid: r.pid, kind: r.kind, entrypoint: r.entrypoint })) });

        // "Take over here", confirmed for this terminal: main's release over this host, with the real signal
        const dispatch = (async (_owner: string, name: string, input: unknown) => host.callRaw(name as never, input as never)) as never;
        const t0 = Date.now();
        const outcome = await releaseHolder({ dispatch, sessions: { list: () => [] }, env: process.env }, { engineSessionId: sessionId as never, appSessionId: s.id as AppSessionId, expected: { kind: 'terminal', pid: term.pid } });
        terminalExit = await Promise.race([exited, delay(5_000).then(() => null)]);
        note('take_over', { outcome, ms: Date.now() - t0, terminalExit, registry: registry(), screenTail: plain().slice(-300) });
        expect(outcome).toEqual({ status: 'released' });
        expect(terminalExit).not.toBeNull();
        expect(registry()).toEqual([]);
      } finally {
        if (terminalExit === null) {
          term.kill();
          terminalExit = await Promise.race([exited, delay(5_000).then(() => ({ exitCode: -1, signal: 9 }))]);
        }
      }

      // the existing resume, then a turn on top of the terminal's
      await host.launch({ ...spec, sessionId: null, resume: { sessionId: sessionId as never, fork: false } });
      const after = await s.send('List, comma separated, every word you were asked to reply with earlier in this conversation. Nothing else.');
      const ended = await host.waitFor(() => mainTurnsEnded(s.events()).find((t) => t.userMessageUuids.includes(after.messageUuid!)), 'the recall turn', TURN_MS);
      const record = disk().find((r) => r.uuid === after.messageUuid);
      const parent = disk().find((r) => r.uuid === record?.parentUuid);
      note('resumed', { answer: ended.resultText, parentEntrypoint: parent?.entrypoint ?? null });
      expect(ended.resultText).toMatch(/BEFORE.*TERMINAL/);
    }, new LiveHost({ userData: g.userData, configHome, fs: true }));
    const provenance = { event: 'provenance', charter: 'docs/charter.md', child: 'C10', wave: 'W7', item: 'F2', document: 'docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md', pin: W7_PIN, engine: ENGINE_VERSION, configHome };
    const rows = [{ at: (notes[0]?.at as string | undefined) ?? new Date().toISOString(), ...provenance }, ...notes, { at: new Date().toISOString(), event: 'exit', code: 0, process: 'maws' }];
    writeFileSync(join(exportsDir, 'w7-take-over.jsonl'), redactJournal(`${rows.map(({ at, ...frame }, i) => JSON.stringify({ seq: i + 1, direction: 'meta', at, frame })).join('\n')}\n`));
    console.log(`   exports: ${exportsDir}`);
  }, 10 * 60_000);
});

// A live journal as a pass-3 fixture candidate: redacted, provenance first, written under the run's userData for a
// look by eye before it is copied into spikes/protocol-probe/fixtures/pass3/.
function exportTo(name: string, journalPath: string, ctx: LiveContext, provenance?: Provenance): void {
  if (!journalPath) return;
  const dir = join(ctx.userData, 'exports');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${name}.jsonl`);
  writeFileSync(dest, exportFixture(readFileSync(journalPath, 'utf8'), undefined, undefined, provenance));
  exports.push(`${name}: ${dest} (from ${journalPath}; ${readdirSync(dir).length} exported so far)`);
}

// W1: the main transcript the engine wrote for one session under a scratch config home, redacted, beside the journal
// exports, for a look by eye before it is copied into test/fixtures/transcripts/; answers its records.
interface TranscriptRecord {
  type?: string;
  subtype?: string;
  uuid?: string;
  parentUuid?: string | null;
  isMeta?: boolean;
  message?: { content?: unknown };
  attachment?: { type?: string } & Record<string, unknown>;
  [key: string]: unknown;
}
function exportTranscript(name: string, configHome: string, engineSessionId: string, ctx: LiveContext): TranscriptRecord[] {
  const projects = join(configHome, 'projects');
  const source = readdirSync(projects).map((dir) => join(projects, dir, `${engineSessionId}.jsonl`)).find((path) => existsSync(path));
  if (!source) throw new Error(`no transcript for ${engineSessionId} under ${projects}`);
  const dir = join(ctx.userData, 'exports');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${name}.jsonl`);
  const redacted = redactJournal(readFileSync(source, 'utf8'));
  writeFileSync(dest, redacted);
  exports.push(`${name}: ${dest} (transcript ${source})`);
  return redacted
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TranscriptRecord);
}

// W1: waits until the session has no open turn and its events have been still for `quietMs` (progress heartbeats aside).
async function w1Quiet(host: LiveHost, id: string, quietMs: number, timeoutMs: number): Promise<void> {
  const count = () => host.events(id).filter((e) => e.kind !== 'tool.progress').length;
  let seen = count();
  let since = Date.now();
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await delay(250)) {
    const now = count();
    if (now !== seen) [seen, since] = [now, Date.now()];
    else if (Date.now() - since >= quietMs && host.status(id)?.turn === null) return;
  }
  console.log(`   (not quiet after ${timeoutMs} ms)`);
}

const w1Lifecycle = (events: SessionEvent[], uuid: string): string[] => ofKind(events, 'command.lifecycle').filter((e) => e.commandUuid === uuid).map((e) => `${e.state}@${e.seq}`);

// W1: the main lane, one line per event that bears on a prompt's fate, the case's prompts named.
function w1Timeline(events: SessionEvent[], names: Record<string, string>): string[] {
  const name = (uuid: string | null) => (uuid !== null && names[uuid]) || String(uuid);
  const short = (value: unknown, n = 80) => JSON.stringify(text(value).slice(0, n));
  const out: string[] = [];
  for (const e of events) {
    if (e.parentToolUseId !== null) continue;
    if (e.kind === 'turn.started') out.push(`${e.seq} turn.started ${name(e.userMessageUuid)} origin=${e.origin}`);
    else if (e.kind === 'turn.ended') out.push(`${e.seq} turn.ended ${e.terminalReason} [${e.userMessageUuids.map(name).join(',')}] echo=${e.isEchoReceipt} numTurns=${e.numTurns} ${short(e.resultText ?? '', 60)}`);
    else if (e.kind === 'command.lifecycle') out.push(`${e.seq} lifecycle ${e.state} ${name(e.commandUuid)}`);
    else if (e.kind === 'user.message') out.push(`${e.seq} user.message ${name(e.messageUuid)} replay=${e.isReplay} synthetic=${e.isSynthetic} origin=${e.origin} ${short(e.content)}`);
    else if (e.kind === 'tool.use') out.push(`${e.seq} tool.use ${e.toolName} ${short(e.input, 50)}`);
    else if (e.kind === 'tool.result') out.push(`${e.seq} tool.result error=${e.isError} denial=${e.denial} ${short(e.content, 50)}`);
    else if (e.kind === 'assistant.block.complete' && e.block.type === 'text') out.push(`${e.seq} assistant text ${short((e.block as { text?: string }).text ?? '', 60)}`);
    else if (e.kind === 'boundary.compaction') out.push(`${e.seq} boundary.compaction ${e.trigger} pre=${e.preTokens} post=${e.postTokens} logicalParent=${e.logicalParentUuid}`);
    else if (e.kind === 'hook.started') out.push(`${e.seq} hook.started ${e.hookEvent} ${e.hookName}`);
    else if (e.kind === 'hook.finished') out.push(`${e.seq} hook.finished ${e.hookEvent} ${e.outcome} exit=${e.exitCode} stdout=${short(e.stdout)} stderr=${short(e.stderr)}`);
    else if (e.kind === 'session.state') out.push(`${e.seq} session.state ${e.state}`);
    else if (e.kind === 'session.init') out.push(`${e.seq} session.init ${e.model}`);
    else if (e.kind === 'notice.posted') out.push(`${e.seq} notice ${short(e.text)}`);
    else if (e.kind === 'error.raised') out.push(`${e.seq} error ${e.scope} ${short(e.message)}`);
  }
  return out;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// W7: the charter's blob at the wave's base (d5a6549e), the pin its fixtures carry.
const W7_PIN = '560ec98bc0b47b5055e87fb4bf0d4c455a11a0e4';

// Debt wave 7: the provenance its C4 probe carries, the charter's blob at the wave's base (4c500ca0).
const DW7_PROVENANCE: Provenance = { charter: 'docs/charter.md', child: 'C4', wave: 'debt wave 7', pin: '936cd8baf7376705e41a6fd1f73f15adedf556d6' };

// W7: the follower events that change what the view shows: a retraction, a notice.
const flipOrNotice = (e: SessionEvent) => e.kind === 'boundary.retraction' || e.kind === 'notice.posted';

// W7: one disk-follow event, as the notes record it.
function diskEventNote(e: SessionEvent): Record<string, unknown> {
  const out: Record<string, unknown> = { id: e.id, kind: e.kind };
  if (e.kind === 'boundary.retraction') Object.assign(out, { reason: e.reason, retracted: e.retractedMessageUuids });
  if (e.kind === 'notice.posted') Object.assign(out, { text: e.text, key: e.key });
  if (e.kind === 'user.message') out.text = text(e.content).slice(0, 60);
  if (e.kind === 'assistant.block.complete' && e.block.type === 'text') out.text = String((e.block as { text?: string }).text ?? '').slice(0, 60);
  return out;
}
