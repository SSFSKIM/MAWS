// The live suite (C3 execution document, Acceptance item 3; M6): the pinned binary through ClaudeUsage's relay, in
// auto mode with the owner's setting sources, Sonnet, `--max-budget-usd 0.50` per process, one scratch git repository
// per case, run serially. Every case but 3.18 goes through the X2 surface the renderer uses (C1's host runtime serving
// registerEngineIpc; support/live-host.ts); 3.18 builds the EngineSession the launcher would, because host hooks have no
// X2 path in P0. Skipped, never failed, when the gate says so. `MAWS_LIVE=1 pnpm test:live`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
import type { RequestAnswer } from '@shared/engine/answers';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { getHooksListing } from '../../src/engine-host/controls';
import { HostHookRegistry } from '../../src/engine-host/host-hooks';
import { ENGINE_VERSION, RELAY_URL } from '../../src/engine-host/launch';
import { exportFixture, frameInventory, LiveLedger, liveGate, liveSpec, withRawProcess, type LiveContext } from './support/live';
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
      const sub = join(realpathSync(cwd), 'sub');
      mkdirSync(sub);
      await observe('session.setCwd', { appSessionId: id, path: sub, trust: { accepted: true, directory: sub } });
    });
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

  it('3.20 plan approval: keep planning, implement, clear and implement', async (ctx) => {
    const g = live(ctx);
    let journalPath = '';
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
    });
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
});

// A live journal as a pass-3 fixture candidate: redacted, provenance first, written under the run's userData for a
// look by eye before it is copied into spikes/protocol-probe/fixtures/pass3/.
function exportTo(name: string, journalPath: string, ctx: LiveContext): void {
  if (!journalPath) return;
  const dir = join(ctx.userData, 'exports');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${name}.jsonl`);
  writeFileSync(dest, exportFixture(readFileSync(journalPath, 'utf8')));
  exports.push(`${name}: ${dest} (from ${journalPath}; ${readdirSync(dir).length} exported so far)`);
}
