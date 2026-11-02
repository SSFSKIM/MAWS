// The live bench's runner (test/support/remote-bench.ts; P5 O7 M7) against a fake command runner that plays both bench
// machines' transports: the mini's plain non-TTY ssh (mini-ops starts its scratch daemon) and the VM's `devcloud vm ssh`
// (the runner packs and starts it). Whatever path a run takes, the enrollment code never appears in an argv, in an
// environment, or in anything said; it reaches the enroll alone, by its file's descriptor; the file is removed after;
// every resource is ended on a failure mid-way; no command is a sminos call, or names SMINOS_RL10, or names
// MAWS_USER_DATA outside the scratch daemon's own start; every path a command names is the scratch profile's but the
// runtime's; the profile is removed only once no bench process is left; and the mini's quiet window refuses every call.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { archiveProblems, BenchRun, buildHeadBundle, machineProblems, meetsQuiet, processRunner, productionProblem, quote, stubFixtures, transportArgv, type BenchMachine, type CommandRunner, type HeadBundle, type RunResult, type Started } from './remote-bench';

const CODE = 'smns-enroll-v1.SECRET-0123456789abcdefghij';
const COMMIT = 'a'.repeat(40);
const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function codeFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bench-code-'));
  scratch.push(dir);
  const file = join(dir, 'code');
  writeFileSync(file, `${CODE}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  writeFileSync(join(dir, 'agent.cjs'), '// the bundle'); // the agent's bundle, beside it (fullRun's prepare)
  return file;
}

const MINI = (file: string): BenchMachine => ({ name: 'mini-bench', transport: { kind: 'ssh', host: 'mini' }, stage: 'mini-ops', codeFile: file, profile: '/Users/kimmi/.local/share/maws-bench/mini-bench', label: 'dev.maws.bench.mini', port: 47901, head: '/Users/kimmi/.local/share/maws-bench/mini-bench/head', commit: COMMIT, node: '/Applications/MAWS.app/Contents/MacOS/MAWS' });
const VM = (file: string): BenchMachine => ({ name: 'vm-bench', transport: { kind: 'devcloud', vm: 'o7-accept' }, stage: 'runner', codeFile: file, profile: '/home/dev/maws-bench/vm-bench', label: 'dev.maws.bench.vm', port: 47902, head: '/home/dev/maws-bench/vm-bench/head', commit: COMMIT, node: '/usr/bin/node' });
const ENGINE_VERSION = '2.1.283';
const BUNDLE: HeadBundle = { tar: '/tmp/bench-local/head.tar', tarBytes: 40 * 1024 * 1024, unpackedBytes: 90 * 1024 * 1024, electron: '44.4.5', commit: COMMIT };
const DF = (availableKb: number) => `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s5 970000000 400000000 ${availableKb} 42% /System/Volumes/Data\n`;
const at = (iso: string) => Date.parse(iso);

type Call = { argv: readonly string[]; stdinFile?: string; stdin?: string };
type Script = (command: string, call: Call) => RunResult | undefined;

/** A command runner that records every call (and reads a stdin file as a child would, to check what crossed), answering by `script`. */
function fakeRunner(script: Script) {
  const calls: Call[] = [];
  const started: { argv: readonly string[]; written: string[]; ended: boolean; killed: boolean }[] = [];
  const runner: CommandRunner = {
    async run(argv, options = {}) {
      const call: Call = { argv, ...(options.stdinFile !== undefined && { stdinFile: options.stdinFile, stdin: options.stdinFile === BUNDLE.tar ? '(the head bundle)' : readFileSync(options.stdinFile, 'utf8') }) };
      calls.push(call);
      return script(argv.at(-1)!, call) ?? { code: 0, stdout: '', stderr: '' };
    },
    start(argv) {
      const record = { argv, written: [] as string[], ended: false, killed: false };
      started.push(record);
      let exit!: (code: number | null) => void;
      const exited = new Promise<number | null>((resolve) => (exit = resolve));
      const handle: Started = {
        onLine: () => undefined,
        write: (line) => void record.written.push(line),
        end: () => {
          record.ended = true;
          exit(0);
        },
        kill: () => void (record.killed = true),
        exited,
      };
      return handle;
    },
  };
  return { runner, calls, started };
}

/** The machine's answers: enroll exits `enrollExit`; `endpoint status` reads hub-confirmed until `listedAfter` reads. */
function machineScript(options: { enrollExit?: number; listedAfter?: number; already?: boolean } = {}): Script {
  let reads = 0;
  return (command) => {
    if (/ enroll /.test(command)) return { code: options.enrollExit ?? 4, stdout: JSON.stringify({ enrollment: 'hub-confirmed', name: 'x', org: 'org-1', ref: 'r' }), stderr: '' };
    if (/ endpoint status /.test(command)) {
      reads += 1;
      const listed = options.already === true || (options.listedAfter !== undefined && reads > options.listedAfter);
      return { code: 0, stdout: JSON.stringify({ enrollment: listed ? 'org-listed' : options.already === false ? 'none' : 'hub-confirmed', name: command.includes('vm-bench') ? 'vm-bench' : 'mini-bench', org: 'org-1' }), stderr: '' };
    }
    if (/ keys /.test(command)) return { code: 0, stdout: JSON.stringify({ key: { keyId: 'KEYID-for-compare', heldKeys: 1 } }), stderr: '' };
    if (/mawsd:pack/.test(command)) return { code: 0, stdout: '/home/dev/maws-bench/vm-bench/bench/pack/0.0.0-aaaa-1234\n', stderr: '' };
    if (/ -p process\.versions\.electron$/.test(command)) return { code: 0, stdout: '44.4.5\n', stderr: '' };
    if (/^df -Pk /.test(command)) return { code: 0, stdout: DF(200 * 1024 * 1024), stderr: '' };
    return undefined;
  };
}

/** Every place a code could leak: argv words, stdin of any call but the enroll's, and every line said. */
function leaks(calls: Call[], started: { argv: readonly string[]; written: string[] }[], said: string[]): string[] {
  const out: string[] = [];
  for (const call of calls) {
    if (call.argv.some((word) => word.includes('SECRET'))) out.push(`argv: ${call.argv.join(' ')}`);
    if (call.stdin?.includes('SECRET') && !/ enroll /.test(call.argv.at(-1)!)) out.push(`stdin of: ${call.argv.at(-1)}`);
  }
  for (const s of started) if ([...s.argv, ...s.written].some((word) => word.includes('SECRET'))) out.push(`agent: ${s.argv.join(' ')}`);
  for (const line of said) if (line.includes('SECRET')) out.push(`said: ${line}`);
  return out;
}

async function fullRun(machine: BenchMachine, script: Script, startAt = 0, bundle: HeadBundle | null = BUNDLE) {
  const fake = fakeRunner(script);
  const said: string[] = [];
  let clock = startAt;
  const run = new BenchRun(machine, { runner: fake.runner, engineVersion: ENGINE_VERSION, say: (line) => void said.push(line), sleep: async (ms) => void (clock += ms), now: () => clock });
  let failure: unknown = null;
  try {
    await run.prepare(machine.codeFile.replace(/code$/, 'agent.cjs'));
    await run.stage(bundle ?? undefined);
    await run.enroll();
    run.serve(() => undefined);
    run.list(['member-1'], 'the bench session');
  } catch (error) {
    failure = error;
  } finally {
    await run.teardown();
  }
  return { ...fake, said, failure };
}

describe('the live bench’s runner (P5 O7 M7)', () => {
  it('reaches each machine by its own transport: the mini’s plain non-TTY ssh, the VM’s devcloud vm ssh', () => {
    expect(transportArgv({ kind: 'ssh', host: 'mini' }, 'echo hi')).toEqual(['ssh', '-T', '-o', 'BatchMode=yes', 'mini', 'echo hi']);
    expect(transportArgv({ kind: 'devcloud', vm: 'o7-accept' }, 'echo hi')).toEqual(['devcloud', 'vm', 'ssh', 'o7-accept', '--', 'echo hi']);
  });

  it('refuses the default profile, its label, the installed mawsd, a relative path, a head outside the profile, sockets that would leave it, and the runner staging the mini', () => {
    const file = '/tmp/code';
    expect(machineProblems(MINI(file))).toEqual([]);
    expect(machineProblems(VM(file))).toEqual([]);
    expect(machineProblems({ ...MINI(file), label: 'dev.maws.mawsd', profile: '/Users/kimmi/Library/Application Support/MAWS', node: '/Users/kimmi/.local/bin/mawsd', head: 'maws-m7', stage: 'runner', quietUtc: ['6:45', '07:00'] })).toEqual([
      'label dev.maws.mawsd is the default profile’s, or not a label',
      'head maws-m7 is not absolute',
      'profile /Users/kimmi/Library/Application Support/MAWS is a default profile',
      'node /Users/kimmi/.local/bin/mawsd is the installed mawsd',
      'the runner stages only a devcloud VM; the mini is mini-ops’',
      'head maws-m7 is not under the scratch profile, where every write stays',
      'profile /Users/kimmi/Library/Application Support/MAWS holds a quote, a space or a shell character',
      'quiet window 6:45–07:00 is not two UTC times HH:MM',
    ]);
    const long = `/Users/kimmi/${'p'.repeat(80)}`;
    expect(machineProblems({ ...MINI(file), profile: long, head: `${long}/head` })).toEqual([`profile ${long} is too long for its sockets, which would fall back out of it`]);
    expect(() => new BenchRun({ ...VM(file), profile: '/home/dev/.config/MAWS', head: '/home/dev/.config/MAWS/head' }, { runner: fakeRunner(() => undefined).runner, engineVersion: ENGINE_VERSION, say: () => undefined })).toThrow(/a default profile/);
  });

  for (const [label, machine] of [['the mini, over ssh', MINI], ['the VM, over devcloud vm ssh', VM]] as const) {
    it(`${label}: the code goes to the enroll alone by its file, is never in an argv, an environment or a line said, and its file is removed`, async () => {
      const file = codeFile();
      const m = machine(file);
        const { calls, started, said, failure } = await fullRun(m, machineScript({ listedAfter: 2 }));
      expect(failure).toBeNull();
      expect(leaks(calls, started, said)).toEqual([]);
      const enrolls = calls.filter((c) => / enroll /.test(c.argv.at(-1)!));
      expect(enrolls).toHaveLength(1);
      expect(enrolls[0]!.stdinFile).toBe(file);
      expect(enrolls[0]!.stdin).toBe(`${CODE}\n`); // what crossed was the file, as the child reads it
      expect(enrolls[0]!.argv.slice(0, m.transport.kind === 'ssh' ? 5 : 5)).toEqual(m.transport.kind === 'ssh' ? ['ssh', '-T', '-o', 'BatchMode=yes', 'mini'] : ['devcloud', 'vm', 'ssh', 'o7-accept', '--']);
      expect(enrolls[0]!.argv.at(-1)).toContain(`enroll --profile ${quote(m.profile)} --label ${m.label} --name ${m.name} --wait 900 --json`);
      expect(calls.filter((c) => c.stdinFile === file)).toHaveLength(1);
      expect(existsSync(file)).toBe(false);
      expect(said).toContain(`[bench] ${m.name}: the machine's key id, to compare: KEYID-for-compare`);
      expect(said).toContain(`[bench] ${m.name}: listed in org-1`);
    });

    it(`${label}: runs no sminos, never names SMINOS_RL10, and names MAWS_USER_DATA only in the scratch daemon’s start`, async () => {
      const file = codeFile();
        const { calls, started, said } = await fullRun(machine(file), machineScript({ listedAfter: 0 }));
      const commands = [...calls.map((c) => c.argv), ...started.map((s) => s.argv)].map((argv) => argv.join(' '));
      expect(commands.filter((c) => /(^|[\s;&|])sminos(\s|$)/.test(c))).toEqual([]);
      expect([...commands, ...said].filter((c) => c.includes('SMINOS_RL10'))).toEqual([]);
      const named = [...commands, ...said].filter((c) => c.includes('MAWS_USER_DATA'));
      for (const line of named) expect(line).toMatch(/nohup .* run --private --dir /);
      expect(commands.filter((c) => /mawsd(\.js)?"? install\b|dev\.maws\.mawsd|\.local\/bin\/mawsd/.test(c))).toEqual([]);
    });
  }

  it('the VM: fetches the commit, packs it and starts the pack’s mawsd under its own profile, label, port and the stub; stops it at teardown', async () => {
    const file = codeFile();
    const { calls } = await fullRun(VM(file), machineScript({ listedAfter: 0 }));
    const lines = calls.map((c) => c.argv.at(-1)!);
    const at = (pattern: RegExp) => lines.findIndex((line) => pattern.test(line));
    expect(at(/bench-agent\.cjs prepare/)).toBeLessThan(at(/nohup/)); // the wrapper and trust before the daemon reads them
    expect(lines[at(/git fetch/)]).toContain(`git checkout --quiet --detach ${COMMIT}`);
    expect(lines[at(/mawsd:pack/)]).toContain('--out /home/dev/maws-bench/vm-bench/bench/pack');
    const start = lines[at(/nohup/)]!;
    for (const part of ['MAWS_USER_DATA=/home/dev/maws-bench/vm-bench', 'MAWS_MAWSD_LABEL=dev.maws.bench.vm', 'CLAUDE_CONFIG_DIR=/home/dev/maws-bench/vm-bench/claude-config', 'MAWS_E2E=1', 'MAWS_E2E_ENGINE_BIN=/home/dev/maws-bench/vm-bench/bench/latency-engine', 'MAWS_ENDPOINT_DIRECT=1', 'MAWS_ENDPOINT_PORT=47902', 'run --private --dir /home/dev/maws-bench/vm-bench/mawsd']) expect(start).toContain(part);
    expect(lines.at(-1)).toMatch(/kill "\$pid"/);
    expect(lines.some((line) => /rm -rf/.test(line))).toBe(false); // the profile is kept until the bench is done
  });

  it('the mini: says mini-ops’ start and waits for it, never starts or stops a daemon itself', async () => {
    const file = codeFile();
    let statusReads = 0;
    const base = machineScript({ listedAfter: 0 });
    const { calls, said } = await fullRun(MINI(file), (command, call) => {
      if (/ status --profile/.test(command) && !/endpoint status/.test(command)) return { code: ++statusReads < 3 ? 3 : 0, stdout: '', stderr: '' };
      return base(command, call);
    });
    expect(statusReads).toBe(3);
    expect(calls.some((c) => /nohup|kill /.test(c.argv.at(-1)!))).toBe(false);
    expect(said.some((line) => line.includes('mini-ops starts the scratch mawsd'))).toBe(true);
    expect(said.some((line) => line.includes('mini-ops stops the scratch mawsd'))).toBe(true);
  });

  it('waits out exit 4 to the code’s TTL and fails, the file removed and every resource ended', async () => {
    const file = codeFile();
    const { failure, calls, said } = await fullRun(VM(file), machineScript({}));
    expect(String(failure)).toMatch(/not listed in the org within the code's 900 s/);
    expect(existsSync(file)).toBe(false);
    expect(calls.at(-1)!.argv.at(-1)).toMatch(/kill "\$pid"/);
    expect(said.at(-1)).toMatch(/torn down/);
  });

  it('a failed enroll: its output never said, the file removed, the daemon stopped', async () => {
    const file = codeFile();
    const { failure, calls, said, started } = await fullRun(VM(file), (command, call) => (/ enroll /.test(command) ? { code: 1, stdout: '', stderr: `refused: ${CODE}` } : machineScript({})(command, call)));
    expect(String(failure)).toMatch(/enroll failed \(exit 1\); its own output is not shown/);
    expect(String(failure)).not.toContain('SECRET');
    expect(leaks(calls, started, said)).toEqual([]);
    expect(existsSync(file)).toBe(false);
    expect(calls.at(-1)!.argv.at(-1)).toMatch(/kill "\$pid"/);
    expect(started).toHaveLength(0); // the agent's serve never started, so nothing of it to end
  });

  it('a rerun on a profile already listed under the name enrolls nothing, and removes the unused code file', async () => {
    const file = codeFile();
    const { calls, started } = await fullRun(VM(file), machineScript({ already: true }));
    expect(calls.some((c) => / enroll /.test(c.argv.at(-1)!))).toBe(false);
    expect(calls.some((c) => c.stdinFile === file)).toBe(false);
    expect(existsSync(file)).toBe(false);
    expect(started[0]!.written).toEqual([JSON.stringify({ list: { owners: ['member-1'], title: 'the bench session' } })]);
    expect(started[0]!.ended).toBe(true);
  });

  // Every absolute path a command names: after a start, a space, a quote, `=` or `(` (a pgrep pattern's `[/]…` is not one).
  const pathsOf = (command: string) => [...command.matchAll(/(?<=^|[\s'"=(])\/[^\s'"`;&|)]*/g)].map((match) => match[0].replace(/\/+$/, ''));
  for (const [label, machine, allowed] of [['the mini', MINI, []], ['the VM', VM, ['/dev/null']]] as const) {
    it(`${label}: every path a command names is under the scratch profile, but the runtime it runs, which nothing writes`, async () => {
      const file = codeFile();
        const m = machine(file);
      const { calls, started } = await fullRun(m, machineScript({ listedAfter: 0 }));
      const commands = [...calls.map((c) => c.argv.at(-1)!), ...started.map((s) => s.argv.at(-1)!)];
      const outside = commands.flatMap(pathsOf).filter((path) => path !== m.profile && !path.startsWith(`${m.profile}/`) && path !== m.node && !(allowed as readonly string[]).includes(path));
      expect(outside).toEqual([]);
      // the runtime only ever runs: never a redirection's target, a copy's, or a directory made
      for (const command of commands) expect(command).not.toMatch(new RegExp(`(>|cat >|mkdir -p|rm -rf|cp) *'?${m.node.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
      // each command's own home and temporary directory are the profile's
      for (const command of commands.filter((c) => /mawsd\.js"? |bench-agent\.cjs'? (prepare|serve)/.test(c))) expect(command).toContain(`HOME=${m.profile}/home TMPDIR=${m.profile}/tmp`);
    });
  }

  it('removes the profile, its head and any tarball with it, only once no bench process is left on the machine: refused, said and kept while one lives', async () => {
    for (const machine of [VM, MINI]) {
      let pids = '4242\n4243\n';
      const fake = fakeRunner((command) => (/pgrep -f -- /.test(command) ? { code: 0, stdout: pids, stderr: '' } : undefined));
      const said: string[] = [];
      const run = new BenchRun(machine(codeFile()), { runner: fake.runner, engineVersion: ENGINE_VERSION, say: (line) => void said.push(line), sleep: async () => undefined, now: () => 0 });
      expect(await run.removeProfile()).toBe(false);
      expect(said.at(-1)).toMatch(/refused to remove the scratch profile: 2 bench processes still run there \(pids 4242, 4243\)/);
      expect(fake.calls.some((c) => /rm -rf/.test(c.argv.at(-1)!))).toBe(false);
      const pgrep = fake.calls.find((c) => /pgrep/.test(c.argv.at(-1)!))!.argv.at(-1)!;
      expect(pgrep).toContain(`pgrep -f -- '[/]${machine === VM ? 'home/dev/maws-bench/vm-bench' : 'Users/kimmi/\\.local/share/maws-bench/mini-bench'}'`);
      pids = '';
      expect(await run.removeProfile()).toBe(true);
      // the profile with all the bench put in it (its head, a tarball left, the pack), and only after the check passed
      const lines = fake.calls.map((c) => c.argv.at(-1)!);
      expect(lines.at(-1)).toBe(`rm -rf ${machine === VM ? '/home/dev/maws-bench/vm-bench' : '/Users/kimmi/.local/share/maws-bench/mini-bench'}`);
      expect(lines.at(-2)).toMatch(/^pgrep -f -- /);
      expect(lines.filter((line) => /rm -rf/.test(line))).toHaveLength(1);
      expect(said.at(-1)).toMatch(/the scratch profile is removed, its head and every bench file in it$/);
    }
  });

  it('meets the quiet window when a call’s span overlaps it, whatever the day, and a window past midnight wraps', () => {
    const w = ['06:45', '07:00'] as const;
    expect(meetsQuiet(w, at('2026-11-03T06:50:00Z'), 0)).toBe(true);
    expect(meetsQuiet(w, at('2026-11-03T06:44:59Z'), 0)).toBe(false);
    expect(meetsQuiet(w, at('2026-11-03T06:30:00Z'), 16 * 60_000)).toBe(true); // a 16-minute call from 06:30 reaches 06:46
    expect(meetsQuiet(w, at('2026-11-03T07:00:00Z'), 0)).toBe(false);
    expect(meetsQuiet(w, at('2026-11-03T08:00:00Z'), 45 * 60_000)).toBe(false);
    expect(meetsQuiet(['23:50', '00:10'], at('2026-11-04T00:05:00Z'), 0)).toBe(true);
    expect(meetsQuiet(['23:50', '00:10'], at('2026-11-03T23:40:00Z'), 9 * 60_000)).toBe(false);
  });

  it('the mini: no call reaches it in its quiet window (06:45 to 07:00 UTC by default), nor an enroll or a serve that would run into it; the VM has none', async () => {
    const inWindow = await fullRun(MINI(codeFile()), machineScript({ listedAfter: 0 }), at('2026-11-03T06:50:00Z'));
    expect(String(inWindow.failure)).toMatch(/mini-bench: refused: nothing reaches it from 06:45 to 07:00 UTC/);
    expect(inWindow.calls).toEqual([]);
    expect(inWindow.started).toEqual([]);
    // 06:30: the copy, the prepare and the status go; the enroll, which may wait 16 minutes, is refused before it starts
    const file = codeFile();
    const before = await fullRun(MINI(file), machineScript({}), at('2026-11-03T06:30:00Z'));
    expect(String(before.failure)).toMatch(/refused: nothing reaches it from 06:45 to 07:00 UTC/);
    expect(before.calls.some((c) => / enroll /.test(c.argv.at(-1)!))).toBe(false);
    expect(existsSync(file)).toBe(true); // nothing consumed it
    const ownWindow = await fullRun({ ...MINI(codeFile()), quietUtc: ['08:00', '09:00'] }, machineScript({ listedAfter: 0 }), at('2026-11-03T08:10:00Z'));
    expect(String(ownWindow.failure)).toMatch(/from 08:00 to 09:00 UTC/);
    // a serve is refused when its span would reach the window: listed already at 06:10, the serve's 45 minutes would
    const late = await fullRun(MINI(codeFile()), machineScript({ already: true }), at('2026-11-03T06:10:00Z'));
    expect(String(late.failure)).toMatch(/refused: nothing reaches it from 06:45/);
    expect(late.started).toEqual([]);
    const vmFile = codeFile();
    expect((await fullRun(VM(vmFile), machineScript({ listedAfter: 0 }), at('2026-11-03T06:50:00Z'))).failure).toBeNull();
  });

  it('the mini: copies the head bundle by cat > into its bench directory and unpacks it under its head alone, after the Electron and free-space preflights, before mini-ops starts the daemon', async () => {
    const { calls, failure, said } = await fullRun(MINI(codeFile()), machineScript({ listedAfter: 0 }));
    expect(failure).toBeNull();
    const lines = calls.map((c) => c.argv.at(-1)!);
    const at = (pattern: RegExp) => lines.findIndex((line) => pattern.test(line));
    const p = '/Users/kimmi/.local/share/maws-bench/mini-bench';
    expect(lines[at(/process\.versions\.electron/)]).toBe(`env HOME=${p}/home TMPDIR=${p}/tmp ELECTRON_RUN_AS_NODE=1 /Applications/MAWS.app/Contents/MacOS/MAWS -p process.versions.electron`);
    expect(lines[at(/^df -Pk/)]).toBe(`df -Pk ${p}`);
    const copy = calls.find((c) => c.stdinFile === BUNDLE.tar)!;
    expect(copy.argv.at(-1)).toBe(`mkdir -p ${p}/bench && cat > ${p}/bench/head.tar`);
    expect(lines[at(/tar -xf/)]).toBe(`rm -rf ${p}/head && mkdir -p ${p}/head && tar -xf ${p}/bench/head.tar -C ${p}/head && rm -f ${p}/bench/head.tar`);
    expect(at(/process\.versions\.electron/)).toBeLessThan(at(/^df -Pk/));
    expect(at(/^df -Pk/)).toBeLessThan(lines.indexOf(copy.argv.at(-1)!));
    expect(lines.indexOf(copy.argv.at(-1)!)).toBeLessThan(at(/tar -xf/));
    expect(said.findIndex((line) => line.includes('is unpacked in'))).toBeLessThan(said.findIndex((line) => line.includes('mini-ops starts the scratch mawsd')));
    // the mini's runtime runs as production runs its mawsd
    expect(lines.filter((line) => /mawsd\.js status/.test(line)).every((line) => line.includes('/Applications/MAWS.app/Contents/MacOS/MAWS --disable-sigusr1 '))).toBe(true);
    // `present`: mini-ops put the head there; nothing is copied
    const present = await fullRun({ ...MINI(codeFile()), stageHead: 'present' }, machineScript({ listedAfter: 0 }), 0, null);
    expect(present.failure).toBeNull();
    expect(present.calls.some((c) => /tar -xf|head\.tar|process\.versions/.test(c.argv.at(-1)!))).toBe(false);
  });

  it('refuses to copy the head when the runtime’s Electron is not the bundle’s, or the volume is short of room, saying both', async () => {
    const other = await fullRun(MINI(codeFile()), (command, call) => (/process\.versions\.electron$/.test(command) ? { code: 0, stdout: '43.1.0\n', stderr: '' } : machineScript({ listedAfter: 0 })(command, call)));
    expect(String(other.failure)).toMatch(/refused to copy the head: the runtime \/Applications\/MAWS\.app\/Contents\/MacOS\/MAWS is Electron 43\.1\.0, the head bundle's is Electron 44\.4\.5/);
    expect(other.calls.some((c) => c.stdinFile === BUNDLE.tar)).toBe(false);
    const full = await fullRun(MINI(codeFile()), (command, call) => (/^df -Pk /.test(command) ? { code: 0, stdout: DF(200 * 1024), stderr: '' } : machineScript({ listedAfter: 0 })(command, call)));
    expect(String(full.failure)).toMatch(/the profile's volume has 200\.0 MiB free, under the 220\.0 MiB the bundle needs \(its 40\.0 MiB tarball and twice its 90\.0 MiB unpacked\)/);
    expect(full.calls.some((c) => c.stdinFile === BUNDLE.tar)).toBe(false);
    const stale = await fullRun(MINI(codeFile()), machineScript({ listedAfter: 0 }), 0, { ...BUNDLE, commit: 'b'.repeat(40) });
    expect(String(stale.failure)).toMatch(/the head bundle is of bbbbbbbbb, not aaaaaaaaa/);
    expect((await fullRun(MINI(codeFile()), machineScript({ listedAfter: 0 }), 0, null)).failure).toMatchObject({ message: expect.stringMatching(/no head bundle was built/) });
  });

  it('refuses every command naming the production mawsd’s profile, its app.asar entry or its unit mode, and such inputs', () => {
    expect(productionProblem(`ls '/Users/new/Library/Application Support/MAWS/mawsd'`)).toMatch(/production mawsd's profile/);
    expect(productionProblem('/Applications/MAWS.app/Contents/Resources/app.asar/out/main/mawsd.js status')).toMatch(/app\.asar entry/);
    expect(productionProblem('mawsd.js run --unit --dir x')).toMatch(/unit mode/);
    expect(productionProblem('/Applications/MAWS.app/Contents/MacOS/MAWS --disable-sigusr1 /p/head/out/main/mawsd.js run --private --dir /p/mawsd')).toBeNull();
    const file = '/tmp/code';
    expect(machineProblems({ ...MINI(file), head: '/Users/new/Library/Application Support/MAWS/head' })).toContain("head /Users/new/Library/Application Support/MAWS/head: it names the production mawsd's profile (Library/Application Support/MAWS)");
    expect(machineProblems({ ...MINI(file), node: '/Applications/MAWS.app/Contents/Resources/app.asar/out/main/mawsd.js' })).toContain("node /Applications/MAWS.app/Contents/Resources/app.asar/out/main/mawsd.js: it names the production mawsd's app.asar entry");
  });

  it('refuses a head bundle entry that is absolute or climbs out with ..', () => {
    expect(archiveProblems(['./', './out/main/mawsd.js', './node_modules/node-pty/package.json', 'bench-head.json'])).toEqual([]);
    expect(archiveProblems(['./out/../../etc/passwd', '/Users/kimmi/.zshrc', './a/..b'])).toEqual([
      "the head bundle's entry ./out/../../etc/passwd would unpack outside the head",
      "the head bundle's entry /Users/kimmi/.zshrc would unpack outside the head",
    ]);
  });

  it('builds the head bundle from the checkout at its commit: the pack, the stub and the fixtures it reads, the pinned Electron, one tarball whose entries stay inside', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bench-bundle-'));
    scratch.push(root);
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'test/support'), { recursive: true });
    mkdirSync(join(repo, 'spikes/protocol-probe/fixtures/pass2'), { recursive: true });
    mkdirSync(join(repo, 'node_modules/electron'), { recursive: true });
    writeFileSync(join(repo, 'test/support/latency-engine-stub.mjs'), "const C = { a: ['init.jsonl', 1], b: ['pass2/auto-unrouted.jsonl', 2] }; // reads.jsonl in a comment is not read\n");
    writeFileSync(join(repo, 'spikes/protocol-probe/fixtures/init.jsonl'), '{}\n');
    writeFileSync(join(repo, 'spikes/protocol-probe/fixtures/pass2/auto-unrouted.jsonl'), '{}\n');
    writeFileSync(join(repo, 'node_modules/electron/package.json'), JSON.stringify({ version: '44.4.5' }));
    let dirty = false;
    const runner: CommandRunner = {
      async run(argv) {
        if (argv[0] === 'git' && argv[3] === 'rev-parse') return { code: 0, stdout: `${COMMIT}\n`, stderr: '' };
        if (argv[0] === 'git') return { code: dirty ? 1 : 0, stdout: '', stderr: '' };
        if (argv[0] === 'pnpm') {
          const pack = join(argv[argv.length - 1]!, '0.0.0-aaaaaaaa-12345678');
          mkdirSync(join(pack, 'out/main'), { recursive: true });
          writeFileSync(join(pack, 'out/main/mawsd.js'), '// main');
          return { code: 0, stdout: `${pack}\n`, stderr: '' };
        }
        const ran = spawnSync(argv[0]!, argv.slice(1), { encoding: 'utf8' });
        return { code: ran.status, stdout: ran.stdout, stderr: ran.stderr };
      },
      start: () => {
        throw new Error('no process is started');
      },
    };
    expect(stubFixtures(readFileSync(join(repo, 'test/support/latency-engine-stub.mjs'), 'utf8'))).toEqual(['init.jsonl', 'pass2/auto-unrouted.jsonl']);
    const bundle = await buildHeadBundle(repo, join(root, 'out'), runner, COMMIT);
    expect(bundle).toMatchObject({ tar: join(root, 'out', 'head.tar'), electron: '44.4.5', commit: COMMIT });
    const entries = spawnSync('tar', ['-tf', bundle.tar], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).map((entry) => entry.replace(/^\.\//, '')).filter(Boolean).sort();
    expect(entries).toEqual(['bench-head.json', 'out/', 'out/main/', 'out/main/mawsd.js', 'spikes/', 'spikes/protocol-probe/', 'spikes/protocol-probe/fixtures/', 'spikes/protocol-probe/fixtures/init.jsonl', 'spikes/protocol-probe/fixtures/pass2/', 'spikes/protocol-probe/fixtures/pass2/auto-unrouted.jsonl', 'test/', 'test/support/', 'test/support/latency-engine-stub.mjs']);
    expect(bundle.unpackedBytes).toBeGreaterThan(0);
    await expect(buildHeadBundle(repo, join(root, 'out2'), runner, 'c'.repeat(40))).rejects.toThrow(/is built from ccccccccc, and .* is at aaaaaaaaa/);
    dirty = true;
    await expect(buildHeadBundle(repo, join(root, 'out3'), runner, COMMIT)).rejects.toThrow(/has tracked changes/);
  });

  it('runs a child with the file’s descriptor as its stdin and neither SMINOS_RL10 nor MAWS_USER_DATA in its environment', async () => {
    const file = codeFile();
    const runner = processRunner({ ...process.env, SMINOS_RL10: '/tmp/rl10.json', MAWS_USER_DATA: '/tmp/profile' });
    const probe = "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.stringify({stdinIsCode:s.trim()===" + JSON.stringify(CODE) + ",rl10:process.env.SMINOS_RL10??null,userData:process.env.MAWS_USER_DATA??null,argv:process.argv.slice(1)})))";
    const result = await runner.run([process.execPath, '-e', probe], { stdinFile: file });
    expect(JSON.parse(result.stdout)).toEqual({ stdinIsCode: true, rl10: null, userData: null, argv: [] });
  });
});
