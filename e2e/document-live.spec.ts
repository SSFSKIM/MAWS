// P3-B's live run (M9 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, Acceptance 2; parent §2 item 2, the agent):
// the product app (MAWS_HARNESS=0) with the installed Claude Code (never patched, D-1) under a scratch CLAUDE_CONFIG_DIR
// under /tmp (`settings.json` `{}`, a `.claude.json` trusting the scratch repository; P1 §15's rule, as
// e2e/maws-tools-live.spec.ts runs it), through ClaudeUsage's relay, in default permission mode, every permission given
// through the request card docked in the composer. One session, asked in its composer:
//   1. creates a document from markdown with `artifact_create`, reads it with ids (`artifact_read`) and makes one small
//      warm-up edit (so the card's "Allow for this session" covers `artifact_edit` before the measured batch);
//   2. in ONE `artifact_edit` batch replaces a sentence, inserts a section after a heading and sets a table cell, while
//      the test composes Korean in another paragraph of the open editor (the panel's Artifacts tool, a second replica
//      of the host doc) from the moment the read's answer is in the journal until the batch's answer is;
//   3. without reading again, sends a batch whose second op quotes a sentence the test has meanwhile changed: refused,
//      naming the block and its current text, and nothing of the batch lands;
//   4. reads the document again, which shows the ids the batch made.
// Asserted from the editor's DOM (blocks by `data-id`), the journal (the tools' calls and answers) and Show editors (the
// right-click over a selection, provenance): only the targeted blocks changed, the human's composed text is exact,
// the inserted blocks' ids are in the next read, the agent's characters credited to the session and the human's to the
// human, the agent's cursor and editing outline drawn while the batch ran, the stale batch atomic.
// Spends money within MAWS_LIVE_DOCUMENT_MAX_USD (US$1.00 when unset; the session launches with it as its
// --max-budget-usd); the model is MAWS_LIVE_DOCUMENT_MODEL (haiku when unset). Run on purpose only:
//   MAWS_LIVE_DOCUMENT=1 pnpm e2e:document-live
// Evidence: test-results/document-live/live-run.txt (plain text; the scratch root is kept for inspection).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
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
import { a15DeltaText, compareA15 } from '../test/support/owner-file';
import { journal, processCost } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { keystrokes, type Step } from './support/hangul';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { eventsOf, mcpCalls, mcpResultOf, ofKind, recordEvents, resultText, seedTranscripts, type McpResult } from './support/maws-tools';
import { sidebarRow } from './support/sidebar';

test.skip(process.env.MAWS_LIVE_DOCUMENT !== '1', 'the document live run runs only under MAWS_LIVE_DOCUMENT=1');
test.describe.configure({ timeout: 1_200_000 });

const EVIDENCE = join(REPO_ROOT, 'test-results', 'document-live');
const EVIDENCE_FILE = join(EVIDENCE, 'live-run.txt');
const CAP_USD = Number(process.env.MAWS_LIVE_DOCUMENT_MAX_USD ?? '1');
const MODEL = process.env.MAWS_LIVE_DOCUMENT_MODEL ?? 'haiku';
const TURN_MS = 300_000;
const TITLE = 'Launch notes';

// The document the agent creates: every block's id given, so the test names them before the agent's read.
const MARKDOWN = [
  '# Launch notes ^h1',
  '',
  'The launch is planned for Friday. The team meets on Monday. ^p1',
  '',
  'The owner writes here. ^p2',
  '',
  '## Budget ^h2',
  '',
  '| Item | Cost | <!-- ^r0 -->',
  '| --- | --- |',
  '| Design | 100 | <!-- ^r1 -->',
  '| Build | 200 | <!-- ^r2 -->',
  '^tb1',
  '',
  '## Risks ^h3',
  '',
  'Nothing is known yet. ^p3',
].join('\n');

const PROMPTS = {
  create: `Use the maws artifact_create tool to create a document (kind "document") titled "${TITLE}" whose content is exactly this markdown, ids included:\n\n${MARKDOWN}\n\nThen call artifact_read on it once. Then make one artifact_edit call (baseRevision: the revision the read returned) with a single op: replace_text in block p3, old "Nothing is known yet." new "Nothing is known yet; the review is pending.". Then reply READY. Do nothing else.`,
  batch: `Make exactly ONE artifact_edit call on the document "${TITLE}" with these three ops in this order, and nothing else (do not read the document first; baseRevision is the revision your last artifact_edit returned): (1) replace_text in block p1, old "The launch is planned for Friday." new "The launch moves to the following Tuesday."; (2) insert after h2 with markdown "### Approvals\\n\\nFinance approves the budget by Thursday."; (3) set_cell on table tb1, row 2, col 1, markdown "250". Reply DONE when the call succeeds.`,
  stale: `Without reading the document again, make exactly ONE artifact_edit call on "${TITLE}" (baseRevision: the revision your last artifact_edit returned) with two ops in this order: (1) insert after h3 with markdown "A second batch paragraph."; (2) replace_text in block p1, old "The team meets on Monday." new "The team meets on Wednesday.". If the call is refused, do not retry, do not read, make no other call: reply REFUSED followed by the refusal's reason.`,
  read: `Call artifact_read on the document "${TITLE}" once and reply DONE. Make no other call.`,
} as const;

// ---- the owner file (A-15), the engine, the evidence ------------------------------------------------------------------

interface A15Reading {
  keys: string[];
  digest: string;
}
// The standing rule's reading of the owner's ~/.claude.json `projects` keys under /tmp (read only).
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

// One root under /tmp: the config home, the trusted repository (a git repository) and one seeded transcript, so the
// sidebar shows a row to launch the session under.
function scratch(): { root: string; config: string; repo: string; engineId: string } {
  const root = realpathSync(mkdtempSync('/tmp/maws-document-live-'));
  const config = join(root, 'claude-config');
  const repo = join(root, 'repo');
  mkdirSync(config);
  mkdirSync(repo);
  writeFileSync(join(config, 'settings.json'), '{}\n');
  writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
  assertConfigHomeSafe({ configHome: config, controls: [] });
  writeFileSync(join(repo, 'README.txt'), 'The document live run.\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=P3B', '-c', 'user.email=p3b@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  const [engineId] = seedTranscripts(config, repo, ['P3-B live: document']);
  return { root, config, repo, engineId: engineId! };
}

// ---- the session -----------------------------------------------------------------------------------------------------

interface Live {
  maws: MawsLaunch;
  page: Page;
  id: string;
  pane: Locator;
  panel: Locator;
  journalPath: string;
  allowed: string[];
  events(): Promise<SessionEvent[]>;
  rows(): JournalRow[];
}

const statusOf = async (page: Page, id: string) => value(await invoke(page, 'session.status', { appSessionId: id as AppSessionId }));
const mainTurnsEnded = (events: SessionEvent[]) => ofKind(events, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);

// One permission the session is asking, allowed for the session through the card docked in the composer (the card's
// "Allow for this session" scope, so the batch the test watches is never held by a card); true when one was answered.
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

// Waits for `until`, allowing every permission the session asks meanwhile.
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

// A prompt through the real composer, then the turn driven to its end.
async function ask(s: Live, prompt: string): Promise<number> {
  const ended = mainTurnsEnded(await s.events()).length;
  const message = s.pane.getByRole('textbox', { name: 'Message', exact: true });
  await message.click();
  await s.page.keyboard.insertText(prompt);
  await s.page.keyboard.press('Meta+Enter'); // `composer.send`: a multi-line prompt's plain Enter breaks the line
  await expect.poll(() => s.rows().some((r) => r.direction === 'out' && (r.frame as { type?: string }).type === 'user'), { timeout: 15_000, message: 'the prompt reached the engine' }).toBe(true);
  return ended;
}
async function turnEnd(s: Live, ended: number, what: string): Promise<string> {
  await drive(s, what, async () => mainTurnsEnded(await s.events()).length > ended && (await idle(s)));
  return mainTurnsEnded(await s.events()).at(-1)?.resultText ?? '';
}

// The `maws` calls of the session so far, with their answers (null while unanswered).
function calls(s: Live): { name: string; args: Record<string, unknown>; result: McpResult | null; at: string | null }[] {
  const rows = s.rows();
  return mcpCalls(rows).map((call) => {
    const answer = rows.find((r) => r.direction === 'out' && (r.frame as { type?: string; response?: { request_id?: string } }).type === 'control_response' && (r.frame as { response: { request_id: string } }).response.request_id === call.requestId);
    return { name: call.name, args: call.args, result: mcpResultOf(rows, call.requestId), at: (answer as { at?: string } | undefined)?.at ?? null };
  });
}
const json = (result: McpResult) => JSON.parse(resultText(result)) as Record<string, unknown>;

// ---- the editor ------------------------------------------------------------------------------------------------------

// Every block of the record's editor by id, its text without the awareness cursors' labels.
async function blocks(editor: Locator): Promise<Record<string, string>> {
  return editor.evaluate((root) => {
    const out: Record<string, string> = {};
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-id]'))) {
      const copy = el.cloneNode(true) as HTMLElement;
      for (const cursor of Array.from(copy.querySelectorAll('.ProseMirror-yjs-cursor'))) cursor.remove();
      out[el.getAttribute('data-id')!] = (copy.textContent ?? '').replace(/⁠/g, '');
    }
    return out;
  });
}

// The ids of every block inside block `id` (a row's cells and their paragraphs).
const idsInside = (editor: Locator, id: string) => editor.evaluate((root, rowId) => Array.from(root.querySelectorAll(`[data-id="${rowId}"] [data-id]`)).map((el) => el.getAttribute('data-id')!), id);

// The caret at the end of block `id`'s text (the DOM selection collapsed after its last text node, which the editor reads
// on selectionchange; End would stop at a wrapped line's end in the panel's narrow column), the editor focused.
async function caretAtEnd(page: Page, editor: Locator, id: string): Promise<void> {
  await editor.locator(`[data-id="${id}"]`).click();
  await editor.evaluate((root, blockId) => {
    const block = root.querySelector(`[data-id="${blockId}"]`)!;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement?.closest('.ProseMirror-yjs-cursor')) last = n as Text;
    if (!last) throw new Error(`no text in ${blockId}`);
    (root as HTMLElement).focus();
    const range = document.createRange();
    range.setStart(last, last.data.length);
    range.collapse(true);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }, id);
  await page.waitForTimeout(100);
}

// One step of S4's 2-set model through CDP (e2e/document-editor.spec.ts's `imeStep`, the owner's pace).
async function imeStep(cdp: CDPSession, step: Step, steps: Step[]): Promise<void> {
  switch (step.kind) {
    case 'key':
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229, key: step.key, code: step.code });
      break;
    case 'compose':
      await cdp.send('Input.imeSetComposition', { text: step.text, selectionStart: step.text.length, selectionEnd: step.text.length });
      break;
    case 'commit':
      await cdp.send('Input.insertText', { text: step.text });
      break;
    case 'plain':
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      break;
    case 'backspace':
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229, key: 'Backspace', code: 'Backspace' });
      break;
  }
  if (step.kind === 'compose') {
    const previous = steps
      .slice(0, steps.indexOf(step))
      .reverse()
      .find((s): s is Extract<Step, { kind: 'key' }> => s.kind === 'key');
    if (previous) await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: previous.keyCode, key: previous.key, code: previous.code });
  }
  if (step.kind === 'compose' || step.kind === 'plain') await new Promise((resolve) => setTimeout(resolve, 60 + Math.random() * 30));
}

// What the editor drew of other replicas while recording: each agent-editing outline (its block and its label) and each
// remote cursor's label, with the time first seen (ms since the page's time origin).
async function watchPresence(editor: Locator): Promise<void> {
  await editor.evaluate((root) => {
    const seen: { kind: 'editing' | 'cursor'; block: string; name: string; at: number }[] = [];
    (window as unknown as { __presence: typeof seen }).__presence = seen;
    const record = () => {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-agent-editing]'))) {
        const entry = { kind: 'editing' as const, block: el.getAttribute('data-id') ?? '', name: el.getAttribute('data-agent-editing') ?? '' };
        if (!seen.some((s) => s.kind === entry.kind && s.block === entry.block && s.name === entry.name)) seen.push({ ...entry, at: performance.now() });
      }
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('.ProseMirror-yjs-cursor'))) {
        const entry = { kind: 'cursor' as const, block: el.closest('[data-id]')?.getAttribute('data-id') ?? '', name: el.textContent?.replace(/⁠/g, '') ?? '' };
        if (!seen.some((s) => s.kind === entry.kind && s.block === entry.block && s.name === entry.name)) seen.push({ ...entry, at: performance.now() });
      }
    };
    new MutationObserver(record).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-agent-editing', 'class'] });
    record();
  });
}
const presence = (page: Page) => page.evaluate(() => (window as unknown as { __presence: { kind: string; block: string; name: string; at: number }[] }).__presence);

// Show editors over `text` inside block `id`: the selection set over it, a right-click on it, the menu's item; the
// list's rows ("name · when").
async function showEditors(page: Page, editor: Locator, id: string, text: string): Promise<string[]> {
  const rect = await editor.evaluate(
    (root, [blockId, wanted]) => {
      const block = root.querySelector(`[data-id="${blockId}"]`)!;
      (root as HTMLElement).focus();
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!(n.parentElement?.closest('.ProseMirror-yjs-cursor'))) nodes.push(n as Text);
      const whole = nodes.map((n) => n.data).join('');
      const start = whole.indexOf(wanted);
      if (start < 0) throw new Error(`no "${wanted}" in ${blockId}: "${whole}"`);
      const at = (offset: number): [Text, number] => {
        let left = offset;
        for (const n of nodes) {
          if (left <= n.data.length) return [n, left];
          left -= n.data.length;
        }
        return [nodes.at(-1)!, nodes.at(-1)!.data.length];
      };
      const [a, ao] = at(start);
      const [b, bo] = at(start + wanted.length);
      const range = document.createRange();
      range.setStart(a, ao);
      range.setEnd(b, bo);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const box = range.getBoundingClientRect();
      return { x: box.left + Math.min(box.width / 2, 20), y: box.top + box.height / 2 };
    },
    [id, text] as const,
  );
  await page.waitForTimeout(100); // the editor reads the DOM selection on selectionchange
  await page.mouse.click(rect.x, rect.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Selection' }).getByRole('menuitem', { name: 'Show editors' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editors' });
  await expect(dialog.locator('.doc-editors-row').first()).toBeVisible({ timeout: 15_000 });
  const rows = await dialog.locator('.doc-editors-row').allTextContents();
  await dialog.getByRole('button', { name: 'Close editors' }).click();
  return rows.map((row) => row.trim());
}

// ---- the run ---------------------------------------------------------------------------------------------------------

test('the live run: the agent creates, reads and edits a document in one batch while the owner composes Korean; a stale quote is refused whole', async () => {
  mkdirSync(EVIDENCE, { recursive: true });
  let relay = relaySkipReason(RELAY_URL);
  if (relay !== null) {
    await new Promise((resolve) => setTimeout(resolve, 120_000)); // a 503 is transient: wait two minutes, retry once
    relay = relaySkipReason(RELAY_URL);
  }
  expect(relay, 'the relay answers GET /api/hello').toBeNull();
  const engine = installedEngine();
  expect(engine.version).toMatch(/^\d+\.\d+\.\d+$/);
  const before = a15();
  const sc = scratch();
  note(`P3-B M9 document live run (Acceptance 2), ${new Date().toISOString()}`);
  note(`engine: ${engine.bin.replace(homedir(), '~')} (${engine.version}), unmodified, through the relay ${RELAY_URL} (GET /api/hello 200); model ${MODEL}; default permission mode; cap US$${CAP_USD} as the session's maxBudgetUsd`);
  note(`app: the product build (MAWS_HARNESS=0) over a scratch CLAUDE_CONFIG_DIR ${sc.config} (settings.json {}, .claude.json trusting ${sc.repo})`);
  note(`A-15 before the launch: ${before.keys.length} keys, sha1 ${before.digest}`);

  const maws = await launchMaws({ env: { MAWS_E2E_ENGINE_BIN: engine.bin, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: sc.config } });
  let live: Live | null = null;
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
    // the panel's Artifacts tool, in this session's panel: the editor beside the session (its composer's card stays in view)
    await panel.getByRole('button', { name: 'Add a tool' }).click();
    await page.getByRole('menuitem', { name: 'Artifacts' }).click();

    const spec = { ...launchDefaults(id as AppSessionId, sc.repo), model: MODEL, permissionMode: 'default' as const, subagentModel: 'haiku', maxBudgetUsd: CAP_USD };
    expect(value(await invoke(page, 'session.launch', { spec }))).toMatchObject({ status: 'launching' });
    const journalPath = (await statusOf(page, id)).journalPath;
    const s: Live = (live = { maws, page, id, pane, panel, journalPath, allowed: [], events: () => eventsOf(page, id), rows: () => journal(journalPath) });
    await expect.poll(async () => (await statusOf(page, id)).process, { timeout: 120_000 }).toBe('ready');

    // 1: create, read, a warm-up edit (its card answered for the session)
    const ended1 = await ask(s, PROMPTS.create);
    const reply1 = await turnEnd(s, ended1, 'the create, the read and the warm-up edit');
    const first = calls(s);
    note(`turn 1: calls ${JSON.stringify(first.map((c) => c.name))}; reply ${JSON.stringify(reply1)}; permissions allowed for the session through the card: ${JSON.stringify(s.allowed)}`);
    const created = first.find((c) => c.name === 'artifact_create');
    expect(created?.result?.isError, created ? resultText(created.result!) : 'no artifact_create').toBeUndefined();
    const artifactId = json(created!.result!).artifactId as string;
    const read1 = first.find((c) => c.name === 'artifact_read' && c.result && !c.result.isError);
    expect(read1, 'the agent read the document').toBeDefined();
    const readMarkdown = json(read1!.result!).markdown as string;
    for (const blockId of ['h1', 'p1', 'p2', 'h2', 'tb1', 'r2', 'h3', 'p3']) expect(readMarkdown, `the read shows ^${blockId}`).toContain(`^${blockId}`);
    note(`G1: artifact_create → ${artifactId} (revision ${String(json(created!.result!).revision)}); artifact_read returned revision ${String(json(read1!.result!).revision)} with every given id (${readMarkdown.split('\n').length} lines)`);
    const warm = first.filter((c) => c.name === 'artifact_edit');
    expect(warm.length, 'one warm-up edit').toBeGreaterThanOrEqual(1);
    expect(warm.at(-1)!.result?.isError).toBeUndefined();

    // the document in the panel's Artifacts tool (its record view): a second replica of the host doc
    await panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /^Artifacts/ }).click();
    await panel.getByRole('button', { name: 'All', exact: true }).click();
    await panel.locator(`[data-artifact-row][data-artifact-id="${artifactId}"]`).click({ timeout: 15_000 });
    const record = panel.locator(`[data-artifact-record="${artifactId}"]`);
    const editor = record.locator('.ds-doc .ProseMirror');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await expect(editor.locator('[data-id="p3"]')).toHaveText('Nothing is known yet; the review is pending.', { timeout: 15_000 });
    const beforeBatch = await blocks(editor);
    note(`the editor's blocks before the batch: ${JSON.stringify(beforeBatch)}`);

    // 2: the batch, while the owner composes Korean at the end of p2
    await watchPresence(editor);
    const editsBefore = calls(s).filter((c) => c.name === 'artifact_edit').length;
    const ended2 = await ask(s, PROMPTS.batch);
    await caretAtEnd(page, editor, 'p2');
    const WORDS = ['안녕하세요', '한글', '입력', '테스트입니다', '문서를', '함께', '고칩니다'];
    let typed = '';
    const typingStarted = new Date().toISOString();
    const batchCall = () => calls(s).filter((c) => c.name === 'artifact_edit')[editsBefore];
    const cdp = await page.context().newCDPSession(page);
    let words = 0;
    try {
      const deadline = Date.now() + TURN_MS;
      for (;;) {
        const word = ` ${WORDS[words % WORDS.length]}`;
        const steps = keystrokes(word);
        for (const step of steps) await imeStep(cdp, step, steps);
        typed += word;
        words += 1;
        if (batchCall()?.result) break;
        await allowPending(s); // a card the batch waits on (the warm-up edit should have allowed the tool for the session)
        if (Date.now() > deadline) throw new Error('the batch did not land while composing');
      }
    } finally {
      await cdp.detach();
    }
    const typingEnded = new Date().toISOString();
    const reply2 = await turnEnd(s, ended2, 'the batch turn');
    const batch = batchCall()!;
    expect(batch.result!.isError, resultText(batch.result!)).toBeUndefined();
    const edited = json(batch.result!) as { revision: number; results: { line: string; newIds?: string[] }[] };
    const editsInTurn2 = calls(s).filter((c) => c.name === 'artifact_edit').length - editsBefore;
    note(`turn 2: the batch call ${JSON.stringify(batch.args)} answered at ${batch.at} → revision ${edited.revision}, results ${JSON.stringify(edited.results)}; artifact_edit calls in the turn: ${editsInTurn2}; reply ${JSON.stringify(reply2)}`);
    note(`G2: composing began ${typingStarted} (after the read's answer), the batch's answer is journaled at ${batch.at}, composing ended ${typingEnded} after ${words} words: ${JSON.stringify(typed)}`);
    expect(editsInTurn2, 'one batch').toBe(1);
    expect((batch.args.ops as unknown[]).length).toBe(3);
    expect(Date.parse(batch.at!)).toBeGreaterThan(Date.parse(typingStarted));
    expect(Date.parse(batch.at!)).toBeLessThanOrEqual(Date.parse(typingEnded));

    // the human's text exact; only the targeted blocks changed
    await expect.poll(async () => (await blocks(editor)).p2, { timeout: 15_000 }).toBe(`The owner writes here.${typed}`);
    const afterBatch = await blocks(editor);
    const newIds = edited.results.flatMap((r) => r.newIds ?? []);
    // inside the set cell's row, ids may be re-minted with the cell's content (cells carry no agent-facing id); the row is
    // judged by its own text
    const inRow = new Set([...(await idsInside(editor, 'r2')), ...Object.keys(beforeBatch).filter((k) => beforeBatch[k] === '200')]);
    const outside = (k: string) => !inRow.has(k);
    const changed = Object.keys(beforeBatch).filter((k) => outside(k) && k in afterBatch && afterBatch[k] !== beforeBatch[k]);
    const added = Object.keys(afterBatch).filter((k) => outside(k) && !(k in beforeBatch));
    const removed = Object.keys(beforeBatch).filter((k) => outside(k) && !(k in afterBatch));
    note(`G3: after the batch: changed ${JSON.stringify(changed.map((k) => [k, afterBatch[k]]))}; added ${JSON.stringify(added.map((k) => [k, afterBatch[k]]))}; removed ${JSON.stringify(removed)}; row r2 ${JSON.stringify(beforeBatch.r2)} → ${JSON.stringify(afterBatch.r2)}; the batch's new ids ${JSON.stringify(newIds)}`);
    expect(removed).toEqual([]);
    expect(afterBatch.p1).toBe('The launch moves to the following Tuesday. The team meets on Monday.');
    // a table's text is its cells', a row's its own cells': both change with the cell, nothing else may
    expect(changed.filter((k) => !['p1', 'p2', 'tb1', 'r2'].includes(k)), 'nothing but the targets changed').toEqual([]);
    expect(afterBatch.r2).toBe(beforeBatch.r2!.replace('200', '250'));
    expect(afterBatch.tb1).toBe(beforeBatch.tb1!.replace('200', '250'));
    expect(new Set(added)).toEqual(new Set(newIds.filter(outside)));
    const insertedTexts = added.map((k) => afterBatch[k]);
    expect(insertedTexts).toContain('Approvals');
    expect(insertedTexts).toContain('Finance approves the budget by Thursday.');
    const order = await editor.evaluate((root) => Array.from(root.querySelectorAll(':scope > [data-id]')).map((el) => el.getAttribute('data-id')));
    expect(order.indexOf(newIds[0]!), 'the section sits right after h2').toBe(order.indexOf('h2') + 1);

    // the agent's cursor and its editing blocks, drawn while the batch ran
    const drawn = await presence(page);
    note(`G4: drawn while the batch ran: ${JSON.stringify(drawn)}`);
    const outlines = drawn.filter((d) => d.kind === 'editing');
    expect(outlines.map((d) => d.block), 'the agent’s editing outline on its targets').toEqual(expect.arrayContaining(['p1']));
    expect(outlines.every((d) => d.name !== '' && d.name !== 'You')).toBe(true);
    expect(drawn.filter((d) => d.kind === 'cursor' && d.name === outlines[0]!.name).length, 'the agent’s cursor').toBeGreaterThan(0);

    // provenance through Show editors
    const agentEditors = await showEditors(page, editor, 'p1', 'following Tuesday');
    const humanEditors = await showEditors(page, editor, 'p2', WORDS[0]!);
    note(`G5: Show editors over "following Tuesday" in p1: ${JSON.stringify(agentEditors)}; over "${WORDS[0]}" in p2: ${JSON.stringify(humanEditors)}`);
    expect(agentEditors, 'one editor of the agent’s words, not the human').toHaveLength(1);
    expect(agentEditors[0]).not.toMatch(/^You · /);
    expect(humanEditors, 'one editor of the human’s words: the human').toHaveLength(1);
    expect(humanEditors[0]).toMatch(/^You · /);

    // 3: the owner changes the sentence the agent will quote, then the stale batch
    await caretAtEnd(page, editor, 'p1');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type(' again');
    await expect.poll(async () => (await blocks(editor)).p1).toBe('The launch moves to the following Tuesday. The team meets on Monday again.');
    await expect(panel.locator('[data-editor-header] [data-header-saved]')).toHaveText('All changes saved', { timeout: 15_000 });
    const beforeStale = await blocks(editor);
    const editsBeforeStale = calls(s).filter((c) => c.name === 'artifact_edit').length;
    const ended3 = await ask(s, PROMPTS.stale);
    const reply3 = await turnEnd(s, ended3, 'the stale batch turn');
    const staleCalls = calls(s).filter((c) => c.name === 'artifact_edit').slice(editsBeforeStale);
    const stale = staleCalls[0]!;
    note(`turn 3: artifact_edit calls ${JSON.stringify(staleCalls.map((c) => ({ args: c.args, error: c.result?.isError ?? false })))}; the answer ${JSON.stringify(stale ? resultText(stale.result!) : null)}; reply ${JSON.stringify(reply3)}`);
    expect(staleCalls).toHaveLength(1);
    expect(stale.result!.isError).toBe(true);
    const refusalText = resultText(stale.result!);
    const refusal = JSON.parse(refusalText.slice(refusalText.indexOf(' {"reason":') + 1)) as Record<string, unknown>;
    expect(refusal).toMatchObject({ reason: 'notFound', opIndex: 1 });
    expect(refusal.candidates).toContainEqual({ id: 'p1', text: 'The launch moves to the following Tuesday. The team meets on Monday again.' });
    const afterStale = await blocks(editor);
    expect(afterStale, 'nothing of the refused batch landed').toEqual(beforeStale);
    note(`G6: the stale batch refused ${JSON.stringify(refusal)}; the editor's blocks unchanged across it (${Object.keys(afterStale).length} blocks, no "A second batch paragraph.")`);

    // 4: the next read shows the batch's ids
    const readsBefore = calls(s).filter((c) => c.name === 'artifact_read').length;
    const ended4 = await ask(s, PROMPTS.read);
    await turnEnd(s, ended4, 'the read turn');
    const read2 = calls(s).filter((c) => c.name === 'artifact_read')[readsBefore];
    expect(read2?.result?.isError).toBeUndefined();
    const markdown2 = json(read2!.result!).markdown as string;
    for (const newId of newIds) expect(markdown2, `the next read shows ^${newId}`).toContain(`^${newId}`);
    note(`G7: the next read (revision ${String(json(read2!.result!).revision)}) shows the batch's ids ${JSON.stringify(newIds)}; its markdown:\n${markdown2}`);
  } finally {
    if (live) {
      const s = live as Live;
      try {
        const stopped = value(await invoke(s.page, 'session.stop', { appSessionId: s.id as AppSessionId, reason: 'stop' }));
        await expect.poll(async () => (await statusOf(s.page, s.id)).process, { timeout: 30_000 }).toBe('exited');
        cpSync(join(maws.userData, 'engine-host', 'journal', s.id), join(sc.root, 'journals'), { recursive: true });
        const costUsd = processCost(s.rows());
        note(`session ${s.id}: stopped ${JSON.stringify(stopped)}; journal kept under ${join(sc.root, 'journals')}; total_cost_usd ${costUsd.toFixed(4)} (cap US$${CAP_USD}); permissions allowed for the session: ${JSON.stringify(s.allowed)}`);
      } catch (error) {
        note(`the session could not be stopped or booked: ${String(error)}`);
      }
    }
    note(`console errors: ${JSON.stringify(maws.consoleErrors())}`);
    await maws.cleanup();
    note(`scratch kept for inspection: ${sc.root}`);
  }
  checkA15('after the run', before, [sc.root, maws.userData]);
});
