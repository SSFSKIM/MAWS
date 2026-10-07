// E4c M4's live recording (docs/doperpowers/plans/2026-10-06-e4c-browser-tools.md, Design §13, Acceptance G1): the six
// browser tools of the `maws` server against the installed Claude Code (`binary: null`), through MAWS's own engine host
// (LiveHost: registerEngineIpc, the launcher, EngineSession, the file deliverable store, the journal), under a scratch
// config home under /tmp, through ClaudeUsage's relay, on Haiku in default permission mode with every permission allowed
// once. The host has no main here, so the case plays it through the stand-in (support/browser-stand-in.ts), which
// answers each `maws.browser.request` with what the real app produces for the same calls on E4c's e2e server, so the
// e2e can replay the recording against the real app. The owner's ~/.claude.json is read only, for the A-15 delta. The
// journal (with E4c's provenance) and the engine's transcript land under the run's `<userData>/exports/` (printed) and
// are copied into
// spikes/protocol-probe/fixtures/pass3/p1-maws-browser.jsonl and test/fixtures/transcripts/p1-maws-browser.jsonl by
// hand after a look by eye. The gate, the scratch repository and the session loop follow E2's maws-artifacts.live.test.ts.
// `MAWS_LIVE=1 pnpm exec vitest run --project live test/live/maws-browser.live.test.ts`
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { captureShellEnvironment } from '@shared/host/shell-env';
import type { MawsBrowserRequest } from '@shared/ipc/schema/maws';
import { BROWSER_TOOL_NAMES } from '@shared/maws/browser';
import { DeliverableRecordSchema } from '@shared/maws/deliverable';
import { recordPath } from '@shared/maws/deliverable-files';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { createBinaryProbe } from '../../src/engine-host/binary-info';
import { RELAY_URL } from '../../src/engine-host/launch';
import { checkRelay } from '../../src/engine-host/relay-health';
import { BrowserStandIn, DONE_SNAPSHOT, DONE_TITLE, DONE_URL, FORM_SNAPSHOT, GREEN_SQUARE_PNG, TAB_ID } from './support/browser-stand-in';
import { exportFixture, journalCost, liveSpec, redactJournal, type Provenance } from './support/live';
import { LiveHost } from './support/live-host';

const TURN_MS = 300_000; // the machine is heavily loaded: generous waits
const CASE_MS = 600_000;
const PIN = 'b96c1a923e9d828745620746a3e5e8e7b9e67a52'; // the P1 spec's blob at master 32c2b016 (Decision Log 28, 34 (d))
const SCENARIO = 'p1-maws-browser';
const MAX_BUDGET_USD = 0.2; // one recording costs about US$0.10; three runs at this cap fit the child's US$0.60

// Design §13's prompt, with one sentence added before the first run (the form snapshot shows Submit `[disabled]`: the
// page enables it 1.2 s after the Email field's last input, and the real click's readiness wait covers that).
const PROMPT =
  'Use the MAWS browser tools, calling each tool yourself, one after another, never through an agent. ' +
  'First call mcp__maws__browser_tabs with action "open" and url "http://127.0.0.1:17391/form.html" and note the tabId it returns. ' +
  'Then call mcp__maws__browser_snapshot on that tab and find the refs of the Name field, the Email field and the Submit button. ' +
  'Then call mcp__maws__browser_act with action "fill" on the Name field with value "Ada Lovelace", then mcp__maws__browser_act with action "fill" on the Email field with value "ada@example.test", then mcp__maws__browser_act with action "click" on the Submit button. ' +
  'The snapshot shows the Submit button as disabled, but the page enables it by itself once both fields are filled, so click it right after the second fill without taking another snapshot first. ' +
  'Then call mcp__maws__browser_snapshot again and read the reference number the page shows. ' +
  'Then call mcp__maws__browser_screenshot on the tab with no target. ' +
  'Reply with one line: the reference number exactly as shown, and the word "image" if you received a picture.';

type Kind = SessionEvent['kind'];
type Ev<K extends Kind> = Extract<SessionEvent, { kind: K }>;
const ofKind = <K extends Kind>(events: SessionEvent[], kind: K): Ev<K>[] => events.filter((e): e is Ev<K> => e.kind === kind);
const mainTurnsEnded = (events: SessionEvent[]) => ofKind(events, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const dir = realpathSync(mkdtempSync('/tmp/maws-e4c-repo-'));
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
  const home = realpathSync(mkdtempSync('/tmp/maws-e4c-config-'));
  writeFileSync(join(home, 'settings.json'), '{}\n');
  gate = { userData: realpathSync(mkdtempSync('/tmp/maws-e4c-live-')), home, version: check.version };
  a15Before = a15();
  report.push(`engine ${check.path} (${check.version}); scratch home ${home}; userData ${gate.userData}`, `A-15 before: ${a15Before.length} keys ${JSON.stringify(a15Before)}`);
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

describe('the maws browser tools, live (E4c M4)', () => {
  it('opens the form, snapshots it, fills and submits it by ref, reads the reference and takes a screenshot', async (ctx) => {
    const g = live(ctx);
    const host = new LiveHost({ userData: g.userData, configHome: g.home, binary: null });
    const repo = scratchRepo(g);
    const spec = liveSpec(repo, { model: 'haiku', permissionMode: 'default', subagentModel: null, maxBudgetUsd: MAX_BUDGET_USD });
    const id = spec.appSessionId;
    const events = () => host.events(id);
    let journalPath = '';
    let running = true;
    try {
      const { status } = await host.launch(spec, 120_000);
      journalPath = status.journalPath;
      // every permission allowed once as it arrives; every browser request answered by the stand-in, as main would
      const standIn = new BrowserStandIn();
      const allowed = new Set<string>();
      const answered = new Set<string>();
      void (async () => {
        while (running) {
          for (const ask of ofKind(events(), 'permission.requested')) {
            if (allowed.has(ask.requestId)) continue;
            allowed.add(ask.requestId);
            console.log(`   allow once: ${ask.toolName} (seq ${ask.seq})`);
            await host.call('session.answer', { appSessionId: id, requestId: ask.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }).catch((error: unknown) => console.log(`   allow failed: ${String(error)}`));
          }
          for (const e of host.emitted) {
            if (e.name !== 'maws.browser.request') continue;
            const request = e.payload as MawsBrowserRequest;
            if (request.appSessionId !== id || answered.has(request.requestId)) continue;
            answered.add(request.requestId);
            console.log(`   request: ${request.tool} ${JSON.stringify(request.args)}`);
            await host
              .call('maws.browser.answer', { appSessionId: id, requestId: request.requestId, result: standIn.answer(request) })
              .then((outcome) => console.log(`   answered: ${JSON.stringify(outcome)}`))
              .catch((error: unknown) => console.log(`   answer failed: ${String(error)}`));
          }
          await delay(100);
        }
      })();

      await host.call('session.send', { appSessionId: id, content: PROMPT });
      const init = await host.waitFor(() => ofKind(events(), 'session.init')[0], 'the init', TURN_MS);
      expect(init.tools).toEqual(expect.arrayContaining(BROWSER_TOOL_NAMES.map((name) => `mcp__maws__${name}`)));
      const ended = await host.waitFor(() => mainTurnsEnded(events())[0], 'the turn', TURN_MS);
      await host.waitFor(() => host.status(id)?.turn === null && host.status(id)?.pendingRequests === 0, 'idle with nothing pending', TURN_MS);
      await delay(3_000);
      running = false;
      console.log(`   reply: ${JSON.stringify(ended.resultText)}`);
      report.push(`reply: ${JSON.stringify(ended.resultText)}`);
      const stopped = await host.call('session.stop', { appSessionId: id, reason: 'stop' });
      report.push(`session.stop: ${JSON.stringify(stopped)}`);

      // the X1 facts: the seven calls in order, each answered without an error, every act by a ref of the form snapshot
      const actions = ofKind(events(), 'maws.browser.action');
      report.push(`maws.browser.action: ${JSON.stringify(actions.map(({ tool, action, tabId, target, url, ms, deliverableId, error }) => ({ tool, action, tabId, target, url, ms, deliverableId, error })))}`);
      expect(actions.map((e) => e.action)).toEqual(['open', 'snapshot', 'fill', 'fill', 'click', 'snapshot', 'screenshot']);
      expect(actions.map((e) => e.error)).toEqual(Array(7).fill(null));
      expect(actions.slice(1).map((e) => e.tabId)).toEqual(Array(6).fill(TAB_ID));
      expect(actions.slice(2, 5).map((e) => e.target)).toEqual(['e7', 'e10', 'e12']); // Name, Email, Submit (form.snapshot.txt)
      expect(ofKind(events(), 'tool.use').filter((e) => e.toolName === 'mcp__maws__browser_act').map((e) => (e.input as { value?: string }).value)).toEqual(['Ada Lovelace', 'ada@example.test', undefined]);

      // the screenshot's answer, as the host wrote it: the image block first, then the result's JSON
      const rows = readJournal(journalPath);
      const shot = actions.at(-1)!;
      const answer = mcpResponseOf(rows, shot.requestId)!;
      expect(answer.result.content.map((b) => b.type)).toEqual(['image', 'text']);
      expect(answer.result.content[0]).toEqual({ type: 'image', data: GREEN_SQUARE_PNG, mimeType: 'image/png' });
      expect(JSON.parse(answer.result.content[1]!.text!)).toMatchObject({ status: 'ok', tabId: TAB_ID, url: DONE_URL, deliverableId: shot.deliverableId, width: 64, height: 64, mimeType: 'image/png' });
      // the snapshots' answers: the JSON header, then the page's text
      const snapshots = actions.filter((e) => e.action === 'snapshot').map((e) => mcpResponseOf(rows, e.requestId)!.result.content);
      expect(snapshots.map((content) => content.map((b) => b.type))).toEqual([['text', 'text'], ['text', 'text']]);
      expect(snapshots.map((content) => content[1]!.text)).toEqual([FORM_SNAPSHOT, DONE_SNAPSHOT]);

      // the record on disk: a screenshot of the done page, its picture at the path it names
      const record = DeliverableRecordSchema.parse(JSON.parse(readFileSync(recordPath(g.userData, id, shot.deliverableId!), 'utf8')));
      expect(record).toMatchObject({ kind: 'screenshot', sourceUrl: DONE_URL, title: DONE_TITLE, toolUseId: shot.toolUseId });
      expect(statSync(record.path).size).toBe(Buffer.from(GREEN_SQUARE_PNG, 'base64').length);
      report.push(`record ${shot.deliverableId}.json: ${JSON.stringify(record)}`);

      // the reply: the reference the done snapshot shows, and that a picture arrived
      expect(ended.resultText).toMatch(/MAWS-7731/);
      expect(ended.resultText).toMatch(/image/i);
    } finally {
      running = false;
      await host.shutdown().catch((error: unknown) => console.log(`   shutdown failed: ${String(error)}`));
      if (journalPath) {
        const { costUsd } = journalCost(readJournal(journalPath));
        report.push(`journal ${journalPath}: total_cost_usd ${costUsd.toFixed(4)}`);
        const exports = join(g.userData, 'exports');
        mkdirSync(exports, { recursive: true });
        const provenance: Provenance = { charter: 'docs/charter.md', child: 'E4c', pin: PIN, document: 'docs/doperpowers/plans/2026-10-05-p1-extension.md', executionDocument: 'docs/doperpowers/plans/2026-10-06-e4c-browser-tools.md', engineVersion: g.version, model: 'haiku', scenario: SCENARIO, costUsd: costUsd.toFixed(4) };
        writeFileSync(join(exports, `${SCENARIO}.jsonl`), exportFixture(readFileSync(journalPath, 'utf8'), undefined, undefined, provenance));
        report.push(`exported: ${join(exports, `${SCENARIO}.jsonl`)}`);
        const projects = join(g.home, 'projects');
        const transcript = existsSync(projects) ? readdirSync(projects).map((dir) => join(projects, dir, `${spec.sessionId}.jsonl`)).find((path) => existsSync(path)) : undefined;
        if (transcript) {
          writeFileSync(join(exports, `${SCENARIO}-transcript.jsonl`), redactJournal(readFileSync(transcript, 'utf8')));
          report.push(`exported: ${join(exports, `${SCENARIO}-transcript.jsonl`)} (transcript ${transcript}, session ${spec.sessionId})`);
        } else report.push(`no transcript for ${spec.sessionId} under ${projects}`);
      }
      const after = a15();
      report.push(`A-15 after: ${after.length} keys ${JSON.stringify(after)}, ${JSON.stringify(after) === JSON.stringify(a15Before) ? 'identical' : 'CHANGED'}`);
      expect(after, 'the A-15 delta: no scratch project in the owner file').toEqual(a15Before);
    }
  }, CASE_MS);
});
