// P3-H spike U2 (docs/doperpowers/plans/2026-10-12-p3-co-work.md §4.12 U2; parent pin blob 8474a047 at c73ba534).
// The engine's `mcp_call` control request, live: an MCP tool called through the engine's own MCP client with no model
// turn. Scratch config home and project (never the owner's); no user message is sent, so no model is called.
// Servers: user scope (the scratch `.claude.json`), project scope (`.mcp.json` in the scratch project, never approved),
// dynamic (`--mcp-config`), one HTTP server with an env-expanded header. The scratch user settings deny one tool and
// set `defaultMode: plan`, to see whether `mcp_call` honours the engine's permission settings.
//   node engine-mcp-call-probe.mjs [binary]   -> fixtures/engine-mcp-call.jsonl, results/engine-mcp-call.json
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bin = process.argv[2] ?? join(homedir(), '.local/share/claude/versions/2.1.296');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'p3c-engine-')));
const configDir = join(scratch, 'config');
const project = join(scratch, 'project');
mkdirSync(configDir);
mkdirSync(project);
const toy = join(here, 'toy-server.mjs');
const stdio = { type: 'stdio', command: process.execPath, args: [toy, 'stdio'] };
const httpPort = 47831;
writeFileSync(join(configDir, '.claude.json'), JSON.stringify({
  hasCompletedOnboarding: true,
  mcpServers: { usertoy: stdio, userhttp: { type: 'http', url: `http://127.0.0.1:${httpPort}/mcp`, headers: { 'X-Probe-Header': '${PROBE_FAKE_SECRET}' } } },
  projects: { [project]: { hasTrustDialogAccepted: true } },
}, null, 2));
writeFileSync(join(configDir, 'settings.json'), JSON.stringify({ permissions: { deny: ['mcp__usertoy__metrics_snapshot'], defaultMode: 'plan' } }, null, 2));
writeFileSync(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { projtoy: stdio } }, null, 2));
const dynamic = { mcpServers: { dyntoy: stdio } };

const http = spawn(process.execPath, [toy, 'http', String(httpPort)], { stdio: ['ignore', 'ignore', 'pipe'] });
await new Promise((r) => http.stderr.once('data', r));

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE') && !k.startsWith('ANTHROPIC')));
Object.assign(env, { CLAUDE_CONFIG_DIR: configDir, PROBE_FAKE_SECRET: 'fake-value-not-a-credential' });
const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--setting-sources', 'user,project,local', '--mcp-config', JSON.stringify(dynamic)];
const t0 = performance.now();
const child = spawn(bin, args, { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'] });
const frames = [];
let seq = 0;
const note = (direction, frame) => frames.push({ seq: ++seq, direction, at: new Date().toISOString(), ms: Math.round(performance.now() - t0), frame });
note('meta', { event: 'spawn', bin, args, cwd: '<scratch>/project', configDir: '<scratch>/config', node: process.version });
const waiters = new Map();
let buf = '';
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const f = JSON.parse(line);
    note('in', f);
    if (f.type === 'control_response') waiters.get(f.response.request_id)?.(f.response);
    if (f.type === 'control_request') note('meta', { event: 'unexpected engine control_request', subtype: f.request?.subtype });
  }
});
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
let n = 0;
const control = (request, timeoutMs = 20_000) => new Promise((resolve) => {
  const request_id = `p3c-${++n}`;
  const frame = { type: 'control_request', request_id, request };
  note('out', frame);
  const started = performance.now();
  const timer = setTimeout(() => resolve({ timeout: true }), timeoutMs);
  waiters.set(request_id, (r) => { clearTimeout(timer); resolve({ ...r, ms: Math.round(performance.now() - started) }); });
  child.stdin.write(`${JSON.stringify(frame)}\n`);
});

const out = {};
out.initialize = await control({ subtype: 'initialize' });
out.initialize = { subtype: out.initialize.subtype, ms: out.initialize.ms, error: out.initialize.error };
await new Promise((r) => setTimeout(r, 4000)); // let stdio and HTTP servers connect
const status = await control({ subtype: 'mcp_status' });
out.mcpStatus = (status.response?.mcpServers ?? []).map((s) => ({ name: s.name, status: s.status, scope: s.scope, config: s.config, tools: s.tools?.map((t) => t.name) }));
// proof that the deny rule and plan mode are in force in this engine
const rules = await control({ subtype: 'list_permission_rules' });
out.permissionRules = rules.response ?? rules.error;
const settings = await control({ subtype: 'get_settings' });
out.effectivePermissions = settings.response?.effective?.permissions ?? settings.response?.permissions ?? settings.error ?? Object.keys(settings.response ?? {});
const call = async (tool, args) => {
  const r = await control({ subtype: 'mcp_call', tool, arguments: args });
  return { tool, ms: r.ms, subtype: r.subtype, error: r.error, structuredContent: r.response?.structuredContent, text: r.response?.content?.[0]?.text?.slice(0, 200) };
};
out.calls = [
  await call('mcp__dyntoy__metrics_snapshot', { series: 'revenue', points: 2 }),
  await call('mcp__dyntoy__metrics_snapshot', { series: 'revenue', points: 2 }),
  await call('mcp__usertoy__metrics_snapshot', { series: 'denied-by-rule', points: 1 }),
  await call('mcp__dyntoy__send_document', { title: 'plan-mode write', body: 'x' }),
  await call('mcp__userhttp__metrics_snapshot', { series: 'http', points: 1 }),
  await call('mcp__projtoy__metrics_snapshot', { series: 'project', points: 1 }),
  await call('mcp__nosuch__tool', {}),
];
out.engineAskedPermission = frames.some((f) => f.direction === 'in' && f.frame.type === 'control_request');
out.modelTurns = frames.filter((f) => f.direction === 'in' && f.frame.type === 'result').length;
child.stdin.end();
await new Promise((r) => { child.on('exit', r); setTimeout(() => { child.kill(); r(); }, 8000); });
http.kill();
note('meta', { event: 'exit', stderrTail: stderr.slice(-800) });
mkdirSync(join(here, 'fixtures'), { recursive: true });
mkdirSync(join(here, 'results'), { recursive: true });
const scrub = (s) => s.replaceAll(scratch, '<scratch>').replaceAll(homedir(), '~');
writeFileSync(join(here, 'fixtures', 'engine-mcp-call.jsonl'), scrub(frames.map((f) => JSON.stringify(f)).join('\n') + '\n'));
writeFileSync(join(here, 'results', 'engine-mcp-call.json'), scrub(`${JSON.stringify({ bin, ...out }, null, 2)}\n`));
console.log(scrub(JSON.stringify(out, null, 1)));
