// The live specs' engine cap (P2-F W-T, the tracker's P2-A live-harness row; e2e/support/live-budget.ts): with
// MAWS_LIVE_MAX_USD unset a spec launches the engine as before; with it set, through a forwarding script that adds
// `--max-budget-usd <what the run's cap leaves>` to every session process and passes everything else through.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { binaryDeclares, SYSTEM_PROMPT_SNAPSHOT_FLAG } from '../../src/engine-host/binary-info';
import { cappedEngine, forwardingScript, liveMaxUsd, spentUnder } from '../../e2e/support/live-budget';

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
const argsOf = (bin: string, args: string[], cwd?: string) => execFileSync(bin, args, { encoding: 'utf8', cwd }).trim().split('\n');

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

// Directory names an installed engine's real path may carry, each of which broke the script's unquoted source.
const HOSTILE = ["owner's-tools", 'two\ntouch pwned #lines','a $(touch pwned) `touch pwned` b', 'semi;colon & "dq"', "end'\n# x\ntouch pwned; exec false '"];

describe('forwardingScript', () => {
  it('stays valid shell, forwarding to the path itself, whatever the engine path and budget file hold', () => {
    for (const name of HOSTILE) {
      const root = scratch();
      const dir = join(root, name);
      mkdirSync(dir);
      const real = fakeEngine(dir, { declares: false });
      const budgetFile = join(dir, 'budget');
      writeFileSync(budgetFile, '0.1000');
      const script = join(root, 'claude-forward');
      writeFileSync(script, forwardingScript({ label: 'test', real, budgetFile, declares: false, cap: 0.2 }), { mode: 0o755 });
      expect(() => execFileSync('/bin/sh', ['-n', script], { stdio: 'pipe' }), JSON.stringify(name)).not.toThrow();
      expect(argsOf(script, ['--input-format', 'stream-json'], root), JSON.stringify(name)).toEqual(['--max-budget-usd', '0.1000', '--input-format', 'stream-json']);
      expect(argsOf(script, ['--version'], root), JSON.stringify(name)).toEqual(['--version']);
      expect(readdirSync(root).sort(), JSON.stringify(name)).toEqual(['claude-forward', name].sort()); // nothing the path spelled ran
    }
  });

  it('lets cappedEngine forward to an engine under a quoted path rather than refusing it', async () => {
    const root = scratch();
    const dir = join(root, HOSTILE[0]!);
    mkdirSync(dir);
    const engine = await cappedEngine({ root, real: fakeEngine(dir, { declares: false }), cap: 0.2 });
    expect(argsOf(engine.bin, ['--input-format', 'stream-json'])).toEqual(['--max-budget-usd', '0.2000', '--input-format', 'stream-json']);
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

  // One launch's journal as the host writes it: the spawn row (resuming `resume` or fresh), a main result per cumulative
  // figure, then the exit row (clean unless given; none for a launch whose exit was never journaled; at `exitMinute`
  // when given, else just after its other rows), its rows split across the base file and the rotations
  // `<id>.<n>.jsonl` at `rotate` (the indexes rotations start at).
  interface Launch { id: string; minute: number; resume?: string; costs: number[]; exit?: { code: number | null; signal: string | null } | null; exitMinute?: number; rotate?: { n: number; at: number }[] }
  function writeSession(userData: string, appId: string, launches: Launch[]): void {
    const dir = join(userData, 'engine-host', 'journal', appId);
    mkdirSync(dir, { recursive: true });
    for (const { id, minute, resume, costs, exit = { code: 0, signal: null }, exitMinute, rotate = [] } of launches) {
      const at = (m: number, k: number) => new Date(Date.UTC(2026, 9, 21, 10, m, k)).toISOString();
      const frames = [
        { direction: 'meta', frame: { event: 'spawn', launchId: id, args: ['-p', '--input-format', 'stream-json', ...(resume ? ['--resume', resume] : [])] } },
        ...costs.map((cost) => ({ direction: 'in', frame: { type: 'result', subtype: 'success', parent_tool_use_id: null, total_cost_usd: cost, num_turns: 1 } })),
        ...(exit ? [{ direction: 'meta', frame: { event: 'exit', ...exit, reason: exit.signal ? 'crash' : 'stop' } }] : []),
      ].map((row, i) => JSON.stringify({ seq: i + 1, at: (row.frame as { event?: string }).event === 'exit' && exitMinute !== undefined ? at(exitMinute, 0) : at(minute, i), ...row }));
      const cuts = [0, ...rotate.map((r) => r.at), frames.length];
      const names = [`${id}.jsonl`, ...rotate.map((r) => `${id}.${r.n}.jsonl`)];
      names.forEach((name, k) => writeFileSync(join(dir, name), `${frames.slice(cuts[k], cuts[k + 1]).join('\n')}\n`));
    }
  }

  it('counts a resumed session’s cumulative spend once, its launches read in launch order rather than by name', () => {
    const userData = scratch();
    // the admitted p2-to-human-new/-resume pair: US$0.0017, then US$0.0042 cumulative in the resume (once summed to 0.0059)
    writeSession(userData, 'app-1', [
      { id: 'zz000001', minute: 0, costs: [0.0017] },
      { id: 'aa000002', minute: 5, resume: 'engine-1', costs: [0.0042] },
    ]);
    expect(spentUnder(userData)).toBeCloseTo(0.0042, 10);
  });

  it('counts a rotated launch once, its rotations in index order after its base file', () => {
    const userData = scratch();
    writeSession(userData, 'app-1', [{ id: 'L1', minute: 0, costs: [0.01, 0.02, 0.03, 0.04], rotate: [{ n: 2, at: 3 }, { n: 10, at: 4 }] }]);
    expect(spentUnder(userData)).toBeCloseTo(0.04, 10);
  });

  it('still opens a segment where the figure drops (/clear), within a launch and across a resume', () => {
    const userData = scratch();
    writeSession(userData, 'app-1', [
      { id: 'L1', minute: 0, costs: [0.01, 0.02, 0.005, 0.007] }, // `/clear` after US$0.02: the fresh session starts at 0
      { id: 'L2', minute: 5, resume: 'engine-cleared', costs: [0.009] }, // resumes the cleared session at its US$0.007
    ]);
    expect(spentUnder(userData)).toBeCloseTo(0.02 + 0.009, 10);
  });

  it('counts each launch whole where the restored figure is unknown: a fresh launch, or one after an exit not seen clean', () => {
    const pair = (first: Partial<Launch>, second: Partial<Launch>) => {
      const userData = scratch();
      writeSession(userData, 'app-1', [{ id: 'L1', minute: 0, costs: [0.0017], ...first }, { id: 'L2', minute: 5, resume: 'engine-1', costs: [0.0042], ...second }]);
      return spentUnder(userData);
    };
    expect(pair({ exit: { code: null, signal: 'SIGKILL' } }, {})).toBeCloseTo(0.0059, 10); // no cost-state written at a kill
    expect(pair({ exit: null }, {})).toBeCloseTo(0.0059, 10); // the exit never journaled (the host gone with it)
    expect(pair({ exit: { code: 1, signal: null } }, {})).toBeCloseTo(0.0059, 10);
    expect(pair({}, { resume: undefined, costs: [0.003] })).toBeCloseTo(0.0047, 10); // fresh: its figure starts at 0
    // two host lifetimes over one profile: the resume spawned while the launch before still ran (the engine allows a
    // concurrent resume, pass2/resume-live-second.jsonl), so it restored nothing of that launch's later spend
    expect(pair({ costs: [0.02], exitMinute: 9 }, { costs: [0.03] })).toBeCloseTo(0.05, 10);
    expect(pair({ costs: [0.02], exitMinute: 4 }, { costs: [0.03] })).toBeCloseTo(0.03, 10); // exited before it: continued
    // the overlap beyond the adjacent pair: B ran inside A's lifetime and exited first, so the cost-state on disk when C
    // resumed was A's (US$0.02, C reaching US$0.04): US$0.07 spent, and C must not continue B, the launch before it
    const overlapped = scratch();
    writeSession(overlapped, 'app-1', [
      { id: 'A', minute: 0, costs: [0.02], exitMinute: 9 },
      { id: 'B', minute: 5, resume: 'engine-1', costs: [0.03], exitMinute: 6 },
      { id: 'C', minute: 10, resume: 'engine-1', costs: [0.04] },
    ]);
    expect(spentUnder(overlapped)).toBeCloseTo(0.02 + 0.03 + 0.04, 10);
    // the launch just before decides: an earlier launch's clean exit does not vouch for a later one's
    const userData = scratch();
    writeSession(userData, 'app-1', [
      { id: 'L1', minute: 0, costs: [0.0017] },
      { id: 'L2', minute: 5, resume: 'engine-1', costs: [0.0042], exit: null },
      { id: 'L3', minute: 9, resume: 'engine-1', costs: [0.005] }, // restored L1's stale US$0.0017, spent its own US$0.0033
    ]);
    expect(spentUnder(userData)).toBeCloseTo(0.0042 + 0.005, 10);
  });

  it('adds the sessions of a profile', () => {
    const userData = scratch();
    writeSession(userData, 'app-1', [{ id: 'L1', minute: 0, costs: [0.0017] }, { id: 'L2', minute: 5, resume: 'engine-1', costs: [0.0042] }]);
    writeSession(userData, 'app-2', [{ id: 'L3', minute: 1, costs: [0.001, 0.002], rotate: [{ n: 1, at: 2 }] }]);
    expect(spentUnder(userData)).toBeCloseTo(0.0062, 10);
  });
});
