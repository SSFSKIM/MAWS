// The live suite's own bookkeeping (C3 execution document, M6): cost per journal, the frame inventory, the fixture
// export, and the run's cost ledger with its cap. Runs in `pnpm test` (it spawns nothing).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { assertConfigHomeSafe, exportFixture, frameInventory, journalCost, LiveLedger, liveSpec, ownerConfigHome, persistingControlOf, PROVENANCE, turnAttribution } from './live';
import { LiveHost } from './live-host';

const REPO_ROOT = resolve(__dirname, '../../..');

const row = (seq: number, direction: JournalRow['direction'], frame: unknown): JournalRow => ({ seq, direction, at: '2026-09-28T10:00:00.000Z', frame });
const result = (costUsd: number, numTurns: number, parent: string | null = null) => ({ type: 'result', subtype: 'success', total_cost_usd: costUsd, num_turns: numTurns, parent_tool_use_id: parent });

describe('live suite bookkeeping', () => {
  it('a journal costs its last main-lane total_cost_usd (the engine reports it cumulatively) over its non-receipt turns', () => {
    const rows = [
      row(1, 'meta', { event: 'spawn' }),
      row(2, 'in', result(0.02, 1)),
      row(3, 'in', result(0.02, 0)), // a `!` echo receipt: no turn, no new cost
      row(4, 'in', result(0.9, 2, 'toolu_child')), // a child lane's figure is not the process's
      row(5, 'in', result(0.05, 3)),
      row(6, 'out', result(7, 1)), // never an out row
    ];
    expect(journalCost(rows)).toEqual({ costUsd: 0.05, turns: 2 });
    expect(journalCost([row(1, 'meta', { event: 'spawn' })])).toEqual({ costUsd: 0, turns: 0 });
  });

  it('a figure that drops (the fresh session `/clear` starts) opens a new cumulative segment: the journal costs the sum of the peaks', () => {
    // the live 3.20 journal: 0.2049 before /clear, the /clear receipt at 0, then 0.0372 in the cleared session
    const rows = [row(1, 'in', result(0.1452, 7)), row(2, 'in', result(0.2049, 5)), row(3, 'in', result(0, 0)), row(4, 'in', result(0.0372, 2))];
    expect(journalCost(rows).costUsd).toBeCloseTo(0.2421);
    expect(journalCost(rows).turns).toBe(3);
  });

  it('the frame inventory lists every inbound system subtype and frame type with the seqs that carried it', () => {
    const rows = [
      row(1, 'in', { type: 'system', subtype: 'init' }),
      row(2, 'in', { type: 'stream_event' }),
      row(3, 'in', { type: 'system', subtype: 'status' }),
      row(4, 'in', { type: 'system', subtype: 'init' }),
      row(5, 'out', { type: 'system', subtype: 'nope' }),
      row(6, 'in', { type: 'rate_limit_event' }),
    ];
    const inventory = frameInventory(rows);
    expect(Object.fromEntries(inventory.systemSubtypes)).toEqual({ init: [1, 4], status: [3] });
    expect(Object.fromEntries(inventory.types)).toEqual({ system: [1, 3, 4], stream_event: [2], rate_limit_event: [6] });
  });

  it('a fixture export puts the provenance row first (seq 0, so the live seqs stay the fixture seqs) and redacts the probe way', () => {
    const journal = [
      row(1, 'meta', { event: 'spawn', envKeys: ['ANTHROPIC_AUTH_TOKEN'], args: ['--settings', '{"dialogExpiry":"never"}'] }),
      row(2, 'in', { type: 'control_response', response: { account: { email: 'owner@example.com' }, key: 'sk-ant-api03-abcdef_123', token: 'hunter2-secret-value' } }),
    ]
      .map((r) => JSON.stringify(r))
      .join('\n');
    const out = exportFixture(`${journal}\n`, { MY_TOKEN: 'hunter2-secret-value' }, '2026-09-28T11:00:00.000Z');
    const lines = out.split('\n').filter((l) => l.length > 0);
    const rows = lines.map((l) => parseJournalRow(JSON.parse(l)));
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(rows[0]).toEqual({ seq: 0, direction: 'meta', at: '2026-09-28T11:00:00.000Z', frame: { event: 'provenance', ...PROVENANCE } });
    expect(PROVENANCE).toMatchObject({ charter: 'docs/charter.md', child: 'C3', pin: '87f8c7881119ea670901205dae35917d3751459c' });
    expect(rows[1]).toEqual(JSON.parse(journal.split('\n')[0]!));
    expect(out).not.toContain('owner@example.com');
    expect(out).not.toContain('sk-ant-api03');
    expect(out).not.toContain('hunter2-secret-value');
    expect(out).toContain('owner@redacted.invalid');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('the live host drives the X2 surface through the host runtime: launch to ready, a send, its turn, a read, shutdown', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'maws-live-host-'));
    const host = new LiveHost({ userData, replayEnabled: true, cwd: REPO_ROOT });
    try {
      const spec = liveSpec('/tmp/maws-live-host', { appSessionId: 'live-host-replay' as never, replay: 'spikes/protocol-probe/fixtures/reads.jsonl', maxBudgetUsd: null });
      const { status } = await host.launch(spec);
      expect(status).toMatchObject({ process: 'ready', gateway: { verified: 'routed' } });
      expect(await host.call('session.send', { appSessionId: spec.appSessionId, content: 'Reply with exactly OK' })).toMatchObject({ disposition: 'sent' });
      const ended = await host.waitFor(() => host.events(spec.appSessionId).find((e) => e.kind === 'turn.ended'), 'turn.ended', 5_000);
      expect(ended).toMatchObject({ resultText: 'OK', terminalReason: 'completed' });
      const usage = await host.callRaw('session.getUsage', { appSessionId: spec.appSessionId });
      expect(usage).toMatchObject({ ok: true, value: { subscription_type: null, rate_limits_available: expect.any(Boolean) } });
      // an input the X2 schema refuses never reaches a handler: the runtime answers it
      expect(await host.callRaw('session.status', { appSessionId: 42 } as never)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      await host.shutdown();
      expect(host.status(spec.appSessionId)).toMatchObject({ process: 'exited', exit: { reason: 'quit' } });
    } finally {
      await host.shutdown().catch(() => {});
      rmSync(userData, { recursive: true, force: true, maxRetries: 10 });
    }
  });

  it('turn attribution: a human turn is misattributed when the result closing it does not name the prompt that opened it', () => {
    const started = (seq: number, origin: string, uuid: string | null) => ({ kind: 'turn.started', seq, parentToolUseId: null, origin, userMessageUuid: uuid });
    const ended = (seq: number, uuids: string[], receipt = false) => ({ kind: 'turn.ended', seq, parentToolUseId: null, userMessageUuids: uuids, isEchoReceipt: receipt, origin: 'human' });
    // the live 3.7 shape: the steer's result (72) closes the turn the queued prompt opened at 53
    const events = [started(16, 'human', 'p1'), ended(48, ['p1']), started(53, 'human', 'after'), ended(72, ['steer']), started(78, 'engine', null), ended(92, ['after']), ended(95, [], true)];
    expect(turnAttribution(events as never)).toEqual(['turn opened at seq 53 by after closed at seq 72 by a result naming [steer]']);
    expect(turnAttribution([started(4, 'human', 'a'), ended(9, ['a']), started(10, 'engine', null), ended(12, [])] as never)).toEqual([]);
  });

  it("the config-home guard: a case under the owner's home may not declare a control the engine persists (coordinator's live-acceptance rule)", () => {
    expect(() => assertConfigHomeSafe({ configHome: null, controls: ['set_cwd:trust'] })).toThrow(/set_cwd:trust.*owner's config home/);
    expect(() => assertConfigHomeSafe({ configHome: '/tmp/maws-live-config-x', controls: ['set_cwd:trust'] })).not.toThrow();
    expect(() => assertConfigHomeSafe({ configHome: null, controls: [] })).not.toThrow(); // reads only
    for (const control of ['mcp_toggle', 'grant:local_settings', 'memory:user'] as const) expect(() => assertConfigHomeSafe({ configHome: null, controls: [control] })).toThrow();
    // the controls a call would issue, inferred from the X2 command and its input
    expect(persistingControlOf('session.setCwd', { appSessionId: 'a', path: '/x', trust: { accepted: true, directory: '/x' } })).toBe('set_cwd:trust');
    expect(persistingControlOf('session.setCwd', { appSessionId: 'a', path: '/x', trust: null })).toBeNull();
    expect(persistingControlOf('session.mcpToggle', { appSessionId: 'a', serverName: 's', enabled: false })).toBe('mcp_toggle');
    expect(persistingControlOf('session.answer', { appSessionId: 'a', requestId: 'r', answer: { kind: 'permission', decision: 'allow', scope: 'local_settings' } })).toBe('grant:local_settings');
    expect(persistingControlOf('session.answer', { appSessionId: 'a', requestId: 'r', answer: { kind: 'permission', decision: 'allow', scope: 'session' } })).toBeNull(); // 3.9's grant: destination session
    expect(persistingControlOf('session.memoryAppend', { appSessionId: 'a', text: 't', target: { kind: 'user', path: null } })).toBe('memory:user');
    expect(persistingControlOf('session.memoryAppend', { appSessionId: 'a', text: 't', target: { kind: 'project', path: null } })).toBeNull(); // the scratch repo's CLAUDE.md
    // a dialog-listed memory folder can live under the config home (M6 re-review): a path target there persists too
    const home = '/Users/x/.claude';
    const pathTarget = (path: string) => ({ appSessionId: 'a', text: 't', target: { kind: 'path', path } });
    expect(persistingControlOf('session.memoryAppend', pathTarget('/Users/x/.claude/projects/-tmp-s/memory/notes.md'), home)).toBe('memory:user');
    expect(persistingControlOf('session.memoryAppend', pathTarget('/Users/x/.claude/../.claude/CLAUDE.md'), home)).toBe('memory:user');
    expect(persistingControlOf('session.memoryAppend', pathTarget('/tmp/maws-live-scratch-a/notes.md'), home)).toBeNull();
    expect(persistingControlOf('session.memoryAppend', pathTarget('/Users/x/.claude-other/notes.md'), home)).toBeNull();
    expect(persistingControlOf('session.memoryAppend', pathTarget(join(ownerConfigHome(), 'memory', 'n.md')))).toBe('memory:user'); // the default: the owner's home
    expect(persistingControlOf('session.getSettings', { appSessionId: 'a' })).toBeNull();
  });

  it('the live host fails a case before any spawn when its config home is the owner\'s and it declares a persisting control, and refuses an undeclared one at the call', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'maws-live-guard-'));
    try {
      expect(() => new LiveHost({ userData, controls: ['set_cwd:trust'] })).toThrow(/owner's config home/);
      const host = new LiveHost({ userData, replayEnabled: true, cwd: REPO_ROOT });
      await expect(host.callRaw('session.setCwd', { appSessionId: 'nobody', path: '/x', trust: { accepted: true, directory: '/x' } })).rejects.toThrow(/set_cwd:trust.*not declared/);
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('the ledger sums the run, prints the cost line, and refuses to go on past the cap', () => {
    const ledger = new LiveLedger(1);
    ledger.add('3.1', '/j/a.jsonl', [row(1, 'in', result(0.4, 1)), row(2, 'in', result(0.5, 2))]);
    ledger.add('3.9', '/j/b.jsonl', [row(1, 'in', result(0.25, 1))]);
    expect(ledger.total).toBeCloseTo(0.75);
    expect(ledger.summary()).toBe('live cost: total_cost_usd sum = $0.75 across 3 turns');
    expect(() => ledger.assertUnderCap()).not.toThrow();
    ledger.add('3.10', '/j/c.jsonl', [row(1, 'in', result(0.3, 1))]);
    expect(() => ledger.assertUnderCap()).toThrow(/live cost cap \$1\.00 reached: \$1\.05/);
  });

  it('a resumed launch continues its session\'s cumulative figure, so a session costs its largest launch, not their sum', () => {
    const ledger = new LiveLedger(5);
    ledger.add('3.9', '/j/start.jsonl', [row(1, 'in', result(0.1262, 1))], 'session-a');
    ledger.add('3.9', '/j/resume.jsonl', [row(1, 'in', result(0.1536, 1))], 'session-a'); // the resumed process reports 0.1262 + 0.0274
    ledger.add('3.3', '/j/other.jsonl', [row(1, 'in', result(0.2, 3))], 'session-b');
    expect(ledger.total).toBeCloseTo(0.3536);
    expect(ledger.summary()).toBe('live cost: total_cost_usd sum = $0.35 across 3 turns');
  });
});
