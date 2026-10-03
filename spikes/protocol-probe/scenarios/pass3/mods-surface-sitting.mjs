// M1 sitting / M3, docs/charter.md and waves plan §2 M. Resume-only: no user prompt or model call.
// Copy the owner's transcript and unmodified mod into a scratch config; never run against the owner's config.
import { Probe } from '../../harness.mjs';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CLIENT, VIEWPORT, ANSWERS, render, ask } from './mods-surface-common.mjs';
import { initPayload, success } from './mods-common.mjs';

export default async function sitting({ bin = realpathSync('/Users/new/.local/bin/claude'), name = 'mods-surface-sitting', headers = false } = {}) {
  const sessionId = '6c90fab1-575c-4e47-a232-8a8df83076ec';
  const slug = '-Users-new-Developer-GitHub-doperpowers';
  const source = `/Users/new/.claude/projects/${slug}/${sessionId}.jsonl`;
  const cache = '/Users/new/.claude/plugins/cache/doperpowers/doperpowers';
  const version = readdirSync(cache).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort((a,b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
  const owner = join(cache, version, 'hooks/mods/to-human.tsx');
  const root = realpathSync(mkdtempSync('/tmp/maws-m3-sitting-'));
  const home = join(root, 'config'); const plugin = join(root, 'owner-mod');
  const cwd = '/Users/new/Developer/GitHub/doperpowers';
  mkdirSync(join(home, 'projects', slug), { recursive: true });
  copyFileSync(source, join(home, 'projects', slug, `${sessionId}.jsonl`));
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: { [cwd]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }));
  writeFileSync(join(home, 'settings.json'), '{}');
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true }); mkdirSync(join(plugin, 'hooks'));
  writeFileSync(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'sitting-owner-mod', version }));
  writeFileSync(join(plugin, 'hooks/hooks.json'), JSON.stringify({ modules: ['./register.tsx'] }));
  copyFileSync(owner, join(plugin, 'hooks/to-human.tsx'));
  writeFileSync(join(plugin, 'hooks/register.tsx'), "import {registerToHuman} from './to-human'; export function register(on) { registerToHuman(on) }\n");
  const records = readFileSync(source, 'utf8').trim().split('\n').map(JSON.parse);
  let texts = records.filter((r) => r.type === 'assistant').flatMap((r) => r.message.content.filter((b) => b.type === 'text').map((b) => ({ uuid: r.uuid, api: r.message.id, text: b.text })));
  const hookOutputs = [];
  if (headers) {
    for (const file of ['to-human-stream.sh', 'to-human-stream.awk']) copyFileSync(join(cache, version, 'hooks', file), join(plugin, 'hooks', file));
    texts = texts.map((entry) => {
      const output = JSON.parse(execFileSync('/bin/bash', [join(plugin, 'hooks/to-human-stream.sh')], { input: JSON.stringify({ message_id: entry.uuid, index: 0, final: true, delta: entry.text }), env: { PATH: process.env.PATH, HOME: home, TMPDIR: root }, encoding: 'utf8' })).hookSpecificOutput.displayContent;
      hookOutputs.push({ uuid: entry.uuid, original: entry.text, output });
      return { ...entry, text: output };
    });
  }
  // Keep enough unmodified message metadata for both disk and streaming normalization, but not private tool output.
  const seed = records.filter((r) => ['user', 'assistant'].includes(r.type) || r.type === 'system' && r.subtype === 'turn_duration').map((r) => {
    const message = r.message && { ...r.message, content: Array.isArray(r.message.content) ? r.message.content.map((b) => b.type === 'tool_result' ? { ...b, content: '[owner tool output omitted in replay seed]' } : b.type === 'thinking' ? { ...b, thinking: '' } : b) : r.message.content };
    return { type: r.type, uuid: r.uuid, parentUuid: r.parentUuid, isSidechain: r.isSidechain, cwd: r.cwd, sessionId, version: r.version, timestamp: r.timestamp, ...(message && { message }), ...(r.subtype && { subtype: r.subtype, durationMs: r.durationMs }) };
  });
  for (const key of Object.keys(process.env)) if (!['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','LANG'].includes(key) && !key.startsWith('LC_')) delete process.env[key];
  let p;
  try {
    p = new Probe(name, { cwd, bin, dir: 'fixtures/pass3/', noModel: true, settingSources: 'user', env: { CLAUDE_CONFIG_DIR: home, DISABLE_AUTOUPDATER: '1', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', ANTHROPIC_AUTH_TOKEN: 'control-only-no-credential', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }, flags: ['--resume', sessionId, '--plugin-dir', plugin, '--replay-user-messages', '--include-hook-events', '--settings', '{"dialogExpiry":"never"}'] });
    p.note({ event: 'provenance', spike: 'M3', charter: 'docs/charter.md', pin: 'f0688d30', pinnedSessionId: sessionId, ownerSource: owner, ownerSha256: createHash('sha256').update(readFileSync(owner)).digest('hex'), sourceSha256: createHash('sha256').update(readFileSync(source)).digest('hex'), configHome: home, controlOnly: true, textBlocks: texts.map(({uuid,text}) => ({ uuid, length: text.length, marked: text.startsWith('<to-human>') && text.endsWith('</to-human>') })) });
    for (const output of hookOutputs) p.note({ event: 'display_hook_output', ...output });
    p.note({ event: 'owner_session_seed', description: 'Original message metadata and text; private tool output omitted. Live engine resumed the complete scratch copy.', records: seed });
    success(await p.init(initPayload(cwd)), 'initialize');
    success(await ask(p, 'ui_attach', { surface: 'desktop', client_id: CLIENT, viewport: VIEWPORT, answers: ANSWERS }, 'attach'), 'attach');
    for (let pass = 0; pass < 2; pass++) for (const { uuid, text } of texts) {
      const answer = success(await render(p, { component: 'AssistantMessage', instance_id: uuid, props: { text, isFirstOfReply: true } }, `owner stored text pass ${pass}`), 'render');
      p.note({ event: 'sitting_answer', pass, uuid, sentLength: text.length, sentMarked: text.startsWith('<to-human>'), hooked: answer.hooked, rewritten: answer.rewritten, answerText: answer.props.text, tree: answer.tree });
    }
    if (headers) {
      // Diagnostic: first establish marked rows, then redraw newest-first with MAWS's old stripped input.
      // Each predecessor is still known as marked when its successor draws, so all three cache a run-start button.
      for (const { uuid, text } of texts) success(await render(p, { component: 'AssistantMessage', instance_id: `diagnostic:${uuid}`, props: { text, isFirstOfReply: true } }, 'diagnostic marked baseline'), 'render');
      for (const { uuid, text } of texts.toReversed()) {
        const stripped = text.replace(/\u001b\[[0-9;]*m/g, '');
        const answer = success(await render(p, { component: 'AssistantMessage', instance_id: `diagnostic:${uuid}`, props: { text: stripped, isFirstOfReply: true } }, 'diagnostic former MAWS stripped input newest first'), 'render');
        p.note({ event: 'stripped_input_answer', uuid, text: stripped, tree: answer.tree });
      }
    }
    p.note({ event: 'model_call_check' , outgoingPrompts: 0, modelResults: p.frames.filter((r) => r.frame.type === 'result').length, replayedAssistantFrames: p.frames.filter((r) => r.frame.type === 'assistant').length });
    await ask(p, 'ui_detach', { client_id: CLIENT }, 'detach');
    await p.request('end_session', { reason: 'stop' });
  } finally { if (p) await p.stop(); rmSync(root, { recursive: true, force: true }); }
  console.log(JSON.stringify({ fixture: p.file, exit: await p.closed }));
}
