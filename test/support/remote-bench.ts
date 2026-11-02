// The live bench's runner (P5 O7 M7, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M7's "The live bench" and
// its Decision Log entries of 2026-11-02): what the live mode of e2e/remote-latency.spec.ts does on one bench machine (the
// mini's `mini-bench`, the acceptance VM's `vm-bench`) before and after it measures, every remote step through the
// machine's transport and every process through one injected command runner, so test/support/remote-bench.test.ts proves
// it with fakes and nothing here reaches a machine on its own.
//
// Per machine, from its inputs (`BenchMachine`): a scratch `mawsd` from M7's head with its own profile, label and port,
// never the default profile, the label `dev.maws.mawsd`, `mawsd install` or ~/.local/bin/mawsd:
//   1. stage: on the VM the runner fetches the commit into its checkout, packs it (`pnpm mawsd:pack`) and starts the
//      pack's mawsd; on the mini, mini-ops starts it under the production mawsd's node runtime (no firewall dialog for a
//      new binary), and the runner prints that command and waits until the scratch daemon answers;
//   2. the bench agent (e2e/support/remote-bench-agent.ts, bundled here and copied over): it writes the latency stub's
//      wrapper and the scratch engine store's trust first (`prepare`, before the daemon starts), then (`serve`) starts
//      the stub's session over the scratch machine.sock and, once told the owner's member, lists it through the
//      harness's fake sminos on the scratch RL10 socket (e2e:remote's pattern), streaming the stub's samples back;
//   3. enroll: the code file streamed by its descriptor into `<transport> '<mawsd> enroll --profile … --label … --name
//      <name> --wait 900 --json'` (mawsd reads stdin without a TTY), exit 4 waited out by polling `endpoint status` until
//      org-listed or the code's TTL; the machine's key id shown for the owner to compare; the code file removed
//      whatever the outcome;
//   4. teardown, on every path: the agent ended (its stdin's end stops its session and ends its stubs), the VM's daemon
//      stopped; the profile kept until the bench is done (`removeProfile`), so a rerun reuses the enrollment, and then
//      removed only once no process on the machine names it (pgrep), else refused and kept.
//
// The machine's bounds (the desk track's conditions of 2026-11-02): every command writes and opens only under the
// scratch profile, the head checkout included, with its own home, temporary directory, sminos home and engine store
// there (`daemonEnv`, `profileEnv`); the runtime it runs on (on the mini the production mawsd's) is only run, never
// written; no `claude` runs (the daemon's engine under MAWS_E2E is MAWS_E2E_ENGINE_BIN alone) and no sminos; and no call
// reaches a machine inside its daily quiet window (the mini's 06:45 to 07:00 UTC by default), nor one that would run
// into it (an enroll's wait, a serve's span), refused before it starts.
//
// Secrets: a code is never read into this process, never in argv or an environment, never printed or logged: the file's
// descriptor is the child's stdin, and only the answer's parsed state, name and org are said. The transport is a
// machine's input, never hard-wired: the mini's plain non-TTY ssh, the VM's `devcloud vm ssh <vm> --` (its own key and
// host alias). SMINOS_RL10 and MAWS_USER_DATA are set only where the fake sminos and the scratch daemon run, and are
// taken out of every command the runner starts, so no real sminos it could reach reads them; the runner calls no sminos.
import { spawn } from 'node:child_process';
import { closeSync, openSync, rmSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export type Transport = { kind: 'ssh'; host: string } | { kind: 'devcloud'; vm: string };

export interface BenchMachine {
  /** the org's name for it, which the code was minted for (a name is bound to its ref for the org's life) */
  name: string;
  transport: Transport;
  /** where the scratch daemon comes from: the runner packs and starts it (the VM), or mini-ops starts it (the mini) */
  stage: 'runner' | 'mini-ops';
  /** this Mac's 0600 file holding the enrollment code */
  codeFile: string;
  /** the scratch profile on the machine, absolute */
  profile: string;
  label: string;
  /** the scratch endpoint's direct listener */
  port: number;
  /** M7's head checkout on the machine, and the commit it must be at */
  head: string;
  commit: string;
  /** the node runtime that runs the agent (on the mini, the production mawsd's) */
  node: string;
  /** the repository the VM's checkout is cloned from when it has none */
  repo?: string;
  /** a daily UTC window ("HH:MM", from, to) in which no call reaches the machine; the mini's is 06:45 to 07:00 */
  quietUtc?: readonly [string, string];
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
export interface Started {
  onLine(listener: (line: string) => void): void;
  write(line: string): void;
  end(): void;
  kill(): void;
  readonly exited: Promise<number | null>;
}
/** Every process the runner starts. `stdinFile`: a file whose descriptor is the child's stdin, never read here. */
export interface CommandRunner {
  run(argv: readonly string[], options?: { stdinFile?: string; timeoutMs?: number }): Promise<RunResult>;
  start(argv: readonly string[]): Started;
}

export const DEFAULT_LABEL = 'dev.maws.mawsd';
/** The mini's quiet window (its owner's, 2026-11-02): nothing on it from 06:45 to 07:00 UTC. */
export const MINI_QUIET_UTC = ['06:45', '07:00'] as const;
/** What a serve may run for, so it starts only when the quiet window is that far off. */
export const SERVE_SPAN_MS = 45 * 60_000;
const SOCKET_PATH_MAX_BYTES = 103; // src/engine-host/supervisor-files.ts's, so a socket never falls back out of the profile
const LONGEST_SOCKET = 'mawsd/engine-host.sock';
export const ENROLL_WAIT_S = 900; // the code's TTL
const STATUS_EVERY_MS = 5_000;
const START_WITHIN_MS = 10 * 60_000; // mini-ops' start, or the VM's pack's mawsd, answering
/** Variables the runner never passes on: sminos picks its endpoint from them, so they belong to the fake and the scratch daemon. */
export const WITHHELD_ENV = ['SMINOS_RL10', 'MAWS_USER_DATA'] as const;

/** One word for a POSIX shell, single-quoted. */
export const quote = (word: string): string => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`);

/** The argv that runs `command` (one shell line) on the machine. */
export function transportArgv(transport: Transport, command: string): string[] {
  return transport.kind === 'ssh' ? ['ssh', '-T', '-o', 'BatchMode=yes', transport.host, command] : ['devcloud', 'vm', 'ssh', transport.vm, '--', command];
}

/** Why a machine's inputs are refused, each one line; empty when they stand. */
export function machineProblems(m: BenchMachine): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(m.name)) problems.push(`name ${m.name} is not a machine name`);
  if (m.label === DEFAULT_LABEL || !/^[\w.-]+$/.test(m.label)) problems.push(`label ${m.label} is the default profile’s, or not a label`);
  for (const [what, path] of [['profile', m.profile], ['head', m.head], ['node', m.node], ['code file', m.codeFile]] as const) if (!isAbsolute(path)) problems.push(`${what} ${path} is not absolute`);
  if (/\/(Library\/Application Support|\.config)\/MAWS\/?$/.test(m.profile)) problems.push(`profile ${m.profile} is a default profile`);
  if (/\.local\/bin\/mawsd$/.test(m.node)) problems.push(`node ${m.node} is the installed mawsd`);
  if (!Number.isSafeInteger(m.port) || m.port < 1024 || m.port > 65535) problems.push(`port ${m.port} is not a free-range port`);
  if (!/^[0-9a-f]{40}$/.test(m.commit)) problems.push(`commit ${m.commit} is not a full sha`);
  if (m.stage === 'runner' && m.transport.kind !== 'devcloud') problems.push('the runner stages only a devcloud VM; the mini is mini-ops’');
  if (!m.head.startsWith(`${m.profile}/`)) problems.push(`head ${m.head} is not under the scratch profile, where every write stays`);
  if (Buffer.byteLength(`${m.profile}/${LONGEST_SOCKET}`) > SOCKET_PATH_MAX_BYTES) problems.push(`profile ${m.profile} is too long for its sockets, which would fall back out of it`);
  if (/['"\\$`\s]/.test(m.profile)) problems.push(`profile ${m.profile} holds a quote, a space or a shell character`);
  const quiet = quietOf(m);
  if (quiet !== null && !quiet.every((at) => /^([01]\d|2[0-3]):[0-5]\d$/.test(at))) problems.push(`quiet window ${quiet.join('–')} is not two UTC times HH:MM`);
  return problems;
}

/** The machine's quiet window: its own, else the mini's for a mini-ops machine, else none. */
export const quietOf = (m: BenchMachine): readonly [string, string] | null => m.quietUtc ?? (m.stage === 'mini-ops' ? MINI_QUIET_UTC : null);

/** Whether [at, at + spanMs] meets the daily UTC window [from, to) (a window past midnight wraps). */
export function meetsQuiet(window: readonly [string, string], at: number, spanMs: number): boolean {
  const minute = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
  const [from, to] = window.map(minute) as [number, number];
  const length = ((to - from + 1440) % 1440) * 60_000;
  const day = Math.floor(at / 86_400_000) * 86_400_000;
  for (const start of [day - 86_400_000, day, day + 86_400_000].map((d) => d + from * 60_000)) if (at < start + length && start < at + spanMs) return true;
  return false;
}

/** The machine's bench files: the agent, the stub's wrapper and samples, the VM's pack, the daemon's output. */
export const benchDir = (m: BenchMachine) => `${m.profile}/bench`;
const packDir = (m: BenchMachine) => `${benchDir(m)}/pack`;
const packPath = (m: BenchMachine) => `${benchDir(m)}/pack-path`;
/** The scratch daemon's program, on the VM its pack's runtime and entry (read from where the pack was recorded). */
const mawsdEntry = (m: BenchMachine) => (m.stage === 'runner' ? `"$(cat ${quote(packPath(m))})/runtime/bin/node" "$(cat ${quote(packPath(m))})/out/main/mawsd.js"` : `${quote(m.node)} ${quote(`${m.head}/out/main/mawsd.js`)}`);
/** A command of the scratch daemon's (status, keys, enroll), in the profile's home and temporary directory. */
const mawsd = (m: BenchMachine) => `env ${envWords(profileEnv(m))} ${mawsdEntry(m)}`;
/** The bench agent's command, on the machine's runtime. */
const agent = (m: BenchMachine, command: 'prepare' | 'serve', engineVersion: string) => `env ${envWords(profileEnv(m))} ${quote(m.node)} ${quote(`${benchDir(m)}/bench-agent.cjs`)} ${command} ${quote(agentArgs(m, engineVersion))}`;
const scoped = (m: BenchMachine) => `--profile ${quote(m.profile)} --label ${quote(m.label)}`;

/**
 * The scratch daemon's environment: its own profile, store, label and listener, the latency stub as its engine (under
 * MAWS_E2E the engine is MAWS_E2E_ENGINE_BIN and nothing else, so no `claude` runs), and a home, temporary directory,
 * sminos home, usage directory and shell home of its own, so what it reads by the home (an engine store, settings) and
 * writes anywhere stays in the profile. ELECTRON_RUN_AS_NODE: the mini's runtime may be the production app's Electron.
 */
export function daemonEnv(m: BenchMachine): Record<string, string> {
  return {
    ...profileEnv(m),
    MAWS_USER_DATA: m.profile,
    MAWS_MAWSD_LABEL: m.label,
    CLAUDE_CONFIG_DIR: `${m.profile}/claude-config`,
    MAWS_CLAUDE_USAGE_DIR: `${m.profile}/claude-usage`,
    SMINOS_HOME: `${m.profile}/sminos`,
    ZDOTDIR: `${m.profile}/shell-home`,
    HISTFILE: `${m.profile}/shell-home/.sh_history`,
    MAWS_E2E: '1',
    MAWS_E2E_ENGINE_BIN: `${benchDir(m)}/latency-engine`,
    MAWS_ENDPOINT_DIRECT: '1',
    MAWS_ENDPOINT_PORT: String(m.port),
    MAWS_MACHINE_NAME: m.name,
  };
}
/** Every remote process's own home and temporary directory, in the profile, and the runtime run as Node. */
const profileEnv = (m: BenchMachine): Record<string, string> => ({ HOME: `${m.profile}/home`, TMPDIR: `${m.profile}/tmp`, ELECTRON_RUN_AS_NODE: '1' });
const envWords = (env: Record<string, string>) => Object.entries(env).map(([k, v]) => `${k}=${quote(v)}`).join(' ');

/** The line that starts the scratch daemon in the background on the machine, its pid recorded beside it. */
export function startLine(m: BenchMachine, entry: string): string {
  const out = `${benchDir(m)}/mawsd.out`;
  const dirs = ['mawsd', 'home', 'tmp', 'sminos', 'shell-home', 'claude-usage'].map((d) => quote(`${m.profile}/${d}`)).join(' ');
  return `mkdir -p ${dirs} && cd ${quote(benchDir(m))} && env ${envWords(daemonEnv(m))} nohup ${entry} run --private --dir ${quote(`${m.profile}/mawsd`)} > ${quote(out)} 2>&1 < /dev/null & echo $! > ${quote(`${benchDir(m)}/mawsd.pid`)}`;
}

export interface BenchDeps {
  runner: CommandRunner;
  /** the version the latency stub answers `--version` with (test/support/engine-pin's FIXTURE_ENGINE_VERSION) */
  engineVersion: string;
  /** a line for the operator's terminal (never a code) */
  say(line: string): void;
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The bench's hold on one machine: each step, and the teardown its steps registered, last first. */
export class BenchRun {
  readonly #m: BenchMachine;
  readonly #deps: BenchDeps;
  readonly #teardown: { what: string; step: () => Promise<void> }[] = [];
  #agent: Started | null = null;

  constructor(machine: BenchMachine, deps: BenchDeps) {
    const problems = machineProblems(machine);
    if (problems.length > 0) throw new Error(`the bench machine's inputs are refused:\n${problems.join('\n')}`);
    this.#m = machine;
    this.#deps = deps;
  }

  get machine(): BenchMachine {
    return this.#m;
  }

  #remote(command: string, options?: { stdinFile?: string; timeoutMs?: number }): Promise<RunResult> {
    this.#quiet(options?.timeoutMs ?? 0);
    return this.#deps.runner.run(transportArgv(this.#m.transport, command), options);
  }
  /** Refuses a call that would reach the machine inside its quiet window, now or within `spanMs`. */
  #quiet(spanMs: number): void {
    const window = quietOf(this.#m);
    if (window !== null && meetsQuiet(window, this.#now(), spanMs)) throw new Error(`${this.#m.name}: refused: nothing reaches it from ${window[0]} to ${window[1]} UTC, and this call would run into that window`);
  }
  async #must(command: string, what: string, options?: { stdinFile?: string; timeoutMs?: number }): Promise<RunResult> {
    const result = await this.#remote(command, options);
    if (result.code !== 0) throw new Error(`${this.#m.name}: ${what} failed (exit ${result.code}): ${result.stderr.trim().slice(-600)}`);
    return result;
  }
  #sleep(ms: number) {
    return (this.#deps.sleep ?? sleepFor)(ms);
  }
  #now() {
    return (this.#deps.now ?? Date.now)();
  }

  /** Copies the agent's bundle (a local file) to the machine and runs its `prepare`: the stub's wrapper, the store's trust. */
  async prepare(agentBundle: string): Promise<void> {
    const m = this.#m;
    await this.#must(`mkdir -p ${quote(benchDir(m))} && cat > ${quote(`${benchDir(m)}/bench-agent.cjs`)}`, 'copying the bench agent', { stdinFile: agentBundle });
    await this.#must(agent(m, 'prepare', this.#deps.engineVersion), 'the bench agent’s prepare');
    this.#deps.say(`[bench] ${m.name}: the bench agent is in place`);
  }

  /** The scratch daemon from M7's head: packed and started here on the VM; on the mini, mini-ops' start waited for. */
  async stage(): Promise<void> {
    const m = this.#m;
    if (m.stage === 'runner') {
      const repo = m.repo ?? 'https://github.com/SSFSKIM/MAWS.git';
      await this.#must(`test -d ${quote(`${m.head}/.git`)} || git clone --quiet ${quote(repo)} ${quote(m.head)}`, 'the checkout', { timeoutMs: 10 * 60_000 });
      await this.#must(`cd ${quote(m.head)} && git fetch --quiet origin ${quote(m.commit)} && git checkout --quiet --detach ${quote(m.commit)} && test "$(git rev-parse HEAD)" = ${quote(m.commit)}`, `M7's head ${m.commit.slice(0, 9)}`, { timeoutMs: 10 * 60_000 });
      // pnpm's store and the downloads' caches in the profile too (the pack's own downloads are under --out)
      const caches = envWords({ npm_config_store_dir: `${m.profile}/pnpm-store`, XDG_CACHE_HOME: `${m.profile}/cache`, ELECTRON_CACHE: `${m.profile}/cache/electron` });
      const packed = await this.#must(`cd ${quote(m.head)} && env ${caches} pnpm install --frozen-lockfile >&2 && env ${caches} pnpm --silent mawsd:pack --out ${quote(packDir(m))}`, 'the pack (pnpm mawsd:pack)', { timeoutMs: 30 * 60_000 });
      const pack = packed.stdout.trim().split('\n').at(-1) ?? '';
      if (!pack.startsWith(packDir(m))) throw new Error(`${m.name}: the pack printed no path under ${packDir(m)}`);
      await this.#must(`printf '%s' ${quote(pack)} > ${quote(packPath(m))}`, 'recording the pack');
      await this.#must(startLine(m, mawsdEntry(m)), 'starting the scratch mawsd');
      this.#teardown.push({ what: 'the scratch mawsd', step: () => this.#stopDaemon() });
    } else {
      this.#deps.say(`[bench] ${m.name}: mini-ops starts the scratch mawsd from ${m.head} at ${m.commit.slice(0, 9)} under the production mawsd's node runtime, with:`);
      this.#deps.say(`[bench]   ${startLine(m, mawsdEntry(m))}`);
      this.#deps.say(`[bench] ${m.name}: waiting for it to answer on ${m.profile}`);
      this.#teardown.push({ what: 'the scratch mawsd', step: async () => this.#deps.say(`[bench] ${m.name}: mini-ops stops the scratch mawsd: kill "$(cat ${benchDir(m)}/mawsd.pid)"`) });
    }
    const deadline = this.#now() + START_WITHIN_MS;
    for (;;) {
      const status = await this.#remote(`${mawsd(m)} status ${scoped(m)} --json`);
      if (status.code === 0) break;
      if (this.#now() > deadline) throw new Error(`${m.name}: the scratch mawsd did not answer within ${START_WITHIN_MS / 60_000} minutes`);
      await this.#sleep(STATUS_EVERY_MS);
    }
    this.#deps.say(`[bench] ${m.name}: the scratch mawsd answers`);
  }

  async #stopDaemon(): Promise<void> {
    const m = this.#m;
    await this.#remote(`pid=$(cat ${quote(`${benchDir(m)}/mawsd.pid`)} 2>/dev/null) && kill "$pid" 2>/dev/null; for i in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || exit 0; sleep 1; done; kill -9 "$pid" 2>/dev/null; true`);
  }

  async #enrollment(): Promise<{ enrollment: string; name?: string; org?: string } | null> {
    const m = this.#m;
    const status = await this.#remote(`${mawsd(m)} endpoint status ${scoped(m)} --json`);
    if (status.code !== 0) return null;
    try {
      const { enrollment, name, org } = JSON.parse(status.stdout) as { enrollment: string; name?: string; org?: string };
      return { enrollment, ...(name === undefined ? {} : { name }), ...(org === undefined ? {} : { org }) };
    } catch {
      return null;
    }
  }

  /**
   * The machine enrolled and listed under its name: skipped when the scratch profile already is (a rerun); else the code
   * file streamed into `mawsd enroll`, exit 4 waited out, the key id shown, and the code file removed whatever happened.
   */
  async enroll(): Promise<void> {
    const m = this.#m;
    const before = await this.#enrollment();
    if (before?.enrollment === 'org-listed' && before.name === m.name) {
      // the code is not needed, and a secret is not left at rest for nothing
      rmSync(m.codeFile, { force: true });
      this.#deps.say(`[bench] ${m.name}: already enrolled and listed in ${before.org ?? 'the org'} (the profile is kept between runs); the unused code file is removed`);
      return;
    }
    const enrollMs = (ENROLL_WAIT_S + 60) * 1000;
    this.#quiet(enrollMs); // before the code is taken: a refused enroll leaves its file for the next try
    const started = this.#now();
    let code: number | null;
    let answer: { enrollment?: string; name?: string; org?: string } = {};
    try {
      this.#deps.say(`[bench] ${m.name}: enrolling with the code from its file (the owner compares the key below and types y)`);
      const result = await this.#remote(`${mawsd(m)} enroll ${scoped(m)} --name ${quote(m.name)} --wait ${ENROLL_WAIT_S} --json`, { stdinFile: m.codeFile, timeoutMs: enrollMs });
      code = result.code;
      try {
        const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
        answer = { ...(typeof parsed.enrollment === 'string' && { enrollment: parsed.enrollment }), ...(typeof parsed.name === 'string' && { name: parsed.name }), ...(typeof parsed.org === 'string' && { org: parsed.org }) };
      } catch {
        // its words are not said: only the parsed state, name and org are
      }
    } finally {
      rmSync(m.codeFile, { force: true });
      this.#deps.say(`[bench] ${m.name}: the code file is removed`);
    }
    this.#deps.say(`[bench] ${m.name}: enroll exited ${code}${answer.enrollment === undefined ? '' : `: ${answer.enrollment}, ${answer.name ?? '?'} in ${answer.org ?? '?'}`}`);
    if (code !== 0 && code !== 4) throw new Error(`${m.name}: enroll failed (exit ${code}); its own output is not shown, read it with \`mawsd endpoint status\` there`);
    await this.showKey();
    if (code === 0) return;
    const deadline = started + ENROLL_WAIT_S * 1000;
    for (;;) {
      // after every wait the decision is asked again: listed now, under this name
      const now = await this.#enrollment();
      if (now?.enrollment === 'org-listed' && now.name === m.name) {
        this.#deps.say(`[bench] ${m.name}: listed in ${now.org ?? 'the org'}`);
        return;
      }
      if (this.#now() > deadline) throw new Error(`${m.name}: not listed in the org within the code's ${ENROLL_WAIT_S} s (state ${now?.enrollment ?? 'unread'})`);
      await this.#sleep(STATUS_EVERY_MS);
    }
  }

  /** The machine's key id, from `mawsd keys`, for the owner to compare with what their terminal shows. */
  async showKey(): Promise<void> {
    const m = this.#m;
    const keys = await this.#remote(`${mawsd(m)} keys ${scoped(m)} --json`);
    let id: string | null;
    try {
      id = (JSON.parse(keys.stdout) as { key?: { keyId?: string } | null }).key?.keyId ?? null;
    } catch {
      id = null;
    }
    this.#deps.say(id === null ? `[bench] ${m.name}: no key id to compare yet (keys exited ${keys.code})` : `[bench] ${m.name}: the machine's key id, to compare: ${id}`);
  }

  /** The agent's `serve`: the stub's session started, listed once `list` names the owners; its lines to `onLine`. */
  serve(onLine: (line: string) => void): Started {
    const m = this.#m;
    this.#quiet(SERVE_SPAN_MS);
    const serving = this.#deps.runner.start(transportArgv(m.transport, agent(m, 'serve', this.#deps.engineVersion)));
    serving.onLine(onLine);
    this.#agent = serving;
    this.#teardown.push({
      what: 'the bench agent',
      step: async () => {
        serving.end();
        const done = await Promise.race([serving.exited, this.#sleep(15_000).then(() => 'late' as const)]);
        if (done === 'late') serving.kill();
      },
    });
    return serving;
  }

  /** Tells the agent the owner's member, so its fake sminos lists the session. */
  list(owners: readonly string[], title: string): void {
    if (this.#agent === null) throw new Error('the bench agent is not serving');
    this.#agent.write(JSON.stringify({ list: { owners, title } }));
  }

  /** Every resource this run holds, ended, last first; each step's failure is said and the rest still run. */
  async teardown(): Promise<void> {
    for (const { what, step } of this.#teardown.splice(0).reverse()) {
      try {
        await step();
      } catch (error) {
        this.#deps.say(`[bench] ${this.#m.name}: ending ${what} failed: ${(error as Error).message}`);
      }
    }
    this.#deps.say(`[bench] ${this.#m.name}: torn down; the scratch profile ${this.#m.profile} is kept until the bench is done`);
  }

  /** The pids of every process on the machine whose arguments name the scratch profile (the bench's: daemon, agent, stub). */
  async benchProcesses(): Promise<string[]> {
    const m = this.#m;
    // `[/]…`: the shell that runs pgrep carries the pattern in its own arguments, which the pattern then doesn't match
    const pattern = `[${m.profile[0]}]${m.profile.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
    const found = await this.#remote(`pgrep -f -- ${quote(pattern)} || true`);
    if (found.code !== 0) throw new Error(`${m.name}: pgrep failed (exit ${found.code})`);
    return found.stdout.split('\n').map((line) => line.trim()).filter((line) => /^\d+$/.test(line));
  }

  /**
   * Once the bench is done: the scratch profile removed (the VM's here; the mini's by mini-ops), unless a bench process
   * still lives on the machine, when it refuses, saying so, and leaves the profile. True when the profile goes.
   */
  async removeProfile(): Promise<boolean> {
    const m = this.#m;
    if (m.stage === 'runner') await this.#stopDaemon();
    const left = await this.benchProcesses();
    if (left.length > 0) {
      this.#deps.say(`[bench] ${m.name}: refused to remove the scratch profile: ${left.length} bench process${left.length === 1 ? '' : 'es'} still run${left.length === 1 ? 's' : ''} there (pids ${left.join(', ')}); ${m.stage === 'mini-ops' ? `mini-ops stops them (kill "$(cat ${benchDir(m)}/mawsd.pid)" for the daemon)` : 'end them'} and remove it again`);
      return false;
    }
    if (m.stage === 'mini-ops') {
      this.#deps.say(`[bench] ${m.name}: no bench process is left; mini-ops removes the scratch profile: rm -rf ${quote(m.profile)}`);
      return true;
    }
    await this.#must(`rm -rf ${quote(m.profile)}`, 'removing the scratch profile');
    this.#deps.say(`[bench] ${m.name}: the scratch profile is removed`);
    return true;
  }
}

/** The agent's arguments, one JSON word: what it needs of the machine, no secret. */
export function agentArgs(m: BenchMachine, engineVersion: string): string {
  return JSON.stringify({ name: m.name, profile: m.profile, bench: benchDir(m), head: m.head, engineVersion });
}

/** Commands on this Mac's processes, every child's environment without WITHHELD_ENV. */
export function processRunner(env: NodeJS.ProcessEnv = process.env): CommandRunner {
  const childEnv = (): NodeJS.ProcessEnv => {
    const copy = { ...env };
    for (const name of WITHHELD_ENV) delete copy[name];
    return copy;
  };
  return {
    run(argv, options = {}) {
      return new Promise((resolve, reject) => {
        const fd = options.stdinFile === undefined ? null : openSync(options.stdinFile, 'r');
        let child;
        try {
          child = spawn(argv[0]!, argv.slice(1), { env: childEnv(), stdio: [fd ?? 'ignore', 'pipe', 'pipe'] });
        } finally {
          if (fd !== null) closeSync(fd); // the child holds its own copy of the descriptor
        }
        let [stdout, stderr] = ['', ''];
        child.stdout!.on('data', (chunk: Buffer) => void (stdout += chunk.toString()));
        child.stderr!.on('data', (chunk: Buffer) => void (stderr += chunk.toString()));
        const timer = options.timeoutMs === undefined ? null : setTimeout(() => child.kill('SIGTERM'), options.timeoutMs);
        child.once('error', (error) => {
          if (timer !== null) clearTimeout(timer);
          reject(error);
        });
        child.once('close', (code) => {
          if (timer !== null) clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
      });
    },
    start(argv) {
      const child = spawn(argv[0]!, argv.slice(1), { env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
      const listeners = new Set<(line: string) => void>();
      let buffer = '';
      child.stdout!.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          for (const listener of listeners) listener(line);
        }
      });
      child.stderr!.on('data', () => undefined); // the agent's diagnostics stay on the machine's side
      child.stdin!.on('error', () => undefined);
      const exited = new Promise<number | null>((resolve) => child.once('close', resolve));
      return {
        onLine: (listener) => void listeners.add(listener),
        write: (line) => void child.stdin!.write(`${line}\n`),
        end: () => void child.stdin!.end(),
        kill: () => void child.kill('SIGKILL'),
        exited,
      };
    },
  };
}
