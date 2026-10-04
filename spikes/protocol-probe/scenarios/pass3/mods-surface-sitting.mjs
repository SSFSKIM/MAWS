// M1 sitting / M3, docs/charter.md and waves plan §2 M. Resume-only: no user prompt or model call.
// Resume the checked-in sanitized seed with the unmodified mod, entirely under scratch cwd/config.
import { Probe } from '../../harness.mjs';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownerModSource } from './owner-mod-source.mjs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CLIENT, VIEWPORT, ANSWERS, render, ask } from './mods-surface-common.mjs';
import { initPayload, success } from './mods-common.mjs';

export default async function sitting({ bin = realpathSync('/Users/new/.local/bin/claude'), name = 'mods-surface-sitting', headers = false } = {}) {
  const sessionId = '6c90fab1-575c-4e47-a232-8a8df83076ec';
  const seedFixture = fileURLToPath(new URL('../../fixtures/pass3/mods-surface-sitting.jsonl', import.meta.url));
  // Read before Probe opens its output; the seed remains byte-for-byte stable across re-recordings.
  const seedBytes = readFileSync(seedFixture);
  const records = seedBytes.toString('utf8').trim().split('\n').map(JSON.parse).find(r => r.frame.event === 'owner_session_seed').frame.records;
  const { root: ownerRoot, ...owner } = ownerModSource();
  const root = realpathSync(mkdtempSync('/tmp/maws-m3-sitting-'));
  const home = join(root, 'config'); const plugin = join(root, 'owner-mod');
  const cwd = join(root, 'project');
  mkdirSync(cwd);
  const slug = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  mkdirSync(join(home, 'projects', slug), { recursive: true });
  writeFileSync(join(home, 'projects', slug, `${sessionId}.jsonl`), records.map(r => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: { [cwd]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }));
  writeFileSync(join(home, 'settings.json'), '{}');
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true }); mkdirSync(join(plugin, 'hooks'));
  writeFileSync(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'sitting-owner-mod', version: owner.ownerVersion }));
  writeFileSync(join(plugin, 'hooks/hooks.json'), JSON.stringify({ modules: ['./register.tsx'] }));
  copyFileSync(owner.ownerSource, join(plugin, 'hooks/to-human.tsx'));
  writeFileSync(join(plugin, 'hooks/register.tsx'), "import {registerToHuman} from './to-human'; export function register(on) { registerToHuman(on) }\n");
  let texts = records.filter((r) => r.type === 'assistant').flatMap((r) => r.message.content.filter((b) => b.type === 'text').map((b) => ({ uuid: r.uuid, api: r.message.id, text: b.text })));
  const hookOutputs = [];
  if (headers) {
    for (const file of ['to-human-stream.sh', 'to-human-stream.awk']) copyFileSync(join(ownerRoot, 'hooks', file), join(plugin, 'hooks', file));
    texts = texts.map((entry) => {
      const output = JSON.parse(execFileSync('/bin/bash', [join(plugin, 'hooks/to-human-stream.sh')], { input: JSON.stringify({ message_id: entry.uuid, index: 0, final: true, delta: entry.text }), env: { PATH: process.env.PATH, HOME: home, TMPDIR: root }, encoding: 'utf8' })).hookSpecificOutput.displayContent;
      hookOutputs.push({ uuid: entry.uuid, original: entry.text, output });
      return { ...entry, text: output };
    });
  }
  const seed = records;
  for (const key of Object.keys(process.env)) if (!['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','LANG'].includes(key) && !key.startsWith('LC_')) delete process.env[key];
  let p;
  try {
    p = new Probe(name, { cwd, bin, dir: 'fixtures/pass3/', noModel: true, settingSources: 'user', env: { CLAUDE_CONFIG_DIR: home, DISABLE_AUTOUPDATER: '1', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', ANTHROPIC_AUTH_TOKEN: 'control-only-no-credential', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }, flags: ['--resume', sessionId, '--plugin-dir', plugin, '--replay-user-messages', '--include-hook-events', '--settings', '{"dialogExpiry":"never"}'] });
    p.note({ event: 'provenance', spike: 'R3b', child: 'C6', charter: 'docs/charter.md', pin: 'b9b282697c56bc87c0d8d9e4ca5c533b0dd38651', pinnedSessionId: sessionId, ...owner, seedFixture, seedSha256: createHash('sha256').update(seedBytes).digest('hex'), scratchCwd: cwd, engine: bin, configHome: home, controlOnly: true, textBlocks: texts.map(({uuid,text}) => ({ uuid, length: text.length, marked: text.startsWith('<to-human>') && text.endsWith('</to-human>') })) });
    for (const output of hookOutputs) p.note({ event: 'display_hook_output', ...output });
    p.note({ event: 'owner_session_seed', description: 'Checked-in sanitized conversation and text, unchanged; live engine resumed this seed under scratch cwd/config.', records: seed });
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
