// The live bench's runner (test/support/remote-bench.ts; P5 O7 M7) against a fake command runner that plays both bench
// machines' transports: the mini's plain non-TTY ssh (mini-ops starts its scratch daemon) and the VM's `devcloud vm ssh`
// (the runner packs and starts it). Whatever path a run takes, the enrollment code never appears in an argv, in an
// environment, or in anything said; it reaches the enroll alone, by its file's descriptor; the file is removed after;
// every resource is ended on a failure mid-way; no command is a sminos call, or names SMINOS_RL10, or names
// MAWS_USER_DATA outside the scratch daemon's own start; every path a command names is the scratch profile's but the
// runtime's; the profile is removed only once no bench process is left; and the mini's quiet window refuses every call.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appProfileProblems, archiveProblems, BenchRun, buildHeadBundle, buildSourceArchive, copyLine, deadlined, envLine, guardedLine, SERVE_MAX_MS, INHERITED_OVERRIDES, machineProblems, meetsQuiet, processRunner, productionProblem, profileEnv, QUIET_MARGIN_MS, quote, startLine, stopLine, stubFixtures, transportArgv, untilQuiet, type BenchMachine, type CommandRunner, type HeadBundle, type RunResult, type Started } from './remote-bench';

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

const MINI = (file: string): BenchMachine => ({ name: 'mini-bench', transport: { kind: 'ssh', host: 'mini' }, stage: 'mini-ops', codeFile: file, scratchRoot: '/Users/kimmi/.local/share/maws-bench', profile: '/Users/kimmi/.local/share/maws-bench/mini-bench', label: 'dev.maws.bench.mini', port: 47901, head: '/Users/kimmi/.local/share/maws-bench/mini-bench/head', commit: COMMIT, node: '/Applications/MAWS.app/Contents/MacOS/MAWS' });
const VM = (file: string): BenchMachine => ({ name: 'vm-bench', transport: { kind: 'devcloud', vm: 'o7-accept' }, stage: 'runner', codeFile: file, scratchRoot: '/home/dev/maws-bench', profile: '/home/dev/maws-bench/vm-bench', label: 'dev.maws.bench.vm', port: 47902, head: '/home/dev/maws-bench/vm-bench/head', commit: COMMIT, node: '/usr/bin/node' });
const ENGINE_VERSION = '2.1.283';
const BUNDLE: HeadBundle = { tar: '/tmp/bench-local/head.tar', tarBytes: 40 * 1024 * 1024, unpackedBytes: 90 * 1024 * 1024, electron: '44.4.5', commit: COMMIT };
const SOURCE: HeadBundle = { tar: '/tmp/bench-local/source.tar', tarBytes: 12 * 1024 * 1024, unpackedBytes: 12 * 1024 * 1024, electron: null, commit: COMMIT };
const DF = (availableKb: number) => `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s5 970000000 400000000 ${availableKb} 42% /System/Volumes/Data\n`;
const at = (iso: string) => Date.parse(iso);

type Call = { argv: readonly string[]; stdinFile?: string; stdin?: string; timeoutMs?: number; wrapped?: string };
type Script = (command: string, call: Call) => RunResult | undefined;
const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' });
/** A command less its guard (`guardedLine`'s prefix). */
const bare = (line: string) => line.replace(/^for t in .*?; done; done; /s, '');

/** What a sound machine answers to the runner's own checks: the profile's path real, the VM prepared, the daemon's pid its own, no bench process left. */
function soundMachine(command: string): RunResult | undefined {
  if (/prepared-commit 2>\/dev\/null\)" = /.test(command)) return ok();
  const pid = /^ps -o args= -p "\$\(cat (\S+)\/bench\/mawsd\.pid\)"$/.exec(command);
  if (pid !== null) return ok(`/p/runtime/bin/node /p/out/main/mawsd.js run --private --dir ${pid[1]}/mawsd\n`);
  if (/^pgrep -f -- /.test(command)) return { code: 1, stdout: '', stderr: '' };
  return undefined;
}

/** The command inside `deadlined`'s `sh -c '…'`. */
function unwrap(line: string): string {
  const match = /^(?:timeout -k 5 \d+|perl -e '(?:[^']|'\\'')*' \d+) sh -c ('(?:[^']|'\\'')*'|\S+)$/s.exec(line);
  if (match === null) throw new Error(`a remote command without its deadline: ${line}`);
  const word = match[1]!;
  return word.startsWith("'") ? word.slice(1, -1).replaceAll("'\\''", "'") : word;
}

/**
 * A command runner that records every call (and reads a stdin file as a child would, to check what crossed), answering by
 * `script`, then as a sound machine. A started agent exits on its stdin's end, or on a kill when `endless`.
 */
function fakeRunner(script: Script, options: { endless?: boolean } = {}) {
  const calls: Call[] = [];
  const started: { argv: readonly string[]; written: string[]; ended: boolean; killed: boolean }[] = [];
  const runner: CommandRunner = {
    async run(transport, runOptions = {}) {
      // the machine's own deadline around each command (`deadlined`): recorded, and the command inside it scripted
      const wrapped = transport.at(-1)!;
      const argv = [...transport.slice(0, -1), unwrap(wrapped)];
      const call: Call = { argv, wrapped, ...(runOptions.timeoutMs !== undefined && { timeoutMs: runOptions.timeoutMs }), ...(runOptions.stdinFile !== undefined && { stdinFile: runOptions.stdinFile, stdin: runOptions.stdinFile === BUNDLE.tar || runOptions.stdinFile === SOURCE.tar ? '(an archive)' : readFileSync(runOptions.stdinFile, 'utf8') }) };
      calls.push(call);
      return script(argv.at(-1)!, call) ?? soundMachine(argv.at(-1)!) ?? ok();
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
          if (options.endless !== true) exit(0);
        },
        kill: () => {
          record.killed = true;
          exit(null);
        },
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
    if (/mawsd-pack\.mjs/.test(command)) return { code: 0, stdout: '/home/dev/maws-bench/vm-bench/bench/pack/0.0.0-aaaaaaaa-1234\n', stderr: '' };
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

/** A run's deps over a fake clock: `sleep` advances it, `after` records each deadline set. */
function benchDeps(fake: ReturnType<typeof fakeRunner>, startAt: number) {
  const said: string[] = [];
  const deadlines: { ms: number; fire: () => void; cancelled: boolean }[] = [];
  let clock = startAt;
  const deps = {
    runner: fake.runner,
    engineVersion: ENGINE_VERSION,
    say: (line: string) => void said.push(line),
    sleep: async (ms: number) => void (clock += ms),
    now: () => clock,
    after: (ms: number, fire: () => void) => {
      const deadline = { ms, fire, cancelled: false };
      deadlines.push(deadline);
      return () => void (deadline.cancelled = true);
    },
  };
  return { deps, said, deadlines };
}

async function fullRun(machine: BenchMachine, script: Script, startAt = 0, bundle: HeadBundle | null = BUNDLE, options: { endless?: boolean } = {}) {
  const fake = fakeRunner(script, options);
  const { deps, said, deadlines } = benchDeps(fake, startAt);
  const run = new BenchRun(machine, deps);
  let failure: unknown = null;
  let teardownFailure: unknown = null;
  try {
    await run.prepare(machine.codeFile.replace(/code$/, 'agent.cjs'));
    await run.stage(machine.stage === 'runner' || bundle === null ? undefined : bundle);
    await run.enroll();
    run.serve(() => undefined);
    run.list(['member-1'], 'the bench session');
  } catch (error) {
    failure = error;
  } finally {
    await run.teardown().catch((error: unknown) => void (teardownFailure = error));
  }
  return { ...fake, said, failure, teardownFailure, deadlines, run };
}

/** prepare-vm alone, on a fake VM. */
async function prepareRun(machine: BenchMachine, script: Script, source: HeadBundle = SOURCE) {
  const fake = fakeRunner(script);
  const { deps, said } = benchDeps(fake, 0);
  let failure: unknown = null;
  try {
    await new BenchRun(machine, deps).prepareVm(source);
  } catch (error) {
    failure = error;
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
      'profile /Users/kimmi/Library/Application Support/MAWS is a default profile, or inside one',
      'profile /Users/kimmi/Library/Application Support/MAWS is not strictly under /Users/kimmi/.local/share/maws-bench',
      'head maws-m7 is not absolute',
      'node /Users/kimmi/.local/bin/mawsd is the installed mawsd',
      'the runner stages only a devcloud VM; the mini is mini-ops’',
      'profile /Users/kimmi/Library/Application Support/MAWS holds a quote, a space or a shell character',
      'quiet window 6:45–07:00 is not two UTC times HH:MM',
    ]);
    const long = `/Users/kimmi/.local/share/maws-bench/${'p'.repeat(50)}`;
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

    it(`${label}: runs no sminos, never sets SMINOS_RL10, and sets MAWS_USER_DATA only in the scratch daemon’s start, unsetting both everywhere else`, async () => {
      const file = codeFile();
      const { calls, started, said } = await fullRun(machine(file), machineScript({ listedAfter: 0 }));
      const commands = [...calls.map((c) => c.argv), ...started.map((s) => s.argv)].map((argv) => argv.join(' '));
      expect(commands.filter((c) => /(^|[\s;&|])sminos(\s|$)/.test(c))).toEqual([]);
      expect([...commands, ...said].filter((c) => c.includes('SMINOS_RL10='))).toEqual([]);
      const named = [...commands, ...said].filter((c) => c.includes('MAWS_USER_DATA='));
      for (const line of named) expect(line).toMatch(/nohup .* run --private --dir /);
      for (const line of [...commands, ...said].filter((c) => /bench-agent\.cjs'? (prepare|serve)|mawsd\.js"? (status|keys|endpoint|enroll)/.test(c))) expect(line).toMatch(/-u MAWS_USER_DATA .*-u SMINOS_RL10 /);
      expect(commands.filter((c) => /mawsd(\.js)?"? install\b|dev\.maws\.mawsd|\.local\/bin\/mawsd/.test(c))).toEqual([]);
    });
  }

  it('prepare-vm: this Mac’s source archive unpacked under the VM’s head (no clone, no fetch), installed, spawn-helper made executable and packed at the commit, in the scratch environment, the commit recorded last; at the same commit again, nothing', async () => {
    const p = '/home/dev/maws-bench/vm-bench';
    const fresh = await prepareRun(VM('/tmp/code'), (command) => (/prepared-commit 2>\/dev\/null\)" = /.test(command) ? { code: 1, stdout: '', stderr: '' } : machineScript({})(command, { argv: [] })));
    expect(fresh.failure).toBeNull();
    const lines = fresh.calls.map((c) => c.argv.at(-1)!);
    const at = (pattern: RegExp) => lines.findIndex((line) => pattern.test(line));
    expect(lines.filter((line) => /\bgit\b/.test(line))).toEqual([]);
    expect(fresh.calls.find((c) => c.stdinFile === SOURCE.tar)!.argv.at(-1)).toBe(copyLine(VM('/tmp/code'), `${p}/bench/source.tar`));
    expect(bare(lines[at(/tar -xf/)]!)).toBe(`rm -rf ${p}/head && mkdir -p ${p}/head && tar -xf ${p}/bench/source.tar -C ${p}/head && rm -f ${p}/bench/source.tar`);
    expect(bare(lines[at(/pnpm install/)]!)).toBe(`cd ${p}/head && ${envLine(profileEnv(VM('/tmp/code')))} pnpm install --frozen-lockfile >&2`);
    expect(bare(lines[at(/spawn-helper/)]!)).toBe(`find ${p}/head -path '*/node-pty/prebuilds/*/spawn-helper' -type f -exec chmod +x {} +`);
    expect(lines[at(/mawsd-pack\.mjs/)]).toContain(`pack({ out: "${p}/bench/pack", commit: "aaaaaaaa" })`);
    expect(lines[at(/mawsd-pack\.mjs/)]).toContain(`cd ${p}/head && ${envLine(profileEnv(VM('/tmp/code')))} /usr/bin/node --input-type=module -e `);
    const order = [at(/; done; done; mkdir -p /), at(/; done; done; rm -f .*prepared-commit/), at(/cat > .*source\.tar/), at(/tar -xf/), at(/pnpm install/), at(/spawn-helper/), at(/mawsd-pack\.mjs/), at(/> \S+\/pack-path$/), at(/> \S+\/prepared-commit$/)];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(bare(lines.at(-1)!)).toBe(`printf '%s\\n' ${COMMIT} > ${p}/bench/prepared-commit`);
    expect(fresh.said.at(-1)).toMatch(/prepared at aaaaaaaaa: its head installed and packed in \/home\/dev\/maws-bench\/vm-bench\/bench\/pack\/0\.0\.0-aaaaaaaa-1234$/);
    const again = await prepareRun(VM('/tmp/code'), machineScript({}));
    expect(again.failure).toBeNull();
    expect(again.calls.some((c) => /tar -xf|pnpm install|mawsd-pack|prepared-commit$/.test(c.argv.at(-1)!))).toBe(false);
    expect(again.said.at(-1)).toMatch(/already prepared at aaaaaaaaa/);
    expect((await prepareRun(MINI('/tmp/code'), machineScript({}))).failure).toMatchObject({ message: expect.stringMatching(/prepare-vm builds a devcloud VM's head/) });
  });

  it('the VM: the prepared pack’s mawsd started detached under its own profile, label, port and the stub, its pid checked, and stopped by that pid at teardown; refused unprepared', async () => {
    const file = codeFile();
    const { calls, failure } = await fullRun(VM(file), machineScript({ listedAfter: 0 }));
    expect(failure).toBeNull();
    const lines = calls.map((c) => c.argv.at(-1)!);
    const at = (pattern: RegExp) => lines.findIndex((line) => pattern.test(line));
    expect(lines.some((line) => /tar -xf|pnpm install|mawsd-pack/.test(line))).toBe(false); // prepare-vm's, before the sitting
    expect(at(/bench-agent\.cjs'? prepare/)).toBeLessThan(at(/nohup/)); // the wrapper and trust before the daemon reads them
    const start = lines[at(/nohup/)]!;
    expect(start).toBe(startLine(VM(file), '"$(cat /home/dev/maws-bench/vm-bench/bench/pack-path)/runtime/bin/node" "$(cat /home/dev/maws-bench/vm-bench/bench/pack-path)/out/main/mawsd.js"'));
    for (const part of ['MAWS_USER_DATA=/home/dev/maws-bench/vm-bench', 'MAWS_MAWSD_LABEL=dev.maws.bench.vm', 'CLAUDE_CONFIG_DIR=/home/dev/maws-bench/vm-bench/claude-config', 'MAWS_E2E=1', 'MAWS_E2E_ENGINE_BIN=/home/dev/maws-bench/vm-bench/bench/latency-engine', 'MAWS_ENDPOINT_DIRECT=1', 'MAWS_ENDPOINT_PORT=47902', 'run --private --dir /home/dev/maws-bench/vm-bench/mawsd']) expect(start).toContain(part);
    expect(at(/^ps -o args= -p /)).toBeGreaterThan(at(/mawsd\.js"? status/));
    expect(lines.at(-1)).toBe(stopLine(VM(file)));
    expect(lines.some((line) => line.includes('rm -rf /home/dev/maws-bench/vm-bench') && !line.includes('rm -rf /home/dev/maws-bench/vm-bench/head'))).toBe(false); // the profile is kept until the bench is done
    const unprepared = await fullRun(VM(codeFile()), (command, call) => (/prepared-commit 2>\/dev\/null\)" = /.test(command) ? { code: 1, stdout: '', stderr: '' } : machineScript({ listedAfter: 0 })(command, call)));
    expect(String(unprepared.failure)).toMatch(/not prepared at aaaaaaaaa: run prepare-vm before the sitting/);
    expect(unprepared.calls.some((c) => /nohup/.test(c.argv.at(-1)!))).toBe(false);
    const stranger = await fullRun(VM(codeFile()), (command, call) => (/^ps -o args= -p /.test(command) ? ok('/usr/bin/sleep 600\n') : machineScript({ listedAfter: 0 })(command, call)));
    expect(String(stranger.failure)).toMatch(/the recorded pid is not the scratch mawsd's/);
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
    expect(calls.at(-1)!.argv.at(-1)).toBe(stopLine(VM(file)));
    expect(said.at(-1)).toMatch(/torn down/);
  });

  it('a failed enroll: its output never said, the file removed, the daemon stopped', async () => {
    const file = codeFile();
    const { failure, calls, said, started } = await fullRun(VM(file), (command, call) => (/ enroll /.test(command) ? { code: 1, stdout: '', stderr: `refused: ${CODE}` } : machineScript({})(command, call)));
    expect(String(failure)).toMatch(/enroll failed \(exit 1\); its own output is not shown/);
    expect(String(failure)).not.toContain('SECRET');
    expect(leaks(calls, started, said)).toEqual([]);
    expect(existsSync(file)).toBe(false);
    expect(calls.at(-1)!.argv.at(-1)).toBe(stopLine(VM(file)));
    expect(started).toHaveLength(0); // the agent's serve never started, so nothing of it to end
  });

  it('a rerun on a profile already listed under the name enrolls nothing, and removes the unused code file', async () => {
    const file = codeFile();
    const { calls, started, run } = await fullRun(VM(file), machineScript({ already: true }));
    expect(calls.some((c) => / enroll /.test(c.argv.at(-1)!))).toBe(false);
    expect(calls.some((c) => c.stdinFile === file)).toBe(false);
    expect(existsSync(file)).toBe(false);
    expect(started[0]!.written).toEqual([JSON.stringify({ list: { owners: ['member-1'], title: 'the bench session' } })]);
    expect(() => run.turn('latency bench turn 5')).toThrow(/the bench agent is ending/); // torn down already
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
      const outside = commands.flatMap(pathsOf).filter((path) => path !== m.profile && !path.startsWith(`${m.profile}/`) && path !== m.scratchRoot && path !== `${m.scratchRoot}/*` && path !== m.node && !(allowed as readonly string[]).includes(path));
      expect(outside).toEqual([]);
      // the runtime only ever runs: never a redirection's target, a copy's, or a directory made
      for (const command of commands) expect(command).not.toMatch(new RegExp(`(>|cat >|mkdir -p|rm -rf|cp) *'?${m.node.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
      // each command's own home and temporary directory are the profile's
      for (const command of commands.filter((c) => /mawsd\.js"? (status|keys|endpoint|enroll|run)|bench-agent\.cjs'? (prepare|serve)/.test(c))) expect(command).toContain(`HOME=${m.profile}/home TMPDIR=${m.profile}/tmp`);
    });
  }

  it('removes the profile, its head and any tarball with it, only once no bench process is left on the machine: refused, said and kept while one lives', async () => {
    for (const machine of [VM, MINI]) {
      let pids = '4242\n4243\n';
      const fake = fakeRunner((command) => (/pgrep -f -- /.test(command) ? { code: pids === '' ? 1 : 0, stdout: pids, stderr: '' } : undefined));
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
      expect(bare(lines.at(-1)!)).toBe(`rm -rf ${machine === VM ? '/home/dev/maws-bench/vm-bench' : '/Users/kimmi/.local/share/maws-bench/mini-bench'}`);
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
    expect(lines[at(/process\.versions\.electron/)]).toBe(`${envLine(profileEnv(MINI('/tmp/code')))} /Applications/MAWS.app/Contents/MacOS/MAWS -p process.versions.electron`);
    expect(lines[at(/^df -Pk/)]).toBe(`df -Pk ${p}`);
    const copy = calls.find((c) => c.stdinFile === BUNDLE.tar)!;
    expect(copy.argv.at(-1)).toBe(copyLine(MINI('/tmp/code'), `${p}/bench/head.tar`));
    expect(bare(lines[at(/tar -xf/)]!)).toBe(`rm -rf ${p}/head && mkdir -p ${p}/head && tar -xf ${p}/bench/head.tar -C ${p}/head && rm -f ${p}/bench/head.tar`);
    expect(bare(lines[at(/spawn-helper/)]!)).toBe(`find ${p}/head -path '*/node-pty/prebuilds/*/spawn-helper' -type f -exec chmod +x {} +`);
    expect(at(/tar -xf/)).toBeLessThan(at(/spawn-helper/));
    expect(at(/process\.versions\.electron/)).toBeLessThan(at(/^df -Pk/));
    expect(at(/^df -Pk/)).toBeLessThan(lines.indexOf(copy.argv.at(-1)!));
    expect(lines.indexOf(copy.argv.at(-1)!)).toBeLessThan(at(/tar -xf/));
    expect(said.findIndex((line) => line.includes('is unpacked in'))).toBeLessThan(said.findIndex((line) => line.includes('mini-ops starts the scratch mawsd')));
    // the mini's runtime runs as production runs its mawsd
    expect(lines.filter((line) => /mawsd\.js status/.test(line)).every((line) => line.includes('/Applications/MAWS.app/Contents/MacOS/MAWS --disable-sigusr1 '))).toBe(true);
    // `present`: mini-ops put the head there; nothing is copied
    const present = await fullRun({ ...MINI(codeFile()), stageHead: 'present' }, machineScript({ listedAfter: 0 }), 0, null);
    expect(present.failure).toBeNull();
    expect(present.calls.some((c) => /tar -xf|head\.tar|process\.versions|spawn-helper/.test(c.argv.at(-1)!))).toBe(false);
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

  it('builds the VM’s source by git archive of the commit, its entries checked, and the VM refuses one of another commit or none', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bench-source-'));
    scratch.push(root);
    const tree = join(root, 'tree');
    mkdirSync(join(tree, 'scripts'), { recursive: true });
    writeFileSync(join(tree, 'scripts/mawsd-pack.mjs'), '// pack');
    let argvSeen: readonly string[] = [];
    const runner: CommandRunner = {
      async run(argv) {
        if (argv[0] === 'git') {
          argvSeen = argv;
          const ran = spawnSync('tar', ['-C', tree, '-cf', argv[argv.indexOf('-o') + 1]!, '.'], { encoding: 'utf8' });
          return { code: ran.status, stdout: '', stderr: ran.stderr };
        }
        const ran = spawnSync(argv[0]!, argv.slice(1), { encoding: 'utf8' });
        return { code: ran.status, stdout: ran.stdout, stderr: ran.stderr };
      },
      start: () => {
        throw new Error('no process is started');
      },
    };
    const source = await buildSourceArchive('/repo', join(root, 'out'), runner, COMMIT);
    expect(argvSeen).toEqual(['git', '-C', '/repo', 'archive', '--format=tar', '-o', join(root, 'out', 'source.tar'), COMMIT]);
    expect(source).toMatchObject({ tar: join(root, 'out', 'source.tar'), electron: null, commit: COMMIT });
    expect(source.tarBytes).toBeGreaterThan(0);
    expect((await prepareRun(VM('/tmp/code'), machineScript({}), { ...source, commit: 'b'.repeat(40) })).failure).toMatchObject({ message: expect.stringMatching(/the source archive is of bbbbbbbbb, not aaaaaaaaa/) });
  });

  it('runs a child with the file’s descriptor as its stdin and neither SMINOS_RL10 nor MAWS_USER_DATA in its environment', async () => {
    const file = codeFile();
    const runner = processRunner({ ...process.env, SMINOS_RL10: '/tmp/rl10.json', MAWS_USER_DATA: '/tmp/profile' });
    const probe = "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.stringify({stdinIsCode:s.trim()===" + JSON.stringify(CODE) + ",rl10:process.env.SMINOS_RL10??null,userData:process.env.MAWS_USER_DATA??null,argv:process.argv.slice(1)})))";
    const result = await runner.run([process.execPath, '-e', probe], { stdinFile: file });
    expect(JSON.parse(result.stdout)).toEqual({ stdinIsCode: true, rl10: null, userData: null, argv: [] });
  });

  it('refuses a profile or head that climbs out with .., is not normal, or is not strictly inside its root, whatever a string prefix says', () => {
    const file = '/tmp/code';
    const root = '/Users/kimmi/.local/share/maws-bench';
    const climbs = machineProblems({ ...MINI(file), profile: `${root}/mini-bench/../../x`, head: `${root}/mini-bench/../../x/head` });
    expect(climbs).toContain(`profile ${root}/mini-bench/../../x is not a normal path (a ., .., empty component or trailing slash)`);
    expect(climbs).toContain(`head ${root}/mini-bench/../../x/head is not a normal path (a ., .., empty component or trailing slash)`);
    expect(machineProblems({ ...MINI(file), head: `${root}/mini-bench/../elsewhere` })).toEqual([`head ${root}/mini-bench/../elsewhere is not a normal path (a ., .., empty component or trailing slash)`]);
    expect(machineProblems({ ...MINI(file), head: `${root}/mini-bench` })).toEqual([`head ${root}/mini-bench is not strictly under ${root}/mini-bench`]);
    expect(machineProblems({ ...MINI(file), profile: root, head: `${root}/head` })).toEqual([`profile ${root} is not strictly under ${root}`]);
    expect(machineProblems({ ...MINI(file), profile: `${root}-other/mini-bench`, head: `${root}-other/mini-bench/head` })).toEqual([`profile ${root}-other/mini-bench is not strictly under ${root}`]);
    expect(machineProblems({ ...MINI(file), profile: `${root}//mini-bench`, head: `${root}//mini-bench/head` })[0]).toMatch(/is not a normal path/);
    expect(machineProblems({ ...MINI(file), scratchRoot: '/' })).toContain("scratch root / is the filesystem's root");
    expect(machineProblems({ ...MINI(file), profile: `${root}/mini*`, head: `${root}/mini*/head` })).toContain(`profile ${root}/mini* holds a quote, a space or a shell character`);
  });

  it('refuses the bench app’s profile outside its scratch root, the production app’s profile, anything inside or above it, and one reached through a symlink', () => {
    const home = '/Users/new';
    const root = `${home}/.local/share/maws-bench`;
    const real = (path: string) => path;
    expect(appProfileProblems(`${root}/app`, root, home, real, () => true)).toEqual([]);
    expect(appProfileProblems(`${root}/app/../../x`, root, home, real, () => true)).toEqual([`the app’s profile ${root}/app/../../x is not a normal path (a ., .., empty component or trailing slash)`]);
    expect(appProfileProblems(`${home}/elsewhere/app`, root, home, real, () => true)).toEqual([`the app’s profile ${home}/elsewhere/app is not strictly under ${root}`]);
    const production = `${home}/Library/Application Support/MAWS`;
    expect(appProfileProblems(production, `${home}/Library/Application Support`, home, real, () => true)).toEqual([`the app’s profile ${production} is the production app’s profile, inside it or above it`, `the app’s scratch root ${home}/Library/Application Support is the production app’s profile, inside it or above it`]);
    expect(appProfileProblems(`${production}/bench/app`, production, home, real, () => true)).toEqual([`the app’s profile ${production}/bench/app is the production app’s profile, inside it or above it`, `the app’s scratch root ${production} is the production app’s profile, inside it or above it`]);
    expect(appProfileProblems(`${home}/Library/app`, home, home, real, () => true)).toEqual([`the app’s scratch root ${home} is the production app’s profile, inside it or above it`]);
    expect(appProfileProblems(`${home}/Library/Application Support`, `${home}/Library`, home, real, () => true)).toEqual([`the app’s profile ${home}/Library/Application Support is the production app’s profile, inside it or above it`, `the app’s scratch root ${home}/Library is the production app’s profile, inside it or above it`]);
    // the deepest existing ancestor must be its own real path
    expect(appProfileProblems(`${root}/app`, root, home, (p) => (p === root ? '/Volumes/x/maws-bench' : p), (p) => p === root || p === home)).toEqual([`the app’s profile ${root}/app goes through a symlink: ${root} is /Volumes/x/maws-bench (name the real path)`]);
  });

  for (const [label, machine] of [['the mini', MINI], ['the VM', VM]] as const) {
    it(`${label}: every program a command runs carries the profile’s whole scratch environment, every inherited override unset, and every remote command a timeout`, async () => {
      const m = machine(codeFile());
      const run = await fullRun(m, machineScript({ listedAfter: 0 }));
      const prep = m.stage === 'runner' ? await prepareRun(m, (command) => (/prepared-commit 2>\/dev\/null\)" = /.test(command) ? { code: 1, stdout: '', stderr: '' } : machineScript({})(command, { argv: [] }))) : null;
      expect(run.failure).toBeNull();
      const calls = [...run.calls, ...(prep?.calls ?? [])];
      const programs = [...calls.map((c) => c.argv.at(-1)!), ...run.started.map((s) => s.argv.at(-1)!)].filter((c) => /pnpm install|mawsd-pack|bench-agent\.cjs'? (prepare|serve)|mawsd\.js"? (status|keys|endpoint|enroll|run)|process\.versions/.test(c));
      expect(programs.length).toBeGreaterThanOrEqual(m.stage === 'runner' ? 7 : 5);
      for (const command of programs) {
        for (const [name, value] of Object.entries(profileEnv(m))) expect(command).toContain(`${name}=${quote(value)}`);
        for (const name of INHERITED_OVERRIDES.filter((n) => !/nohup/.test(command) || !['MAWS_USER_DATA', 'MAWS_MAWSD_LABEL', 'MAWS_ENDPOINT_DIRECT', 'MAWS_ENDPOINT_PORT', 'MAWS_MACHINE_NAME', 'MAWS_E2E', 'MAWS_E2E_ENGINE_BIN', 'MAWS_CLAUDE_USAGE_DIR', 'CLAUDE_CONFIG_DIR', 'SMINOS_HOME', 'ZDOTDIR', 'HISTFILE'].includes(n))) expect(command).toContain(`-u ${name} `);
      }
      expect(programs.join('\n')).toContain('ELECTRON_SKIP_BINARY_DOWNLOAD=1');
      for (const call of calls) expect(call.timeoutMs, call.argv.at(-1)).toBeGreaterThan(0);
    });
  }

  it('starts a real daemon detached by sh with its own pid recorded, and stops it by that pid only while the pid’s command line is the profile’s daemon', async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'bench-sh-')));
    scratch.push(base);
    const m: BenchMachine = { ...VM('/tmp/code'), scratchRoot: base, profile: `${base}/p`, head: `${base}/p/head` };
    const script = join(base, 'daemon.mjs');
    writeFileSync(script, 'setInterval(() => {}, 1000);\n');
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    let pid = 0;
    try {
      const started = spawnSync('sh', ['-c', startLine(m, `${quote(process.execPath)} ${quote(script)}`)], { encoding: 'utf8', timeout: 10_000 });
      expect(started.status).toBe(0);
      pid = Number(readFileSync(`${m.profile}/bench/mawsd.pid`, 'utf8').trim());
      // the recorded pid is the daemon itself, not a shell waiting on it
      const args = spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).stdout;
      expect(args).toContain(script);
      expect(args).toContain(`run --private --dir ${m.profile}/mawsd`);
      // a pid reused by another process is never signalled
      writeFileSync(`${m.profile}/bench/mawsd.pid`, `${process.pid}\n`);
      expect(spawnSync('sh', ['-c', stopLine(m)], { encoding: 'utf8', timeout: 20_000 }).status).toBe(4);
      expect(alive(process.pid)).toBe(true);
      writeFileSync(`${m.profile}/bench/mawsd.pid`, `${pid}\n`);
      expect(spawnSync('sh', ['-c', stopLine(m)], { encoding: 'utf8', timeout: 20_000 }).status).toBe(0);
      await expect.poll(() => alive(pid), { timeout: 5_000 }).toBe(false);
      // stopped, or never started: nothing to do
      expect(spawnSync('sh', ['-c', stopLine(m)], { encoding: 'utf8', timeout: 20_000 }).status).toBe(0);
      rmSync(`${m.profile}/bench/mawsd.pid`);
      expect(spawnSync('sh', ['-c', stopLine(m)], { encoding: 'utf8', timeout: 20_000 }).status).toBe(0);
    } finally {
      if (pid > 0 && alive(pid)) process.kill(pid, 'SIGKILL');
    }
  });

  it('fails closed on the process check: a pgrep error, a missing pgrep or an answer without pids removes nothing', async () => {
    for (const answer of [{ code: 2, stdout: '', stderr: 'pgrep: bad pattern' }, { code: 127, stdout: '', stderr: 'pgrep: not found' }, { code: 255, stdout: '', stderr: '' }, { code: 0, stdout: '\n', stderr: '' }]) {
      const fake = fakeRunner((command) => (/^pgrep -f -- /.test(command) ? answer : undefined));
      const run = new BenchRun(VM('/tmp/code'), benchDeps(fake, 0).deps);
      await expect(run.removeProfile()).rejects.toThrow(new RegExp(`the bench process check failed \\(pgrep exit ${answer.code}.*whether a bench process lives there is unknown`));
      expect(fake.calls.some((c) => /rm -rf/.test(c.argv.at(-1)!))).toBe(false);
    }
  });

  it('teardown attempts every step, waits for a killed agent’s exit, throws the first failure, and never says torn down after one', async () => {
    // the daemon's stop fails; the agent, which outlives its stdin's end, is still killed and its exit waited for
    const failed = await fullRun(VM(codeFile()), (command, call) => (/^pid=\$\(cat /.test(command) ? { code: 5, stdout: '', stderr: '' } : machineScript({ listedAfter: 0 })(command, call)), 0, BUNDLE, { endless: true });
    expect(failed.failure).toBeNull();
    expect(failed.started[0]).toMatchObject({ ended: true, killed: true });
    // the agent's step ran first (last registered) and failed, its cleanup unverified once killed; the daemon's stop still ran
    expect(String(failed.teardownFailure)).toMatch(/vm-bench: teardown: ending the bench agent failed: vm-bench: the bench agent was killed: its cleanup on the machine is unverified/);
    expect(failed.said).toContain('[bench] vm-bench: ending the scratch mawsd failed: vm-bench: stopping the scratch mawsd failed (exit 5)');
    expect(failed.said.some((line) => /torn down;/.test(line))).toBe(false);
    expect(failed.said.at(-1)).toMatch(/not torn down \(2 steps failed\)/);
    // a pid that is another process's: refused, said, and teardown fails
    const stranger = await fullRun(VM(codeFile()), (command, call) => (/^pid=\$\(cat /.test(command) ? { code: 4, stdout: '', stderr: '' } : machineScript({ listedAfter: 0 })(command, call)));
    expect(String(stranger.teardownFailure)).toMatch(/refused to signal the recorded pid/);
    // an agent whose transport never exits, even killed: its end fails, and the daemon is still stopped
    const fake = fakeRunner(machineScript({ listedAfter: 0 }), { endless: true });
    const { deps, said } = benchDeps(fake, 0);
    const original = fake.runner.start;
    fake.runner.start = (argv) => ({ ...original(argv), kill: () => undefined, exited: new Promise<number | null>(() => undefined) });
    const run = new BenchRun(VM(codeFile()), deps);
    await run.stage();
    run.serve(() => undefined);
    await expect(run.teardown()).rejects.toThrow(/the bench agent's transport did not exit 10 s after it was killed/);
    expect(fake.calls.at(-1)!.argv.at(-1)).toBe(stopLine(VM('/tmp/code')));
    expect(said.at(-1)).toMatch(/not torn down/);
  });

  it('keeps the mini’s quiet window whatever is asked: a custom window adds to it, and the next window’s start is known', async () => {
    const custom = await fullRun({ ...MINI(codeFile()), quietUtc: ['08:00', '09:00'] }, machineScript({ listedAfter: 0 }), at('2026-11-03T06:50:00Z'));
    expect(String(custom.failure)).toMatch(/from 06:45 to 07:00 UTC/);
    expect(custom.calls).toEqual([]);
    expect(machineProblems({ ...MINI('/tmp/code'), quietUtc: ['08:00', '09:00'] })).toEqual([]);
    const both = [['06:45', '07:00'], ['08:00', '09:00']] as const;
    expect(untilQuiet(both, at('2026-11-03T06:00:00Z'))).toBe(45 * 60_000);
    expect(untilQuiet(both, at('2026-11-03T07:30:00Z'))).toBe(30 * 60_000);
    expect(untilQuiet(both, at('2026-11-03T06:50:00Z'))).toBe(0);
    expect(untilQuiet(both, at('2026-11-03T10:00:00Z'))).toBe((20 * 60 + 45) * 60_000);
    expect(untilQuiet([], 0)).toBe(Infinity);
    // a call whose timeout would reach the window's margin is refused: 06:41 plus a 2-minute status reaches 06:45 less 2
    const late = await fullRun(MINI(codeFile()), machineScript({ listedAfter: 0 }), at('2026-11-03T06:41:30Z'));
    expect(String(late.failure)).toMatch(/would run into that window or the 2 minutes before it/);
  });

  it('ends a running serve, its session and stubs with it, the margin before the mini’s quiet window, and refuses a list after', async () => {
    const run = await fullRun(MINI(codeFile()), machineScript({ already: true }), at('2026-11-03T05:00:00Z'));
    expect(run.failure).toBeNull();
    // teardown ran in fullRun: rerun the serve on a fresh run to cross its deadline while it serves
    const fake = fakeRunner(machineScript({ already: true }));
    const { deps, said, deadlines } = benchDeps(fake, at('2026-11-03T05:00:00Z'));
    const bench = new BenchRun(MINI(codeFile()), deps);
    bench.serve(() => undefined);
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]!.ms).toBe(105 * 60_000 - QUIET_MARGIN_MS);
    bench.turn('latency bench turn 2');
    expect(fake.started[0]!.written).toEqual([JSON.stringify({ turn: { content: 'latency bench turn 2' } })]);
    deadlines[0]!.fire();
    await expect.poll(() => fake.started[0]!.ended).toBe(true);
    expect(said).toContain('[bench] mini-bench: its quiet window is 2 minutes off: the bench agent is ended now, its session and stubs with it');
    expect(() => bench.list(['member-1'], 'late')).toThrow(/the bench agent is ending/);
    expect(() => bench.turn('latency bench turn 9')).toThrow(/the bench agent is ending/);
    expect(fake.started[0]!.written).toHaveLength(1);
    await bench.teardown();
    expect(deadlines[0]!.cancelled).toBe(true);
    expect(said.at(-1)).toMatch(/torn down;/);
    // the VM has no window: no deadline is set
    const vm = benchDeps(fakeRunner(machineScript({})), 0);
    new BenchRun(VM(codeFile()), vm.deps).serve(() => undefined);
    expect(vm.deadlines).toEqual([]);
  });

  // ---- the re-check's fixes ----------------------------------------------------------------------------------------

  /** A real tree under a fresh directory: the scratch root, a profile in it, and a directory outside it. */
  function realTree() {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'bench-guard-')));
    scratch.push(base);
    const root = `${base}/root`;
    mkdirSync(`${root}/p/bench`, { recursive: true });
    mkdirSync(`${base}/outside`);
    writeFileSync(`${base}/outside/file`, 'the owner’s\n');
    const m: BenchMachine = { ...VM('/tmp/code'), scratchRoot: root, profile: `${root}/p`, head: `${root}/p/head` };
    return { base, root, m };
  }
  const sh = (line: string, input = '') => spawnSync('sh', ['-c', line], { encoding: 'utf8', input, timeout: 20_000 });

  it('refuses a write through a symlinked component of its target, from the scratch root down, in the same shell step as the write', () => {
    const { base, m } = realTree();
    // an intermediate component of the head a symlink out of the profile
    mkdirSync(`${base}/outside/elsewhere`);
    symlinkSync(`${base}/outside/elsewhere`, `${m.profile}/inner`);
    const head = `${m.profile}/inner/head`;
    const through = guardedLine(m, [head], `mkdir -p ${quote(head)} && printf x > ${quote(`${head}/f`)}`);
    const ran = sh(through);
    expect(ran.status).toBe(86);
    expect(ran.stderr).toContain(`refused: ${m.profile}/inner is a symlink`);
    expect(existsSync(`${base}/outside/elsewhere/head`)).toBe(false);
    // a target outside the root is refused whatever it is
    expect(sh(guardedLine(m, [`${base}/outside/file`], 'true')).status).toBe(86);
    // a sound target: the command runs
    expect(sh(guardedLine(m, [`${m.profile}/bench/x`], `printf ok > ${quote(`${m.profile}/bench/x`)}`)).status).toBe(0);
    expect(readFileSync(`${m.profile}/bench/x`, 'utf8')).toBe('ok');
  });

  it('copies a file to the machine through a fresh name moved into place, refusing a target that is a symlink, the outside file untouched', () => {
    const { base, m } = realTree();
    const target = `${m.profile}/bench/bench-agent.cjs`;
    symlinkSync(`${base}/outside/file`, target);
    const ran = sh(copyLine(m, target), '// the bundle\n');
    expect(ran.status).toBe(86);
    expect(ran.stderr).toContain(`refused: ${target} is a symlink`);
    expect(readFileSync(`${base}/outside/file`, 'utf8')).toBe('the owner’s\n');
    rmSync(target);
    expect(sh(copyLine(m, target), '// the bundle\n').status).toBe(0);
    expect(readFileSync(target, 'utf8')).toBe('// the bundle\n');
    expect(readdirSync(`${m.profile}/bench`).filter((name) => name.startsWith('.bench-copy'))).toEqual([]);
  });

  it('guards every writing or destructive command the runner sends: each names its targets in the guard before it writes', async () => {
    for (const machine of [MINI, VM]) {
      const run = await fullRun(machine(codeFile()), machineScript({ listedAfter: 0 }));
      const prep = machine === VM ? await prepareRun(VM('/tmp/code'), (command) => (/prepared-commit 2>\/dev\/null\)" = /.test(command) ? { code: 1, stdout: '', stderr: '' } : machineScript({})(command, { argv: [] }))) : null;
      const fake = fakeRunner(() => undefined);
      await new BenchRun(machine('/tmp/code'), benchDeps(fake, 0).deps).removeProfile();
      const lines = [...run.calls, ...(prep?.calls ?? []), ...fake.calls].map((c) => c.argv.at(-1)!);
      const writing = lines.filter((line) => /(^|[;&|] *)(mkdir|rm|tar|cat >|printf .*>|mv|chmod|find .*chmod)|tmp=\$\(mktemp|pnpm install|mawsd-pack|nohup| enroll /.test(bare(line)));
      expect(writing.length).toBeGreaterThan(machine === VM ? 10 : 4);
      for (const line of writing) expect(line, line).toMatch(/^for t in .* do p=\$t; while :; do if \[ -L "\$p" \]/);
    }
  });

  it('gives every one-shot remote command its own deadline on the machine: timeout on the VM, a perl alarm on the mini', async () => {
    for (const machine of [MINI, VM]) {
      const run = await fullRun(machine(codeFile()), machineScript({ listedAfter: 0 }));
      expect(run.failure).toBeNull();
      for (const call of run.calls) {
        const seconds = Number(/ (\d+) sh -c /.exec(call.wrapped!)![1]);
        expect(call.wrapped, call.argv.at(-1)).toBe(deadlined(machine('/tmp/code'), seconds, call.argv.at(-1)!));
        expect(call.timeoutMs).toBe(seconds * 1000 + 15_000); // given up on here only after the machine's own deadline
        expect(call.wrapped).toMatch(machine === VM ? new RegExp(`^timeout -k 5 ${seconds} sh -c `) : new RegExp(`^perl -e '.*' ${seconds} sh -c `));
      }
    }
    // the mini's perl deadline ends the command's whole group, a child that ignores SIGTERM included, at its second
    const started = Date.now();
    const ran = sh(deadlined(MINI('/tmp/code'), 1, `sh -c 'trap "" TERM; sleep 30' & wait`));
    expect(ran.status).toBe(124);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(sh(deadlined(MINI('/tmp/code'), 5, 'exit 3')).status).toBe(3);
  });

  it('resolves a local command as failed at its deadline, a child that ignores SIGTERM killed after the grace', async () => {
    const runner = processRunner();
    const started = Date.now();
    const result = await runner.run([process.execPath, '-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('started\\n')"], { timeoutMs: 1_000 });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(result.code).toBeNull();
    expect(result.stderr).toMatch(/timed out after 1 s/);
  });

  it('fails teardown when the agent’s exit does not show its cleanup done: a non-zero exit, or a kill', async () => {
    const fake = fakeRunner(machineScript({ already: true }));
    const original = fake.runner.start;
    fake.runner.start = (argv) => {
      const handle = original(argv);
      let exit!: (code: number | null) => void;
      const exited = new Promise<number | null>((resolve) => (exit = resolve));
      return { ...handle, end: () => exit(1), exited }; // its own end failed on the machine
    };
    const { deps, said } = benchDeps(fake, 0);
    const run = new BenchRun(VM(codeFile()), deps);
    await run.stage();
    run.serve(() => undefined);
    await expect(run.teardown()).rejects.toThrow(/the bench agent exited 1: its cleanup on the machine is unverified/);
    expect(fake.calls.at(-1)!.argv.at(-1)).toBe(stopLine(VM('/tmp/code'))); // the daemon's stop still attempted
    expect(said.some((line) => /torn down;/.test(line))).toBe(false);
    // killed after outliving its stdin's end: unverified too
    const late = await fullRun(VM(codeFile()), machineScript({ listedAfter: 0 }), 0, BUNDLE, { endless: true });
    expect(String(late.teardownFailure)).toMatch(/the bench agent was killed: its cleanup on the machine is unverified/);
  });

  it('passes serve an absolute deadline before the mini’s window, which the agent keeps itself', async () => {
    const fake = fakeRunner(machineScript({ already: true }));
    const { deps } = benchDeps(fake, at('2026-11-03T05:00:00Z'));
    new BenchRun(MINI(codeFile()), deps).serve(() => undefined);
    const word = /serve '(\{.*\})'$/.exec(fake.started[0]!.argv.at(-1)!)![1]!;
    expect(JSON.parse(word).deadline).toBe(at('2026-11-03T06:45:00Z') - QUIET_MARGIN_MS);
    const vm = fakeRunner(machineScript({}));
    new BenchRun(VM(codeFile()), benchDeps(vm, 0).deps).serve(() => undefined);
    expect(JSON.parse(/serve '(\{.*\})'$/.exec(vm.started[0]!.argv.at(-1)!)![1]!).deadline).toBe(SERVE_MAX_MS);
  });
});
