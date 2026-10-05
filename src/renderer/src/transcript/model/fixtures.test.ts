import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentId, SessionId } from '@shared/graph/ids';
import { ChainFollower, type ChainFollowerOptions } from '../../../../engine-host/fs/chain-follower';
import { MemoryFileReader } from '../../../../../test/support/memory-reader';
import { TEST_FIXTURE_DIR } from '../../../../../test/support/fixtures';
import type { SessionEvent } from '@shared/graph/events';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEventFixture, loadJournal, loadSyntheticJournal } from '../../../../../test/support/fixtures';
import { synthesise } from '../../../../../test/support/synth-transcript';
import { journalToEvents } from '../dev/journal';
import { rowsOf, withAllExpanded } from './derive';
import { rowId } from './keys';
import { applyEvents, createState } from './reduce';
import type { Cell, Row } from './rows';
import { configureTime } from './time';

const stateOf = (events: SessionEvent[]) => applyEvents(createState(null, null), events);
const rowsFor = (events: SessionEvent[]) => rowsOf(withAllExpanded(stateOf(events)));
const journal = (name: string) => journalToEvents(loadSyntheticJournal(name));
const ofKind = <K extends Row['kind']>(rows: Row[], kind: K) => rows.filter((row): row is Extract<Row, { kind: K }> => row.kind === kind);
const cellsOf = (rows: Row[]): Cell[] => rows.flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []));
const inTurn = (rows: Row[], turnId: string | null) => rows.filter((row) => row.turnId === turnId);

afterEach(() => configureTime(null));

describe('synthetic journals', () => {
  it('transcript/denials: every disposition of the denial table', () => {
    const state = stateOf(journal('denials'));
    const rows = rowsOf(withAllExpanded(state));
    expect(state.order).toHaveLength(3);
    const [first, second, third] = state.order.map((id) => inTurn(rows, id));
    const dividers = ofKind(rows, 'divider');
    expect(dividers.map((d) => [d.state, d.denied, d.autoDenied])).toEqual([['completed', 1, 2], ['stopped', 0, 0], ['completed', 0, 0]]);
    const firstCells = ofKind(first, 'cell');
    expect(firstCells.map((c) => [c.status, c.classification.denial?.disposition])).toEqual([['denied', 'denied'], ['denied', 'auto_denied'], ['denied', 'auto_denied']]);
    expect(ofKind(first, 'group')).toHaveLength(0);
    expect(dividers[0].firstDeniedCell).toBe(firstCells[0].id);
    expect(firstCells.map((c) => c.label)).toEqual([
      'Denied: `git push --force origin main` · Never force-push main.',
      'Auto mode blocked: `rm -rf build` · Auto mode blocked this command: destructive deletion outside the workspace allowlist.',
      'Auto mode blocked: `curl -X POST https://deploy.example.com/hook` · review unreadable',
    ]);
    const interrupted = cellsOf(second);
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]).toMatchObject({ status: 'stopped', label: 'Stopped: `sleep 1; echo 1`', classification: { denial: { kind: 'user-rejected', disposition: 'stopped', interruption: true } } });
    expect(dividers[1].firstDeniedCell).toBeNull();
    const stopped = cellsOf(third);
    expect(stopped.map((c) => [c.status, c.classification.denial?.kind])).toEqual([['stopped', 'automode-unavailable'], ['stopped', 'interrupted'], ['stopped', 'cancelled']]);
    expect(stopped.map((c) => c.label)).toEqual(['Stopped: `./deploy.sh stage` · auto mode unavailable', 'Stopped: `./deploy.sh prod`', 'Stopped: `./deploy.sh verify`']);
    expect(dividers[2].firstDeniedCell).toBeNull();
    expect(dividers[2].summary.denials.map((d) => d.disposition)).toEqual(['stopped', 'stopped', 'stopped']);
    for (const cell of [...interrupted, ...stopped]) expect(cell.label.toLowerCase().includes('auto')).toBe(cell.classification.denial?.kind === 'automode-unavailable');
    // The `!` command: one bash row, no bubble for the echo, no turn opened by its init or closed by its receipt.
    expect(ofKind(rows, 'bash')).toHaveLength(1);
    expect(ofKind(rows, 'bash')[0]).toMatchObject({ command: 'git status --short', stdout: ' M src/app.ts\n?? build/', exitCode: 0 });
    expect(ofKind(rows, 'user')).toHaveLength(3);
    expect(state.echoUuids.size).toBe(1);
  });

  it('transcript/plan-outcomes: three plan rows with the three outcomes and one reset boundary', () => {
    const rows = rowsFor(journal('plan-outcomes'));
    const plans = ofKind(rows, 'plan');
    expect(plans.map((p) => [p.outcome, p.feedback])).toEqual([['implement', null], ['clear_and_implement', null], ['keep_planning', 'Add the delta-batch measurement before I approve.']]);
    expect(plans.map((p) => p.id)).toEqual(['plan:toolu_synth_plan_1', 'plan:toolu_synth_plan_2', 'plan:toolu_synth_plan_3']);
    expect(plans[0].plan.startsWith('# Plan 1')).toBe(true);
    const boundaries = ofKind(rows, 'boundary');
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({ boundaryKind: 'reset', text: 'Conversation reset · after plan approval' });
    expect(ofKind(rows, 'request_slot')).toHaveLength(0);
  });

  it('transcript/boundaries: a retraction boundary, the retracted text absent, two time rows, a retry row updated in place, compaction and a notice', () => {
    configureTime({ now: '2026-09-29T00:00:00.000Z', locale: 'en-US', timeZone: 'UTC' });
    const state = stateOf(journal('boundaries'));
    const rows = rowsOf(withAllExpanded(state));
    const times = ofKind(rows, 'time');
    expect(times).toHaveLength(2);
    expect(times.map((t) => t.label)).toEqual(['Yesterday 8:00 AM', 'Yesterday 10:00 AM']);
    const retraction = ofKind(rows, 'boundary').find((b) => b.boundaryKind === 'retraction')!;
    expect(retraction).toMatchObject({ text: 'Response retracted · refusal · switched to claude-sonnet-5', turnId: state.order[1] });
    expect(ofKind(rows, 'assistant_text').some((t) => t.markdown === 'I cannot help with that request.')).toBe(false);
    expect(ofKind(rows, 'assistant_text').some((t) => t.markdown.startsWith('An APPLE once sat'))).toBe(true);
    const retries = ofKind(rows, 'error').filter((e) => e.scope === 'api');
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({ id: rowId.retry(state.order[1]), attempt: { n: 2, max: 10 }, text: 'Retrying (2/10) · 529 Overloaded' });
    const compaction = ofKind(rows, 'boundary').find((b) => b.boundaryKind === 'compaction')!;
    expect(compaction).toMatchObject({ turnId: null, text: 'Context compacted · 164k → 24k tokens · auto' });
    expect(ofKind(rows, 'error').find((e) => e.scope === 'notice')).toMatchObject({ text: 'Context is 82% full; compaction will run before the next turn.', turnId: null });
    // Loose rows sit after the turn they followed, before the next one.
    const kinds = rows.map((r) => r.kind);
    expect(kinds.indexOf('boundary', kinds.indexOf('boundary') + 1)).toBeLessThan(kinds.lastIndexOf('user'));
  });

  it('transcript/mockup-turn: Worked for {t} · 12 tool calls · 1 denied, the denied cell outside its group, three files in the receipt', () => {
    const rows = rowsFor(journal('mockup-turn'));
    const divider = ofKind(rows, 'divider')[0];
    expect(divider).toMatchObject({ state: 'completed', origin: 'human', toolCalls: 12, denied: 1, autoDenied: 0, firstDeniedCell: 'cell:toolu_synth_mock_7' });
    expect(divider.summary.byCategory).toEqual({ mcp: 0, skills: 0, files: 3, exploration: 4, commands: 5, web: 0, other: 0 });
    const denied = ofKind(rows, 'cell').find((c) => c.id === 'cell:toolu_synth_mock_7')!;
    expect(denied).toMatchObject({ status: 'denied', label: 'Denied: `rm -rf node_modules/.vite` · Permission denied by rule: Bash(rm -rf:*) is denied in this project.' });
    expect(ofKind(rows, 'group').map((g) => g.summary)).toEqual(['Read 2 files, searched for `setWidth`, searched for `src/layout/*.css`', 'Edited 2 files', 'Ran 4 commands']);
    expect(ofKind(rows, 'assistant_text').map((t) => t.phase)).toEqual(['commentary', 'commentary', 'answer']);
    const receipt = ofKind(rows, 'receipt')[0];
    expect(receipt.files.map((f) => f.path.split('/').at(-1))).toEqual(['useSidebarDrag.ts', 'store.ts', 'sidebar.css']);
    expect(receipt).toMatchObject({ added: 4, removed: 2 });
  });

  it('transcript/edit-and-receipt: edit cells with hunks and the receipt with three files', () => {
    const rows = rowsFor(journal('edit-and-receipt'));
    const cells = cellsOf(rows);
    const edits = cells.filter((c) => c.detail.kind === 'edit');
    expect(edits.map((c) => c.label.split(' ')[0])).toEqual(['Edited', 'Edited', 'Created']);
    expect(edits.map((c) => (c.detail.kind === 'edit' ? [c.detail.change, c.detail.added, c.detail.removed, c.detail.hunks.length] : null))).toEqual([['update', 1, 1, 1], ['update', 3, 3, 1], ['create', 3, 0, 1]]);
    const shell = cells.find((c) => c.detail.kind === 'shell')!;
    expect(shell.detail).toMatchObject({ kind: 'shell', command: 'pnpm test', exitCode: 0 });
    expect(shell.label).toMatch(/^Ran `pnpm test` in \d+s$/);
    expect(ofKind(rows, 'receipt')[0]).toMatchObject({ added: 7, removed: 4 });
    expect(ofKind(rows, 'receipt')[0].files).toHaveLength(3);
    expect(ofKind(rows, 'assistant_text').at(-1)?.markdown).toContain('```ts');
  });

  it('transcript/agents-and-messages: one grouped subagent row, an agent message, a following engine turn', () => {
    const state = stateOf(journal('agents-and-messages'));
    const rows = rowsOf(withAllExpanded(state));
    expect(state.order.map((id) => state.turns.get(id)!.origin)).toEqual(['human', 'engine']);
    const subagents = ofKind(rows, 'subagent');
    expect(subagents).toHaveLength(1);
    expect(subagents[0].agents.map((a) => [a.taskId, a.name, a.agentId])).toEqual([['ad1synthagent0001', 'Survey src for TODOs', 'ad1synthagent0001'], ['ad2synthagent0002', 'List the tests', 'ad2synthagent0002']]);
    expect(subagents[0]).toMatchObject({ status: 'finished', sentence: 'Survey src for TODOs and List the tests finished' });
    expect(ofKind(rows, 'agent_message')[0]).toMatchObject({ direction: 'to_child', text: 'Sent message to ad1synthagent0001: Skip node_modules entirely.' });
    expect(cellsOf(rows).some((c) => c.toolName === 'Agent' || c.toolName === 'Grep')).toBe(false); // the child's Grep is never a parent cell
    expect(state.turns.get(state.order[0])!.children.get('toolu_synth_agent_1' as never)?.length).toBeGreaterThan(0);
    expect(ofKind(rows, 'user')).toHaveLength(1);
  });

  it('transcript/exploration-and-web: a merged read cell with six paths and the web, skill, tool-search and MCP cells', () => {
    const rows = rowsFor(journal('exploration-and-web'));
    const cells = cellsOf(rows);
    const reads = cells.find((c) => c.id === 'cell:reads:toolu_synth_x_read1')!;
    expect(reads.paths).toHaveLength(6);
    expect(reads.label).toBe('Read 6 files');
    expect(reads.detail).toMatchObject({ kind: 'read', files: expect.arrayContaining([{ path: expect.stringContaining('reduce.ts'), range: [10, 49] }]) });
    expect(ofKind(rows, 'group').map((g) => g.summary)).toEqual([
      'Read 6 files, searched for `rowsOf`, searched for `src/model/**/*.ts`',
      'Used docs, loaded test-driven-development skill, loaded 2 tools, searched the web for tanstack virtual followOnAppend, fetched tanstack.com',
    ]);
    expect(cells.find((c) => c.toolName === 'mcp__docs__search')?.detail).toMatchObject({ kind: 'mcp', server: 'docs', tool: 'search' });
    expect(ofKind(rows, 'divider')[0].toolCalls).toBe(13); // Grep, Glob, six Reads, WebSearch, WebFetch, Skill, ToolSearch, one MCP call
  });

  it('transcript/attachments-and-images: an image attachment on the bubble and a standalone image cell', () => {
    const rows = rowsFor(journal('attachments-and-images'));
    const user = ofKind(rows, 'user')[0];
    expect(user.attachments).toHaveLength(1);
    expect(user.attachments[0]).toMatchObject({ kind: 'image', mediaType: 'image/png', text: null });
    expect(user.attachments[0].dataUrl?.startsWith('data:image/png;base64,')).toBe(true);
    expect(user.text).toBe('Here is the failing screenshot. Read shot.png from the repo too and compare.');
    const image = ofKind(rows, 'cell').find((c) => c.detail.kind === 'image')!;
    expect(image).toBeDefined();
    expect(image.classification.groupable).toBe(false);
    expect(ofKind(rows, 'group')).toHaveLength(0);
  });

  it('transcript/long-output: a result over 64 KB is marked truncated with the whole text kept', () => {
    const cells = cellsOf(rowsFor(journal('long-output')));
    const big = cells[0].detail;
    expect(big.kind).toBe('shell');
    if (big.kind !== 'shell') return;
    expect(big.stdout.length).toBeGreaterThan(64 * 1024);
    expect(big.truncated).toEqual({ shownHead: 32 * 1024, shownTail: 16 * 1024, omittedBytes: big.stdout.length - 48 * 1024 });
    expect(cells[1].detail).toMatchObject({ kind: 'shell', truncated: null });
  });

  // C3's normaliser reads the engine's persisted Bash output (`tool_use_result.persistedOutputPath`) as the spill path.
  it('transcript/long-output: a persisted Bash output is a spill the detail can load', () => {
    const cells = cellsOf(rowsFor(journal('long-output')));
    expect(cells[1].detail).toMatchObject({
      kind: 'shell',
      spill: { path: '/Users/owner/.claude/projects/-Users-owner-app/00000000-c6c6-4000-8000-longoutput00/tool-results/toolu_synth_long_2.txt', state: 'not_loaded' },
    });
  });

  it('transcript/idle-drop: a prompt the engine drops before it starts stays a bubble, dropped, and its turn closes without work', () => {
    const events = journal('idle-drop');
    // No turn.started (the engine never accepted it) and no synthetic turn.ended: the lifecycle event is the drop.
    expect(events.some((e) => e.kind === 'turn.started' || e.kind === 'turn.ended')).toBe(false);
    const lifecycle = loadSyntheticJournal('idle-drop').find((row) => (row.frame as { type?: string; state?: string }).type === 'command_lifecycle' && (row.frame as { state?: string }).state === 'cancelled')!;
    expect(events.find((e) => e.kind === 'command.lifecycle' && e.state === 'cancelled')).toMatchObject({ seq: lifecycle.seq, at: lifecycle.at });
    const state = stateOf(events);
    expect(state.order).toHaveLength(1);
    expect(state.turns.get(state.order[0])!.state).toBe('closed');
    const rows = rowsOf(withAllExpanded(state));
    expect(rows.map((r) => r.kind)).toEqual(['time', 'user', 'error']); // the exit row follows
    expect(ofKind(rows, 'user')[0]).toMatchObject({ dropped: true, steer: false });
  });

  // W1 (A1): the owner's journal shape for shot 11. MessageDisplay and Stop hooks follow every final text, so a rule that
  // counted them as work classed the answer as commentary, muted and folded away; and an empty thinking block opened
  // onto nothing.
  it('transcript/hooks-after-answer: the final text after a trailing MessageDisplay and Stop hook is the answer, in its display form, visible when collapsed', () => {
    const state = stateOf(journal('hooks-after-answer'));
    expect(state.order).toHaveLength(2);
    const collapsed = rowsOf(state);
    const answers = ofKind(collapsed, 'assistant_text');
    expect(answers.map((row) => [row.turnId, row.phase, row.markdown])).toEqual([
      [state.order[0], 'answer', '\nto human\n\nDoing fine and ready to work.\n\nNothing is in progress.\n'],
      [state.order[1], 'answer', '\nto human\n\nIt is 10:00.\n'],
    ]);
    const expanded = rowsOf(withAllExpanded(state));
    expect(ofKind(expanded, 'assistant_text').every((row) => row.phase === 'answer')).toBe(true);
    expect(ofKind(expanded, 'thinking')).toEqual([]); // the signature-only block has nothing to disclose
    // A4: the successful MessageDisplay, PreToolUse and Stop hooks show nothing; the Bash call is the only work.
    expect(cellsOf(expanded).map((cell) => cell.toolName)).toEqual(['Bash']);
    expect(ofKind(expanded, 'error').filter((row) => row.scope === 'hook')).toEqual([]);
    // The answer comes after the turn's work, as the last row of its turn.
    const second = inTurn(expanded, state.order[1]);
    expect(second.at(-1)).toMatchObject({ kind: 'assistant_text', phase: 'answer' });
  });

  it('transcript/math-and-diagrams: the answer carries the math and the mermaid fence verbatim', () => {
    const answer = ofKind(rowsFor(journal('math-and-diagrams')), 'assistant_text')[0].markdown;
    expect(answer).toContain('$$\n\\frac{1}{60}');
    expect(answer).toContain('```mermaid\nflowchart LR');
  });
});

describe('event fixtures', () => {
  it('events/streaming-block: a live text row after the first delta, the same id and live: false after the complete, no re-derivation between deltas', () => {
    const events = loadEventFixture('streaming-block');
    const firstTextDelta = events.findIndex((e) => e.kind === 'assistant.block.delta' && e.blockType === 'text');
    let state = stateOf(events.slice(0, firstTextDelta + 1));
    const live = ofKind(rowsOf(state), 'assistant_text');
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ id: 'text:msg_stream_1:1', live: true, messageUuid: null, markdown: 'The list is **anchored to its end**: ', phase: 'answer' });
    state = applyEvents(state, [events[firstTextDelta + 1]]);
    const afterSecond = rowsOf(state);
    state = applyEvents(state, [events[firstTextDelta + 2]]);
    expect(rowsOf(state)).toBe(afterSecond);
    state = applyEvents(state, events.slice(firstTextDelta + 3));
    const done = ofKind(rowsOf(state), 'assistant_text');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ id: 'text:msg_stream_1:1', live: false, messageUuid: 'a-stream-2' });
    expect(done[0].markdown.endsWith('by the same amount.')).toBe(true);
    expect(ofKind(rowsOf(withAllExpanded(state)), 'thinking')[0]).toMatchObject({ id: 'think:msg_stream_1:0', live: false, durationMs: 500 });
  });

  it('events/disk-null-origin (a synthetic disk history; C4’s real backfill is pinned in disk.test.ts): human turns only, each with a user row, the Agent call as a subagent row', () => {
    const state = stateOf(loadEventFixture('disk-null-origin'));
    expect(state.order).toHaveLength(2);
    expect(state.order.map((id) => state.turns.get(id)!.origin)).toEqual(['human', 'human']);
    const rows = rowsOf(withAllExpanded(state));
    expect(ofKind(rows, 'user').map((u) => u.text)).toEqual(['Dispatch an agent to read one.txt and report its content.', 'Thanks. Now say DONE.']);
    const subagent = ofKind(rows, 'subagent');
    expect(subagent).toHaveLength(1);
    expect(subagent[0].agents[0]).toMatchObject({ name: 'Read and report one.txt content', toolUseId: 'toolu_disk_agent', agentId: 'ad286defbc77bc090', kind: 'agent' });
    expect(cellsOf(rows).some((c) => c.toolName === 'Agent')).toBe(false);
    expect(ofKind(rows, 'divider').map((d) => d.origin)).toEqual(['human']);
    expect(ofKind(rows, 'thinking')[0].durationMs).toBeNull();
  });

  // W1's hook notices after a reload (C4 · C6): disk keeps no hook events, so C4's backfill (debt wave 7) states a hook
  // that got in the way from what the engine writes, in the wire's own kinds: the meta "Stop hook feedback" record and
  // the blocked prompt's `informational` record (w1-hooks-blocking.jsonl lines 24 and 31) each become a `hook.started`
  // and a `hook.finished` in the exit-2 form (outcome error, exit code 2, the reason on stderr), whichever way the hook
  // blocked live; the blocked prompt opens and closes a turn of its own with the record's "Original prompt:". The
  // reload reads the notices the live session showed (pass3/hooks-blocking is the same run), in the same places, folded
  // or not.
  it('events/hooks-blocking-disk: the disk form of pass3/hooks-blocking reads the same hook notices in the same places as live', () => {
    const shape = (rows: Row[]) =>
      rows
        .filter((row) => row.kind !== 'time' && !(row.kind === 'error' && row.scope === 'exit')) // the disk read ends with no exit of its own
        .map((row) => (row.kind === 'error' ? `${row.scope}:${row.severity}:${row.text}${row.action ? `:${row.action}` : ''}` : row.kind === 'user' ? `user:${row.text}` : row.kind === 'assistant_text' ? `${row.phase}:${row.markdown}` : row.kind));
    const disk = stateOf(loadEventFixture('hooks-blocking-disk'));
    const live = stateOf(journalToEvents(loadJournal('pass3', 'hooks-blocking')));
    expect(shape(rowsOf(disk))).toEqual([
      'user:Reply ONE',
      'answer:ONE',
      'hook:notice:Hook re-prompted Claude · Say REPROMPTED and stop',
      'answer:REPROMPTED',
      'user:BLOCKME please reply TWO',
      'hook:notice:A hook blocked your prompt · BLOCKED_BY_TEST_HOOK:edit_prompt',
    ]);
    expect(shape(rowsOf(disk))).toEqual(shape(rowsOf(live)));
    expect(shape(rowsOf(withAllExpanded(disk)))).toEqual(shape(rowsOf(withAllExpanded(live))));
    // the blocked prompt's notice sits in the turn of the prompt it hands back
    const blocked = ofKind(rowsOf(disk), 'error').find((row) => row.action === 'edit_prompt')!;
    expect(ofKind(rowsOf(disk), 'user').find((row) => row.turnId === blocked.turnId)?.text).toBe('BLOCKME please reply TWO');
  });

  it('events/spill: the shell detail carries the spill unloaded, its size from persistedOutputSize, with the wire preview as content', () => {
    const cell = cellsOf(rowsFor(loadEventFixture('spill')))[0];
    expect(cell.detail).toMatchObject({ kind: 'shell', spill: { path: '/Users/owner/.claude/projects/-tmp-demo/session/tool-results/toolu_spill_1.txt', bytes: 188_416, state: 'not_loaded', content: null } });
    expect(cell.detail.kind === 'shell' && cell.detail.stdout.startsWith('[1/1200]')).toBe(true);
  });

  it('events/reconnect: a reconnect row updates in place through its episode, leaves on reconnected, and a failed one says why', () => {
    const events = loadEventFixture('reconnect');
    const reconnectsOf = (rows: Row[]) => ofKind(rows, 'error').filter((e) => e.scope === 'reconnect');
    const attempting = reconnectsOf(rowsFor(events.slice(0, 6))); // through the second attempt of the first episode
    expect(attempting.map((r) => [r.id, r.text])).toEqual([['reconnect:r4', 'Reconnecting (2/3)…']]); // keyed by its first attempting event
    const rows = rowsFor(events);
    expect(reconnectsOf(rows).map((r) => [r.id, r.text])).toEqual([['reconnect:r11', 'Could not reconnect · engine binary missing']]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(rows.map((r) => r.kind)).toEqual(['time', 'user', 'assistant_text', 'user', 'assistant_text', 'error']);
  });

  it('events/process-exit: a permission resolved by exit leaves no row; the exit row carries the lost count', () => {
    const rows = rowsFor(loadEventFixture('process-exit'));
    expect(ofKind(rows, 'request_slot')).toHaveLength(0);
    expect(rows.at(-1)).toMatchObject({ kind: 'error', scope: 'exit', severity: 'error', text: 'Session process exited (crash) · 1 approval lost', lostAttentionCount: 1 });
    expect(cellsOf(rows)[0]).toMatchObject({ status: 'stopped', classification: { humanDecision: false } }); // the killed process ended its turn: the call stopped (M6 whole-branch fix)
  });
});

describe('the seeded transcript', () => {
  it('derives to the same rows twice, with at least 7,000 rows and cells fully expanded', () => {
    const events = synthesise({ turns: 500, seed: 1 });
    const first = rowsOf(withAllExpanded(stateOf(events)));
    const second = rowsOf(withAllExpanded(stateOf(events)));
    expect(first).toEqual(second);
    const total = first.reduce((n, row) => n + 1 + (row.kind === 'group' ? row.cells.length : 0), 0);
    expect(total).toBeGreaterThanOrEqual(7000);
    expect(ofKind(first, 'user')).toHaveLength(500);
    expect(ofKind(first, 'subagent')).toHaveLength(50);
    expect(ofKind(first, 'boundary').filter((b) => b.boundaryKind === 'compaction')).toHaveLength(2);
    expect(ofKind(first, 'divider').filter((d) => d.denied > 0)).toHaveLength(12);
  });
});

// D1: synthetic, anonymised terminal storage shapes through the production disk pipeline.
async function d1Fixture(name: string, options: ChainFollowerOptions = {}) {
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(readFileSync(join(TEST_FIXTURE_DIR, `transcript-d1-${name}.jsonl`))), 'd1-session' as SessionId, null,
    (event) => { if (event.t === 'events') events.push(...event.events); }, { holders: () => 0, ...options });
  await follower.start();
  follower.stop();
  const state = stateOf(events);
  return { events, state, rows: rowsOf(withAllExpanded(state)) };
}

describe('D1 disk semantics', () => {
  it('S1 draws command output without wrappers, ANSI, empty output or command echoes', async () => {
    const { rows } = await d1Fixture('local-commands');
    expect(ofKind(rows, 'user').map((row) => row.text)).toEqual(['/model example']);
    expect(ofKind(rows, 'local_command').map((row) => row.text)).toEqual(['Model selected', 'Status ready', 'Command failed']);
    expect(ofKind(rows, 'error')).toEqual([]);
  });
});

const d1Sidecars: ChainFollowerOptions['subagents'] = {
  byToolUseId: (toolUseId) => ({ agentId: toolUseId.replace('tool-', 'child-') as AgentId, meta: { agentType: 'general-purpose', description: toolUseId, toolUseId, spawnDepth: 1, requestShape: 'background' }, prompt: null }),
};

describe('D1 subagent outcomes', () => {
  it.each([false, true])('S2 closes task notifications and deduplicates source/legacy deliveries (sidecar %s)', async (sidecar) => {
    const { events, state, rows } = await d1Fixture('subagents', sidecar ? { subagents: d1Sidecars } : {});
    expect(state.order).toHaveLength(1);
    expect(events.filter((event) => event.kind === 'turn.started')).toHaveLength(1);
    expect(ofKind(rows, 'assistant_text').at(-1)?.turnId).toBe(state.order[0]);
    expect(state.turns.get(state.order[0])?.ended?.userMessageUuids).toEqual(['d1-subagents-0']);
    const outcomes = events.filter((event) => event.kind === 'subagent.finished' || event.kind === 'task.notification');
    expect(outcomes.map((event) => [event.taskId, event.status])).toEqual([['child-new', 'completed'], ['child-old', 'completed']]);
    expect(ofKind(rows, 'subagent').map((row) => row.status)).toEqual(['finished']);
    expect(ofKind(rows, 'user').map((row) => row.text)).toEqual(['Run two sample tasks.']);
  });
  it.each([false, true])('S2 failed Agent results terminate the invocation (sidecar %s)', async (sidecar) => {
    const { rows } = await d1Fixture('agent-failure', sidecar ? { subagents: d1Sidecars } : {});
    expect(ofKind(rows, 'subagent').map((row) => row.status)).toEqual(['finished_with_errors']);
  });
});

it('S3 keeps warning and notice informational records, not info/empty, and preserves blocked prompts', async () => {
  const { events, rows } = await d1Fixture('notices');
  expect(events.filter((e) => e.kind === 'notice.posted').map((e) => [e.level, e.text])).toEqual([
    ['notice', 'Usage resumed.'], ['warning', 'Remote connection unavailable.'],
  ]);
  expect(ofKind(rows, 'error').map((row) => [row.scope, row.text])).toEqual([
    ['notice', 'Usage resumed.'], ['notice', 'Remote connection unavailable.'], ['hook', 'A hook blocked your prompt · Blocked by sample policy'],
  ]);
});

it('S4 retains API-error envelopes as diagnostics and uses the last assistant evidence for turn outcomes', async () => {
  const { events, state, rows } = await d1Fixture('api-errors');
  expect(ofKind(rowsOf(state), 'error').map((row) => row.text)).toEqual(['Authentication unavailable.', 'Authentication unavailable.']);
  expect(events.filter((e) => e.kind === 'assistant.block.complete' && e.model === '<synthetic>')).toEqual([
    expect.objectContaining({ isApiErrorMessage: true, error: 'authentication_failed' }),
    expect.objectContaining({ isApiErrorMessage: true, error: 'authentication_failed' }),
  ]);
  expect(events.filter((e) => e.kind === 'turn.ended').map((e) => [e.result, e.isError])).toEqual([
    ['error_during_execution', true], ['success', false], ['success', false],
  ]);
  expect(ofKind(rows, 'assistant_text').map((row) => row.markdown)).toEqual(['Recovered successfully.', 'Success.']);
  expect(ofKind(rows, 'error').map((row) => [row.scope, row.severity, row.text])).toEqual([
    ['api', 'error', 'Authentication unavailable.'], ['api', 'error', 'Authentication unavailable.'],
  ]);
});

it('S5 skips completed empty and whitespace native text rows', async () => {
  const { rows } = await d1Fixture('empty-text');
  expect(ofKind(rows, 'assistant_text').map((row) => row.markdown)).toEqual(['Visible answer.']);
});


describe('FX8 disk conversation history', () => {
  async function fx8(name: string) {
    const events: SessionEvent[] = [];
    const follower = new ChainFollower(new MemoryFileReader(readFileSync(join(TEST_FIXTURE_DIR, `transcript-fx8-${name}.jsonl`))), 'fx8-session' as SessionId, null,
      (event) => { if (event.t === 'events') events.push(...event.events); }, { holders: () => 2 });
    await follower.start();
    follower.stop();
    return stateOf(events);
  }

  it('a real fork persists outside folded work, without a second-writer notice', async () => {
    configureTime({ now: '2026-10-04T00:00:00.000Z', locale: 'en-US', timeZone: 'UTC' });
    const state = await fx8('fork');
    const rows = rowsOf(state);
    const boundaries = ofKind(rows, 'boundary');
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({ text: 'Conversation continued from an earlier point', secondary: 'Later messages from the previous path are no longer part of the current conversation history' });
    expect(ofKind(rows, 'error')).toEqual([]);
    expect(ofKind(rowsOf(withAllExpanded(state)), 'boundary')).toEqual(boundaries);
    await expect(JSON.stringify(rows, null, 2) + '\n').toMatchFileSnapshot(join(TEST_FIXTURE_DIR, '../snapshots/transcript/fx8/fork.rows.json'));
  });

  it('does not render the exact synthetic no-response marker', async () => {
    const state = await fx8('no-response');
    expect(ofKind(rowsOf(state), 'assistant_text')).toEqual([]);
    expect(ofKind(rowsOf(withAllExpanded(state)), 'assistant_text')).toEqual([]);
  });

  it.each([
    { command: 'echo', anchored: false }, { command: 'compact', anchored: false },
    { command: 'echo', anchored: true }, { command: 'compact', anchored: true },
  ])('restores the retained $command turn context on rejoin (anchored=$anchored) without duplicate rows or deliveries', async ({ command, anchored }) => {
    const records: Record<string, unknown>[] = readFileSync(join(TEST_FIXTURE_DIR, 'transcript-fx8-local-cuts.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    if (command === 'compact') records.splice(2, 4, { type: 'user', uuid: 'compact', parentUuid: 'a', message: { content: '/compact' } });
    const encode = (items: Record<string, unknown>[]) => items.map((record) => JSON.stringify(record) + '\n').join('');
    const events: SessionEvent[] = [];
    const reader = new MemoryFileReader(encode(records));
    const follower = new ChainFollower(reader, 'fx8-local-context' as SessionId, null,
      (event) => { if (event.t === 'events') events.push(...event.events); }, { holders: () => 2 });
    await follower.start();
    if (anchored) {
      reader.append(encode([{ type: 'last-prompt', leafUuid: 'a', rewound: true }]));
      await follower.poke();
    }
    const before = events.length;
    reader.append(encode([{ type: 'system', subtype: 'turn_duration', uuid: 'end', parentUuid: command === 'echo' ? 'output' : 'compact', durationMs: 25 }]));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(command === 'echo' ? ['u', 'a', 'caveat', 'echo', 'output', 'end'] : ['u', 'a', 'compact', 'end']);
    expect(events.slice(before).filter((event) => event.kind === 'turn.ended')).toMatchObject([{ userMessageUuids: [command] }]);
    expect(events.slice(before).filter((event) => event.kind === 'user.message' || event.kind === 'turn.started')).toEqual([]);
    const state = stateOf(events);
    // C6 tracks the existing reducer limitation for results naming already-closed turns; FX8 pins
    // the follower's exact command identity above and preserves visible history without duplicate delivery.
    for (const rows of [rowsOf(state), rowsOf(withAllExpanded(state))]) {
      // Local commands contain no model work, so their completed turn correctly has no work divider.
      expect(ofKind(rows, 'divider').filter((row) => row.turnId === `turn:${command}`)).toEqual([]);
      expect(ofKind(rows, 'local_command').map((row) => row.text)).toEqual(command === 'echo' ? ['Ready', 'Ready again'] : []);
      expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    }
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
    follower.stop();
  });

  it.each([
    { rewind: 'anchor', compact: false }, { rewind: 'terminal', compact: false },
    { rewind: 'anchor', compact: true }, { rewind: 'terminal', compact: true },
  ])('redelivers retained output hidden by a genuine $rewind rewind (compact=$compact), but not earlier visible output', async ({ rewind, compact }) => {
    const user = (uuid: string, parentUuid: string | null) => ({ type: 'user', uuid, parentUuid, message: { content: `Sample ${uuid}` } });
    const assistant = (uuid: string, parentUuid: string) => ({ type: 'assistant', uuid, parentUuid, message: { id: `response-${uuid}`, content: [{ type: 'text', text: `Answer ${uuid}` }] } });
    const local = (uuid: string, parentUuid: string) => ({ type: 'system', subtype: 'local_command', uuid, parentUuid, content: `<local-command-stdout>${uuid}</local-command-stdout>` });
    const encode = (records: unknown[]) => records.map((record) => JSON.stringify(record) + '\n').join('');
    const records = [user('u1', null), assistant('a1', 'u1'), local('earlier', 'a1'), user('u2', 'a1'), assistant('a2', 'u2'),
      ...(compact ? [{ ...user('compact', 'a2'), message: { content: '/compact' } }] : []),
      local('out', compact ? 'compact' : 'a2'), user('next', 'a2')];
    const events: SessionEvent[] = [];
    const reader = new MemoryFileReader(encode(records));
    const follower = new ChainFollower(reader, 'fx8-local-rewind' as SessionId, null,
      (event) => { if (event.t === 'events') events.push(...event.events); }, { holders: () => 1 });
    await follower.start();
    reader.append(encode([rewind === 'anchor' ? { type: 'last-prompt', rewound: true, leafUuid: 'a1', lastPrompt: 'Second sample' } : user('replacement', 'a1')]));
    await follower.poke();
    expect(events.filter((event) => event.kind === 'boundary.rewind')).toMatchObject([{ targetMessageUuid: 'u2' }]);
    expect(ofKind(rowsOf(stateOf(events)), 'local_command').map((row) => row.text)).toEqual(['earlier']);
    reader.append(encode([local('rejoin', 'out')]));
    await follower.poke();
    expect(follower.snapshot().chain).toEqual(['u1', 'a1', 'u2', 'a2', ...(compact ? ['compact'] : []), 'out', 'rejoin']);
    const rows = rowsOf(stateOf(events));
    expect(ofKind(rows, 'local_command').map((row) => row.text)).toEqual(['earlier', 'out', 'rejoin']);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(events.filter((event) => event.kind === 'user.message' && event.messageUuid === 'out').map((event) => event.id)).toEqual(['out', 'out@2']);
    // An earlier turn stayed visible through the rewind; rejoining its local output must not duplicate it.
    reader.append(encode([local('earlier-rejoin', 'earlier')]));
    await follower.poke();
    expect(events.filter((event) => event.kind === 'user.message' && event.messageUuid === 'earlier').map((event) => event.id)).toEqual(['earlier']);
    const after = rowsOf(stateOf(events));
    expect(ofKind(after, 'local_command').filter((row) => row.text === 'earlier')).toHaveLength(1);
    expect(new Set(after.map((row) => row.id)).size).toBe(after.length);
    follower.stop();
  });

  it('delivers a rejoining local record first discovered off-chain during rewrite', async () => {
    const prefix = [
      { type: 'user', uuid: 'u', parentUuid: null, message: { content: 'Sample request' } },
      { type: 'assistant', uuid: 'a', parentUuid: 'u', message: { id: 'response', content: [{ type: 'text', text: 'Sample answer' }] } },
    ];
    const local = (uuid: string, parentUuid: string) => ({ type: 'system', subtype: 'local_command', uuid, parentUuid, content: `<local-command-stdout>${uuid}</local-command-stdout>` });
    const encode = (records: unknown[]) => records.map((record) => JSON.stringify(record) + '\n').join('');
    const reader = new MemoryFileReader(encode(prefix));
    const events: SessionEvent[] = [];
    const follower = new ChainFollower(reader, 'fx8-rewrite-local' as SessionId, null,
      (event) => { if (event.t === 'events') events.push(...event.events); }, { holders: () => 2 });
    await follower.start();
    reader.replace(encode([...prefix, local('out1', 'a'), local('out2', 'a')]));
    await follower.poke();
    reader.append(encode([local('out3', 'out1')]));
    await follower.poke();
    const rows = rowsOf(stateOf(events));
    expect(ofKind(rows, 'local_command').map((row) => row.text)).toEqual(['out2', 'out1', 'out3']);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(events.filter((event) => event.kind === 'user.message' && event.messageUuid === 'out1').map((event) => event.id)).toEqual(['out1']);
    follower.stop();
  });

  it.each(['tail', 'cold', 'rewrite', 'refold'])('retains local output exactly once when silently swapped history rejoins (%s)', async (mode) => {
    const records: Record<string, unknown>[] = [
      { type: 'user', uuid: 'u', parentUuid: null, message: { content: 'Sample request' } },
      { type: 'assistant', uuid: 'a', parentUuid: 'u', message: { id: 'response', model: 'sample', content: [{ type: 'text', text: 'Sample answer' }] } },
      { type: 'system', subtype: 'local_command', uuid: 'out1', parentUuid: 'a', content: '<local-command-stdout>First output</local-command-stdout>' },
      { type: 'system', subtype: 'local_command', uuid: 'out2', parentUuid: 'a', content: '<local-command-stdout>Second output</local-command-stdout>' },
    ];
    const rejoin = { type: 'system', subtype: 'local_command', uuid: 'out3', parentUuid: 'out1', content: '<local-command-stdout>Third output</local-command-stdout>' };
    const encode = (items: Record<string, unknown>[]) => items.map((record) => JSON.stringify(record) + '\n').join('');
    const events: SessionEvent[] = [];
    let pinned = mode === 'refold';
    const reader = new MemoryFileReader(encode(mode === 'cold' ? [...records, rejoin] : records));
    const follower = new ChainFollower(reader, 'fx8-local-rejoin' as SessionId, null,
      (event) => { if (event.t === 'events') events.push(...event.events); },
      { holders: () => 2, pinned: () => pinned, isOwnRecord: (record) => record.uuid === 'a' });
    await follower.start();
    if (mode === 'rewrite') { reader.replace(encode(records)); await follower.poke(); }
    if (mode === 'refold') {
      records.push({ type: 'user', uuid: 'foreign', parentUuid: 'u', message: { content: 'Earlier branch' } });
      reader.append(encode(records.slice(-1)));
      await follower.poke();
      expect(events.filter((event) => event.kind === 'notice.posted')).toMatchObject([{ key: 'transcript_branch_held' }]);
      pinned = false;
      await follower.refold();
    }
    if (mode !== 'cold') { reader.append(encode([rejoin])); await follower.poke(); }
    const state = stateOf(events);
    for (const rows of [rowsOf(state), rowsOf(withAllExpanded(state))]) {
      expect(ofKind(rows, 'local_command').map((row) => row.text)).toEqual(['First output', 'Second output', 'Third output']);
      const ids = rows.map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(events.filter((event) => event.kind === 'user.message' && event.messageUuid === 'out1').map((event) => event.id)).toEqual(['out1']);
    if (mode === 'refold') {
      // Conversational records genuinely retracted during the refold still need re-delivery.
      expect(events.filter((event) => event.kind === 'assistant.block.complete' && event.messageUuid === 'a').map((event) => event.id)).toEqual(['a', 'a@2']);
    }
    const idsBeforeRewrite = rowsOf(state).map((row) => row.id);
    reader.replace(encode([...records, rejoin]));
    await follower.poke();
    expect(rowsOf(stateOf(events)).map((row) => row.id)).toEqual(idsBeforeRewrite);
    follower.stop();
  });

  it('a local-only swap leaves command output visible as local history', async () => {
    const rows = rowsOf(await fx8('local-cuts'));
    expect(ofKind(rows, 'boundary')).toEqual([]);
    expect(ofKind(rows, 'local_command').map((row) => row.text)).toEqual(['Ready', 'Ready again']);
  });
});
