// E1 M2's live recording (docs/doperpowers/plans/2026-10-05-e1-tool-server.md, Plan of Work M2, residues 9 and 15): the
// `maws` tool server against the installed Claude Code (`binary: null`, as main configures a fresh install), through
// MAWS's own engine host (LiveHost: registerEngineIpc, the launcher, EngineSession, the journal), under one scratch
// config home under /tmp, through ClaudeUsage's relay, on Haiku in default permission mode with every permission allowed
// once. Four cases each record a pass-3 fixture (send_file, a blocking ask, an async ask, show_pane), answering the
// human's part through the X2 commands the renderer uses (`maws.ask.answer`, `maws.pane.answer`); a fifth resumes case
// 1's session headless outside MAWS (no initialize, so no SDK server) for G1's terminal half. The owner's ~/.claude.json
// is read only, for the A-15 delta before the first launch and after every case. Exports land under the run's
// `<userData>/exports/` (printed) and are copied into spikes/protocol-probe/fixtures/pass3/ and
// test/fixtures/transcripts/ by hand after a look by eye.
// `MAWS_LIVE=1 pnpm exec vitest run --project live test/live/maws-tools.live.test.ts`
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import { captureShellEnvironment } from '@shared/host/shell-env';
import type { MawsPaneShow } from '@shared/ipc/schema/maws';
import { TOOL_ERRORS, type AskAnswer } from '@shared/maws/tools';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { createBinaryProbe } from '../../src/engine-host/binary-info';
import { buildEnvironment, RELAY_URL } from '../../src/engine-host/launch';
import { checkRelay } from '../../src/engine-host/relay-health';
import { exportFixture, journalCost, liveSpec, redactJournal, type Provenance } from './support/live';
import { LiveHost } from './support/live-host';
import { withoutClaudeVariables } from '../support/claude-env';

const TURN_MS = 300_000; // the machine is heavily loaded: generous waits, and a case that only timed out is re-run
const CASE_MS = 600_000;
const PIN = 'a346e00b0f9662062fb76841590cbe8d10920697'; // the P1 spec's blob at master 4256c78f (the E1 document's pin)

type Kind = SessionEvent['kind'];
type Ev<K extends Kind> = Extract<SessionEvent, { kind: K }>;
const ofKind = <K extends Kind>(events: SessionEvent[], kind: K): Ev<K>[] => events.filter((e): e is Ev<K> => e.kind === kind);
const mainTurnsEnded = (events: SessionEvent[]) => ofKind(events, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Gate {
  userData: string;
  home: string; // the scratch CLAUDE_CONFIG_DIR every launch of the run shares
  bin: string; // the installed engine the product resolves with no binary configured
  version: string;
}
let gate: { skip: string } | Gate;
let a15Before: string[] = [];
const costs: { label: string; costUsd: number }[] = [];
const exports: string[] = [];
let case1: { repo: string; engineSessionId: string } | null = null;

// The owner's ~/.claude.json, read only: the project keys under /tmp (A-15). A launch that leaked its scratch project
// into the owner's file would add one.
function a15(): string[] {
  const projects = (JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')) as { projects?: Record<string, unknown> }).projects ?? {};
  return Object.keys(projects).filter((k) => k.startsWith('/tmp') || k.startsWith('/private/tmp')).sort();
}

// A scratch git repository under /tmp (so a leak would show in the A-15 delta), trusted in the scratch home.
function scratchRepo(g: Gate): string {
  const dir = realpathSync(mkdtempSync('/tmp/maws-e1-repo-'));
  writeFileSync(join(dir, 'one.txt'), 'ONE\n');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', '.keep'), '');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Live', '-c', 'user.email=live@localhost', 'commit', '-qm', 'seed'], { cwd: dir });
  const claudeJson = join(g.home, '.claude.json');
  const state: { projects?: Record<string, unknown> } & Record<string, unknown> = existsSync(claudeJson) ? JSON.parse(readFileSync(claudeJson, 'utf8')) : { hasCompletedOnboarding: true, theme: 'light' };
  state.projects = { ...state.projects, [dir]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } };
  writeFileSync(claudeJson, `${JSON.stringify(state, null, 2)}\n`);
  return dir;
}

beforeAll(async () => {
  if (process.env.MAWS_LIVE !== '1') {
    gate = { skip: 'live tests skipped: MAWS_LIVE is not 1' };
    return;
  }
  let relay = await checkRelay(RELAY_URL, undefined, { force: true });
  if (!relay.ok) {
    console.log(`   relay not ready (${JSON.stringify(relay)}); waiting two minutes and retrying once`);
    await delay(120_000);
    relay = await checkRelay(RELAY_URL, undefined, { force: true });
  }
  if (!relay.ok) {
    gate = { skip: `live tests skipped: relay at ${RELAY_URL} unreachable — start ClaudeUsage` };
    return;
  }
  const check = await createBinaryProbe({ captureEnv: () => captureShellEnvironment() })();
  if (!check.ok || check.version === null) {
    gate = { skip: `live tests skipped: the installed engine did not answer its version (${check.error ?? check.path})` };
    return;
  }
  const home = realpathSync(mkdtempSync('/tmp/maws-e1-config-'));
  writeFileSync(join(home, 'settings.json'), '{}\n');
  gate = { userData: realpathSync(mkdtempSync('/tmp/maws-e1-live-')), home, bin: check.path, version: check.version };
  a15Before = a15();
  console.info(`[live engine] ${check.path} (${check.version}); scratch home ${home}; userData ${gate.userData}`);
  console.info(`   A-15 before: ${a15Before.length} keys`);
}, 300_000);

afterAll(() => {
  if ('skip' in gate) return;
  for (const line of exports) console.log(`   exported: ${line}`);
  for (const { label, costUsd } of costs) console.log(`   cost ${label}: total_cost_usd ${costUsd.toFixed(4)}`);
  console.log(`   live cost: total_cost_usd sum = $${costs.reduce((sum, c) => sum + c.costUsd, 0).toFixed(4)}`);
});

function live(ctx: TestContext): Gate {
  if ('skip' in gate) {
    console.log(`↓ ${gate.skip}`);
    ctx.skip(gate.skip);
  }
  return gate as Gate;
}

function readJournal(path: string): JournalRow[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseJournalRow(JSON.parse(line)));
}

// One session of one case, through the X2 surface: launched on Haiku in default mode, every permission the engine asks
// allowed once as it arrives, ended with session.stop; the journal booked (cost), exported with E1's provenance, and the
// A-15 delta checked, whatever the case's outcome.
async function withSession(g: Gate, scenario: string, fn: (s: ReturnType<typeof view>, repo: string, spec: LaunchSpec) => Promise<void>): Promise<{ journalPath: string; spec: LaunchSpec; repo: string }> {
  const host = new LiveHost({ userData: g.userData, configHome: g.home, binary: null });
  const repo = scratchRepo(g);
  const spec = liveSpec(repo, { model: 'haiku', permissionMode: 'default', subagentModel: null });
  let journalPath = '';
  let allowing = true;
  try {
    const { status } = await host.launch(spec, 120_000);
    journalPath = status.journalPath;
    const s = view(host, spec);
    const allowed = new Set<string>();
    void (async () => {
      while (allowing) {
        for (const ask of ofKind(s.events(), 'permission.requested')) {
          if (allowed.has(ask.requestId)) continue;
          allowed.add(ask.requestId);
          console.log(`   allow once: ${ask.toolName} (seq ${ask.seq})`);
          await host.call('session.answer', { appSessionId: spec.appSessionId, requestId: ask.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }).catch((error: unknown) => console.log(`   allow failed: ${String(error)}`));
        }
        await delay(100);
      }
    })();
    await fn(s, repo, spec);
    await s.quiet();
    allowing = false;
    const stopped = await host.call('session.stop', { appSessionId: spec.appSessionId, reason: 'stop' });
    console.log(`   session.stop: ${JSON.stringify(stopped)}`);
  } finally {
    allowing = false;
    await host.shutdown().catch((error: unknown) => console.log(`   shutdown failed: ${String(error)}`));
    if (journalPath) {
      const { costUsd } = journalCost(readJournal(journalPath));
      costs.push({ label: scenario, costUsd });
      console.log(`   journal: ${journalPath} (total_cost_usd ${costUsd.toFixed(4)})`);
      exportJournal(scenario, journalPath, g, costUsd);
    }
    expect(a15(), 'the A-15 delta: no scratch project in the owner file').toEqual(a15Before);
  }
  return { journalPath, spec, repo };
}

function view(host: LiveHost, spec: LaunchSpec) {
  const id = spec.appSessionId;
  const events = () => host.events(id);
  return {
    id,
    host,
    events,
    wait: <K extends Kind>(kind: K, what: string, pred: (e: Ev<K>) => boolean = () => true, ms = TURN_MS) => host.waitFor(() => ofKind(events(), kind).find(pred), `${id} ${kind} ${what}`, ms),
    send: (content: string) => host.call('session.send', { appSessionId: id, content }),
    journal: () => readJournal(host.status(id)!.journalPath),
    paneShows: () => host.emitted.filter((e) => e.name === 'maws.pane.show' && (e.payload as MawsPaneShow).appSessionId === id).map((e) => e.payload as MawsPaneShow),
    // the turn ended and the host's own reads after it were answered (no request of either side left open), then 3 s still
    quiet: async () => {
      await host.waitFor(() => host.status(id)?.turn === null && host.status(id)?.pendingRequests === 0, `${id} idle with nothing pending`, TURN_MS);
      await delay(3_000);
    },
  };
}

function exportJournal(scenario: string, journalPath: string, g: Gate, costUsd: number): void {
  const dir = join(g.userData, 'exports');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${scenario}.jsonl`);
  const provenance: Provenance = { charter: 'docs/charter.md', child: 'E1', pin: PIN, document: 'docs/doperpowers/plans/2026-10-05-p1-extension.md', engineVersion: g.version, model: 'haiku', scenario, costUsd: costUsd.toFixed(4) };
  writeFileSync(dest, exportFixture(readFileSync(journalPath, 'utf8'), undefined, undefined, provenance));
  exports.push(`${scenario}: ${dest} (from ${journalPath})`);
}

// The engine's transcript of one session in the scratch home, redacted, beside the journal exports.
function exportTranscript(name: string, g: Gate, engineSessionId: string): string {
  const projects = join(g.home, 'projects');
  const source = readdirSync(projects).map((dir) => join(projects, dir, `${engineSessionId}.jsonl`)).find((path) => existsSync(path));
  if (!source) throw new Error(`no transcript for ${engineSessionId} under ${projects}`);
  const dest = join(g.userData, 'exports', `${name}.jsonl`);
  const text = redactJournal(readFileSync(source, 'utf8'));
  writeFileSync(dest, text);
  exports.push(`${name}: ${dest} (transcript ${source})`);
  return text;
}

const outRows = (rows: JournalRow[]) => rows.filter((r) => r.direction === 'out').map((r) => r.frame as Record<string, unknown>);
const textOf = (content: unknown): string => (typeof content === 'string' ? content : JSON.stringify(content));

describe('the maws tool server, live (E1 M2)', () => {
  it('1 send_file delivers hello.txt with its caption', async (ctx) => {
    const g = live(ctx);
    const { spec, repo } = await withSession(g, 'p1-maws-send-file', async (s, repo, spec) => {
      await s.send('Write a file named hello.txt containing exactly HELLO_E1 in the working directory, then deliver it to me with the maws send_file tool with the caption "the greeting". Reply DELIVERED when done.');
      const init = await s.wait('session.init', 'the init');
      expect(init.tools).toEqual(expect.arrayContaining(['mcp__maws__send_file', 'mcp__maws__ask', 'mcp__maws__show_pane']));
      expect(init.mcpServers).toContainEqual({ name: 'maws', status: 'connected', source: 'sdk' });
      const delivered = await s.wait('maws.delivery.file', 'the delivery');
      expect(delivered.deliverables).toHaveLength(1);
      expect(basename(delivered.deliverables[0]!.path)).toBe('hello.txt');
      expect(delivered.caption).toBe('the greeting');
      const record = join(g.userData, 'deliverables', spec.appSessionId, `${delivered.deliverables[0]!.id}.json`);
      expect(JSON.parse(readFileSync(record, 'utf8'))).toMatchObject({ id: delivered.deliverables[0]!.id, kind: 'file', path: join(repo, 'hello.txt'), title: 'hello.txt', caption: 'the greeting' });
      const ended = await s.host.waitFor(() => mainTurnsEnded(s.events())[0], 'the turn', TURN_MS);
      console.log(`   reply: ${JSON.stringify(ended.resultText)}`);
    });
    case1 = { repo, engineSessionId: spec.sessionId! };
  }, CASE_MS);

  it('2 a blocking ask with five modalities, answered through maws.ask.answer', async (ctx) => {
    const g = live(ctx);
    await withSession(g, 'p1-maws-ask-blocking', async (s, repo) => {
      await s.send('Use the maws ask tool (blocking) to ask me five questions, with these ids and modalities: q1 choice single with options Red, Green, Blue ("Which colour?"); q2 choice multi with options Mon, Tue, Wed ("Which days?"); q3 text ("What should the title be?"); q4 folder ("Which folder holds the assets?"); q5 repository ("Which repository is this for?"). Then reply with one line per question: id, then the answer or SKIPPED or DECIDE.');
      const opened = await s.wait('maws.ask.opened', 'the ask');
      console.log(`   opened: ${JSON.stringify(opened.questions)}`);
      expect(opened.blocking).toBe(true);
      expect(opened.questions.map((q) => [q.id, q.modality])).toEqual([['q1', 'choice'], ['q2', 'choice'], ['q3', 'text'], ['q4', 'folder'], ['q5', 'repository']]);
      const text = (id: string) => opened.questions.find((q) => q.id === id)!.question;
      const answers: AskAnswer[] = [
        { id: 'q1', question: text('q1'), status: 'answered', value: ['Blue'] },
        { id: 'q2', question: text('q2'), status: 'answered', value: ['Mon', 'Wed'], otherText: 'Fri' },
        { id: 'q3', question: text('q3'), status: 'skipped' },
        { id: 'q4', question: text('q4'), status: 'answered', value: [join(repo, 'assets')] },
        { id: 'q5', question: text('q5'), status: 'decide_for_me' },
      ];
      expect(await s.host.call('maws.asks.list', { appSessionId: s.id })).toMatchObject({ asks: [{ askId: opened.askId, blocking: true }] });
      expect(await s.host.call('maws.ask.answer', { appSessionId: s.id, askId: opened.askId, answers })).toEqual({ outcome: 'delivered' });
      const answered = await s.wait('maws.ask.answered', 'the answer');
      expect(answered).toMatchObject({ askId: opened.askId, delivery: 'result', answers });
      const ended = await s.host.waitFor(() => mainTurnsEnded(s.events())[0], 'the turn', TURN_MS);
      console.log(`   reply: ${JSON.stringify(ended.resultText)}`);
      expect(ended.resultText).toMatch(/Blue/);
      expect(ended.resultText).toMatch(/SKIPPED/);
    });
  }, CASE_MS);

  it('3 an async ask: acknowledged at once, answered later as a next steer', async (ctx) => {
    const g = live(ctx);
    let engineSessionId = '';
    await withSession(g, 'p1-maws-ask-async', async (s, _repo, spec) => {
      engineSessionId = spec.sessionId!;
      await s.send('Use the maws ask tool with blocking false to ask me one choice question with id q1 and options Yes, No ("Proceed?"). Then, without waiting, run the Bash command `sleep 15; echo WAITED` and report its output. When my answer arrives, reply with ANSWER: followed by it.');
      const opened = await s.wait('maws.ask.opened', 'the async ask', (e) => !e.blocking);
      await delay(2_000);
      const answers: AskAnswer[] = [{ id: 'q1', question: opened.questions[0]!.question, status: 'answered', value: ['Yes'] }];
      expect(await s.host.call('maws.ask.answer', { appSessionId: s.id, askId: opened.askId, answers })).toEqual({ outcome: 'delivered' });
      const answered = await s.wait('maws.ask.answered', 'the answer');
      expect(answered).toMatchObject({ askId: opened.askId, delivery: 'steer', answers });
      const steer = outRows(s.journal()).find((f) => f.type === 'user' && textOf((f.message as { content: unknown }).content).startsWith(`[MAWS ask ${opened.askId}]`));
      expect(steer?.priority).toBe('next');
      const replied = await s.host.waitFor(() => mainTurnsEnded(s.events()).find((t) => /ANSWER:\s*Yes/i.test(t.resultText ?? '')), 'the reply naming the answer', TURN_MS);
      console.log(`   reply: ${JSON.stringify(replied.resultText)}`);
    });
    const transcript = exportTranscript('p1-maws-ask-async-transcript', g, engineSessionId);
    expect(transcript).toContain('[MAWS ask ');
  }, CASE_MS);

  it('4 show_pane: terminal opened, deliverable not in this build, an unknown pane refused', async (ctx) => {
    const g = live(ctx);
    await withSession(g, 'p1-maws-show-pane', async (s) => {
      await s.send('Call the maws show_pane tool three times: first with pane "terminal", then with pane "deliverable" and target "none", then with pane "nope". Reply with one line per call: the pane name and the result status or error text.');
      const terminal = await s.host.waitFor(() => s.paneShows()[0], 'the terminal pane request', TURN_MS);
      expect(terminal.pane).toBe('terminal');
      expect(await s.host.call('maws.pane.answer', { appSessionId: s.id, requestId: terminal.requestId, result: { ok: true, opened: { kind: 'panel-tool', toolId: 'terminal', tabId: 'terminal:live', title: 'Terminal' } } })).toEqual({ outcome: 'delivered' });
      const deliverable = await s.host.waitFor(() => s.paneShows()[1], 'the deliverable pane request', TURN_MS);
      expect(deliverable).toMatchObject({ pane: 'deliverable', target: 'none' });
      expect(await s.host.call('maws.pane.answer', { appSessionId: s.id, requestId: deliverable.requestId, result: { ok: false, error: TOOL_ERRORS.paneUnavailable('deliverable') } })).toEqual({ outcome: 'delivered' });
      const ended = await s.host.waitFor(() => mainTurnsEnded(s.events())[0], 'the turn', TURN_MS);
      console.log(`   reply: ${JSON.stringify(ended.resultText)}`);
      const shown = ofKind(s.events(), 'maws.pane.shown');
      expect(shown).toMatchObject([
        { pane: 'terminal', opened: { kind: 'panel-tool', toolId: 'terminal' }, error: null },
        { pane: 'deliverable', target: 'none', opened: null, error: TOOL_ERRORS.paneUnavailable('deliverable') },
      ]);
      const nope = ofKind(s.events(), 'tool.use').find((e) => e.toolName === 'mcp__maws__show_pane' && (e.input as { pane?: string }).pane === 'nope');
      expect(nope).toBeDefined();
      const refused = ofKind(s.events(), 'tool.result').find((e) => e.toolUseId === nope!.toolUseId)!;
      expect(refused.isError).toBe(true);
      expect(textOf(refused.content)).toContain(TOOL_ERRORS.unknownPane('nope'));
      expect(s.paneShows()).toHaveLength(2);
    });
  }, CASE_MS);

  // residue 15: the same session resumed outside MAWS (headless, no --input-format stream-json, no initialize, so no
  // SDK server) lists no maws tool, and the turn completes
  it('5 a terminal resume of case 1 has no maws tools and completes', async (ctx) => {
    const g = live(ctx);
    if (case1 === null) ctx.skip('case 1 did not record a session');
    const { repo, engineSessionId } = case1!;
    const captured = { ...withoutClaudeVariables(await captureShellEnvironment()), CLAUDE_CONFIG_DIR: g.home }; // E11 W-E: no inherited CLAUDE*
    const env = buildEnvironment(liveSpec(repo, { subagentModel: null }), captured, RELAY_URL);
    delete env.CLAUDE_CODE_ENTRYPOINT; // a terminal launch, not the SDK's
    const prompt = 'Reply with the names of the tools you have whose names start with mcp__maws, or NONE if there are none.';
    const args = ['-p', '--resume', engineSessionId, '--output-format', 'stream-json', '--verbose', '--model', 'haiku', prompt];
    const { stdout, code } = await new Promise<{ stdout: string; code: number | null }>((resolve) => {
      execFile(g.bin, args, { cwd: repo, env, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }, (error, out) => resolve({ stdout: out, code: error ? ((error as { code?: number }).code ?? 1) : 0 }));
    });
    const frames = stdout.split('\n').filter((line) => line.trim().startsWith('{')).map((line) => JSON.parse(line) as Record<string, unknown>);
    const init = frames.find((f) => f.type === 'system' && f.subtype === 'init') as { tools: string[]; mcp_servers: { name: string }[] } | undefined;
    const result = frames.find((f) => f.type === 'result') as { subtype: string; is_error: boolean; result: string; total_cost_usd?: number } | undefined;
    const costUsd = result?.total_cost_usd ?? 0;
    costs.push({ label: 'terminal-resume (cumulative for the resumed session)', costUsd });
    const evidence = join(g.userData, 'exports', 'terminal-resume.jsonl');
    mkdirSync(join(g.userData, 'exports'), { recursive: true });
    writeFileSync(evidence, redactJournal(stdout));
    exports.push(`terminal-resume: ${evidence}`);
    const maws = (init?.tools ?? []).filter((t) => t.startsWith('mcp__maws__'));
    const line = `G1 terminal half: ${g.bin} ${args.slice(0, -1).join(' ')} <prompt>: exit ${code}; system/init.tools ${init?.tools.length ?? 'absent'} tools, mcp__maws__* ${JSON.stringify(maws)}; mcp_servers ${JSON.stringify((init?.mcp_servers ?? []).map((m) => m.name))}; result ${result?.subtype} ${JSON.stringify(result?.result)}`;
    writeFileSync(join(g.userData, 'exports', 'terminal-resume.txt'), `${line}\n`);
    console.log(`   ${line}`);
    expect(a15(), 'the A-15 delta after the terminal resume').toEqual(a15Before);
    expect(code).toBe(0);
    expect(init).toBeDefined();
    expect(maws).toEqual([]);
    expect((init?.mcp_servers ?? []).map((m) => m.name)).not.toContain('maws');
    expect(result).toMatchObject({ subtype: 'success', is_error: false });
    expect(result!.result).toContain('NONE');
  }, CASE_MS);
});
