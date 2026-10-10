// The live specs' engine cap (P2-F W-T, the tracker's P2-A live-harness row; e2e/support/live-budget.ts): with
// MAWS_LIVE_MAX_USD unset a spec launches the engine as before; with it set, through a forwarding script that adds
// `--max-budget-usd <what the run's cap leaves>` to every session process and passes everything else through.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { binaryDeclares, SYSTEM_PROMPT_SNAPSHOT_FLAG } from '../../src/engine-host/binary-info';
import { cappedEngine, liveMaxUsd, spentUnder } from '../../e2e/support/live-budget';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function scratch(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-live-budget-')));
  roots.push(root);
  return root;
}
// A stand-in for the installed engine: prints the arguments it was given, one per line.
function fakeEngine(root: string, { declares }: { declares: boolean }): string {
  const path = join(root, 'claude-real');
  writeFileSync(path, `#!/bin/sh\n# ${declares ? SYSTEM_PROMPT_SNAPSHOT_FLAG : 'no flag table here'}\nfor a in "$@"; do echo "$a"; done\n`, { mode: 0o755 });
  return path;
}
const argsOf = (bin: string, args: string[]) => execFileSync(bin, args, { encoding: 'utf8' }).trim().split('\n');

describe('liveMaxUsd', () => {
  it('reads no cap when the variable is unset, and a cap above 0 and at most US$1 when set', () => {
    expect(liveMaxUsd({})).toBeNull();
    expect(liveMaxUsd({ MAWS_LIVE_MAX_USD: '0.20' })).toBe(0.2);
    expect(liveMaxUsd({ MAWS_LIVE_MAX_USD: '1' })).toBe(1);
  });
  it('refuses a value it cannot cap a run with, rather than running uncapped', () => {
    for (const value of ['', '0', '-0.1', '1.5', 'abc']) expect(() => liveMaxUsd({ MAWS_LIVE_MAX_USD: value })).toThrow(/MAWS_LIVE_MAX_USD/);
  });
});

describe('cappedEngine', () => {
  it('without a cap, is the installed engine itself and writes nothing', async () => {
    const root = scratch();
    const real = fakeEngine(root, { declares: false });
    const engine = await cappedEngine({ root, real, cap: null });
    expect(engine.bin).toBe(real);
    expect(engine.budget(0)).toBeNull();
    expect(readdirSync(root)).toEqual(['claude-real']);
  });

  it('with a cap, adds --max-budget-usd with what the cap leaves to a session process and nothing to any other', async () => {
    const root = scratch();
    const real = fakeEngine(root, { declares: false });
    const engine = await cappedEngine({ root, real, cap: 0.2 });
    expect(engine.bin).not.toBe(real);
    expect(engine.bin.startsWith(`${root}/`)).toBe(true);
    expect(statSync(engine.bin).mode & 0o111).not.toBe(0);
    expect(engine.budget(0)).toBeCloseTo(0.2);
    expect(argsOf(engine.bin, ['-p', '--input-format', 'stream-json', '--model', 'haiku'])).toEqual(['--max-budget-usd', '0.2000', '-p', '--input-format', 'stream-json', '--model', 'haiku']);
    expect(argsOf(engine.bin, ['--version'])).toEqual(['--version']);
    expect(argsOf(engine.bin, ['plugin', 'list', '--json'])).toEqual(['plugin', 'list', '--json']);
    expect(engine.budget(0.12)).toBeCloseTo(0.08);
    expect(argsOf(engine.bin, ['--input-format', 'stream-json'])).toEqual(['--max-budget-usd', '0.0800', '--input-format', 'stream-json']);
  });

  it('refuses a launch when less than US$0.05 of the cap is left', async () => {
    const root = scratch();
    const engine = await cappedEngine({ root, real: fakeEngine(root, { declares: false }), cap: 0.2 });
    expect(() => engine.budget(0.16)).toThrow(/not run \(budget\): US\$0\.0400 left of US\$0\.2/);
  });

  it('declares the system-prompt snapshot flag exactly when the installed engine does, so the app reads the engine as it is', async () => {
    for (const declares of [true, false]) {
      const root = scratch();
      const real = fakeEngine(root, { declares });
      const engine = await cappedEngine({ root, real, cap: 0.2 });
      expect(await binaryDeclares(engine.bin, SYSTEM_PROMPT_SNAPSHOT_FLAG)).toBe(declares);
    }
  });
});

describe('spentUnder', () => {
  it('sums every journal in a profile by its sessions’ receipts, and reads a profile with no journal as nothing spent', () => {
    const userData = scratch();
    expect(spentUnder(userData)).toBe(0);
    const row = (seq: number, cost: number) => JSON.stringify({ seq, direction: 'in', at: '2026-10-10T00:00:00.000Z', frame: { type: 'result', subtype: 'success', parent_tool_use_id: null, total_cost_usd: cost, num_turns: 1 } });
    for (const [id, costs] of [['a', [0.01, 0.03]], ['b', [0.02]]] as const) {
      const dir = join(userData, 'engine-host', 'journal', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, '0001.jsonl'), `${costs.map((cost, i) => row(i + 1, cost)).join('\n')}\n`);
    }
    expect(spentUnder(userData)).toBeCloseTo(0.05);
  });
});
