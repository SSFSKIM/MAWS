// P4-A2's live run (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §5 A2's acceptance; §2 items 9 and 10;
// docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md M8): the agent's edit seen as it is written on the
// installed engine, over a 200-page document. The product app (MAWS_HARNESS=0) with the installed Claude Code (never
// patched, D-1) under a scratch CLAUDE_CONFIG_DIR under /tmp (as e2e/document-live.spec.ts runs it, whose session
// helpers this file repeats), through ClaudeUsage's relay, in default permission mode, every permission given through
// the request card. The document is S7's 200-page seed (e2e/support/document-seed.ts) written through the host's perf
// seam (MAWS_DOCUMENT_PERF=1), open in the panel's Artifacts tool beside the session. One session, asked in its composer:
//   1. reads the document once and makes a small warm-up edit of its first block (the card's "Allow for this session");
//   2. in ONE `artifact_edit` call replaces that block's sentence with a long one, while the test composes Korean in
//      another paragraph from the prompt's send until the call's answer is in the journal;
//   3. without reading again, sends a batch that replaces the block the test has meanwhile changed: refused whole.
// Judged from the page-side recorder (e2e/support/document-provisional.ts) against the journal's clock: the agent's
// presence drawn within one delta of the call's first streamed delta and before the `tools/call` reached MAWS; the
// provisional text at the target block before the call ran, growing as it streamed; the real text replacing it with
// no gap and no double; the human's composed text exact; the refused batch seen, then withdrawn, the blocks and the
// version list unchanged; and the tool-time guard (X34) over every `artifact_*` call of the run.
// Spends money within MAWS_LIVE_DOCUMENT_MAX_USD (US$1.00 when unset); the model is MAWS_LIVE_DOCUMENT_MODEL (haiku when
// unset). Run on purpose only: MAWS_LIVE_DOCUMENT=1 pnpm e2e:document-live
// Evidence: test-results/document-provisional-live/live-run.txt (the scratch root is kept for inspection).
import { openArtifactInPanel } from './support/shell';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import type { JournalRow } from '@shared/wire/journal';
import { launchDefaults } from '../src/shared/composer/launch-defaults';
import { RELAY_URL } from '../src/engine-host/launch';
import { isolatedGitEnv } from '../test/support/git-env';
import { relaySkipReason } from '../test/support/relay-health';
import { assertConfigHomeSafe } from '../test/live/support/live';
import { guardToolTime } from '../test/live/support/tool-time';
import { a15DeltaText, compareA15 } from '../test/support/owner-file';
import { journal, processCost } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { recordDrawing, swapOffenders } from './support/document-provisional';
import { imeStep, PerfSeam } from './support/document-scale';
import { seedDocument } from './support/document-seed';
import { keystrokes } from './support/hangul';
import { latencyBudgets } from './support/latency';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { liveSpend } from './support/live-lifecycle';
import { eventsOf, mcpCalls, mcpResultOf, ofKind, recordEvents, resultText, seedTranscripts, type McpResult } from './support/maws-tools';
import { sidebarRow } from './support/sidebar';

test.skip(process.env.MAWS_LIVE_DOCUMENT !== '1', 'the document live runs run only under MAWS_LIVE_DOCUMENT=1');
test.describe.configure({ timeout: 1_200_000 });

const EVIDENCE = join(REPO_ROOT, 'test-results', 'document-provisional-live');
const EVIDENCE_FILE = join(EVIDENCE, 'live-run.txt');
const CAP_USD = Number(process.env.MAWS_LIVE_DOCUMENT_MAX_USD ?? '1');
const MODEL = process.env.MAWS_LIVE_DOCUMENT_MODEL ?? 'haiku';
const TURN_MS = 300_000;
const TITLE = 'Scale 200 live';
const SECTIONS = 160; // about 200 pages (e2e/document-scale.spec.ts)
const BLOCK = 's0first'; // the seed's first block, "Start." plus whatever its seeded human typed into it (read at the run)
// The paragraph the test composes in: the second section's (the seed threads a passage of every third section's first
// paragraph from the first, and a click on a commented passage opens the comments rail, a drawer over the panel's
// narrow page that would then take the later clicks)
const OTHER = 's1p1';
const AGENT_NAME = 'Claude';
const WARM = 'Start here.';
// The edit's text: long enough that the model streams it over a second or more (haiku sent a 130-character sentence in
// three bursts inside 450 ms, the call 12 ms after the last; the sitting's edits streamed about 17 characters per 50 ms),
// so the layer is seen growing, as the owner's edits are.
const NEW =
  'Start here: the launch moves to the following Tuesday, after the budget review, and the team meets on Monday to confirm the plan. ' +
  'Design hands the final mockups to engineering on Wednesday morning, and the copy review follows in the afternoon with the whole team present. ' +
  'Finance approves the budget by Thursday, once the vendor quotes are in and the contingency line has been checked against last quarter. ' +
  'Marketing drafts the announcement during the week and circulates it for comments before the weekend, so nothing waits on a single reviewer. ' +
  'The retrospective is booked for the Friday after the launch, with the notes shared the same day.';
const STALE = 'The start was rewritten by the agent.';

// The prompts over the document's id (the owner created it, so the test knows it; a title with spaces is not a ref, and
// haiku once refused rather than list) and the first block's text as the seed left it (its human edits type " edited"
// into random paragraphs, so the quote the warm-up replaces is read from the page, never assumed).
const promptsFor = (artifactId: string, start: string) => ({
  warm: `Call artifact_read once on the document whose artifact id is ${artifactId}, with exactly these arguments: artifact "${artifactId}", count 10 (the document is 200 pages long; its first ten blocks are enough, and a larger read overflows the tool's output). Then make one artifact_edit call on it (baseRevision: the revision the read returned) with a single op: replace_text in block ${BLOCK}, old "${start}" new "${WARM}". Then reply READY. Do nothing else.`,
  edit: `Make exactly ONE artifact_edit call on the document whose artifact id is ${artifactId} and nothing else (do not read the document first; baseRevision is the revision your last artifact_edit returned) with a single op: replace_text in block ${BLOCK}, old "${WARM}" new "${NEW}". Reply DONE when the call succeeds.`,
  stale: `Without reading the document again, make exactly ONE artifact_edit call on the document whose artifact id is ${artifactId} (baseRevision: the revision your last artifact_edit returned) with a single op: replace_block of block ${BLOCK} with markdown "${STALE}". If the call is refused, do not retry, do not read, make no other call: reply REFUSED followed by the refusal's reason.`,
});

// ---- the owner file (A-15), the engine, the evidence (as e2e/document-live.spec.ts) -----------------------------------

interface A15Reading {
  keys: string[];
  digest: string;
}
function a15(): A15Reading {
  const script = `import json;d=json.load(open('${homedir()}/.claude.json'));k=sorted(k for k in d.get('projects',{}) if k.startswith('/tmp') or k.startswith('/private/tmp'));print(k);print(json.dumps(k))`;
  const [repr, keys] = execFileSync('/usr/bin/python3', ['-c', script], { encoding: 'utf8' }).split('\n');
  return { keys: JSON.parse(keys!) as string[], digest: createHash('sha1').update(`${repr}\n`).digest('hex') };
}
function checkA15(label: string, before: A15Reading, ours: readonly string[]): void {
  const after = a15();
  const delta = compareA15(before.keys, after.keys, ours);
  note(`A-15 ${label}: ${after.keys.length} keys, sha1 ${after.digest} (${a15DeltaText(delta)})`);
  expect(delta.breach, `the A-15 delta ${label}: no project of the run's scratch in the owner file`).toEqual([]);
}
function installedEngine(): { bin: string; version: string } {
  const bin = realpathSync(join(homedir(), '.local/bin/claude'));
  const version = /\d+\.\d+\.\d+/.exec(execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 30_000 }))?.[0] ?? '';
  return { bin, version };
}
const lines: string[] = [];
function note(line: string): void {
  lines.push(line);
  writeFileSync(EVIDENCE_FILE, `${lines.join('\n')}\n`);
}
function scratch(): { root: string; config: string; repo: string; engineId: string } {
  const root = realpathSync(mkdtempSync('/tmp/maws-document-provisional-live-'));
  const config = join(root, 'claude-config');
  const repo = join(root, 'repo');
  mkdirSync(config);
  mkdirSync(repo);
  writeFileSync(join(config, 'settings.json'), '{}\n');
  writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
  assertConfigHomeSafe({ configHome: config, controls: [] });
  writeFileSync(join(repo, 'README.txt'), 'The document provisional live run.\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=P4A2', '-c', 'user.email=p4a2@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  const [engineId] = seedTranscripts(config, repo, ['P4-A2 live: provisional']);
  return { root, config, repo, engineId: engineId! };
}

// ---- the session (as e2e/document-live.spec.ts) --------------------------------------------------------------------------

interface Live {
  maws: MawsLaunch;
  page: Page;
  id: string;
  pane: Locator;
  journalPath: string;
  allowed: string[];
  prompted: boolean;
  events(): Promise<SessionEvent[]>;
  rows(): JournalRow[];
}
const statusOf = async (page: Page, id: string) => value(await invoke(page, 'session.status', { appSessionId: id as AppSessionId }));
const mainTurnsEnded = (events: SessionEvent[]) => ofKind(events, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);
async function allowPending(s: Live): Promise<boolean> {
  const events = await s.events();
  const resolved = new Set(ofKind(events, 'permission.resolved').map((e) => e.requestId));
  const open = ofKind(events, 'permission.requested').filter((e) => !resolved.has(e.requestId));
  if (open.length === 0) return false;
  const frame = s.pane.getByRole('group', { name: 'Approval needed' });
  const allow = frame.getByRole('button', { name: 'Allow', exact: true });
  if (!(await allow.isVisible().catch(() => false)) || !(await allow.isEnabled().catch(() => false))) return false;
  const session = frame.getByRole('radio', { name: 'Allow for this session' });
  if ((await session.count()) > 0) await session.click();
  await allow.click();
  s.allowed.push(open[0]!.toolName);
  await expect.poll(async () => ofKind(await s.events(), 'permission.resolved').some((e) => e.requestId === open[0]!.requestId), { timeout: 30_000 }).toBe(true);
  return true;
}
async function drive(s: Live, what: string, until: () => Promise<boolean>, timeout = TURN_MS): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await until()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    if (await allowPending(s)) continue;
    await s.page.waitForTimeout(300);
  }
}
const idle = async (s: Live) => {
  const status = await statusOf(s.page, s.id);
  return status.turn === null && status.pendingRequests === 0;
};
const sentPrompts = (s: Live) => s.rows().filter((r) => r.direction === 'out' && (r.frame as { type?: string }).type === 'user').length;
async function ask(s: Live, prompt: string): Promise<number> {
  const ended = mainTurnsEnded(await s.events()).length;
  const sent = sentPrompts(s);
  const message = s.pane.getByRole('textbox', { name: 'Message', exact: true });
  await message.click();
  await s.page.keyboard.insertText(prompt);
  s.prompted = true;
  await s.page.keyboard.press('Meta+Enter');
  await expect.poll(() => sentPrompts(s), { timeout: 15_000, message: 'the prompt reached the engine' }).toBeGreaterThan(sent);
  return ended;
}
async function turnEnd(s: Live, ended: number, what: string): Promise<string> {
  await drive(s, what, async () => mainTurnsEnded(await s.events()).length > ended && (await idle(s)));
  return mainTurnsEnded(await s.events()).at(-1)?.resultText ?? '';
}

interface Call {
  name: string;
  args: Record<string, unknown>;
  toolUseId: string | null;
  result: McpResult | null;
  requestedAt: number | null; // the `tools/call` row's `at`
  answeredAt: number | null; // the `control_response` row's `at`
  firstDeltaAt: number | null; // the first non-empty `input_json_delta` of the call's block
  deltas: number;
  raw: string; // the input as streamed, the deltas concatenated
  deltaEnds: { at: number; length: number }[]; // each non-empty delta's `at` and the input's length once it arrived
}
type Row = JournalRow & { frame: Record<string, unknown> };
// The `maws` calls of the session so far, each with its stream's first delta (the tool_use block whose id the call's
// `_meta` names) and its answer.
function calls(s: Live): Call[] {
  const rows = s.rows() as Row[];
  const at = (row: JournalRow | undefined) => (row ? Date.parse(row.at) : null);
  return mcpCalls(rows).map((call) => {
    const request = rows.find((r) => r.direction === 'in' && r.frame.type === 'control_request' && r.frame.request_id === call.requestId);
    const params = ((request?.frame.request as { message?: { params?: { _meta?: Record<string, unknown> } } } | undefined)?.message?.params ?? {}) as { _meta?: Record<string, unknown> };
    const toolUseId = typeof params._meta?.['claudecode/toolUseId'] === 'string' ? (params._meta['claudecode/toolUseId'] as string) : null;
    const answer = rows.find((r) => r.direction === 'out' && r.frame.type === 'control_response' && (r.frame.response as { request_id?: string } | undefined)?.request_id === call.requestId);
    let firstDelta: JournalRow | undefined;
    let deltas = 0;
    let raw = '';
    const deltaEnds: { at: number; length: number }[] = [];
    if (toolUseId) {
      const start = rows.find((r) => r.direction === 'in' && r.frame.type === 'stream_event' && (r.frame.event as { type?: string; content_block?: { id?: string } }).type === 'content_block_start' && (r.frame.event as { content_block?: { id?: string } }).content_block?.id === toolUseId);
      const index = (start?.frame.event as { index?: number } | undefined)?.index;
      if (start && index !== undefined) {
        for (const r of rows) {
          if (r.seq <= start.seq || r.direction !== 'in' || r.frame.type !== 'stream_event') continue;
          const event = r.frame.event as { type?: string; index?: number; delta?: { type?: string; partial_json?: string } };
          if (event.index !== index) continue;
          if (event.type === 'content_block_stop') break;
          if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta' && (event.delta.partial_json ?? '') !== '') {
            deltas += 1;
            firstDelta ??= r;
            raw += event.delta.partial_json;
            deltaEnds.push({ at: Date.parse(r.at), length: raw.length });
          }
        }
      }
    }
    return { name: call.name, args: call.args, toolUseId, result: mcpResultOf(rows, call.requestId), requestedAt: at(request), answeredAt: at(answer), firstDeltaAt: at(firstDelta), deltas, raw, deltaEnds };
  });
}
// The `at` of the delta that completed `needle` in the call's streamed input (the first the input holds it whole after), or null.
function deltaCompleting(call: Call, needle: string): number | null {
  const end = call.raw.indexOf(needle);
  if (end < 0) return null;
  return call.deltaEnds.find((delta) => delta.length >= end + needle.length)?.at ?? null;
}
const json = (result: McpResult) => JSON.parse(resultText(result)) as Record<string, unknown>;

// The caret at the end of block `id` (document-live's rule: done once the editor's own selection is that caret).
type EditorRoot = HTMLElement & { editor?: { state: { doc: { descendants(f: (node: { attrs: Record<string, unknown>; nodeSize: number }, pos: number) => boolean | void): void }; selection: { from: number; to: number } } } };
async function caretAtEnd(editor: Locator, id: string): Promise<void> {
  await editor.locator(`[data-id="${id}"]`).click();
  await editor.evaluate((root, blockId) => {
    const block = root.querySelector(`[data-id="${blockId}"]`)!;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement?.closest('.ProseMirror-yjs-cursor, [data-provisional]')) last = n as Text;
    if (!last) throw new Error(`no text in ${blockId}`);
    (root as HTMLElement).focus();
    const range = document.createRange();
    range.setStart(last, last.data.length);
    range.collapse(true);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }, id);
  await expect
    .poll(
      () =>
        editor.evaluate((root, blockId) => {
          const view = (root as EditorRoot).editor;
          if (!view) return 'no editor on the element';
          let end = -1;
          view.state.doc.descendants((node, pos) => {
            if (node.attrs.id === blockId) end = pos + node.nodeSize - 1;
            return end < 0;
          });
          const { from, to } = view.state.selection;
          return from === to && from === end ? 'at the end' : `the editor's selection ${from}–${to}, the block's end ${end}`;
        }, id),
      { timeout: 10_000, message: `the editor's own caret at the end of ${id}` },
    )
    .toBe('at the end');
}

// ---- the run ---------------------------------------------------------------------------------------------------------

test('the live run: the agent’s edit on a 200-page document is seen as it is written, swapped without a gap while the owner composes, a stale batch withdrawn; the tool time guarded', async () => {
  const budget = latencyBudgets();
  mkdirSync(EVIDENCE, { recursive: true });
  let relay = relaySkipReason(RELAY_URL);
  if (relay !== null) {
    await new Promise((resolve) => setTimeout(resolve, 120_000));
    relay = relaySkipReason(RELAY_URL);
  }
  expect(relay, 'the relay answers GET /api/hello').toBeNull();
  const engine = installedEngine();
  expect(engine.version).toMatch(/^\d+\.\d+\.\d+$/);
  const before = a15();
  const sc = scratch();
  note(`P4-A2 document provisional live run (§5 A2's acceptance), ${new Date().toISOString()}`);
  note(`engine: ${engine.bin.replace(homedir(), '~')} (${engine.version}), unmodified, through the relay ${RELAY_URL}; model ${MODEL}; default permission mode; cap US$${CAP_USD}`);
  note(`app: the product build (MAWS_HARNESS=0) over a scratch CLAUDE_CONFIG_DIR ${sc.config}; the host's perf seam (MAWS_DOCUMENT_PERF=1) for the seed only; CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING in the launching shell: ${JSON.stringify(process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING ?? null)} (MAWS sets it in the engine's environment itself)`);
  note(`A-15 before the launch: ${before.keys.length} keys, sha1 ${before.digest}`);

  // MAWS's constructed environment sets CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING=1 (launch.ts, as Claude Desktop
  // does): the API then streams a tool input's text as it is written. Without it the API emits a string value only once
  // it closes, so a 790-character edit arrived in one 5 ms burst 7 ms before the `tools/call` (this spec's run of
  // 2026-10-20 00:59Z, before launch.ts set it). The run sets nothing itself, so a multi-delta stream here is MAWS's
  // own doing; the launching shell may even unset the variable.
  const maws = await launchMaws({ env: { MAWS_E2E_ENGINE_BIN: engine.bin, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: sc.config, MAWS_DOCUMENT_PERF: '1' } });
  let live: Live | null = null;
  let completed = false;
  try {
    const { page } = maws;
    await recordEvents(page);
    let id = '';
    await expect
      .poll(async () => {
        const { sessions } = value(await invoke(page, 'session.list', {}));
        id = sessions.find((r) => r.engineSessionId === sc.engineId)?.appId ?? '';
        return id !== '';
      }, { timeout: 30_000 })
      .toBe(true);
    const pane = page.locator('[data-region="main"] [data-pane="0"]');
    const panel = page.locator('[data-region="panel"]');
    await (await sidebarRow(page, { appSessionId: id })).click();
    await page.mouse.move(700, 20);
    await expect(pane.locator(`[data-composer="${id}"]`)).toBeVisible();

    // the 200-page document, created by the owner and seeded through the host's seam
    const seam = new PerfSeam(join(maws.userData, 'document-perf'));
    await expect.poll(() => existsSync(join(seam.dir, 'in')), { timeout: 20_000, message: 'the host seam is up' }).toBe(true);
    const seed = seedDocument(SECTIONS);
    const { artifact } = value(await invoke(page, 'artifacts.create', { kind: 'document', title: TITLE }));
    const seeded = await seam.seed(artifact.id, seed.state);
    note(`the document: ${artifact.id} "${TITLE}", seeded with ${seed.stats.topBlocks} top blocks (${seed.stats.words} words, ${seed.stats.sections} sections) at revision ${seeded.revision}`);

    // the document in the panel's Artifacts tool beside the composer
    await openArtifactInPanel(page, artifact.id);
    const record = panel.locator(`[data-artifact-record="${artifact.id}"]`);
    const editor = record.locator('.ds-doc .ProseMirror[data-editor="live"]');
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(editor.locator(`[data-id="${BLOCK}"]`)).toContainText('Start.', { timeout: 30_000 });
    const start = ((await editor.locator(`[data-id="${BLOCK}"]`).textContent()) ?? '').trim(); // no cursor label yet: no agent has joined
    const PROMPTS = promptsFor(artifact.id, start);
    note(`the first block ${BLOCK} reads ${JSON.stringify(start)} as seeded`);
    // the two blocks the run reads (each sample of all 1,455 would weigh about 0.7 MB)
    const seen = await recordDrawing(page, `[data-region="panel"] [data-artifact-record="${artifact.id}"] .ds-doc .ProseMirror[data-editor="live"]`, { blocks: [BLOCK, OTHER] });

    const spec = { ...launchDefaults(id as AppSessionId, sc.repo), model: MODEL, permissionMode: 'default' as const, subagentModel: 'haiku', maxBudgetUsd: CAP_USD };
    expect(value(await invoke(page, 'session.launch', { spec }))).toMatchObject({ status: 'launching' });
    const journalPath = (await statusOf(page, id)).journalPath;
    const s: Live = (live = { maws, page, id, pane, journalPath, allowed: [], prompted: false, events: () => eventsOf(page, id), rows: () => journal(journalPath) });
    await expect.poll(async () => (await statusOf(page, id)).process, { timeout: 120_000 }).toBe('ready');

    // 1: the read and the warm-up edit (the card answered for the session)
    const ended1 = await ask(s, PROMPTS.warm);
    const reply1 = await turnEnd(s, ended1, 'the read and the warm-up edit');
    const first = calls(s);
    note(`turn 1: calls ${JSON.stringify(first.map((c) => c.name))}; reply ${JSON.stringify(reply1)}; permissions allowed for the session: ${JSON.stringify(s.allowed)}`);
    const warm = first.filter((c) => c.name === 'artifact_edit');
    expect(warm.length, 'one warm-up edit').toBeGreaterThanOrEqual(1);
    expect(warm.at(-1)!.result?.isError, warm.at(-1)!.result ? resultText(warm.at(-1)!.result!) : 'no answer').toBeUndefined();
    await expect(editor.locator(`[data-id="${BLOCK}"]`)).toHaveText(WARM, { timeout: 15_000 });
    await expect(editor.locator('[data-provisional]')).toHaveCount(0, { timeout: 15_000 });
    const warmDrawn = (await seen()).filter((smp) => smp.provisional.length > 0).length;
    note(`G0: the warm-up edit drew ${warmDrawn} provisional sample(s) (its stream ran under the permission card)`);

    // 2: the measured edit, while the owner composes Korean at the end of another paragraph. The warm-up's outline
    // stays 4 s after its answer (D11's hold), so the turn's samples start once it is gone: the first outline they
    // carry is the measured call's.
    await expect(editor.locator('[data-agent-editing]')).toHaveCount(0, { timeout: 20_000 });
    const editsBefore = calls(s).filter((c) => c.name === 'artifact_edit').length;
    const samplesBefore = (await seen()).length;
    const ended2 = await ask(s, PROMPTS.edit);
    await caretAtEnd(editor, OTHER);
    const WORDS = ['안녕하세요', '한글', '입력', '테스트입니다', '문서를', '함께', '고칩니다'];
    let typed = '';
    const editCall = () => calls(s).filter((c) => c.name === 'artifact_edit')[editsBefore];
    const cdp: CDPSession = await page.context().newCDPSession(page);
    let words = 0;
    try {
      const deadline = Date.now() + TURN_MS;
      for (;;) {
        const word = ` ${WORDS[words % WORDS.length]}`;
        const steps = keystrokes(word);
        for (const step of steps) await imeStep(cdp, step, steps);
        typed += word;
        words += 1;
        if (editCall()?.result) break;
        await allowPending(s);
        if (Date.now() > deadline) throw new Error('the edit did not land while composing');
      }
    } finally {
      await cdp.detach();
    }
    const reply2 = await turnEnd(s, ended2, 'the edit turn');
    const call = editCall()!;
    expect(call.result!.isError, resultText(call.result!)).toBeUndefined();
    const edited = json(call.result!) as { revision: number };
    await expect(editor.locator(`[data-id="${BLOCK}"]`)).toHaveText(NEW, { timeout: 15_000 });
    await expect(editor.locator('[data-provisional]')).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(async () => (await seen()).at(-1)?.blocks[OTHER]?.endsWith(typed), { timeout: 15_000 }).toBe(true);
    const otherBefore = (await seen())[samplesBefore - 1]?.blocks[OTHER] ?? '';
    const samples = (await seen()).slice(samplesBefore);
    const firstPresence = samples.find((smp) => smp.outlines.includes(AGENT_NAME) && smp.at >= (call.firstDeltaAt ?? Infinity)); // drawn from this call's stream
    const firstLayer = samples.find((smp) => smp.provisional.some((p) => p.id === call.toolUseId));
    const texts = [...new Set(samples.flatMap((smp) => smp.provisional.filter((p) => p.id === call.toolUseId && p.op === 'replace_text').map((p) => p.text)))];
    const targetNamedAt = deltaCompleting(call, `"${BLOCK}"`); // the delta that named the target block
    const timeline = {
      toolUseId: call.toolUseId, deltas: call.deltas, streamedChars: call.raw.length,
      firstDeltaAt: call.firstDeltaAt, requestedAt: call.requestedAt, answeredAt: call.answeredAt,
      targetNamedAt,
      presenceAfterFirstDeltaMs: firstPresence && call.firstDeltaAt !== null ? firstPresence.at - call.firstDeltaAt : null,
      presenceAfterTargetNamedMs: firstPresence && targetNamedAt !== null ? firstPresence.at - targetNamedAt : null,
      layerAfterFirstDeltaMs: firstLayer && call.firstDeltaAt !== null ? firstLayer.at - call.firstDeltaAt : null,
      layerBeforeCallMs: firstLayer && call.requestedAt !== null ? call.requestedAt - firstLayer.at : null,
      layerBeforeAnswerMs: firstLayer && call.answeredAt !== null ? call.answeredAt - firstLayer.at : null,
      textsDrawn: texts.length, lastText: texts.at(-1) ?? null,
    };
    note(`turn 2: the call ${JSON.stringify({ args: call.args, toolUseId: call.toolUseId })} answered → revision ${edited.revision}; reply ${JSON.stringify(reply2)}; composed ${words} words: ${JSON.stringify(typed)}`);
    note(`G1 timeline: ${JSON.stringify(timeline)}`);
    test.info().annotations.push({ type: 'provisional live timeline', description: JSON.stringify(timeline) });
    expect(call.firstDeltaAt, 'the call streamed deltas').not.toBeNull();
    expect(call.deltas, 'several deltas').toBeGreaterThan(1);
    // Presence is published on the host from the tick in which the call's `artifact` parses, but the editor draws it as
    // the outline of the blocks it names (D11), so the first visible presence follows the delta that named the target:
    // within a second of it (the next delta came about 50 ms later at the sitting; the tick, the awareness relay and the
    // page's walk of 1,455 blocks add the rest), and before the call completes.
    await test.step('G1: presence within one delta of the call’s start, before the call completes', () => {
      expect(firstPresence, `the agent's outline was drawn; the turn's first samples ${JSON.stringify(samples.slice(0, 4))}`).toBeDefined();
      expect(targetNamedAt, 'the stream named the target block').not.toBeNull();
      expect(firstPresence!.at, 'presence drawn from the call’s stream, not left from the warm-up').toBeGreaterThanOrEqual(call.firstDeltaAt!);
      // Through the load-aware budget, read at the test's start: a neighbour or ci-kit's guest may run beside a live run.
      budget('presence after the delta that named the target', firstPresence!.at - targetNamedAt!, 1_000, 'presence within 1 s of the delta that named the target');
      expect(firstPresence!.at, 'presence before the call completed').toBeLessThanOrEqual(call.answeredAt!);
    });
    await test.step('G2: the provisional text at the target block before the call completes, growing as it streamed', () => {
      expect(firstLayer, 'the layer was drawn').toBeDefined();
      expect(firstLayer!.at, 'the layer before the call completed').toBeLessThanOrEqual(call.answeredAt!);
      expect(firstLayer!.at, 'the layer before the tools/call reached MAWS (the text streams for a second or more)').toBeLessThanOrEqual(call.requestedAt!);
      expect(firstLayer!.provisional.find((p) => p.id === call.toolUseId)!.inBlock).toBe(BLOCK);
      expect(texts.length, `several lengths of the text were drawn: ${JSON.stringify(texts)}`).toBeGreaterThan(1);
      expect(texts.every((t) => NEW.startsWith(t))).toBe(true);
      expect(samples.filter((smp) => smp.at < call.answeredAt!).every((smp) => !smp.blocks[BLOCK]?.includes(NEW.slice(0, 40))), 'nothing of the batch in the document before the answer').toBe(true);
    });
    await test.step('G3: the swap without a gap or a double; the human’s composed text exact', () => {
      const { gaps, doubles } = swapOffenders(samples, call.toolUseId!, 'replace_text', BLOCK, NEW);
      expect(gaps, `a gap: ${JSON.stringify(gaps.map((smp) => ({ at: smp.at - call.firstDeltaAt!, block: smp.blocks[BLOCK] })))}`).toEqual([]);
      expect(doubles, 'a double').toEqual([]);
      expect(samples.at(-1)!.blocks[BLOCK]).toBe(NEW);
      expect(samples.at(-1)!.blocks[OTHER]).toBe(`${otherBefore}${typed}`);
    });

    // 3: the owner changes the block, then the stale batch: seen, then withdrawn whole
    const versionsBefore = value(await invoke(page, 'artifacts.versions', { artifactId: artifact.id })).versions.length;
    await caretAtEnd(editor, BLOCK);
    await page.keyboard.type(' Bring the notes.');
    await expect.poll(async () => (await seen()).at(-1)?.blocks[BLOCK]).toBe(`${NEW} Bring the notes.`);
    await page.waitForTimeout(1_000); // the host's ack
    const blocksBefore = (await seen()).at(-1)!.blocks;
    const staleBefore = calls(s).filter((c) => c.name === 'artifact_edit').length;
    const ended3 = await ask(s, PROMPTS.stale);
    const reply3 = await turnEnd(s, ended3, 'the stale batch turn');
    const stale = calls(s).filter((c) => c.name === 'artifact_edit')[staleBefore];
    expect(stale, 'one stale call').toBeDefined();
    expect(stale!.result!.isError, 'the stale batch is refused').toBe(true);
    const refusalText = resultText(stale!.result!);
    note(`turn 3: the stale call ${JSON.stringify(stale!.args)} refused: ${JSON.stringify(refusalText)}; reply ${JSON.stringify(reply3)}`);
    const staleSamples = (await seen()).filter((smp) => smp.provisional.some((p) => p.id === stale!.toolUseId));
    note(`G4: the stale batch's layer drawn in ${staleSamples.length} sample(s) (op ${JSON.stringify([...new Set(staleSamples.flatMap((smp) => smp.provisional.map((p) => p.op)))])}), then withdrawn`);
    expect(staleSamples.length, 'the stale batch was seen').toBeGreaterThan(0);
    await expect(editor.locator('[data-provisional]')).toHaveCount(0, { timeout: 15_000 });
    const blocksAfter = (await seen()).at(-1)!.blocks;
    expect(blocksAfter, 'nothing of the refused batch is in the document').toEqual(blocksBefore);
    const versionsAfter = value(await invoke(page, 'artifacts.versions', { artifactId: artifact.id })).versions.length;
    expect(versionsAfter, 'the history is untouched').toBe(versionsBefore);

    // the guard (X34) over every artifact_* call of the run
    const guard = guardToolTime(s.rows());
    note(`G5 tool time: ${guard.guarded} guarded call(s), max ${guard.maxMs.toFixed(1)} ms, median ${guard.medianMs.toFixed(1)} ms; ${JSON.stringify(guard.spans.map((span) => ({ name: span.name, ms: Math.round(span.ms * 10) / 10 })))}`);
    completed = true;
  } finally {
    if (live) {
      const s = live as Live;
      try {
        const stopped = value(await invoke(s.page, 'session.stop', { appSessionId: s.id as AppSessionId, reason: 'stop' }));
        await expect.poll(async () => (await statusOf(s.page, s.id)).process, { timeout: 30_000 }).toBe('exited');
        cpSync(join(maws.userData, 'engine-host', 'journal', s.id), join(sc.root, 'journals'), { recursive: true });
        const costUsd = processCost(s.rows());
        note(`session ${s.id}: stopped ${JSON.stringify(stopped)}; journal kept under ${join(sc.root, 'journals')}; total_cost_usd ${costUsd.toFixed(4)} (cap US$${CAP_USD}); permissions allowed: ${JSON.stringify(s.allowed)}`);
      } catch (error) {
        note(`the session could not be stopped or booked: ${String(error)}`);
      }
    }
    const ran = live as Live | null;
    const spend = liveSpend(ran !== null && existsSync(ran.journalPath) ? journal(ran.journalPath) : [], CAP_USD, ran?.prompted ?? false);
    note(`spend: receipts ${spend.receipts.length > 0 ? `${JSON.stringify(spend.receipts)}, total_cost_usd ${spend.receipted.toFixed(4)}` : 'none'}; accounted exposure US$${spend.accounted.toFixed(4)} (${spend.basis}); cap US$${CAP_USD}`);
    note(`console errors: ${JSON.stringify(maws.consoleErrors())}`);
    await maws.cleanup();
    note(`scratch kept for inspection: ${sc.root}`);
    expect.soft(spend.accounted, 'within the cap').toBeLessThanOrEqual(CAP_USD);
    if (completed) {
      expect.soft(spend.receipts.length, 'a passing run has the engine’s receipt for each of its three turns').toBeGreaterThanOrEqual(3);
      expect.soft(spend.settled, 'the last receipt came after the last prompt').toBe(true);
    }
  }
  checkA15('after the run', before, [sc.root, maws.userData]);
});
