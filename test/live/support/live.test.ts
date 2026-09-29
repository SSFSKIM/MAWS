// The live suite's own bookkeeping (C3 execution document, M6): cost per journal, the frame inventory, the fixture
// export, and the run's cost ledger with its cap. Runs in `pnpm test` (it spawns nothing).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { exportFixture, frameInventory, journalCost, LiveLedger, liveSpec, PROVENANCE } from './live';
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
    rmSync(userData, { recursive: true, force: true, maxRetries: 10 });
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
});
