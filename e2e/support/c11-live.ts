// C11's live acceptance support (C11 execution document, M6 and Acceptance item 3): the gate (C3's: the pinned binary
// answering its version, ClaudeUsage's relay answering /api/hello), a scratch CLAUDE_CONFIG_DIR and scratch git
// repositories under /tmp carrying the fixtures that stand in for the owner's own configuration (a project settings file
// with allow, ask and deny rules, a PostToolUse hook and an env key; a project `.mcp.json` naming a tiny stdio MCP
// server written into the scratch; user and project memory files), the loopback forwarder the relay-down cases stop and
// start (MAWS_RELAY_URL, ruled 2026-09-29: ClaudeUsage itself is never quit), and an observations file. Never the
// owner's ~/.claude or ~/.claude.json; the owner's ClaudeUsage data directory is read only.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { ENGINE_BIN, ENGINE_VERSION } from '../../src/engine-host/launch';

export const RELAY = 'http://127.0.0.1:8641'; // ClaudeUsage's relay, whatever MAWS_RELAY_URL this process may carry
export const FORWARDER_PORT = 18641;

export function c11LiveSkipReason(): string | null {
  if (process.env.MAWS_C11_LIVE !== '1') return 'the C11 live acceptance runs only under MAWS_C11_LIVE=1';
  if (!existsSync(ENGINE_BIN)) return `engine binary missing at ${ENGINE_BIN}`;
  const version = execFileSync(ENGINE_BIN, ['--version'], { encoding: 'utf8', timeout: 15_000 }).trim();
  if (!version.startsWith(ENGINE_VERSION)) return `engine reports ${version}, expected ${ENGINE_VERSION}`;
  const code = execFileSync('/usr/bin/curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `${RELAY}/api/hello`], { encoding: 'utf8' }).trim();
  return code === '200' ? null : `relay at ${RELAY} answered ${code}: start ClaudeUsage`;
}

// The relay's own catalogue, as `/model`'s Gateway group must list it (display names, in the relay's order).
export function relayCatalogue(): string[] {
  const out = execFileSync('/usr/bin/curl', ['-s', `${RELAY}/v1/models`], { encoding: 'utf8' });
  return (JSON.parse(out) as { data: { id: string; display_name?: string }[] }).data.map((m) => m.display_name ?? m.id);
}

// A newline-delimited JSON-RPC MCP server with one tool, the target of Reconnect and the enable switch.
const MCP_SERVER = `const rl = require('node:readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return;
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'c11probe', version: '1.0.0' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'c11_echo', description: 'Echoes its text argument back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } });
  else if (m.method === 'tools/call') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'echo: ' + (m.params?.arguments?.text ?? '') }] } });
  else if (m.method === 'ping') send({ jsonrpc: '2.0', id: m.id, result: {} });
  else send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not found: ' + m.method } });
});
`;

export interface C11Scratch {
  root: string;
  config: string; // the scratch CLAUDE_CONFIG_DIR
  repo(name: string): string; // a scratch repository with the fixtures, created on first use, trusted in the scratch home
  hookLog: string;
  claudeJson(): Record<string, unknown> & { projects?: Record<string, { disabledMcpServers?: string[]; enabledMcpServers?: string[] }> };
  observe(key: string, value: unknown): void;
}

export function c11Scratch(): C11Scratch {
  const root = realpathSync(mkdtempSync('/tmp/maws-c11-live-'));
  const config = join(root, 'claude-config');
  mkdirSync(config);
  writeFileSync(join(config, 'settings.json'), '{}\n');
  writeFileSync(join(config, 'CLAUDE.md'), '# Scratch user memory\n');
  writeFileSync(join(root, 'mcp-server.cjs'), MCP_SERVER);
  const hookLog = join(root, 'hook.log');
  const claudeJsonPath = join(config, '.claude.json');
  const claudeJson = () => (existsSync(claudeJsonPath) ? (JSON.parse(readFileSync(claudeJsonPath, 'utf8')) as ReturnType<C11Scratch['claudeJson']>) : {});
  writeFileSync(claudeJsonPath, JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: {} }, null, 2));
  const repo = (name: string) => {
    const dir = join(root, name);
    if (existsSync(dir)) return dir;
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, 'one.txt'), 'ONE\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '# Scratch project memory\n');
    const settings = {
      permissions: { allow: ['Bash(git status:*)', 'Read(./one.txt)'], ask: ['Bash(git push:*)'], deny: ['Bash(rm -rf:*)'] },
      hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `echo post >> ${hookLog}` }] }] },
      env: { C11_LIVE_FIXTURE: '1' },
      enableAllProjectMcpServers: true,
    };
    writeFileSync(join(dir, '.claude', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
    writeFileSync(join(dir, '.mcp.json'), `${JSON.stringify({ mcpServers: { c11probe: { type: 'stdio', command: process.execPath, args: [join(root, 'mcp-server.cjs')] } } }, null, 2)}\n`);
    const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=Live', '-c', 'user.email=live@localhost', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    git('add', '.');
    git('commit', '-qm', 'seed');
    const state = claudeJson();
    writeFileSync(claudeJsonPath, JSON.stringify({ ...state, projects: { ...state.projects, [dir]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2));
    return dir;
  };
  const file = join(root, 'observations.json');
  const observe = (key: string, value: unknown) => {
    const prior = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
    writeFileSync(file, JSON.stringify({ ...prior, [key]: value }, null, 2));
  };
  return { root, config, repo, hookLog, claudeJson, observe };
}

// A loopback TCP forwarder 127.0.0.1:18641 → the relay, stopped and started to take the relay down and up for a MAWS
// launched with MAWS_RELAY_URL=http://127.0.0.1:18641. Stopping it also cuts the connections it carries.
export class Forwarder {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();

  get running(): boolean {
    return this.server !== null;
  }

  start(): Promise<void> {
    if (this.server) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const server = createServer((client) => {
        const upstream = connect(8641, '127.0.0.1');
        const drop = () => {
          client.destroy();
          upstream.destroy();
          this.sockets.delete(client);
          this.sockets.delete(upstream);
        };
        for (const socket of [client, upstream]) {
          this.sockets.add(socket);
          socket.on('error', drop);
          socket.on('close', drop);
        }
        client.pipe(upstream);
        upstream.pipe(client);
      });
      server.once('error', reject);
      server.listen(FORWARDER_PORT, '127.0.0.1', () => {
        this.server = server;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    const server = this.server;
    if (!server) return Promise.resolve();
    this.server = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    return new Promise((resolve) => server.close(() => resolve()));
  }
}
