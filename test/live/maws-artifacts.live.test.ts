// E2 M2's live recording (docs/doperpowers/plans/2026-10-06-e2-deliverables.md, Plan of Work M2): the four artifact tools
// of the `maws` server against the installed Claude Code (`binary: null`), through MAWS's own engine host (LiveHost:
// registerEngineIpc, the launcher, EngineSession, the file deliverable store, the journal), under a scratch config home
// under /tmp, through ClaudeUsage's relay, on Haiku in default permission mode with every permission allowed once. The
// host has no main here, so the case plays main's part of `artifact_screenshot`: it answers each `maws.artifact.capture`
// with a solid-green 64×64 PNG through `maws.artifact.captured`. The page the prompt asks for is red, so a reply that
// names green proves the model read the image block (Decision Log 26). The owner's ~/.claude.json is read only, for the
// A-15 delta. The journal (with E2's provenance) and the engine's transcript land under the run's `<userData>/exports/`
// (printed) and are copied into spikes/protocol-probe/fixtures/pass3/p1-maws-artifacts.jsonl and
// test/fixtures/transcripts/p1-maws-artifacts.jsonl by hand after a look by eye.
// The gate, the scratch repository and the session loop follow E1's maws-tools.live.test.ts.
// `MAWS_LIVE=1 pnpm exec vitest run --project live test/live/maws-artifacts.live.test.ts`
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { captureShellEnvironment } from '@shared/host/shell-env';
import type { MawsArtifactCapture } from '@shared/ipc/schema/maws';
import { DeliverableRecordSchema } from '@shared/maws/deliverable';
import { versionPath } from '@shared/maws/deliverable-files';
import { TOOL_ERRORS } from '@shared/maws/tools';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { createBinaryProbe } from '../../src/engine-host/binary-info';
import { RELAY_URL } from '../../src/engine-host/launch';
import { checkRelay } from '../../src/engine-host/relay-health';
import { exportFixture, journalCost, liveSpec, redactJournal, type Provenance } from './support/live';
import { LiveHost } from './support/live-host';

const TURN_MS = 300_000; // the machine is heavily loaded: generous waits
const CASE_MS = 600_000;
const PIN = '7094958a1431369ef699ff9875cd7e9259a37695'; // the P1 spec's blob at master 2224b4b0 (Decision Log 24)
const SCENARIO = 'p1-maws-artifacts';

// A solid-green (#00ff00) 64×64 RGB PNG, 132 bytes, built with zlib in the shape of M0's red constant
// (scenarios/pass3/p1-sdk-mcp-image.mjs; copied, not imported: importing the scenario runs the engine at load).
const GREEN_SQUARE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsJp+ExAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBC4LLjs8OJxKlMxAAAAAElFTkSuQmCC';

// The document's prompt, steered as M0's was (Surprises): every tool by its full `mcp__maws__` name, and the calls made
// "yourself, not through an agent", since Haiku otherwise handed a deferred MCP tool's call to a background Agent.
const PROMPT =
  'Write a self-contained HTML file named dashboard.html in the working directory whose body is one full-page div with an inline red background and the text HELLO_E2, with no external resources. ' +
  'Register it with the mcp__maws__artifact_create tool using id "dash" and title "Dashboard". ' +
  'Then call the mcp__maws__artifact_screenshot tool for id "dash" and note in one word what colour fills the picture (report what the picture shows; do not investigate). ' +
  'Then rewrite dashboard.html with a blue background and call the mcp__maws__artifact_update tool for id "dash". ' +
  'Then call the mcp__maws__artifact_list tool. ' +
  'Then call mcp__maws__artifact_update with id "nope" and the same file and note the error text. ' +
  'Make every one of these calls yourself, one after another, not through an agent. ' +
  'Reply with one line: the colour word, the number of versions artifact_list reported, and the first six words of the error.';

type Kind = SessionEvent['kind'];
type Ev<K extends Kind> = Extract<SessionEvent, { kind: K }>;
const ofKind = <K extends Kind>(events: SessionEvent[], kind: K): Ev<K>[] => events.filter((e): e is Ev<K> => e.kind === kind);
const mainTurnsEnded = (events: SessionEvent[]) => ofKind(events, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const textOf = (content: unknown): string => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((b: { text?: unknown }) => (typeof b.text === 'string' ? b.text : '')).join('\n') : JSON.stringify(content));

interface Gate {
  userData: string;
  home: string; // the scratch CLAUDE_CONFIG_DIR
  version: string;
}
let gate: { skip: string } | Gate;
let a15Before: string[] = [];
const report: string[] = [];

// The owner's ~/.claude.json, read only: the project keys under /tmp (A-15).
function a15(): string[] {
  const projects = (JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')) as { projects?: Record<string, unknown> }).projects ?? {};
  return Object.keys(projects).filter((k) => k.startsWith('/tmp') || k.startsWith('/private/tmp')).sort();
}

// A scratch git repository under /tmp (so a leak would show in the A-15 delta), trusted in the scratch home.
function scratchRepo(g: Gate): string {
  const dir = realpathSync(mkdtempSync('/tmp/maws-e2-repo-'));
  writeFileSync(join(dir, 'one.txt'), 'ONE\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Live', '-c', 'user.email=live@localhost', 'commit', '-qm', 'seed'], { cwd: dir });
  const state = { hasCompletedOnboarding: true, theme: 'light', projects: { [dir]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } };
  writeFileSync(join(g.home, '.claude.json'), `${JSON.stringify(state, null, 2)}\n`);
  return dir;
}

function readJournal(path: string): JournalRow[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseJournalRow(JSON.parse(line)));
}

beforeAll(async () => {
  if (process.env.MAWS_LIVE !== '1') {
    gate = { skip: 'live tests skipped: MAWS_LIVE is not 1' };
    return;
  }
  const relay = await checkRelay(RELAY_URL, undefined, { force: true });
  if (!relay.ok) {
    gate = { skip: `live tests skipped: relay at ${RELAY_URL} unreachable — start ClaudeUsage` };
    return;
  }
  const check = await createBinaryProbe({ captureEnv: () => captureShellEnvironment() })();
  if (!check.ok || check.version === null) {
    gate = { skip: `live tests skipped: the installed engine did not answer its version (${check.error ?? check.path})` };
    return;
  }
  const home = realpathSync(mkdtempSync('/tmp/maws-e2-config-'));
  writeFileSync(join(home, 'settings.json'), '{}\n');
  gate = { userData: realpathSync(mkdtempSync('/tmp/maws-e2-live-')), home, version: check.version };
  a15Before = a15();
  report.push(`engine ${check.path} (${check.version}); scratch home ${home}; userData ${gate.userData}`, `A-15 before: ${a15Before.length} keys`);
}, 120_000);

afterAll(() => {
  for (const line of report) console.log(`   ${line}`);
});

function live(ctx: TestContext): Gate {
  if ('skip' in gate) {
    console.log(`↓ ${gate.skip}`);
    ctx.skip(gate.skip);
  }
  return gate as Gate;
}

// The journal row the host wrote to answer the engine's `mcp_message` request `requestId`: its JSON-RPC response.
type McpContent = { type: string; text?: string; data?: string; mimeType?: string }[];
function mcpResponseOf(rows: JournalRow[], requestId: string): { result: { content: McpContent; isError?: boolean } } | undefined {
  const row = rows.find((r) => r.direction === 'out' && (r.frame as { type?: string; response?: { request_id?: string } }).type === 'control_response' && (r.frame as { response: { request_id: string } }).response.request_id === requestId);
  return (row?.frame as { response: { response: { mcp_response: { result: { content: McpContent; isError?: boolean } } } } } | undefined)?.response.response.mcp_response;
}

describe('the maws artifact tools, live (E2 M2)', () => {
  it('creates, screenshots, updates and lists an artifact, and refuses an unknown id', async (ctx) => {
    const g = live(ctx);
    const host = new LiveHost({ userData: g.userData, configHome: g.home, binary: null });
    const repo = scratchRepo(g);
    const spec = liveSpec(repo, { model: 'haiku', permissionMode: 'default', subagentModel: null });
    const id = spec.appSessionId;
    const events = () => host.events(id);
    let journalPath = '';
    let running = true;
    try {
      const { status } = await host.launch(spec, 120_000);
      journalPath = status.journalPath;
      // every permission allowed once as it arrives; every capture answered with the green square, as main would
      const allowed = new Set<string>();
      const captured = new Set<string>();
      void (async () => {
        while (running) {
          for (const ask of ofKind(events(), 'permission.requested')) {
            if (allowed.has(ask.requestId)) continue;
            allowed.add(ask.requestId);
            console.log(`   allow once: ${ask.toolName} (seq ${ask.seq})`);
            await host.call('session.answer', { appSessionId: id, requestId: ask.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }).catch((error: unknown) => console.log(`   allow failed: ${String(error)}`));
          }
          for (const e of host.emitted) {
            if (e.name !== 'maws.artifact.capture') continue;
            const capture = e.payload as MawsArtifactCapture;
            if (capture.appSessionId !== id || captured.has(capture.requestId)) continue;
            captured.add(capture.requestId);
            console.log(`   capture: ${JSON.stringify(capture)}`);
            await host
              .call('maws.artifact.captured', { appSessionId: id, requestId: capture.requestId, result: { ok: true, png: GREEN_SQUARE_PNG, width: 64, height: 64, consoleErrors: [] } })
              .then((answered) => console.log(`   captured: ${JSON.stringify(answered)}`))
              .catch((error: unknown) => console.log(`   capture answer failed: ${String(error)}`));
          }
          await delay(100);
        }
      })();

      await host.call('session.send', { appSessionId: id, content: PROMPT });
      const init = await host.waitFor(() => ofKind(events(), 'session.init')[0], 'the init', TURN_MS);
      expect(init.tools).toEqual(expect.arrayContaining(['mcp__maws__artifact_create', 'mcp__maws__artifact_update', 'mcp__maws__artifact_list', 'mcp__maws__artifact_screenshot']));
      const ended = await host.waitFor(() => mainTurnsEnded(events())[0], 'the turn', TURN_MS);
      await host.waitFor(() => host.status(id)?.turn === null && host.status(id)?.pendingRequests === 0, 'idle with nothing pending', TURN_MS);
      await delay(3_000);
      running = false;
      console.log(`   reply: ${JSON.stringify(ended.resultText)}`);
      report.push(`reply: ${JSON.stringify(ended.resultText)}`);
      const stopped = await host.call('session.stop', { appSessionId: id, reason: 'stop' });
      report.push(`session.stop: ${JSON.stringify(stopped)}`);

      // the X1 facts: create v1, then update v2, and nothing for the refused update
      const artifacts = ofKind(events(), 'maws.delivery.artifact');
      report.push(`maws.delivery.artifact: ${JSON.stringify(artifacts.map(({ action, artifactId, version, title, deliverableId }) => ({ action, artifactId, version, title, deliverableId })))}`);
      expect(artifacts.map((e) => [e.action, e.artifactId, e.version, e.title])).toEqual([['create', 'dash', 1, 'Dashboard'], ['update', 'dash', 2, 'Dashboard']]);
      const deliverableId = artifacts[0]!.deliverableId;
      expect(artifacts[1]!.deliverableId).toBe(deliverableId);

      // the screenshot's answer, as the host wrote it: the image block first, then the result's JSON
      const rows = readJournal(journalPath);
      const shot = ofKind(events(), 'tool.use').find((e) => e.toolName === 'mcp__maws__artifact_screenshot');
      expect(shot, 'the model called artifact_screenshot').toBeDefined();
      const callRow = rows.find((r) => r.direction === 'in' && (r.frame as { request?: { subtype?: string; message?: { method?: string; params?: { name?: string } } } }).request?.message?.params?.name === 'artifact_screenshot');
      const answer = mcpResponseOf(rows, (callRow!.frame as { request_id: string }).request_id)!;
      expect(answer.result.content.map((b) => b.type)).toEqual(['image', 'text']);
      expect(answer.result.content[0]).toEqual({ type: 'image', data: GREEN_SQUARE_PNG, mimeType: 'image/png' });
      expect(JSON.parse(answer.result.content[1]!.text!)).toMatchObject({ status: 'captured', id: 'dash', deliverableId, title: 'Dashboard', version: 1, width: 64, height: 64, consoleErrors: [] });

      // the refused update, as the model read it
      const nope = ofKind(events(), 'tool.use').find((e) => e.toolName === 'mcp__maws__artifact_update' && (e.input as { id?: string }).id === 'nope');
      expect(nope, 'the model called artifact_update for "nope"').toBeDefined();
      const refused = ofKind(events(), 'tool.result').find((e) => e.toolUseId === nope!.toolUseId)!;
      expect(refused.isError).toBe(true);
      expect(textOf(refused.content)).toContain(TOOL_ERRORS.noArtifact('artifact_update', 'nope'));

      // the store on disk: one artifact record with two versions copied under it, `path` on v2
      const record = DeliverableRecordSchema.parse(JSON.parse(readFileSync(join(g.userData, 'deliverables', id, `${deliverableId}.json`), 'utf8')));
      const v1 = versionPath(g.userData, id, deliverableId, 1);
      const v2 = versionPath(g.userData, id, deliverableId, 2);
      expect(record).toMatchObject({ kind: 'artifact', artifactId: 'dash', title: 'Dashboard', path: v2 });
      expect(record.versions.map((v) => [v.path, realpathSync(v.sourcePath!)])).toEqual([[v1, join(repo, 'dashboard.html')], [v2, join(repo, 'dashboard.html')]]);
      expect(readFileSync(v1, 'utf8')).not.toBe(readFileSync(v2, 'utf8'));
      expect(readFileSync(v2, 'utf8')).toBe(readFileSync(join(repo, 'dashboard.html'), 'utf8'));
      report.push(`record ${deliverableId}.json: ${JSON.stringify(record)}`);

      // the reply: the colour the picture shows (green, which the prompt never names), the two versions, the error
      expect(ended.resultText).toMatch(/green/i);
      expect(ended.resultText).toMatch(/\b2\b/);
      // counting "the first six words", the model may drop the quotes (both recordings did: `green 2 artifact_update no
      // artifact nope in`)
      expect(ended.resultText).toMatch(/no artifact "?nope"?/);
    } finally {
      running = false;
      await host.shutdown().catch((error: unknown) => console.log(`   shutdown failed: ${String(error)}`));
      if (journalPath) {
        const { costUsd } = journalCost(readJournal(journalPath));
        report.push(`journal ${journalPath}: total_cost_usd ${costUsd.toFixed(4)}`);
        const exports = join(g.userData, 'exports');
        mkdirSync(exports, { recursive: true });
        const provenance: Provenance = { charter: 'docs/charter.md', child: 'E2', pin: PIN, document: 'docs/doperpowers/plans/2026-10-05-p1-extension.md', executionDocument: 'docs/doperpowers/plans/2026-10-06-e2-deliverables.md', engineVersion: g.version, model: 'haiku', scenario: SCENARIO, costUsd: costUsd.toFixed(4) };
        writeFileSync(join(exports, `${SCENARIO}.jsonl`), exportFixture(readFileSync(journalPath, 'utf8'), undefined, undefined, provenance));
        report.push(`exported: ${join(exports, `${SCENARIO}.jsonl`)}`);
        const projects = join(g.home, 'projects');
        const transcript = existsSync(projects) ? readdirSync(projects).map((dir) => join(projects, dir, `${spec.sessionId}.jsonl`)).find((path) => existsSync(path)) : undefined;
        if (transcript) {
          writeFileSync(join(exports, `${SCENARIO}-transcript.jsonl`), redactJournal(readFileSync(transcript, 'utf8')));
          report.push(`exported: ${join(exports, `${SCENARIO}-transcript.jsonl`)} (transcript ${transcript})`);
        } else report.push(`no transcript for ${spec.sessionId} under ${projects}`);
      }
      const after = a15();
      report.push(`A-15 after: ${after.length} keys, ${JSON.stringify(after) === JSON.stringify(a15Before) ? 'identical' : `CHANGED: ${JSON.stringify(after)}`}`);
      expect(after, 'the A-15 delta: no scratch project in the owner file').toEqual(a15Before);
    }
  }, CASE_MS);
});
