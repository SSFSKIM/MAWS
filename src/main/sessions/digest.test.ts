import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import { parseJournalRow } from '@shared/wire/journal'; // P4-R7
import { parseTranscriptRecord } from '@shared/wire/transcript';
import { createBackfillContext, recordToEvents } from '../../engine-host/fs/backfill';
import { applyStatusToDigest, costLedger, costOf, emptyDigest, foldDigest, foldEvents, restoreCost, type MessageCalls } from './digest';
import { status } from '../../../test/support/builders'; // C12
import { ev } from '../../../test/support/events';
import { FIXTURE_DIR, framesOf, loadJournal } from '../../../test/support/fixtures';
import { Normalizer } from '../../engine-host/normalizer'; // C12

const APP = 'app-1' as AppSessionId;
const CHILD = { agentId: 'agent-a', parentToolUseId: 'toolu_parent' };
const run = (events: SessionEvent[], from = emptyDigest(APP)) => events.reduce(foldDigest, from);

const parentTurn = [
  ev('turn.started', { at: '2026-09-28T10:00:00Z' }),
  ev('tool.use', { toolName: 'Bash', input: { command: 'git status' } }),
  ev('tool.result', {}),
  ev('assistant.block.complete', { block: { type: 'text', text: 'Done.\nMore' } }),
];
const parentEnd = ev('turn.ended', { costUsd: 0.12, at: '2026-09-28T10:01:00Z' });

describe('digest fold', () => {
  it('folds a parent turn to idle with its last line and cost', () => {
    const digest = run([...parentTurn, parentEnd]);
    expect(digest).toMatchObject({
      phase: 'idle',
      activity: null,
      lastAssistantLine: 'Done.',
      turnStartedAt: '2026-09-28T10:00:00Z',
      lastTurnEndedAt: '2026-09-28T10:01:00Z',
      cost: { totalUsd: 0.12 },
    });
  });

  it('describes what a working session is doing', () => {
    const at = (event: SessionEvent) => run([ev('turn.started', {}), event]).activity;
    expect(run([ev('turn.started', {})])).toMatchObject({ phase: 'working', activity: 'Thinking' });
    expect(at(ev('tool.use', { toolName: 'Bash', input: { command: `bun test ${'x'.repeat(80)}` } }))).toBe(`Running bun test ${'x'.repeat(51)}`);
    expect(at(ev('tool.use', { toolName: 'Edit', input: { file_path: '/r/src/app.ts' } }))).toBe('Editing app.ts');
    expect(at(ev('tool.use', { toolName: 'Read', input: { file_path: '/r/docs/charter.md' } }))).toBe('Reading charter.md');
    expect(at(ev('tool.use', { toolName: 'Grep', input: { pattern: 'x' } }))).toBe('Searching');
    expect(at(ev('tool.use', { toolName: 'WebFetch', input: { url: 'https://example.com/a' } }))).toBe('Fetching example.com');
    expect(at(ev('tool.use', { toolName: 'mcp__x__y', input: {} }))).toBe('Running mcp__x__y');
    expect(at(ev('tool.result', {}))).toBe('Working');
    expect(at(ev('boundary.compaction', {}))).toBe('Compacting');
    expect(at(ev('session.reconnect', { phase: 'attempting' }))).toBe('Reconnecting');
  });

  it('follows session.state and pending requests', () => {
    const waiting = run([ev('turn.started', {}), ev('permission.requested', {}), ev('session.state', { state: 'requires_action' })]);
    expect(waiting).toMatchObject({ phase: 'waiting', pendingRequests: 1 });
    expect(run([ev('permission.resolved', {}), ev('session.state', { state: 'running' })], waiting)).toMatchObject({ phase: 'working', pendingRequests: 0 });
  });

  it('marks a failed turn failed, but not an aborted one', () => {
    expect(run([ev('turn.started', {}), ev('turn.ended', { isError: true, terminalReason: 'max_turns' })]).phase).toBe('failed');
    expect(run([ev('turn.started', {}), ev('turn.ended', { isError: true, terminalReason: 'aborted_streaming' })]).phase).toBe('idle');
  });

  // Debt wave 5 (C5 · C6): an interrupt while a tool runs ends the turn `error_during_execution` with `aborted_tools`
  // (pass2/per-task-stop-off.jsonl: the foreground `sleep 20` interrupted at seq 67, its result at seq 72), which is the
  // human's stop, not a failure: the row and tab read idle, as the transcript's divider reads Stopped.
  it('an interrupt during a tool (the recorded aborted_tools result) reads idle, not failed', () => {
    const normalizer = new Normalizer({ appSessionId: APP, launchId: 'LAUNCH01', sessionId: null });
    const events = loadJournal('pass2', 'per-task-stop-off').filter((row) => row.seq <= 72).flatMap((row) => normalizer.push(row));
    const ended = events.findLast((e) => e.kind === 'turn.ended');
    expect(ended).toMatchObject({ isError: true, terminalReason: 'aborted_tools' });
    expect(run(events).phase).toBe('idle');
  });

  // C12 start: the engine's state frames, which X6 turns on from C12 M5 (CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS), read
  // honestly beside the turn's own events (pass3/launch-env-state-events.jsonl: running, requires_action with its
  // can_use_tool, running, the result, then idle).
  it('with the recorded state frames, a turn with a permission reads working, waiting, working, then idle, then exited at the end_session', () => {
    const normalizer = new Normalizer({ appSessionId: APP, launchId: 'LAUNCH01', sessionId: null });
    const events = loadJournal('pass3', 'launch-env-state-events').flatMap((row) => normalizer.push(row));
    expect(events.filter((e) => e.kind === 'session.state').map((e) => (e as Extract<SessionEvent, { kind: 'session.state' }>).state)).toEqual(['running', 'requires_action', 'running', 'idle']);
    const phases: string[] = [];
    events.reduce((d, e) => {
      const next = foldDigest(d, e);
      if (phases.at(-1) !== next.phase) phases.push(next.phase);
      return next;
    }, emptyDigest(APP));
    expect(phases).toEqual(['idle', 'working', 'waiting', 'working', 'idle', 'exited']); // the probe ended the process
  });

  it("the engine's idle after a failed turn keeps the failure; its running for the next turn clears it", () => {
    const failed = run([ev('session.state', { state: 'running' }), ev('turn.started', {}), ev('turn.ended', { isError: true, terminalReason: 'max_turns' }), ev('session.state', { state: 'idle' })]);
    expect(failed.phase).toBe('failed');
    expect(run([ev('session.state', { state: 'running' })], failed).phase).toBe('working');
  });
  // C12 end

  it('ends on process exit, failed on a crash', () => {
    expect(run([ev('turn.started', {}), ev('process.exited', { reason: 'quit' })])).toMatchObject({ phase: 'exited', activity: null });
    expect(run([ev('process.exited', { reason: 'crash' })]).phase).toBe('failed');
  });

  it('takes context and cost samples', () => {
    const digest = run([
      ev('context.sample', { totalTokens: 410000, maxTokens: 1000000, percentage: 41, autoCompactThreshold: 950000 }),
      ev('usage.sample', { costUsd: 0.5 }),
    ]);
    expect(digest.context).toEqual({ percent: 41, totalTokens: 410000, maxTokens: 1000000, autoCompactThreshold: 950000 });
    expect(digest.cost?.totalUsd).toBe(0.5);
  });

  it('names no auto-compact threshold when the engine reports autocompact off', () => {
    const off = run([ev('context.sample', { totalTokens: 180000, maxTokens: 200000, percentage: 90, autoCompactThreshold: 167000, isAutoCompactEnabled: false })]);
    expect(off.context).toEqual({ percent: 90, totalTokens: 180000, maxTokens: 200000, autoCompactThreshold: null });
    // and a later sample with it back on names it again
    expect(run([ev('context.sample', { totalTokens: 1, maxTokens: 200000, percentage: 0, autoCompactThreshold: 167000, isAutoCompactEnabled: true })], off).context?.autoCompactThreshold).toBe(167000);
  });

  it('treats the engine’s cost as the process’s running total, not an increment', () => {
    // The probe's results report a cumulative total_cost_usd (pass2/rewind: 0.0555, 0.0614, 0.0674).
    const digest = run([ev('turn.ended', { costUsd: 0.0555 }), ev('turn.ended', { costUsd: 0.0614 }), ev('turn.ended', { costUsd: 0.0674 })]);
    expect(digest.cost?.totalUsd).toBe(0.0674);
  });

  it('keeps a finished process’s cost when a new process restarts its running total at zero', () => {
    const ledger = costLedger(emptyDigest(APP));
    const seen = new Set<string>();
    const totals: number[] = [];
    let digest = emptyDigest(APP);
    for (const batch of [
      [ev('turn.started', {}), ev('turn.ended', { costUsd: 0.3 })],
      [ev('process.exited', { reason: 'quit' })],
      [ev('turn.started', {}), ev('turn.ended', { costUsd: 0.05 })], // the resumed process counts from zero
      [ev('usage.sample', { costUsd: 0.07 })],
    ]) {
      digest = foldEvents(digest, seen, batch, ledger);
      totals.push(digest.cost?.totalUsd ?? 0);
    }
    expect(totals).toEqual([0.3, 0.3, 0.35, 0.37]);
    // a first total below the restored figure: what the process restored is the transcript's to say (restoreCost)
    expect(ledger).toEqual({ finishedUsd: 0.3, restoredUsd: 0, runningUsd: 0.07, awaitingFirst: false, signalled: false, restoring: { firstUsd: 0.05, previousUsd: 0.3 } });
  });

  // Each journal's result totals as the engine reported them, one process per journal, an exit between processes.
  const processes = (...names: string[]) =>
    names.map((name) => [
      ...framesOf(loadJournal(name.includes('/') ? 'pass2' : 'pass1', name.replace(/^pass2\//, '')), 'in')
        .filter(({ frame }) => (frame as { type?: string }).type === 'result')
        .flatMap(({ seq, frame }) => [ev('turn.started', {}), ev('turn.ended', { seq, costUsd: (frame as { total_cost_usd: number }).total_cost_usd })]),
      ev('process.exited', { reason: 'quit' }),
    ]);
  const costAfterEach = (batches: SessionEvent[][]) => {
    const ledger = costLedger(emptyDigest(APP));
    const seen = new Set<string>();
    let digest = emptyDigest(APP);
    return batches.map((batch) => (digest = foldEvents(digest, seen, batch, ledger)).cost?.totalUsd);
  };

  it('a resumed process’s total continues the restored one, so it replaces the restored part rather than adding to it (resume-fork-*)', () => {
    // resume-fork-start ends at 0.0266824; its two resumes of the same id report 0.0295122 and 0.0322007, each total
    // carrying what the processes before it spent (the engine's modelUsage grows 920 → 930 → 940 input tokens)
    expect(costAfterEach(processes('resume-fork-start', 'resume-fork-no-replay', 'resume-fork-replay'))).toEqual([0.0266824, 0.0295122, 0.0322007].map((usd) => expect.closeTo(usd, 9)));
  });

  it('a resumed process that restored nothing (pass2/resume-live-second, resumed while its holder still ran) counts from zero', () => {
    // the holder ends at 0.061483; the resume's first total, 0.0060484, is its own turn alone (modelUsage 2 input tokens)
    expect(costAfterEach(processes('pass2/resume-live-holder', 'pass2/resume-live-second'))).toEqual([0.061483, 0.061483 + 0.0060484].map((usd) => expect.closeTo(usd, 9)));
  });

  // Tracker 2026-09-29: a resume the ledger cannot place alone takes its restored part from the transcript's last
  // `cost-state` (restored-cost.ts). The figures are pass 3's: a session's first process ended at 0.0031984
  // (p1-side-thread-live-fork) and its resume at 0.00593705 (p1-side-thread-live-resume: 0.0031984 restored plus a turn
  // of 0.00273865). Here the resume is killed (SIGKILL) before it records its total, so the next resume restores the
  // older 0.0031984.
  describe('a resume’s restored part, settled from the transcript', () => {
    const FIRST = 0.0031983999999999997;
    const SECOND = 0.005937049999999999;
    const TURN = SECOND - FIRST;
    const ledgerAfter = (third: number, exit: Record<string, unknown> = { signal: 'SIGKILL', code: null, reason: 'crash' }) => {
      const ledger = costLedger(emptyDigest(APP));
      foldEvents(emptyDigest(APP), new Set(), [
        ev('turn.ended', { costUsd: FIRST }), ev('process.exited', {}),
        ev('turn.ended', { costUsd: SECOND }), ev('process.exited', exit),
        ev('turn.ended', { costUsd: third }),
      ], ledger);
      return ledger;
    };

    it('a first total below the restored figure: the older figure it restored, not zero (the restored part counted twice)', () => {
      const ledger = ledgerAfter(FIRST + 0.001); // a cheaper turn than the killed process's
      expect(costOf(ledger)).toBeCloseTo(SECOND + FIRST + 0.001, 12); // the ledger's own rule
      expect(ledger.restoring).toEqual({ firstUsd: FIRST + 0.001, previousUsd: SECOND });
      expect(costOf(restoreCost(ledger, FIRST))).toBeCloseTo(SECOND + 0.001, 12);
      expect(restoreCost(ledger, FIRST).restoring).toBeNull();
    });

    it('a first total at or above it, after a signal ended the process before: the killed process’s spend is kept', () => {
      const ledger = ledgerAfter(SECOND); // the same turn again: 0.0031984 restored plus 0.00273865
      expect(costOf(ledger)).toBeCloseTo(SECOND, 12); // the ledger's own rule loses the killed process's turn
      expect(costOf(restoreCost(ledger, FIRST))).toBeCloseTo(FIRST + 2 * TURN, 12);
    });

    it('a process a signal ended after it recorded a total above its last sample (stopped mid-turn, its shutdown past the stop ladder): that spend is kept', () => {
      const recorded = SECOND + 0.0005; // spent after its last sample, then recorded at its shutdown before the SIGKILL
      const ledger = ledgerAfter(recorded + TURN); // the next resume restored the recorded figure
      expect(costOf(ledger)).toBeCloseTo(recorded + TURN, 12); // the ledger's own rule: the unsampled 0.0005 is counted
      expect(costOf(restoreCost(ledger, recorded))).toBeCloseTo(recorded + TURN, 12); // the last sample stays the restored part
    });

    it('after an exit that recorded its total and a first total above it, nothing is read', () => {
      expect(ledgerAfter(SECOND + TURN, { signal: null, code: 0, reason: 'quit' }).restoring).toBeNull();
    });

    it('a figure above the first total was recorded after the process started, and one it cannot read changes nothing', () => {
      // pass2/resume-live-second: resumed while its holder still ran, which recorded 0.061483 at its exit afterwards
      const live = costLedger(emptyDigest(APP));
      foldEvents(emptyDigest(APP), new Set(), processes('pass2/resume-live-holder', 'pass2/resume-live-second').flat().slice(0, -1), live);
      expect(live.restoring).toEqual({ firstUsd: expect.closeTo(0.0060484, 12), previousUsd: expect.closeTo(0.061483, 12) });
      expect(costOf(restoreCost(live, 0.061483))).toBeCloseTo(0.061483 + 0.0060484, 12);
      expect(costOf(restoreCost(live, null))).toBeCloseTo(0.061483 + 0.0060484, 12);
      expect(restoreCost(live, null).restoring).toBeNull();
    });
  });

  it('a synthesised turn end (C4’s backfill, no accounting on disk) leaves the cost alone', () => {
    const live = run([ev('turn.started', {}), ev('turn.ended', { costUsd: 0.4 })]);
    expect(run([ev('turn.started', { seq: null }), ev('turn.ended', { seq: null, costUsd: 0 })], live).cost?.totalUsd).toBe(0.4);
  });

  it('child traffic and echo receipts leave the parent alone', () => {
    const interleaved = [
      ...parentTurn,
      ev('subagent.started', {}),
      ev('turn.started', CHILD),
      ev('assistant.block.complete', { ...CHILD, block: { type: 'text', text: 'child says' } }),
      ev('turn.ended', { ...CHILD, costUsd: 9 }),
    ];
    expect(run(interleaved)).toMatchObject({ phase: 'working', lastAssistantLine: 'Done.', childAgents: { active: 1, done: 0 }, cost: null });
    const finished = run([...interleaved, ev('subagent.finished', {})]);
    expect(finished.childAgents).toEqual({ active: 0, done: 1 });

    const during = run([ev('turn.started', {})]);
    expect(run([ev('turn.ended', { isEchoReceipt: true }), ev('user.message', { origin: 'bash_echo' })], during)).toEqual(during);
  });

  it('takes the summary line from a MessageDisplay hook’s display form with its ANSI colour codes stripped (W1)', () => {
    const shown = run([ev('turn.started', {}), ev('assistant.block.complete', { block: { type: 'text', text: '\n\u001b[1;36mto human\u001b[0m\n\nDoing fine.\n' } })]);
    expect(shown.lastAssistantLine).toBe('to human');
  });

  // E11 F2b (plan 2.6): a report whose first line is only its tag previews its body
  it('takes the owner-aware preview of a tagged answer, not its "<to-human>" line', () => {
    const shown = run([ev('turn.started', {}), ev('assistant.block.complete', { block: { type: 'text', text: '<to-human>\nThe migration ran.\n<essential>Three tables changed.</essential>\n</to-human>' } })]);
    expect(shown.lastAssistantLine).toBe('Three tables changed.');
  });

  it('counts a child’s request as blocking the session', () => {
    expect(run([ev('permission.requested', CHILD)]).pendingRequests).toBe(1);
    expect(run([ev('subagent.started', CHILD)]).childAgents).toEqual({ active: 0, done: 0 });
  });

  it('a C4-shaped child backfill during a live parent turn leaves it working', () => {
    const working = run([ev('turn.started', {})]);
    const backfill = [
      ev('turn.started', { id: 'uuid-1', seq: null, agentId: 'agent-b', parentToolUseId: null }),
      ev('turn.ended', { id: 'uuid-1#1', seq: null, agentId: 'agent-b', parentToolUseId: null }),
    ];
    expect(run(backfill, working).phase).toBe('working');
  });

  it('a repeated batch counts once', () => {
    const batch = [...parentTurn, parentEnd];
    const once = foldEvents(emptyDigest(APP), new Set(), batch);
    const seen = new Set<string>();
    const first = foldEvents(emptyDigest(APP), seen, batch);
    const twice = foldEvents(first, seen, batch);
    expect(twice).toEqual(once);
    expect(twice.cost?.totalUsd).toBe(0.12);
  });

  it('keeps a bounded window of seen ids', () => {
    const seen = new Set<string>();
    const many = Array.from({ length: 2100 }, (_, i) => ev('tool.result', { id: `e${i}` }));
    foldEvents(emptyDigest(APP), seen, many);
    expect(seen.size).toBe(2000);
    expect(seen.has('e2099')).toBe(true);
    expect(seen.has('e0')).toBe(false);
  });
});

// P4-R7: a message the model sent through a message tool is the session's last line once the tool accepted it. Its call
// and its result arrive in different batches, so the read model keeps the calls awaiting results beside the ledger.
describe('a message tool’s message as the last line', () => {
  const call = (id: string, text: unknown, over: Record<string, unknown> = {}) => ev('tool.use', { toolUseId: id, toolName: 'mcp__maws__message', input: { text }, ...over });
  const result = (id: string, over: Record<string, unknown> = {}) => ev('tool.result', { toolUseId: id, content: [{ type: 'text', text: 'sent' }], ...over });
  const text = (words: string) => ev('assistant.block.complete', { block: { type: 'text', text: words } });
  // The batches folded in turn as the read model folds them, with one session's state carried across them.
  function lines(...batches: SessionEvent[][]): (string | null)[] {
    const seen = new Set<string>();
    const ledger = costLedger(emptyDigest(APP));
    const messages: MessageCalls = new Map();
    let digest = emptyDigest(APP);
    return batches.map((batch) => (digest = foldEvents(digest, seen, batch, ledger, true, messages)).lastAssistantLine);
  }

  it('the call in one batch and its accepted result in the next: the message’s first line, once the result is in', () => {
    expect(lines([ev('turn.started', {}), text('Looking first.'), call('c1', '\nStage 1 is done.\nMoving on.')], [result('c1')])).toEqual(['Looking first.', 'Stage 1 is done.']);
    expect(lines([call('c1', 'x'.repeat(300))], [result('c1')])).toEqual([null, 'x'.repeat(160)]);
  });

  // P4-R7z (the P4 spec's Decision Log 92): the to-human plugin's tool, the one a MAWS session messages through, reads
  // as MAWS's former one does: no work, and its message the line once accepted.
  it('an accepted call of the to-human plugin’s message tool is no work, and its message is the line', () => {
    const seen = new Set<string>();
    const messages: MessageCalls = new Map();
    let digest = emptyDigest(APP);
    const fold = (batch: SessionEvent[]) => (digest = foldEvents(digest, seen, batch, costLedger(digest), true, messages));
    fold([ev('turn.started', {}), text('Looking first.'), call('c1', 'Stage 1 is done.', { toolName: 'mcp__to-human__message' })]);
    expect(digest).toMatchObject({ lastAssistantLine: 'Looking first.', activity: 'Thinking' });
    expect(messages.size).toBe(1);
    fold([result('c1')]);
    expect(digest).toMatchObject({ lastAssistantLine: 'Stage 1 is done.' });
  });

  // test/fixtures/transcript-to-human-final.jsonl as C4 backfills it for a terminal session: the turn ends on an accepted
  // final call of the plugin's tool, then the plugin's made-up answer, which said nothing and is no line: the message is.
  it('the to-human plugin’s answer after a final message, followed from disk, is no line: the message is', () => {
    const turn = readFileSync(join(__dirname, '../../../test/fixtures/transcript-to-human-final.jsonl'), 'utf8');
    const lineOf = (text: string) => {
      const ctx = createBackfillContext({ sessionId: 'S' as SessionId, agent: null });
      const events = text.trim().split('\n').flatMap((line) => recordToEvents(parseTranscriptRecord(JSON.parse(line)), ctx));
      return foldEvents(emptyDigest(APP), new Set(), events, costLedger(emptyDigest(APP)), false, new Map()).lastAssistantLine;
    };
    expect(lineOf(turn)).toBe('Both stages ran; 37 labels are missing.');
  });

  it('a refused result, or a call with no words, leaves the line it had', () => {
    expect(lines([text('Looking first.'), call('c1', 'Stage 1 is done.')], [result('c1', { isError: true, content: 'MCP error: the server went away' })])).toEqual(['Looking first.', 'Looking first.']);
    expect(lines([text('Looking first.'), call('c1', '  ')], [result('c1')])).toEqual(['Looking first.', 'Looking first.']);
  });

  it('a later text is the newer line', () => {
    expect(lines([call('c1', 'Stage 1 is done.'), result('c1')], [text('All stages ran.')])).toEqual(['Stage 1 is done.', 'All stages ran.']);
  });

  it('a message call is no work: the activity stays the last tool’s through the call and its result', () => {
    const seen = new Set<string>();
    const ledger = costLedger(emptyDigest(APP));
    const messages: MessageCalls = new Map();
    const bash = ev('tool.use', { toolUseId: 'b1', toolName: 'Bash', input: { command: 'sh stage.sh 2' } });
    const digest = foldEvents(emptyDigest(APP), seen, [ev('turn.started', {}), bash, call('c1', 'Stage 1 is done.')], ledger, true, messages);
    expect(digest.activity).toBe('Running sh stage.sh 2');
    expect(foldEvents(digest, seen, [result('c1')], ledger, true, messages)).toMatchObject({ activity: 'Running sh stage.sh 2', lastAssistantLine: 'Stage 1 is done.' });
  });

  it('a subagent’s call and result leave the parent’s line alone', () => {
    expect(lines([text('Looking first.'), call('c1', 'Child found it.', CHILD)], [result('c1', CHILD)])).toEqual(['Looking first.', 'Looking first.']);
  });

  it('a call its turn ended without answering sent nothing, whatever arrives after the end', () => {
    expect(lines([ev('turn.started', {}), text('Looking first.'), call('c1', 'Stage 1 is done.')], [ev('turn.ended', {})], [result('c1')])).toEqual(['Looking first.', 'Looking first.', 'Looking first.']);
  });

  it('one event on its own keeps no call waiting: a result folded alone is no message', () => {
    expect(run([text('Looking first.'), call('c1', 'Stage 1 is done.'), result('c1')]).lastAssistantLine).toBe('Looking first.');
  });

  // The recorded session (spikes/protocol-probe/fixtures/p4/p4-r7-tool-stages.jsonl): three statuses through the tool,
  // each in the same response as the next command, then the final message as a span; one batch per frame.
  it('over the recorded wire, each status is the last line in turn once its result is in, then the final message', () => {
    const rows = readFileSync(join(FIXTURE_DIR, 'p4', 'p4-r7-tool-stages.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => parseJournalRow(JSON.parse(line)));
    const normalizer = new Normalizer({ appSessionId: APP, launchId: 'LAUNCH01', sessionId: null });
    const shown = lines(...rows.map((row) => normalizer.push(row))).filter((line, i, all) => line !== null && line !== all[i - 1]);
    expect(shown).toEqual([
      'Stage 1 of 4 is done. It indexed 1,240 call transcripts, and 37 of them are missing their speaker labels.',
      'Stage 2 of 4 is done. It restored 34 of the 37 missing labels from the audio. Calls 0412, 0977 and 1203 could not be restored and need a person to label them. Moving on to stage 3.'.slice(0, 160),
      'Stage 3 of 4 is done. The classifier is trained. Accuracy on the held-out 10% is 91.4%, down from 93.0% last week, a drop of 1.6 points.',
      'Stage 4 of 4 is done, so the whole pipeline has run. It wrote `out/labels.csv` with 1,240 rows.', // the span's first line
    ]);
  });
});

// C12 start: the memory budget's released mark (C12 execution document, Interfaces "X2 additions", SessionDigest.released).
// A release reads idle with the mark, not exited; the next launch clears it.
describe('a budget exit reads idle with the released mark', () => {
  const RELEASE = { limitKiB: 8_388_608, totalKiB: 9_100_000 };
  const releasedStatus = () => ({ ...status(APP, { process: 'exited', exit: { reason: 'budget', release: RELEASE } }), exit: { code: 0, signal: null, reason: 'budget' as const, at: '2026-09-29T14:02:00.000Z', release: RELEASE } });

  it('the exited status of a release maps to idle with the mark, keeping an existing mark', () => {
    const working = { ...emptyDigest(APP), phase: 'working' as const, activity: 'Thinking' };
    const released = applyStatusToDigest(working, releasedStatus());
    expect(released).toMatchObject({ phase: 'idle', activity: null, released: { at: '2026-09-29T14:02:00.000Z', reason: 'budget', limitKiB: 8_388_608 } });
    const earlier = { ...released, released: { at: '2026-09-29T13:00:00.000Z', reason: 'budget' as const, limitKiB: 4_194_304 } };
    expect(applyStatusToDigest(earlier, releasedStatus()).released).toEqual({ at: '2026-09-29T13:00:00.000Z', reason: 'budget', limitKiB: 4_194_304 });
  });

  it('every other exit keeps today’s mapping, with no mark', () => {
    for (const reason of ['stop', 'quit', 'archive', 'unknown'] as const) {
      const d = applyStatusToDigest(emptyDigest(APP), status(APP, { process: 'exited', exit: { reason } }));
      expect(d.phase).toBe('exited');
      expect(d.released).toBeUndefined();
    }
  });

  it('the process.exited event of a release folds to idle with the mark and no pending requests', () => {
    const exited = ev('process.exited', { reason: 'budget', budget: RELEASE, at: '2026-09-29T14:02:00.000Z' });
    expect(run([ev('turn.started', {}), ev('turn.ended', {}), exited])).toMatchObject({ phase: 'idle', activity: null, pendingRequests: 0, released: { at: '2026-09-29T14:02:00.000Z', reason: 'budget', limitKiB: 8_388_608 } });
    expect(run([ev('process.exited', { reason: 'stop' })]).released).toBeUndefined();
  });

  it('a launch clears the mark: starting and initializing drop it', () => {
    const released = applyStatusToDigest(emptyDigest(APP), releasedStatus());
    for (const process of ['starting', 'initializing'] as const) {
      const d = applyStatusToDigest(released, status(APP, { process }));
      expect(d.phase).toBe('starting');
      expect(d.released).toBeUndefined();
    }
  });

  // E10: the supervisor's idle release is a release like the budget's, with no budget detail
  it('an idle release reads idle with the mark, its reason idle and no limit, from the status and from the event', () => {
    const idleStatus = { ...status(APP, { process: 'exited', exit: { reason: 'idle', release: null } }), exit: { code: 0, signal: null, reason: 'idle' as const, at: '2026-10-06T14:02:00.000Z', release: null } };
    const working = { ...emptyDigest(APP), phase: 'working' as const, activity: 'Thinking' };
    expect(applyStatusToDigest(working, idleStatus)).toMatchObject({ phase: 'idle', activity: null, released: { at: '2026-10-06T14:02:00.000Z', reason: 'idle', limitKiB: null } });
    const exited = ev('process.exited', { reason: 'idle', budget: null, at: '2026-10-06T14:02:00.000Z' });
    expect(run([ev('turn.started', {}), ev('turn.ended', {}), exited])).toMatchObject({ phase: 'idle', activity: null, pendingRequests: 0, released: { at: '2026-10-06T14:02:00.000Z', reason: 'idle', limitKiB: null } });
    expect(applyStatusToDigest(applyStatusToDigest(emptyDigest(APP), idleStatus), status(APP, { process: 'starting' })).released).toBeUndefined();
  });
});
// C12 end
