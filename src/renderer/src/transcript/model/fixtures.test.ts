// The M2 pins over the synthetic journals, the event fixtures and the seeded transcript (C6 execution document,
// M2 "Proves"). The probe-journal pins live beside the replay stub.
import type { SessionEvent } from '@shared/graph/events';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEventFixture, loadSyntheticJournal } from '../../../../../test/support/fixtures';
import { synthesise } from '../../../../../test/support/synth-transcript';
import { journalToEvents } from '../dev/replay-stub';
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

  it('transcript/idle-drop: a prompt dropped before its init closes on the cancelled turn.ended derived from its lifecycle row', () => {
    const events = journal('idle-drop');
    const ended = events.find((e) => e.kind === 'turn.ended') as Extract<SessionEvent, { kind: 'turn.ended' }>;
    const lifecycle = loadSyntheticJournal('idle-drop').find((row) => (row.frame as { type?: string; state?: string }).type === 'command_lifecycle' && (row.frame as { state?: string }).state === 'cancelled')!;
    expect(ended).toMatchObject({
      seq: lifecycle.seq, at: lifecycle.at, result: 'cancelled', isError: false, terminalReason: 'cancelled', resultText: null, durationMs: 0, numTurns: 0, costUsd: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null }, permissionDenials: [], errors: [], origin: 'human', resultIndex: null, isEchoReceipt: false,
    });
    expect(ended.userMessageUuids).toHaveLength(1);
    expect(events.some((e) => e.kind === 'command.lifecycle' && e.state === 'cancelled')).toBe(false);
    const state = stateOf(events);
    expect(state.order).toHaveLength(1);
    expect(state.turns.get(state.order[0])!.state).toBe('closed');
    const rows = rowsOf(withAllExpanded(state));
    expect(rows.map((r) => r.kind)).toEqual(['time', 'user', 'error']); // the exit row follows
    expect(ofKind(rows, 'user')[0]).toMatchObject({ dropped: true, steer: false });
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

  it('events/disk-null-origin (the C4-backfill pin, over a synthetic fixture until C4 lands): human turns only, each with a user row, the Agent call as a subagent row', () => {
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
    expect(cellsOf(rows)[0]).toMatchObject({ status: 'running', classification: { humanDecision: false } });
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
