// P4-A2 G2's live run (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §5 A2's acceptance, "the same on a slide publish
// after B2 lands"; §2 item 9; docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md G2.7, G-R1 to G-R3): the
// agent's slide publish seen as it is written on the installed engine. The product app (MAWS_HARNESS=0) with the installed
// Claude Code (never patched, D-1) under a scratch CLAUDE_CONFIG_DIR under /tmp, through ClaudeUsage's relay, in default
// permission mode, every permission given through the request card (as e2e/document-provisional-live.spec.ts, M8, whose
// session helpers this file repeats). The deck is the owner's: created with `artifacts.create`, seeded through the
// window's presentations seam, open in the panel's Artifacts tool beside the session, its one slide on the stage and
// holding a date. One session, asked in its composer:
//   1. reads the deck once and publishes a small warm-up change of that slide (another line's text), the card's "Allow
//      for this session" answered for the read and the publish;
//   2. without reading again, in ONE `artifact_publish` of that slide's file, changes the date.
// Judged from a page-side recorder of the stage (e2e/support/slide-provisional-live.ts) against the journal's clock: the
// label "<name> is writing…" on the slide before the `tools/call` reached MAWS, within a second of the delta that named
// the slide's file; the date's ghost drawn changed, with the new date as its text, before the call, its texts prefixes of
// the new date as they streamed; nothing of the publish on the live slide before the call; the swap with no sample in
// which the date shows neither the ghost nor the real text, and none showing both; the layer gone after; and the
// tool-time guard (X34) over every `artifact_*` call of the run.
// Spends money within the session's --max-budget-usd, MAWS_LIVE_MAX_USD or US$0.50 when unset; the model is
// MAWS_LIVE_SLIDE_MODEL (haiku when unset, the cheapest that drives the publish). Run on purpose only:
//   MAWS_LIVE=1 pnpm e2e:presentations-provisional-live
// Evidence: test-results/presentations-provisional-live/live-run.txt (the scratch root, journal included, is kept).
import { openArtifactInPanel } from './support/shell';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import type { JournalRow } from '@shared/wire/journal';
import type { ArtifactPublishResult } from '@shared/maws/tools';
import { launchDefaults } from '../src/shared/composer/launch-defaults';
import { RELAY_URL } from '../src/engine-host/launch';
import { assertConfigHomeSafe } from '../test/live/support/live';
import { guardToolTime } from '../test/live/support/tool-time';
import { isolatedGitEnv } from '../test/support/git-env';
import { compareA15 } from '../test/support/owner-file';
import { relaySkipReason } from '../test/support/relay-health';
import { journal } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { latencyBudgets } from './support/latency';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { liveMaxUsd } from './support/live-budget';
import { endLiveRun, liveSpend } from './support/live-lifecycle';
import { eventsOf, mcpCalls, mcpResultOf, ofKind, recordEvents, resultText, seedTranscripts, type McpResult } from './support/maws-tools';
import { a15Line, a15Reading, installedEngine } from './support/p1-live';
import { sidebarRow } from './support/sidebar';
import { ghostOf, slideSwapOffenders } from './support/slide-provisional-judge';
import { recordSlide } from './support/slide-provisional-live';

test.skip(process.env.MAWS_LIVE !== '1', 'the slide provisional live run runs only under MAWS_LIVE=1');
test.describe.configure({ timeout: 1_200_000 });

const EVIDENCE = join(REPO_ROOT, 'test-results', 'presentations-provisional-live');
const EVIDENCE_FILE = join(EVIDENCE, 'live-run.txt');
const CAP_USD = liveMaxUsd() ?? 0.5;
const MODEL = process.env.MAWS_LIVE_SLIDE_MODEL ?? 'haiku';
const TURN_MS = 300_000;
const TITLE = 'Harbor open house';
const SLIDE = 'event';
const PATH = `project/slides/${SLIDE}.html`;
const DATE = 'date'; // the element whose text the measured publish changes
const OLD = 'Thursday, 12 November 2026';
const NEW = 'Friday, 4 December 2026';
const PLACE_OLD = 'Room 4B, Harbor Building';
const PLACE_NEW = 'Room 5A, Harbor Building';

// One slide on the stage. The date is its second element, so its ghost is drawn early in the file's stream and the rest
// of the file (the place, the agenda, the notes) streams after it, before the `tools/call`.
const FILES: Record<string, string> = {
  'project/deck.json': JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-22T09:00:00Z' }, lists: 'css', title: TITLE, cover: SLIDE, order: [SLIDE], sections: {}, faces: {}, designSystems: [] }),
  [PATH]:
    `<section id="${SLIDE}" style="background:#ffffff; padding:128px; display:flex; flex-direction:column; gap:32px">` +
    `<h1 id="title" style="font-size:96px">Fall open house</h1>` +
    `<p id="${DATE}" style="font-size:56px">${OLD}</p>` +
    `<p id="place" style="font-size:40px">${PLACE_OLD}</p>` +
    `<ul id="agenda" style="font-size:36px"><li>Welcome and a tour of the classrooms</li><li>The course fair, one table per subject</li><li>Questions and answers with the tutors</li></ul>` +
    `<aside>Mention the parking behind the building.</aside></section>`,
};

// The prompts over the deck's id (the owner created it, so the test knows it).
const promptsFor = (artifactId: string) => ({
  warm:
    `Call mcp__maws__artifact_read once on the presentation whose artifact id is ${artifactId} (artifact "${artifactId}"). ` +
    `Then make exactly ONE mcp__maws__artifact_publish call on it, with baseRevision the revision that read returned and files holding only "${PATH}": ` +
    `that file's text exactly as the read returned it, except that "${PLACE_OLD}" becomes "${PLACE_NEW}". Change nothing else and send no other file. ` +
    'Do every step yourself, never through an agent. Then reply READY.',
  edit:
    `Without reading the presentation again, make exactly ONE mcp__maws__artifact_publish call on the presentation whose artifact id is ${artifactId}, ` +
    `with baseRevision the revision your last artifact_publish returned and files holding only "${PATH}": that file's text exactly as you last published it, ` +
    `except that the date "${OLD}" becomes "${NEW}". Change nothing else, send no other file, make no other call. Reply DONE when the publish succeeds.`,
});

interface DeckSeam {
  __maws_presentations: {
    seed(artifactId: string, files: Record<string, string>): Promise<{ changed: string[]; held: string[] }>;
    slide(artifactId: string, slideId: string): Promise<{ children: ElementIR[] }>;
  };
}
interface ElementIR {
  id: string;
  children: ElementIR[];
  text?: { inline: ({ text: string } | { br: true })[] }[];
}
const find = (children: ElementIR[], id: string): ElementIR | undefined => {
  for (const c of children) {
    if (c.id === id) return c;
    const inner = find(c.children, id);
    if (inner) return inner;
  }
  return undefined;
};
const textOf = (e: ElementIR | undefined) => (e?.text ?? []).map((b) => b.inline.map((r) => ('text' in r ? r.text : '\n')).join('')).join('\n');
const liveText = async (page: Page, artifactId: string, elementId: string) =>
  textOf(find((await page.evaluate(([a, s]) => (window as unknown as DeckSeam).__maws_presentations.slide(a!, s!), [artifactId, SLIDE] as const)).children, elementId));

const lines: string[] = [];
function note(line: string): void {
  lines.push(line);
  writeFileSync(EVIDENCE_FILE, `${lines.join('\n')}\n`);
}
function scratch(): { root: string; config: string; repo: string; userData: string; engineId: string } {
  const root = realpathSync(mkdtempSync('/tmp/maws-presentations-provisional-live-'));
  const config = join(root, 'claude-config');
  const repo = join(root, 'repo');
  const userData = join(root, 'user-data'); // the app's profile, kept with the scratch
  for (const dir of [config, repo, userData]) mkdirSync(dir);
  writeFileSync(join(config, 'settings.json'), '{}\n');
  writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
  assertConfigHomeSafe({ configHome: config, controls: [] });
  writeFileSync(join(repo, 'README.txt'), 'The slide provisional live run.\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=P4A2', '-c', 'user.email=p4a2@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  const [engineId] = seedTranscripts(config, repo, ['P4-A2 live: a slide written']);
  return { root, config, repo, userData, engineId: engineId! };
}

// ---- the session (as e2e/document-provisional-live.spec.ts) ------------------------------------------------------------

interface Live {
  page: Page;
  id: string;
  pane: Locator;
  journalPath: string;
  allowed: string[];
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
const sentPrompts = (s: Live) => s.rows().filter((r) => r.direction === 'out' && (r.frame as { type?: string }).type === 'user').length;
// A prompt through the real composer, its turn driven to its end (each permission allowed for the session); its reply.
async function turn(s: Live, what: string, prompt: string): Promise<string> {
  const ended = mainTurnsEnded(await s.events()).length;
  const sent = sentPrompts(s);
  const message = s.pane.getByRole('textbox', { name: 'Message', exact: true });
  await message.click();
  await s.page.keyboard.insertText(prompt);
  await s.page.keyboard.press('Meta+Enter'); // `composer.send`
  await expect.poll(() => sentPrompts(s), { timeout: 15_000, message: 'the prompt reached the engine' }).toBeGreaterThan(sent);
  const deadline = Date.now() + TURN_MS;
  for (;;) {
    const status = await statusOf(s.page, s.id);
    if (mainTurnsEnded(await s.events()).length > ended && status.turn === null && status.pendingRequests === 0) break;
    if (status.process === 'exited') throw new Error(`the engine exited during ${what}`);
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    if (await allowPending(s)) continue;
    await s.page.waitForTimeout(300);
  }
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
// The `maws` calls of the session so far, each with its stream (the tool_use block whose id the call's `_meta` names)
// and its answer.
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
const filesOf = (call: Call) => Object.keys((call.args.files ?? {}) as Record<string, unknown>);

// ---- the run ---------------------------------------------------------------------------------------------------------

test('the live run: the agent’s publish of a slide is seen as it is written, its label and the changed date before the call, swapped without a gap or a double; the tool time guarded', async () => {
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
  const sc = scratch();
  const a15First = a15Reading();
  const ours = [sc.root];
  note(`P4-A2 G2.7 slide provisional live run (§5 A2's acceptance on a slide publish), ${new Date().toISOString()}`);
  note(`engine: ${engine.bin.replace(homedir(), '~')} (${engine.version}), unmodified, through the relay ${RELAY_URL}; model ${MODEL}; default permission mode; --max-budget-usd ${CAP_USD}`);
  note(`app: the product build (MAWS_HARNESS=0) over a scratch CLAUDE_CONFIG_DIR ${sc.config}; CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING in the launching shell: ${JSON.stringify(process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING ?? null)} (MAWS sets it in the engine's environment itself)`);
  note(a15Line('before the launch', a15First, a15First, ours));

  let maws: MawsLaunch | null = null;
  let live: Live | null = null;
  let enginePid: number | null = null;
  let prompted = false; // a paid turn was asked for: from here an absent receipt is spend at the whole cap
  let failure: unknown = null;
  try {
    maws = await launchMaws({ userData: sc.userData, env: { MAWS_E2E_ENGINE_BIN: engine.bin, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: sc.config } });
    await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000)); // room for the panel's stage
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
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as Partial<DeckSeam>).__maws_presentations), { message: 'the window’s presentations seam is installed' }).toBe('object');
    const pane = page.locator('[data-region="main"] [data-pane="0"]');
    await (await sidebarRow(page, { appSessionId: id })).click();
    await page.mouse.move(700, 20);
    await expect(pane.locator(`[data-composer="${id}"]`)).toBeVisible();

    // the owner's deck, seeded from files, open in the panel's Artifacts tool beside the composer, its slide on the stage
    const { artifact } = value(await invoke(page, 'artifacts.create', { kind: 'presentation', title: TITLE }));
    const seeded = await page.evaluate(([a, f]) => (window as unknown as DeckSeam).__maws_presentations.seed(a!, f!), [artifact.id, FILES] as const);
    expect(seeded.held, 'the seeded slide loads').toEqual([]);
    await openArtifactInPanel(page, artifact.id);
    const rootSelector = `[data-region="panel"] [data-deck-artifact="${artifact.id}"]`;
    const deck = page.locator(rootSelector);
    await expect(deck.locator('[data-deck-editor]')).toBeVisible({ timeout: 30_000 });
    const stage = deck.locator(`[data-stage-slide="${SLIDE}"]`);
    await expect(stage.locator(`[data-eid="${DATE}"]`).first()).toHaveText(OLD, { timeout: 30_000 });
    note(`the deck: ${artifact.id} "${TITLE}", one slide ${SLIDE} on the panel's stage, its ${DATE} reading ${JSON.stringify(OLD)}`);
    const seen = await recordSlide(page, rootSelector, { slide: SLIDE, element: DATE });
    const PROMPTS = promptsFor(artifact.id);

    const spec = { ...launchDefaults(id as AppSessionId, sc.repo), model: MODEL, permissionMode: 'default' as const, subagentModel: 'haiku', maxBudgetUsd: CAP_USD };
    expect(value(await invoke(page, 'session.launch', { spec }))).toMatchObject({ status: 'launching' });
    const journalPath = (await statusOf(page, id)).journalPath;
    const s: Live = (live = { page, id, pane, journalPath, allowed: [], events: () => eventsOf(page, id), rows: () => (existsSync(journalPath) ? journal(journalPath) : []) });
    await expect.poll(async () => (await statusOf(page, id)).process, { timeout: 120_000 }).toBe('ready');
    enginePid = (await statusOf(page, id)).pid;

    // 1: the read and the warm-up publish (the cards answered for the session)
    prompted = true;
    const reply1 = await turn(s, 'the read and the warm-up publish', PROMPTS.warm);
    const first = calls(s);
    note(`turn 1: calls ${JSON.stringify(first.map((c) => c.name))}; reply ${JSON.stringify(reply1)}; permissions allowed for the session: ${JSON.stringify(s.allowed)}`);
    const warm = first.filter((c) => c.name === 'artifact_publish');
    expect(warm.length, 'a warm-up publish').toBeGreaterThanOrEqual(1);
    expect(warm.at(-1)!.result?.isError, warm.at(-1)!.result ? resultText(warm.at(-1)!.result!) : 'no answer').toBeUndefined();
    await expect.poll(() => liveText(page, artifact.id, 'place'), { timeout: 15_000 }).toBe(PLACE_NEW);
    await expect(deck.locator('[data-provisional-writing]')).toHaveCount(0, { timeout: 15_000 });
    const warmDrawn = (await seen()).filter((smp) => smp.writing === warm.at(-1)!.toolUseId).length;
    note(`G0: the warm-up publish drew its layer in ${warmDrawn} sample(s) (its stream ran before the permission card)`);

    // 2: the measured publish: the date changed in one publish of the slide's file
    const publishesBefore = calls(s).filter((c) => c.name === 'artifact_publish').length;
    const samplesBefore = (await seen()).length;
    const reply2 = await turn(s, 'the date publish', PROMPTS.edit);
    const made = calls(s).filter((c) => c.name === 'artifact_publish').slice(publishesBefore);
    expect(made, 'one publish in the turn').toHaveLength(1);
    const call = made[0]!;
    expect(call.result?.isError, call.result ? resultText(call.result) : 'no answer').toBeUndefined();
    const published = JSON.parse(resultText(call.result!)) as ArtifactPublishResult;
    expect(filesOf(call), 'the publish carried the slide’s file').toContain(PATH);
    await expect(stage.locator(`[data-eid="${DATE}"]`).first()).toHaveText(NEW, { timeout: 15_000 });
    await expect(deck.locator('[data-provisional-writing], [data-provisional-veiled], [data-provisional-label], section[data-provisional-ghost]')).toHaveCount(0, { timeout: 15_000 });
    expect(await liveText(page, artifact.id, DATE), 'the deck’s date is the new one').toBe(NEW);
    note(`turn 2: the publish ${JSON.stringify({ files: filesOf(call), baseRevision: call.args.baseRevision, toolUseId: call.toolUseId })} → ${JSON.stringify({ status: published.status, revision: published.revision, changed: published.changed })}; reply ${JSON.stringify(reply2)}`);

    const samples = (await seen()).slice(samplesBefore);
    const mine = samples.filter((smp) => smp.writing === call.toolUseId);
    const labelled = mine.find((smp) => smp.label !== null);
    const firstGhost = mine.find((smp) => ghostOf(smp, DATE) !== null);
    const wholeGhost = mine.find((smp) => ghostOf(smp, DATE)?.text === NEW);
    const ghostTexts = [...new Set(mine.flatMap((smp) => (ghostOf(smp, DATE) ? [ghostOf(smp, DATE)!.text] : [])))];
    const swap = slideSwapOffenders(samples, DATE, NEW);
    const swapped = swap.from < 0 ? undefined : samples.slice(swap.from).find((smp) => smp.live?.text === NEW && !smp.live.veiled);
    const fileNamedAt = deltaCompleting(call, `"${PATH}"`); // the delta that named the slide's file
    const dateWrittenAt = deltaCompleting(call, NEW); // the delta that completed the new date
    const since = (smp: { at: number } | undefined, from: number | null) => (smp && from !== null ? smp.at - from : null);
    const timeline = {
      toolUseId: call.toolUseId, deltas: call.deltas, streamedChars: call.raw.length,
      firstDeltaAt: call.firstDeltaAt, fileNamedAt, dateWrittenAt, requestedAt: call.requestedAt, answeredAt: call.answeredAt,
      labelAfterFileNamedMs: since(labelled, fileNamedAt),
      labelBeforeCallMs: labelled && call.requestedAt !== null ? call.requestedAt - labelled.at : null,
      ghostAfterFirstDeltaMs: since(firstGhost, call.firstDeltaAt),
      wholeGhostAfterDateWrittenMs: since(wholeGhost, dateWrittenAt),
      wholeGhostBeforeCallMs: wholeGhost && call.requestedAt !== null ? call.requestedAt - wholeGhost.at : null,
      swapAfterAnswerMs: since(swapped, call.answeredAt),
      ghostTexts, ghostKinds: [...new Set(mine.flatMap((smp) => smp.ghost.map((g) => `${g.key}:${g.shown}`)))],
      held: [...new Set(mine.map((smp) => smp.held).filter((held) => held !== null))],
      thumbRinged: samples.some((smp) => smp.thumb === call.toolUseId),
      samples: samples.length,
    };
    note(`G1 timeline: ${JSON.stringify(timeline)}`);
    test.info().annotations.push({ type: 'slide provisional live timeline', description: JSON.stringify(timeline) });
    expect(call.firstDeltaAt, 'the call streamed deltas').not.toBeNull();
    expect(call.deltas, 'several deltas').toBeGreaterThan(1);

    await test.step('G1: the label on the slide before the tools/call reached MAWS, within a second of the delta that named its file', () => {
      expect(labelled, `the label was drawn; the turn's first samples ${JSON.stringify(samples.slice(0, 4))}`).toBeDefined();
      expect(labelled!.label).toMatch(/^.+ is writing…$/);
      expect(fileNamedAt, 'the stream named the slide’s file').not.toBeNull();
      expect(labelled!.at, 'the label before the tools/call').toBeLessThanOrEqual(call.requestedAt!);
      // Through the load-aware budget, read at the test's start: a neighbour or ci-kit's guest may run beside a live run.
      budget('label after the delta that named the slide file', labelled!.at - fileNamedAt!, 1_000, 'the label within 1 s of the delta that named the slide’s file');
    });
    await test.step('G2: the date’s ghost, changed, with the new date before the call; nothing of the publish on the live slide before it', () => {
      expect(wholeGhost, `the date's ghost drew the new date; its texts ${JSON.stringify(ghostTexts)}`).toBeDefined();
      expect(ghostOf(wholeGhost!, DATE)!.shown, 'the date drawn as changed').toBe('changed');
      expect(wholeGhost!.at, 'the whole new date drawn before the tools/call').toBeLessThanOrEqual(call.requestedAt!);
      expect(ghostTexts.every((text) => NEW.startsWith(text)), `every drawn length a prefix of the new date: ${JSON.stringify(ghostTexts)}`).toBe(true);
      expect(mine.filter((smp) => smp.at <= wholeGhost!.at).every((smp) => smp.live?.veiled === true || ghostOf(smp, DATE) === null), 'the live date veiled under its ghost').toBe(true);
      expect(samples.filter((smp) => smp.at < call.requestedAt!).every((smp) => smp.live?.text === OLD), 'the live date unchanged before the call').toBe(true);
    });
    await test.step('G3: the swap without a gap or a double; the layer gone after', () => {
      const offence = (smp: (typeof samples)[number]) => ({ at: smp.at - (call.firstDeltaAt ?? 0), ghost: ghostOf(smp, DATE), live: smp.live });
      expect(swap.judged, 'a swap to judge: the ghost drew the whole new date in some sample').toBe(true);
      expect(swap.gaps.map(offence), 'a gap: the date showing neither the ghost nor the real text').toEqual([]);
      expect(swap.doubles.map(offence), 'a double: the date showing both').toEqual([]);
      expect(swapped, 'the real date shown').toBeDefined();
      const end = samples.at(-1)!;
      expect(end).toMatchObject({ writing: null, label: null, ghost: [], live: { text: NEW, veiled: false } });
    });

    // the guard (X34) over every artifact_* call of the run; throws over the bound
    note(`G4 tool time: ${guardToolTime(s.rows()).line}`);
    note(`the window's console errors: ${JSON.stringify(maws.consoleErrors())}`);
    note('PASS: the label and the changed date drawn before the tools/call, swapped without a gap or a double, the tool time within the guard');
  } catch (error) {
    failure = error;
    note(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // The session stopped, the app closed, the engine process gone, the spend from the journal's receipts
    // (e2e/support/live-lifecycle.ts), the owner file read again; the first error fails the test after the bookkeeping.
    const ran = live as Live | null;
    const ended = await endLiveRun({
      session: ran ? { status: () => statusOf(ran.page, ran.id), stop: async () => void value(await invoke(ran.page, 'session.stop', { appSessionId: ran.id as AppSessionId, reason: 'stop' })) } : null,
      enginePid,
      beforeCleanup: () => {
        if (ran && existsSync(ran.journalPath)) cpSync(ran.journalPath, join(sc.root, 'journal.jsonl'));
      },
      cleanup: maws === null ? null : () => maws!.cleanup(),
      note,
    });
    failure ??= ended.errors[0] ?? null;
    const spend = liveSpend(ran !== null && existsSync(ran.journalPath) ? journal(ran.journalPath) : [], CAP_USD, prompted);
    note(`spend: receipts ${spend.receipts.length > 0 ? `${JSON.stringify(spend.receipts)}, total_cost_usd ${spend.receipted.toFixed(4)}` : 'none'}; accounted exposure US$${spend.accounted.toFixed(4)} (${spend.basis}); cap US$${CAP_USD}; journal ${ran?.journalPath ?? 'none (no launch)'}`);
    const a15After = a15Reading();
    note(a15Line('after the app closed', a15First, a15After, ours));
    note(`scratch kept for inspection: ${sc.root}`);
    expect(compareA15(a15First.keys, a15After.keys, ours).breach, 'no project of the run’s scratch in the owner file (A-15)').toEqual([]);
    expect(spend.accounted, 'within the cap').toBeLessThanOrEqual(CAP_USD);
    if (failure === null) {
      expect(spend.receipts.length, 'a passing run has the engine’s receipt for each of its two turns').toBeGreaterThanOrEqual(2);
      expect(spend.settled, 'the last receipt came after the last prompt').toBe(true);
    }
  }
  if (failure !== null) throw failure;
});
