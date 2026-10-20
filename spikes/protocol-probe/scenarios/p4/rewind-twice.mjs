// W2-A no-spend probe: what `rewind_conversation` answers for a target already rewound, on a forked launch of a real
// transcript (scratch config home, no user message ever sent, so no model request).
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const [bin, sourceFile, X, target, lastSeen] = process.argv.slice(2);
const config = realpathSync(mkdtempSync('/tmp/w2a-probe-config-'));
writeFileSync(join(config, 'settings.json'), '{}\n');
const repo = realpathSync(mkdtempSync('/tmp/w2a-probe-repo-'));
const slug = (p) => p.replace(/[^a-zA-Z0-9]/g, '-');
const projects = join(config, 'projects', slug(repo));
mkdirSync(projects, { recursive: true });
copyFileSync(sourceFile, join(projects, X + '.jsonl'));
const Y = randomUUID();
const env = { ...process.env, CLAUDE_CONFIG_DIR: config };
for (const k of Object.keys(env)) if (k.startsWith('CLAUDE') && k !== 'CLAUDE_CONFIG_DIR') delete env[k];
delete env.ANTHROPIC_BASE_URL;
delete env.ANTHROPIC_AUTH_TOKEN;
delete env.ANTHROPIC_API_KEY;
env.CLAUDE_CODE_ENTRYPOINT = 'sdk-ts';
const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--setting-sources', 'user,project,local', '--permission-mode', 'default', '--resume', X, '--fork-session', '--session-id', Y];
const child = spawn(bin, args, { cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe'] });
const yPath = join(projects, Y + '.jsonl');
let buffer = '';
const responses = new Map();
child.stdout.on('data', (d) => {
  buffer += d;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    try {
      const f = JSON.parse(line);
      if (f.type === 'control_response') responses.set(f.response.request_id, f.response);
      else console.log(JSON.stringify({ frame: f.type + (f.subtype ? '/' + f.subtype : '') }));
    } catch {}
  }
});
let err = '';
child.stderr.on('data', (d) => (err += d));
const request = async (id, request) => {
  child.stdin.write(JSON.stringify({ type: 'control_request', request_id: id, request }) + '\n');
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && !responses.has(id)) await new Promise((r) => setTimeout(r, 50));
  return responses.get(id) ?? 'no answer';
};
console.log(JSON.stringify({ initialize: (await request('init', { subtype: 'initialize' }))?.subtype }));
const rewind = { subtype: 'rewind_conversation', target_message_uuid: target, last_seen_user_message_uuid: lastSeen, interrupt_if_running: false };
console.log(JSON.stringify({ first: (await request('rw1', rewind)), yExists: existsSync(yPath) }));
console.log(JSON.stringify({ second: (await request('rw2', rewind)), yExists: existsSync(yPath) }));
child.stdin.end();
await new Promise((r) => child.on('close', r));
console.log(JSON.stringify({ afterExit: { yExists: existsSync(yPath) }, stderrTail: err.slice(-400) }));
