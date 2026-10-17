// P3-HD's no-model scratch-source probe (e2e/connectors-direct.spec.ts): the installed engine under a scratch HOME and
// config home, launched the way MAWS launches it (src/engine-host/launch.ts: ENGINE_FLAGS, buildEnvironment over a
// captured environment the probe writes itself; no `--strict-mcp-config`), so user, local and project servers load
// from scratch files, never the owner's. It sends control requests only: no user message, no model turn, no
// credentials. MAWS's own flag settings go in `--settings` as a launch passes them (mergeFlagSettings), and each launch's
// ConnectorLaunchContext is built from the exact environment and flag settings handed to that engine, with the
// local-scope key captured before the spawn as the launcher captures it (src/engine-host/connectors/local-key.ts). A case may add
// synthetic variables MAWS's allowlist would drop (`syntheticEnv`), recorded by name in the spawn row, to observe what
// the engine does with them. Listeners are 127.0.0.1 only.
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { McpStatusResponse } from '@shared/wire/control';
import type { JournalDirection, JournalRow } from '@shared/wire/journal';
import { captureLocalKey } from '../../src/engine-host/connectors/local-key';
import { connectorLaunchContext, type ConnectorLaunchContext } from '../../src/engine-host/connectors/provenance';
import { mcpStatus } from '../../src/engine-host/controls';
import { buildEnvironment, ENGINE_FLAGS, mergeFlagSettings, RELAY_URL, type LaunchPlan } from '../../src/engine-host/launch';
import { ControlClient } from '../../src/engine-host/rpc';
import { MAX_LINE_CHARS, spawnEngine } from '../../src/engine-host/transport';
import { installedEngine } from './p1-live';

export const DIRECT_SERVER = join(__dirname, 'connector-direct-server.mjs');
export const PROBE_VALUE = 'probe-value-from-launch';
export const PROBE_ARG = 'probe-arg-from-launch';

export interface ProbeLayout {
  scratch: string;
  home: string;
  config: string; // a CLAUDE_CONFIG_DIR
  project: string;
  bin: string; // on the launch PATH only, never the host's
  log: string;
  close(): void;
}

export function probeLayout(): ProbeLayout {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maws-direct-')));
  const layout = { scratch, home: join(scratch, 'home'), config: join(scratch, 'config'), project: join(scratch, 'project'), bin: join(scratch, 'bin'), log: join(scratch, 'calls.jsonl') };
  for (const dir of [layout.home, layout.config, layout.project, layout.bin]) mkdirSync(dir);
  // a bare command the engine and MAWS can find only through the launch PATH
  writeFileSync(join(layout.bin, 'probe-node'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`);
  chmodSync(join(layout.bin, 'probe-node'), 0o755);
  return { ...layout, close: () => rmSync(scratch, { recursive: true, force: true }) };
}

// A stdio entry as an owner writes one: the bare launcher found on the launch PATH, literal arguments and env unless a
// case adds references (`args`, `env`).
export function stdioEntry(layout: ProbeLayout, id: string, extra: { args?: string[]; env?: Record<string, string> } = {}): Record<string, unknown> {
  return { type: 'stdio', command: 'probe-node', args: [DIRECT_SERVER, 'stdio', '--id', id, '--log', layout.log, ...(extra.args ?? [])], env: { MAWS_PROBE_PLAIN: `plain-${id}`, ...extra.env } };
}

export interface LogEntry {
  at: string;
  server: string;
  pid: number;
  event?: 'start' | 'http';
  method?: string | null;
  cwd?: string;
  argv?: string[];
  env?: Record<string, string>;
  sdk?: Record<string, string>; // the SDK-minimal keys the instance was started with
  probeHeader?: string | null;
  tool?: string;
}

export const readLog = (layout: ProbeLayout): LogEntry[] => (existsSync(layout.log) ? readFileSync(layout.log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as LogEntry) : []);

export async function startHttpFixture(layout: ProbeLayout, id: string, options: { auth?: boolean } = {}): Promise<{ url: string; close(): void }> {
  const child: ChildProcess = spawn(process.execPath, [DIRECT_SERVER, 'http', '--id', id, '--log', layout.log, ...(options.auth ? ['--auth'] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise<number>((resolve, reject) => {
    child.stdout!.once('data', (chunk: Buffer) => resolve((JSON.parse(chunk.toString('utf8').split('\n')[0]!) as { port: number }).port));
    child.once('exit', (code) => reject(new Error(`the http fixture ${id} exited (${code})`)));
  });
  return { url: `http://127.0.0.1:${port}/mcp`, close: () => void child.kill('SIGTERM') };
}

// The PATH a probe launch hands its engine: the layout's bin first, then the runner's.
export const launchPathOf = (layout: ProbeLayout) => `${layout.bin}:${process.env.PATH ?? '/usr/bin:/bin'}`;

export interface ProbeEngine {
  client: ControlClient;
  context: ConnectorLaunchContext;
  env: Record<string, string>;
  version: string;
  settled(timeoutMs?: number): Promise<McpStatusResponse>;
  wire(): string;
  close(): Promise<void>;
}

let launches = 0;

// `configDir`: launch with CLAUDE_CONFIG_DIR at the layout's config home, else with HOME alone.
export async function startProbeEngine(layout: ProbeLayout, options: { cwd: string; configDir: boolean; dynamic?: Record<string, unknown>; appSessionId?: string; launchEnv?: Record<string, string>; syntheticEnv?: Record<string, string> }): Promise<ProbeEngine> {
  const engine = installedEngine();
  launches += 1;
  const captured: Record<string, string> = {
    HOME: layout.home, PATH: launchPathOf(layout), USER: process.env.USER ?? 'probe', LOGNAME: process.env.LOGNAME ?? process.env.USER ?? 'probe', SHELL: process.env.SHELL ?? '/bin/sh', TMPDIR: tmpdir(), LANG: 'en_US.UTF-8',
    XDG_MAWS_PROBE_VALUE: PROBE_VALUE, XDG_MAWS_PROBE_ARG: PROBE_ARG, // pass MAWS's allowlist (XDG_), as an owner's exported variable would
    ...(options.configDir && { CLAUDE_CONFIG_DIR: layout.config }),
    ...options.launchEnv,
  };
  const spec = { subagentModel: null, gateway: 'direct', effort: null, extraSettings: null } as unknown as LaunchSpec;
  const env = { ...buildEnvironment(spec, captured, RELAY_URL), ...options.syntheticEnv };
  const flagSettings = mergeFlagSettings(spec);
  const args = [...ENGINE_FLAGS, ...(options.dynamic ? ['--mcp-config', JSON.stringify(options.dynamic)] : []), '--settings', JSON.stringify(flagSettings)];
  const launchId = `PROBE-${launches}`;
  const localKey = await captureLocalKey(options.cwd); // before the spawn, as the launcher does
  const context = connectorLaunchContext({ appSessionId: options.appSessionId ?? `probe-${launches}`, launchId, cwd: options.cwd, environment: env, flagSettings, localKey });

  const rows: JournalRow[] = [];
  const sink = { row: (direction: JournalDirection, frame: unknown): JournalRow => { const row = { seq: rows.length + 1, direction, at: new Date().toISOString(), frame }; rows.push(row); return row; } };
  sink.row('meta', { event: 'spawn', engineVersion: engine.version, args, cwd: options.cwd, envKeys: Object.keys(env).sort(), syntheticEnvKeys: Object.keys(options.syntheticEnv ?? {}).sort(), localKey });
  const transport = spawnEngine({ bin: engine.bin, args, cwd: options.cwd, env } as Pick<LaunchPlan, 'bin' | 'args' | 'cwd' | 'env'> as LaunchPlan, { maxLineChars: MAX_LINE_CHARS });
  const client = new ControlClient(transport, sink, launchId);
  let stderr = '';
  const reading = (async () => {
    for await (const item of transport.frames) {
      if (item.frame === null) sink.row('meta', { event: 'transport_problem', problem: item.error });
      else {
        sink.row('in', item.frame);
        client.observe(item.frame);
      }
    }
  })();
  const draining = (async () => {
    for await (const line of transport.stderr) stderr = `${stderr}${line}\n`.slice(-4_000);
  })();
  void transport.exited.then((value) => client.close(`the engine exited (${value.code ?? value.signal})`));
  const scrub = (text: string) => text.replaceAll(layout.scratch, '<scratch>').replaceAll(DIRECT_SERVER, '<fixture-server>').replaceAll(process.execPath, '<node>').replaceAll(homedir(), '~');
  const stop = async () => {
    transport.endInput();
    const exited = await Promise.race([transport.exited.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8_000))]);
    if (!exited) {
      transport.kill('SIGKILL');
      await transport.exited;
    }
    await Promise.all([reading, draining]);
    sink.row('meta', { event: 'exit', stderrTail: scrub(stderr) });
  };
  let version = engine.version;
  try {
    version = ((await client.requestRaw('initialize', {}, { klass: 'long' })) as { claude_code_version?: string }).claude_code_version ?? version;
  } catch (error) {
    await stop();
    throw new Error(`the probe engine did not initialize: ${error instanceof Error ? error.message : String(error)}; stderr: ${scrub(stderr)}`, { cause: error });
  }
  return {
    client,
    context,
    env,
    version,
    async settled(timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const status = await mcpStatus(client, {});
        if (!status.mcpServers.some((server) => server.status === 'pending') || Date.now() > deadline) return status;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    },
    // every frame, scrubbed; the initialize answer reduced to the version (its catalogue is unrelated to connectors)
    wire() {
      const trimmed = rows.map((row) => {
        const frame = row.frame as { type?: string; response?: { response?: Record<string, unknown> } };
        if (row.direction !== 'in' || frame.type !== 'control_response' || typeof frame.response?.response?.claude_code_version !== 'string') return row;
        return { ...row, frame: { ...frame, response: { ...frame.response, response: { claude_code_version: frame.response.response.claude_code_version, trimmed: 'initialize answer reduced to the version' } } } };
      });
      return scrub(trimmed.map((row) => JSON.stringify(row)).join('\n') + '\n');
    },
    close: stop,
  };
}
