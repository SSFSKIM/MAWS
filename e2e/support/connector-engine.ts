// A scratch engine for the connector e2e runs (P3-H): the installed Claude Code (found as a fresh MAWS install finds
// it, `installedEngine`), spawned with MAWS's stream-json flags under a fresh HOME and CLAUDE_CONFIG_DIR, every
// CLAUDE* and ANTHROPIC* variable of the runner dropped, `--strict-mcp-config` with only the fixture servers the run
// names (connector-mcp-server.mjs, all writing one call log), and driven through the host's own ControlClient. It
// sends control requests only: no user message, so no model turn and no credentials. Every frame in and out is kept as
// a journal row, and `wire()` serialises them as a fixture: scratch paths scrubbed and the initialize answer reduced to
// the version and capabilities (its command and model catalogue are unrelated to connectors).
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JournalDirection, JournalRow } from '@shared/wire/journal';
import { mcpStatus } from '../../src/engine-host/controls';
import type { LaunchPlan } from '../../src/engine-host/launch';
import { ControlClient } from '../../src/engine-host/rpc';
import { MAX_LINE_CHARS, spawnEngine, type EngineTransport } from '../../src/engine-host/transport';
import type { McpStatusResponse } from '@shared/wire/control';
import { withoutClaudeVariables } from '../../test/support/claude-env';
import { installedEngine } from './p1-live';

export const FIXTURE_SERVER = join(__dirname, 'connector-mcp-server.mjs');

export interface FixtureServer {
  name: string; // the configured name, as mcp_status will report it
  id: string; // what the server calls itself in its answers and the call log
  tools: string[];
}

export interface CallLogEntry {
  at: string;
  server: string; // the fixture server's id
  pid: number;
  method: string | null;
  tool?: string;
  arguments?: Record<string, unknown>;
}

export interface ScratchEngine {
  client: ControlClient;
  version: string;
  rows: JournalRow[];
  calls(): CallLogEntry[]; // every request a fixture server received
  toolCalls(): CallLogEntry[];
  waitSettled(timeoutMs?: number): Promise<McpStatusResponse>; // mcp_status once no configured server is pending
  wire(): string;
  close(): Promise<void>;
}

const ENGINE_ARGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--setting-sources', 'user,project,local', '--strict-mcp-config'];

export async function startScratchEngine(servers: readonly FixtureServer[]): Promise<ScratchEngine> {
  const engine = installedEngine();
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maws-connectors-')));
  const config = join(scratch, 'config');
  const home = join(scratch, 'home');
  const project = join(scratch, 'project');
  for (const dir of [config, home, project]) mkdirSync(dir);
  writeFileSync(join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }));
  const log = join(scratch, 'calls.jsonl');
  const mcpServers = Object.fromEntries(servers.map((s) => [s.name, { type: 'stdio', command: process.execPath, args: [FIXTURE_SERVER, '--id', s.id, '--log', log, '--tools', JSON.stringify(s.tools)] }]));
  const args = [...ENGINE_ARGS, '--mcp-config', JSON.stringify({ mcpServers })];
  const env: Record<string, string> = Object.fromEntries(Object.entries(withoutClaudeVariables(process.env)).filter(([key]) => !key.startsWith('ANTHROPIC')));
  Object.assign(env, { HOME: home, CLAUDE_CONFIG_DIR: config, DISABLE_AUTOUPDATER: '1' });

  const rows: JournalRow[] = [];
  const sink = { row: (direction: JournalDirection, frame: unknown): JournalRow => { const row = { seq: rows.length + 1, direction, at: new Date().toISOString(), frame }; rows.push(row); return row; } };
  sink.row('meta', { event: 'spawn', engineVersion: engine.version, args, cwd: project, envKeys: Object.keys(env).sort(), servers });
  // spawnEngine reads the plan's bin, args, cwd and env only
  const transport: EngineTransport = spawnEngine({ bin: engine.bin, args, cwd: project, env } as Pick<LaunchPlan, 'bin' | 'args' | 'cwd' | 'env'> as LaunchPlan, { maxLineChars: MAX_LINE_CHARS });
  const client = new ControlClient(transport, sink, 'CONN');
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
  let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  void transport.exited.then((value) => {
    exit = value;
    client.close(`the engine exited (${value.code ?? value.signal})`);
  });

  let kept: CallLogEntry[] | null = null; // the log as close() found it, the scratch directory gone
  const calls = (): CallLogEntry[] => kept ?? (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as CallLogEntry) : []);
  const scrub = (text: string) => text.replaceAll(scratch, '<scratch>').replaceAll(FIXTURE_SERVER, '<fixture-server>').replaceAll(process.execPath, '<node>').replaceAll(homedir(), '~');

  const stop = async () => {
    transport.endInput();
    const exited = await Promise.race([transport.exited.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8_000))]);
    if (!exited) {
      transport.kill('SIGKILL');
      await transport.exited;
    }
    await Promise.all([reading, draining]);
    sink.row('meta', { event: 'exit', exit, stderrTail: scrub(stderr) });
    kept = calls();
    rmSync(scratch, { recursive: true, force: true });
  };
  let initialized: { claude_code_version?: string };
  try {
    initialized = (await client.requestRaw('initialize', {}, { klass: 'long' })) as { claude_code_version?: string };
  } catch (error) {
    await stop();
    throw new Error(`the scratch engine did not initialize: ${error instanceof Error ? error.message : String(error)}; stderr: ${scrub(stderr)}`, { cause: error });
  }
  return {
    client,
    version: initialized.claude_code_version ?? engine.version,
    rows,
    calls,
    toolCalls: () => calls().filter((entry) => entry.method === 'tools/call'),
    async waitSettled(timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const status = await mcpStatus(client, {});
        if (!status.mcpServers.some((s) => s.status === 'pending') || Date.now() > deadline) return status;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    },
    wire() {
      const initializeId = rows.find((r) => r.direction === 'out' && (r.frame as { request?: { subtype?: string } }).request?.subtype === 'initialize');
      const id = (initializeId?.frame as { request_id?: string } | undefined)?.request_id;
      const trimmed = rows.map((row) => {
        const frame = row.frame as { type?: string; response?: { request_id?: string; response?: Record<string, unknown> } };
        const envelope = frame.response;
        if (id === undefined || row.direction !== 'in' || frame.type !== 'control_response' || envelope?.request_id !== id || !envelope.response) return row;
        const { claude_code_version, capabilities } = envelope.response;
        return { ...row, frame: { ...frame, response: { ...envelope, response: { claude_code_version, capabilities, trimmed: 'initialize answer reduced to the version and capabilities' } } } };
      });
      return scrub(trimmed.map((row) => JSON.stringify(row)).join('\n') + '\n');
    },
    close: stop,
  };
}
