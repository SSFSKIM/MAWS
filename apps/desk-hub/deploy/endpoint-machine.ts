// The machine the endpoint acceptance run (endpoint-acceptance.ts; P5 O10 M11) drives: the scratch `mawsd` it enrolls,
// the sminos beside it and the lane A session under that sminos. `EndpointMachine` is what the items ask of it; the
// devcloud acceptance VM's implementation (`VmMachine`) runs each step as the scene's own script, `vm/scene.sh`, which
// `vm/setup.sh` installs as /opt/o10-m11/scene.sh, through `devcloud vm ssh <vm> [--root] < <file>` and nothing else
// (P5 DL 103): a script file of mode 0600 written under the run's scratch directory and unlinked as soon as devcloud has
// it open, so a file that held a secret (an enrollment code) is gone before the step ends, and the secret reaches no
// argument of any process here or on the VM (`printf` is the shell's builtin). Every step is bounded.
//
// A step's script prints its own lines between `@@BEGIN` and `@@END <status>`, so the VM's login banner and devcloud's
// own words are never read as the step's.
import { spawn } from 'node:child_process';
import { closeSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The endpoint's `status()` as `mawsd endpoint status --json` prints it (O10 M2's shape). */
export type EndpointStatus = {
  enrollment: 'none' | 'hub-confirmed' | 'org-listed';
  name?: string;
  org?: string;
  stateVersion?: number;
  hub: { connected: boolean; generation?: number };
  channels: { relayed: number; direct: number };
  rl10: { connected: boolean };
  listener: { bound: boolean };
  refusing?: string;
};

/** What the items read of the machine's sminos: only where a real one runs (the VM), null in the local proof. */
export interface SminosProbe {
  /** `sminos daemon status`'s lines, and whether `daemon/hub.json` exists (a DX2 credential: it never may here). */
  status(): Promise<{ lines: string[]; hubJson: boolean }>;
  /** `daemon/revoked.json` (RL10's revocations as sminos keeps them), or null when it has none. */
  revoked(): Promise<{ version?: number; devices?: string[]; members?: string[]; keys?: string[] } | null>;
  /** How many events in sminos's project logs hold `token` (a person's words it imported). */
  imported(token: string): Promise<number>;
  /** daemon.log's size now, and its lines after a size. */
  logMark(): Promise<number>;
  logSince(mark: number): Promise<string[]>;
  /** The lane A session's engine ended (its bridge with it), and started again on the same session. */
  stopSession(): Promise<void>;
  resumeSession(): Promise<{ launch: string }>;
  /** A local `sminos spawn <alias>` from the lane A project's checkout, as a terminal session's Bash runs one. */
  localSpawn(alias: string): Promise<{ rc: number; lines: string[] }>;
  /** That spawned session retired again. */
  retire(alias: string): Promise<void>;
}

/** The lane A source: one terminal session under the machine's sminos. */
export interface LaneAScene {
  /** sminos and the session up in `project` (the machine enrolled and listed first); the session's ids, its alias and
   * its checkout. */
  up(project: { id: string; name: string }): Promise<{ session: string; launch: string; alias: string; checkout: string }>;
  /**
   * A stretch of `count` rows the session goes on writing by itself (on the VM: a tool loop against the stub model,
   * asked for through `send`, the device's own `sminos.send`), so rows keep coming while the run cuts its links.
   */
  ticks(count: number, tag: string, send: (text: string) => Promise<void>): Promise<void>;
  /** The producer's own record of the session: its transcript's row uuids, in order. */
  rows(session: string): Promise<string[]>;
  /** How many times a send whose text ends in `token` (a marker the run made) reached the session as a user's row. */
  count(session: string, token: string): Promise<number>;
  sminos: SminosProbe | null;
}

export interface EndpointMachine {
  /** What the run prints for it. */
  readonly label: string;
  /** The direct listener as the device dials it (the machine's tailnet address and the scratch port). */
  readonly directUrl: string;
  /** A fresh scratch `mawsd` serving, unenrolled. */
  up(): Promise<void>;
  /** `mawsd enroll --name <name> --wait 300 --json` with `code` on its stdin; its JSON answer. */
  enroll(code: string, name: string): Promise<Record<string, unknown>>;
  keys(): Promise<Record<string, unknown>>;
  status(): Promise<EndpointStatus>;
  /** `mawsd restart`, and the daemon serving again. */
  restart(): Promise<void>;
  /** `mawsd endpoint policy` set (or only read, with nothing given). */
  policy(set?: { readOnly?: boolean; ceiling?: string }): Promise<{ read_only: boolean; ceiling: string }>;
  /** The endpoint's RL1 socket closed by force from the machine's end; what was cut. */
  cutHubSocket(): Promise<string>;
  /** mawsd.log's size now, and its lines after a size. */
  logMark(): Promise<number>;
  logSince(mark: number): Promise<string[]>;
  /** The local addresses the direct listener is bound to. */
  listening(): Promise<string[]>;
  laneA: LaneAScene;
  /** Everything of the scene stopped and removed; what could not be. */
  down(): Promise<string[]>;
  /**
   * Waits until nothing the run asked of the machine is still running (after the run's end cancelled it), at most
   * `ms`; what still runs then, by name.
   */
  settle(ms?: number): Promise<string[]>;
}

// ---- the steps -------------------------------------------------------------------------------------------------------

export type Ssh = { devcloud: string; vm: string };
export type StepResult = { rc: number; lines: string[] };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A step's script: its body's output (stdout and stderr) between the markers, and its status after them. */
function stepScript(body: string): string {
  return `#!/bin/bash\nset -uo pipefail\necho "@@BEGIN"\n{\n${body}\n} 2>&1\nrc=$?\necho "@@END $rc"\n`;
}

/**
 * A script carrying `files` (base64, unpacked into a fresh stage directory, `$STAGE`) and running `body` after them,
 * with the step markers; the stage directory is removed however the body ends. For `vm/setup.sh`'s payloads.
 */
export function composeScript(body: string, files: Record<string, Buffer>, { trace = 'step' }: { trace?: string } = {}): string {
  const parts = [`STAGE=$(mktemp -d /tmp/o10-m11-${trace}.XXXXXX) || exit 1`, 'trap \'rm -rf "$STAGE"\' EXIT', 'chmod 700 "$STAGE"'];
  for (const [name, bytes] of Object.entries(files)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.')) throw new Error(`a file name in the stage directory, not ${name}`);
    parts.push(`base64 -d > "$STAGE/${name}" <<'O10_M11_B64'\n${bytes.toString('base64').replace(/(.{76})/g, '$1\n')}\nO10_M11_B64`);
  }
  parts.push(body);
  return stepScript(parts.join('\n'));
}

/**
 * Runs steps on the VM: each script written to `dir` (mode 0600), handed to `devcloud vm ssh <vm> [--root]` as its
 * stdin, and unlinked as soon as devcloud has it open. `log` hears one line per step, its name and status, never its
 * script or output.
 */
export class ScriptRunner {
  #n = 0;
  /** The steps running, each by its name. */
  readonly #inflight = new Map<Promise<unknown>, string>();
  constructor(
    readonly ssh: Ssh,
    private readonly dir: string,
    private readonly log: (line: string) => void = () => {},
    /**
     * The run's interruption: `gate` refuses a new step once the run is interrupted (outside its cleanup; proof.ts's
     * `Cleanup.check`), and `signal` cancels the steps running when it aborts.
     */
    private readonly options: { gate?: () => void; signal?: AbortSignal } = {},
  ) {}

  /**
   * Waits until no step is running, at most `ms`; the names of those still running then (none: every step ended, and a
   * cancelled one only once its whole process group was gone). A step still running here is not proof its script on
   * the VM ended: the scene's `down` stops the scene's verbs still running there.
   */
  async settle(ms = 15_000): Promise<string[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled([...this.#inflight.keys()]), new Promise((done) => (timer = setTimeout(done, ms)))]);
    clearTimeout(timer);
    return [...this.#inflight.values()];
  }

  /** The step's lines and status; throws when it never reached its end marker, ran past `ms`, or was cancelled. */
  step(name: string, body: string, options: { root?: boolean; secret?: string; ms?: number; composed?: boolean } = {}): Promise<StepResult> {
    try {
      this.options.gate?.();
    } catch (error) {
      return Promise.reject(error as Error);
    }
    const running = this.#step(name, body, options);
    this.#inflight.set(running, name);
    void running.then(
      () => this.#inflight.delete(running),
      () => this.#inflight.delete(running),
    );
    return running;
  }

  async #step(name: string, body: string, { root = false, secret, ms = 120_000, composed = false }: { root?: boolean; secret?: string; ms?: number; composed?: boolean }): Promise<StepResult> {
    const file = join(this.dir, `${name.replace(/[^a-z0-9-]/gi, '-')}-${process.pid}-${++this.#n}.sh`);
    writeFileSync(file, composed ? body : stepScript(body), { mode: 0o600, flag: 'wx' });
    let fd: number;
    try {
      fd = openSync(file, 'r');
    } finally {
      unlinkSync(file); // the open descriptor keeps the bytes for devcloud; no name points at them any longer
    }
    const args = ['vm', 'ssh', this.ssh.vm, ...(root ? ['--root'] : [])];
    const started = Date.now();
    // A step that started before the run was interrupted is cancelled by it; one the cleanup starts (the signal aborted
    // already) runs to its own bound.
    const signal = this.options.signal?.aborted === false ? this.options.signal : undefined;
    const { code, out } = await new Promise<{ code: number | null; out: string }>((resolve, reject) => {
      // Its own process group, so a kill reaches what devcloud started (its `ssh`), not devcloud alone.
      const child = spawn(this.ssh.devcloud, args, { stdio: [fd, 'pipe', 'pipe'], detached: true });
      closeSync(fd);
      let out = '';
      child.stdout!.setEncoding('utf8').on('data', (chunk: string) => (out += chunk));
      child.stderr!.resume(); // devcloud's own words: not the step's
      let settled = false;
      const timers: Array<ReturnType<typeof setTimeout>> = [];
      const finish = (outcome: { code: number | null } | Error) => {
        if (settled) return;
        settled = true;
        for (const t of timers) clearTimeout(t);
        signal?.removeEventListener('abort', onAbort);
        if (outcome instanceof Error) {
          child.stdout!.destroy();
          child.stderr!.destroy();
          reject(outcome);
        } else resolve({ code: outcome.code, out });
      };
      const group = (sig: NodeJS.Signals | 0): boolean => {
        try {
          process.kill(-child.pid!, sig);
          return true;
        } catch {
          return false; // the group is gone
        }
      };
      /**
       * Ends the step: the group sent TERM, then KILL at 2 s whatever devcloud's own exit does (a child may ignore
       * TERM, and may hold none of the pipes whose closing reports that exit), and the step ended only once no
       * process of the group is left, or on a deadline of its own that says one outlived the KILL.
       */
      let ended: Error | null = null;
      const end = (why: Error) => {
        if (ended !== null) return;
        ended = why;
        group('SIGTERM');
        const escalate = setTimeout(() => group('SIGKILL'), 2000);
        const deadline = Date.now() + 6000;
        const watch = () => {
          if (!group(0)) {
            clearTimeout(escalate);
            return finish(why);
          }
          if (Date.now() > deadline) return finish(new Error(`${why.message}; a process of its group (${child.pid}) outlived SIGKILL`));
          timers.push(setTimeout(watch, 100));
        };
        timers.push(setTimeout(watch, 100));
      };
      const onAbort = () => end(new Error(`the step ${name} on ${this.ssh.vm} was cancelled: ${(signal!.reason as Error | undefined)?.message ?? 'the run was interrupted'}`));
      signal?.addEventListener('abort', onAbort, { once: true });
      timers.push(setTimeout(() => end(new Error(`the step ${name} on ${this.ssh.vm} took longer than ${ms / 1000} s`)), ms));
      child.once('error', (error) => finish(error));
      child.once('close', (exit) => {
        if (ended === null) finish({ code: exit });
      });
    });
    const lines = out.split('\n');
    const begin = lines.indexOf('@@BEGIN');
    const end = lines.findIndex((line, i) => i > begin && /^@@END -?\d+$/.test(line));
    if (begin < 0 || end < 0) throw new Error(`the step ${name} on ${this.ssh.vm} ended before its end (devcloud exit ${code})`);
    const said = lines.slice(begin + 1, end).map((line) => (secret !== undefined && line.includes(secret) ? line.split(secret).join('<secret>') : line));
    const rc = Number(lines[end].slice('@@END '.length));
    this.log(`vm ${this.ssh.vm}: ${name} exited ${rc} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return { rc, lines: said };
  }
}

/**
 * The run's end, however it ended (an item's failure as much as a signal): what the machine still runs for it
 * cancelled, and settled before anything is undone, so no step lands after the teardown; a line for each step still
 * running when settling ran out of time.
 */
export async function stopMachineWork(run: { interrupt(why: string): void }, machine: Pick<EndpointMachine, 'label' | 'settle'>, status: number): Promise<string[]> {
  run.interrupt(status === 0 ? 'the run ended' : 'the run failed');
  return (await machine.settle()).map((step) => `the step ${step} on ${machine.label} still ran when the run ended; the scene’s down stops it there`);
}

// ---- the VM ----------------------------------------------------------------------------------------------------------

/** Where `vm/setup.sh` installs the scene's script. */
export const SCENE = '/opt/o10-m11/scene.sh';
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const CEILINGS = new Set(['plan', 'default', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions', 'settings']);
/** An enrollment code's alphabet (`smns-enroll-v2.` and base64url): nothing a single-quoted word could end on. */
const CODE = /^[A-Za-z0-9._-]+$/;

/** The last lines of a step, for a refusal's message. */
const tail = (r: StepResult) => r.lines.slice(-4).join(' / ').slice(0, 400);

function jsonLine(name: string, r: StepResult): Record<string, unknown> {
  for (const line of [...r.lines].reverse()) {
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      // not the JSON line
    }
  }
  throw new Error(`${name} printed no JSON: ${tail(r)}`);
}

/**
 * The scratch `mawsd` on the devcloud acceptance VM, as `vm/scene.sh` runs it: a user of its own (`o10acc`), a scratch
 * profile, the direct listener on the scratch port, sminos and the lane A session beside it, all in a private mount
 * namespace that hides the VM's managed settings from every engine the scene starts.
 */
export class VmMachine implements EndpointMachine {
  readonly label: string;
  readonly directUrl: string;
  readonly runner: ScriptRunner;
  readonly laneA: LaneAScene;
  readonly #script: string;

  /** `options.script` is the scene's script on the VM: the scratch scene's (SCENE) unless named. */
  /** `gate` and `signal` are the run's interruption (ScriptRunner's). */
  constructor(ssh: Ssh, scratchDir: string, options: { directUrl: string; log?: (line: string) => void; script?: string; label?: string; gate?: () => void; signal?: AbortSignal }) {
    this.runner = new ScriptRunner(ssh, scratchDir, options.log, { gate: options.gate, signal: options.signal });
    this.directUrl = options.directUrl;
    this.#script = options.script ?? SCENE;
    this.label = options.label ?? `the scratch mawsd on ${ssh.vm}`;
    this.laneA = new VmLaneA(this);
  }

  /** A scene verb as root, its words checked by the caller; throws on a non-zero status unless `allow` holds it. */
  async scene(verb: string, args: string[] = [], { ms, allow = [0], input, what }: { ms?: number; allow?: number[]; input?: string; what?: string } = {}): Promise<StepResult> {
    for (const arg of [verb, ...args]) if (!/^[A-Za-z0-9._:/=@+-]+$/.test(arg)) throw new Error(`a scene word, not ${JSON.stringify(arg)}`);
    const line = `${this.#script} ${[verb, ...args].join(' ')}`;
    const body = input === undefined ? line : `printf '%s\\n' '${input}' | ${line}`;
    const result = await this.runner.step(verb, body, { root: true, ms, secret: input });
    if (!allow.includes(result.rc)) throw new Error(`${what ?? [verb, ...args].join(' ')} on ${this.runner.ssh.vm} exited ${result.rc}: ${tail(result)}`);
    return result;
  }

  async up(): Promise<void> {
    await this.scene('up', [], { ms: 180_000 });
  }

  async enroll(code: string, name: string): Promise<Record<string, unknown>> {
    if (!NAME.test(name)) throw new Error(`a machine name ([a-z0-9-]), not ${JSON.stringify(name)}`);
    if (!CODE.test(code)) throw new Error('the enrollment code is not in its alphabet');
    return jsonLine('enroll', await this.scene('enroll', [name], { input: code, ms: 360_000 }));
  }

  async keys(): Promise<Record<string, unknown>> {
    return jsonLine('keys', await this.scene('mawsd', ['keys', '--json'], { what: 'keys' }));
  }

  async status(): Promise<EndpointStatus> {
    return jsonLine('status', await this.scene('mawsd', ['endpoint', 'status', '--json'])) as EndpointStatus;
  }

  async restart(): Promise<void> {
    await this.scene('restart', [], { ms: 180_000 });
  }

  async policy(set: { readOnly?: boolean; ceiling?: string } = {}): Promise<{ read_only: boolean; ceiling: string }> {
    if (set.ceiling !== undefined && !CEILINGS.has(set.ceiling)) throw new Error(`a ceiling among ${[...CEILINGS].join(', ')}, not ${JSON.stringify(set.ceiling)}`);
    const args = ['endpoint', 'policy', ...(set.readOnly === undefined ? [] : ['--read-only', set.readOnly ? 'on' : 'off']), ...(set.ceiling === undefined ? [] : ['--ceiling', set.ceiling]), '--json'];
    const shown = jsonLine('policy', await this.scene('mawsd', args));
    return { read_only: shown.read_only as boolean, ceiling: shown.ceiling as string };
  }

  async cutHubSocket(): Promise<string> {
    return tail(await this.scene('cut-hub'));
  }

  async logMark(): Promise<number> {
    return Number((await this.scene('log-size', ['mawsd'])).lines.at(-1));
  }

  async logSince(mark: number): Promise<string[]> {
    return (await this.scene('log-since', ['mawsd', String(Math.max(0, Math.floor(mark)))], { ms: 60_000 })).lines;
  }

  async listening(): Promise<string[]> {
    return (await this.scene('listening')).lines.filter((line) => line.trim() !== '');
  }

  settle(ms?: number): Promise<string[]> {
    return this.runner.settle(ms);
  }

  async down(): Promise<string[]> {
    const result = await this.scene('down', [], { ms: 180_000, allow: [0, 1] });
    return result.rc === 0 ? [] : result.lines.filter((line) => line.startsWith('LEFT '));
  }
}

class VmLaneA implements LaneAScene {
  readonly sminos: SminosProbe;
  constructor(private readonly vm: VmMachine) {
    this.sminos = {
      status: async () => {
        const r = await vm.scene('sminos-status');
        return { lines: r.lines.filter((l) => !l.startsWith('hub.json:')), hubJson: r.lines.includes('hub.json: present') };
      },
      revoked: async () => {
        const r = await vm.scene('sminos-revoked');
        return r.lines.includes('none') ? null : (jsonLine('sminos-revoked', r) as Awaited<ReturnType<SminosProbe['revoked']>>);
      },
      imported: async (token) => {
        if (!/^[a-z0-9-]{4,64}$/.test(token)) throw new Error('imported: a marker token ([a-z0-9-])');
        return Number((await vm.scene('imported', [token])).lines.at(-1));
      },
      logMark: async () => Number((await vm.scene('log-size', ['sminos'])).lines.at(-1)),
      logSince: async (mark) => (await vm.scene('log-since', ['sminos', String(Math.max(0, Math.floor(mark)))], { ms: 60_000 })).lines,
      stopSession: async () => void (await vm.scene('lane-a-stop', [], { ms: 60_000 })),
      resumeSession: async () => ({ launch: String(jsonLine('lane-a-resume', await vm.scene('lane-a-resume', [], { ms: 120_000 })).launch) }),
      localSpawn: async (alias) => {
        if (!NAME.test(alias)) throw new Error(`an alias ([a-z0-9-]), not ${JSON.stringify(alias)}`);
        return vm.scene('local-spawn', [alias], { ms: 180_000, allow: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] });
      },
      retire: async (alias) => {
        if (!NAME.test(alias)) throw new Error(`an alias ([a-z0-9-]), not ${JSON.stringify(alias)}`);
        await vm.scene('retire', [alias], { ms: 60_000, allow: [0, 1] });
      },
    };
  }

  async up(project: { id: string; name: string }): Promise<{ session: string; launch: string; alias: string; checkout: string }> {
    if (!/^[0-9a-f-]{36}$/.test(project.id) || !NAME.test(project.name)) throw new Error('a project id (a UUID) and name ([a-z0-9-])');
    const shown = jsonLine('lane-a-up', await this.vm.scene('lane-a-up', [project.id, project.name], { ms: 300_000 }));
    return { session: String(shown.session), launch: String(shown.launch), alias: String(shown.alias), checkout: String(shown.checkout) };
  }

  async ticks(count: number, tag: string, send: (text: string) => Promise<void>): Promise<void> {
    if (!Number.isSafeInteger(count) || count < 1 || count > 500 || !/^[a-z0-9]{1,16}$/.test(tag)) throw new Error('ticks: a count 1-500 and a tag [a-z0-9]');
    await send(`o10-m11 ticks ${count} ${tag}`);
  }

  async rows(session: string): Promise<string[]> {
    if (!/^[0-9a-f-]{36}$/.test(session)) throw new Error(`a session id, not ${JSON.stringify(session)}`);
    // Wait out a write in flight: the transcript read twice, the same both times.
    let last: string[] | null = null;
    for (let i = 0; i < 5; i++) {
      const rows = (await this.vm.scene('transcript', [session], { ms: 60_000 })).lines.filter((l) => /^[0-9a-f-]{36}$/.test(l));
      if (last !== null && rows.length === last.length) return rows;
      last = rows;
      await sleep(2000);
    }
    return last ?? [];
  }

  async count(session: string, token: string): Promise<number> {
    if (!/^[0-9a-f-]{36}$/.test(session) || !/^[a-z0-9-]{4,64}$/.test(token)) throw new Error('count: a session id and a marker token ([a-z0-9-])');
    const shown = Number((await this.vm.scene('transcript', [session, token], { ms: 60_000 })).lines.at(-1));
    if (!Number.isSafeInteger(shown)) throw new Error(`count: the scene answered no number for ${token}`);
    return shown;
  }
}
