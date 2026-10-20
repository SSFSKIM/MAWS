// P3-C's live run (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, M10, Acceptance 2; the P3 composite's §2
// item 5, the agent's half, read at property level per its Decision Log 53 (1)). Its cap and scratch layout are P3-L's
// and P3-D's live runs' (e2e/library-live.spec.ts, e2e/design-systems-live.spec.ts): the product app (a plain build, as
// MAWS ships it) with the installed Claude Code (unmodified, D-1) under a scratch CLAUDE_CONFIG_DIR under /tmp
// (`settings.json` `{}`, a `.claude.json` trusting the scratch project), through ClaudeUsage's relay (GET /api/hello, one
// retry two minutes later, else the run is `blocked: relay`), on Haiku in default permission mode with the session's
// `--max-budget-usd`, every permission allowed for the session through the request card docked in the composer. The
// window is never shown (`launchMaws`'s quiet window).
// One session, four prompts through the real composer:
//   1. the agent builds a deck of five slides from a brief in one `artifact_create` from files (deck.json and one file
//      per slide), each slide's heading an element `title` in Georgia, then reads it once;
//   2. the owner, through the product (a replica of the deck in the window, the human's edits acknowledged by the host),
//      changes the font of the second slide's heading, retitles the third slide and recolours and annotates the fourth;
//      the agent, asked to change the heading font deck-wide without reading again, publishes every slide from its stale
//      read in one call: refused, naming the second slide's file, the element `title` and `font-family`, and nothing of
//      the publish landed (the deck's files and revision unchanged);
//   3. the agent reads again and publishes the same change in one multi-file call: it lands at one revision (the
//      store's next), every heading is in Verdana and the owner's retitle, colour and notes are intact;
//   4. the agent exports the deck as PPTX with `artifact_export`: the file is a zip with one slide part per slide, whose
//      shapes are named by element ids (`title` on every slide).
// The owner's ~/.claude.json is only read, for the A-15 delta before the launch and after the app closed. The run's lines
// go to stdout and to `live-run.txt` under the scratch root, which is kept for inspection (journals included).
// It spends money, within MAWS_LIVE_MAX_USD (US$0.75 when unset, at most US$1), the session's `--max-budget-usd`; run on
// purpose only (the script builds, the flag runs):
//   MAWS_LIVE=1 pnpm e2e:presentations-live
// (`pnpm e2e:presentations-live` alone builds and reports the case skipped.)
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import JSZip from 'jszip';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import type { ArtifactCreateResult, ArtifactExportResult, ArtifactPublishResult } from '@shared/maws/tools';
import { launchDefaults } from '../src/shared/composer/launch-defaults';
import { RELAY_URL } from '../src/engine-host/launch';
import { assertConfigHomeSafe } from '../test/live/support/live';
import { guardToolTime } from '../test/live/support/tool-time'; // P4-A2 (X34)
import { ownerPlugins } from '../test/support/claude-env';
import { isolatedGitEnv } from '../test/support/git-env';
import { compareA15 } from '../test/support/owner-file';
import { relaySkipReason } from '../test/support/relay-health';
import { journal } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { launchMaws, type MawsLaunch } from './support/launch';
import { liveMaxUsd } from './support/live-budget';
import { endLiveRun, liveSpend } from './support/live-lifecycle';
import { eventsOf, mcpCalls, mcpResultOf, ofKind, recordEvents, resultText, seedTranscripts, type McpResult } from './support/maws-tools';
import { a15Line, a15Reading, chargeOf, initPluginsOf, installedEngine } from './support/p1-live';
import { sidebarRow } from './support/sidebar';

test.skip(process.env.MAWS_LIVE !== '1', 'the P3-C live run runs only under MAWS_LIVE=1');
test.describe.configure({ timeout: 1_800_000 });

const CAP_USD = liveMaxUsd() ?? 0.75;
const TURN_MS = 600_000;
const TITLE = 'Harbor Tutoring — Fall term';
const FIRST_FONT = 'Georgia, serif';
const OWNER_FONT = 'Tahoma, sans-serif';
const AGENT_FONT = 'Verdana, sans-serif';
const RETITLE = 'This term: ';
const OWNER_COLOUR = '#c0392b';
const OWNER_NOTES = 'Mention the sibling discount.';

const PROMPTS = {
  build:
    `Build a slide deck from this brief as a MAWS presentation artifact. The brief: "${TITLE}", a five-slide talk to parents of high-school students in Portland, Maine: ` +
    '(1) a cover with the title and the subtitle "After-school tutoring, September to December"; (2) the courses: algebra, chemistry and essay writing; ' +
    '(3) the weekly schedule: Monday to Thursday, 3:30 to 6 pm; (4) how to sign up: the form on the website, by September 1; (5) contact: hello@harbortutoring.example or the front desk.\n' +
    'Do every step yourself, one after another, never through an agent:\n' +
    '1. Call mcp__maws__artifact_describe_type with kind "presentation" and read its guide and format reference.\n' +
    `2. Make ONE mcp__maws__artifact_create call with kind "presentation", title "${TITLE}" and files: "project/deck.json" plus one "project/slides/<id>.html" per slide, five slides with ids cover, courses, schedule, signup and contact, in that order. ` +
    `On every slide the heading is an h1 or h2 with id "title" whose style includes font-family: ${FIRST_FONT} (write that value literally, not as a var()). Give every other element an id too. No pictures.\n` +
    '3. If the create answers held slides or warnings, fix them with mcp__maws__artifact_publish.\n' +
    '4. Call mcp__maws__artifact_read on the presentation once, last.\n' +
    'Then reply with exactly one word: READY.',
  stale:
    `Change the heading font deck-wide: on every slide, set the font-family of the element with id "title" to ${AGENT_FONT}, and change nothing else. ` +
    'Do NOT read the presentation again: start from the files your last mcp__maws__artifact_read returned, and make exactly ONE mcp__maws__artifact_publish call that sends every slide file with that change, with baseRevision the revision that read returned. ' +
    'If the call is refused, do not retry, do not read, make no other call: reply REFUSED followed by the refusal’s reason.',
  reread:
    `Now read the presentation again with mcp__maws__artifact_read, apply the same change to what you read (on every slide, the element with id "title" gets font-family: ${AGENT_FONT}; keep every other property, text and id exactly as you read them), ` +
    'and send every slide file in exactly ONE mcp__maws__artifact_publish call with baseRevision from that read. Make no other call. Reply DONE when the publish succeeds.',
  export: 'Export the presentation as PowerPoint: call mcp__maws__artifact_export once with format "pptx", make no other call, and reply with exactly the path it returned.',
} as const;

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

interface SlideIR {
  id: string;
  style: Record<string, string>;
  notes: string;
  children: ElementIR[];
}
interface ElementIR {
  id: string;
  style: Record<string, string>;
  children: ElementIR[];
  text?: { inline: ({ text: string } | { br: true })[] }[];
}
interface DeckSeam {
  __maws_presentations: {
    edit(artifactId: string, edit: Record<string, unknown>): Promise<void>;
    files(artifactId: string): Promise<Record<string, string>>;
    slide(artifactId: string, slideId: string): Promise<SlideIR>;
    order(artifactId: string): Promise<string[]>;
  };
}
const deck = <K extends keyof DeckSeam['__maws_presentations']>(page: Page, name: K, ...args: Parameters<DeckSeam['__maws_presentations'][K]>) =>
  page.evaluate(([n, a]) => ((window as unknown as DeckSeam).__maws_presentations[n as K] as (...x: unknown[]) => unknown)(...(a as unknown[])), [name, args] as const) as ReturnType<DeckSeam['__maws_presentations'][K]>;
const find = (children: ElementIR[], id: string): ElementIR | undefined => {
  for (const c of children) {
    if (c.id === id) return c;
    const inner = find(c.children, id);
    if (inner) return inner;
  }
  return undefined;
};
const textOf = (e: ElementIR | undefined) => (e?.text ?? []).map((b) => b.inline.map((r) => ('text' in r ? r.text : '\n')).join('')).join('\n');
/** A font stack compared by meaning: quotes, case and spaces after commas aside. */
const family = (value: string | undefined) => (value ?? '').replace(/["']/g, '').replace(/\s*,\s*/g, ',').trim().toLowerCase();

test('the agent builds a deck from a brief; its stale deck-wide publish is refused naming the slide, element and property with nothing landed; after a re-read it lands whole with the owner’s edits kept; it exports a PPTX', async () => {
  const root = realpathSync(mkdtempSync('/tmp/maws-p3c-live-'));
  const config = join(root, 'claude-config');
  const repo = join(root, 'repo');
  const userData = join(root, 'user-data');
  for (const dir of [config, repo, userData]) mkdirSync(dir, { recursive: true });
  const logFile = join(root, 'live-run.txt');
  const note = (line: string) => {
    appendFileSync(logFile, `${line}\n`);
    console.log(line);
  };

  let relay = relaySkipReason(RELAY_URL);
  if (relay !== null) {
    note(`relay not ready (${relay}); waiting two minutes and retrying once`);
    await new Promise((resolve) => setTimeout(resolve, 120_000));
    relay = relaySkipReason(RELAY_URL);
  }
  if (relay !== null) {
    note(`blocked: relay (${relay}) at ${new Date().toISOString()}`);
    test.skip(true, `blocked: relay: ${relay}`);
  }
  let engine: { bin: string; version: string };
  try {
    engine = installedEngine();
    if (!/^\d+\.\d+\.\d+$/.test(engine.version)) throw new Error(`no version from ${engine.bin} --version`);
  } catch (error) {
    note(`blocked: engine (${String(error)})`);
    test.skip(true, `blocked: engine: ${String(error)}`);
    return;
  }

  writeFileSync(join(config, 'settings.json'), '{}\n');
  writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
  assertConfigHomeSafe({ configHome: config, controls: [] });
  writeFileSync(join(repo, 'README.md'), '# Harbor Tutoring\n\nAn after-school tutoring centre for high-school students in Portland, Maine.\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=P3-C', '-c', 'user.email=p3c@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  const [engineId] = seedTranscripts(config, repo, ['P3-C live: a deck from a brief']);

  const a15First = a15Reading();
  const ours = [root];
  note(`==== P3-C live run (M10, Acceptance 2), ${new Date().toISOString()}`);
  note(`engine: ${engine.bin.replace(homedir(), '~')} (${engine.version}), unmodified, through ClaudeUsage's relay ${RELAY_URL} (GET /api/hello 200), Haiku, default permission mode, --max-budget-usd ${CAP_USD} (MAWS_LIVE_MAX_USD)`);
  note(`scratch: ${root} (claude-config/ settings.json {} and .claude.json trusting repo/; repo/ a one-file project; user-data/ the app's profile, show: false); the app: the product build (out/main/index.js), every CLAUDE* variable of the runner dropped (launchEnvironment)`);
  note(a15Line('before the launch', a15First, a15First, ours));

  let maws: MawsLaunch | null = null;
  let id = '' as AppSessionId;
  let journalPath: string | null = null;
  let enginePid: number | null = null;
  let prompted = false; // a paid turn was asked for: from here an absent receipt is spend at the whole cap
  const allowed: string[] = [];
  let failure: unknown = null;
  try {
    maws = await launchMaws({ userData, env: { MAWS_E2E_ENGINE_BIN: engine.bin, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: config } });
    const { page } = maws;
    const pane = page.locator('[data-region="main"] [data-pane="0"]');
    await recordEvents(page);
    await expect
      .poll(async () => {
        const { sessions } = value(await invoke(page, 'session.list', {}));
        id = (sessions.find((r) => r.engineSessionId === engineId)?.appId ?? '') as AppSessionId;
        return id !== '';
      }, { timeout: 30_000 })
      .toBe(true);
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as Partial<DeckSeam>).__maws_presentations), { message: 'the window’s presentations seam is installed' }).toBe('object');
    const statusOf = async () => value(await invoke(page, 'session.status', { appSessionId: id }));
    const events = (): Promise<SessionEvent[]> => eventsOf(page, id);
    const rows = (): JournalRow[] => (journalPath !== null && existsSync(journalPath) ? journal(journalPath) : []);
    const mainTurnsEnded = (all: SessionEvent[]) => ofKind(all, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);
    const ipc = async <T,>(name: string, input: unknown): Promise<T> => {
      const result = (await page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const)) as Result<T>;
      if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
      return result.value;
    };
    const revisionOf = async (artifactId: string) => (await ipc<{ artifact: { revision: number } | null }>('artifacts.get', { artifactId })).artifact?.revision ?? -1;
    const calls = () => mcpCalls(rows()).map((c) => ({ ...c, result: mcpResultOf(rows(), c.requestId) }));
    const json = <T,>(result: McpResult) => JSON.parse(resultText(result)) as T;
    const logCalls = (from: number) => {
      for (const c of calls().slice(from)) {
        const files = c.args.files && typeof c.args.files === 'object' ? Object.fromEntries(Object.entries(c.args.files as Record<string, string | null>).map(([path, text]) => [path, text === null ? null : `${text.length} chars`])) : undefined;
        note(`  maws ${c.name} ${JSON.stringify({ ...c.args, ...(files ? { files } : {}) })} -> ${c.result ? `${c.result.isError ? 'ERROR ' : ''}${resultText(c.result).slice(0, 900)}` : 'no answer'}`);
      }
    };

    // one permission the session asks, allowed for the session through the card docked in the composer
    const allowPending = async (): Promise<boolean> => {
      const all = await events();
      const resolved = new Set(ofKind(all, 'permission.resolved').map((e) => e.requestId));
      const open = ofKind(all, 'permission.requested').filter((e) => !resolved.has(e.requestId));
      if (open.length === 0) return false;
      const frame = pane.getByRole('group', { name: 'Approval needed' });
      const allow = frame.getByRole('button', { name: 'Allow', exact: true });
      if (!(await allow.isVisible().catch(() => false)) || !(await allow.isEnabled().catch(() => false))) return false;
      const forSession = frame.getByRole('radio', { name: 'Allow for this session' });
      if ((await forSession.count()) > 0) await forSession.click();
      await allow.click();
      allowed.push(open[0]!.toolName);
      await expect.poll(async () => ofKind(await events(), 'permission.resolved').some((e) => e.requestId === open[0]!.requestId), { timeout: 30_000 }).toBe(true);
      return true;
    };
    // a prompt through the real composer, its turn driven to its end; answers the turn's reply and the calls it made
    const turn = async (label: string, prompt: string): Promise<{ reply: string; made: ReturnType<typeof calls> }> => {
      const ended = mainTurnsEnded(await events()).length;
      const before = calls().length;
      const message = pane.getByRole('textbox', { name: 'Message', exact: true });
      await message.click();
      await page.keyboard.insertText(prompt);
      prompted = true;
      await page.keyboard.press('Meta+Enter'); // `composer.send`: a multi-line prompt's plain Enter breaks the line
      const deadline = Date.now() + TURN_MS;
      for (;;) {
        const status = await statusOf();
        if (mainTurnsEnded(await events()).length > ended && status.turn === null && status.pendingRequests === 0) break;
        if (status.process === 'exited') throw new Error(`the engine exited during ${label}`);
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label} to end`);
        if (await allowPending()) continue;
        await page.waitForTimeout(400);
      }
      const reply = mainTurnsEnded(await events()).at(-1)?.resultText ?? '';
      const tools = ofKind(await events(), 'tool.use').filter((e) => e.parentToolUseId === null).map((e) => e.toolName);
      note(`${label}: reply ${JSON.stringify(reply.slice(0, 400))}; tools so far ${JSON.stringify(tools)}; permissions allowed for the session ${JSON.stringify(allowed)}; receipts so far US$${chargeOf(rows(), CAP_USD).receipted.toFixed(4)}`);
      logCalls(before);
      return { reply, made: calls().slice(before) };
    };

    // the session shown, launched fresh as the app launches (Haiku, default mode, the run's cap)
    await (await sidebarRow(page, { appSessionId: id })).click();
    await page.mouse.move(700, 20);
    await expect(pane.locator(`[data-composer="${id}"]`)).toBeVisible();
    const spec = { ...launchDefaults(id, repo), model: 'haiku', permissionMode: 'default' as const, subagentModel: 'haiku', maxBudgetUsd: CAP_USD };
    expect(value(await invoke(page, 'session.launch', { spec }))).toMatchObject({ status: 'launching' });
    journalPath = (await statusOf()).journalPath;
    await expect.poll(async () => (await statusOf()).process, { timeout: 120_000 }).toBe('ready');
    enginePid = (await statusOf()).pid;

    // ---- 1: the deck from a brief, in one create from files, then one read --------------------------------------------
    const built = await turn('turn 1 (build)', PROMPTS.build);
    const [init] = ofKind(await events(), 'session.init');
    expect(ownerPlugins(init?.plugins ?? [], [root]), 'none of the owner plugins').toEqual([]);
    note(`init plugins ${JSON.stringify(initPluginsOf(rows()))} (none of the owner's)`);
    const creates = built.made.filter((c) => c.name === 'artifact_create' && c.args.kind === 'presentation');
    const made = creates.filter((c) => c.result !== null && c.result.isError === undefined);
    expect(made.length, `a presentation artifact_create succeeded (${creates.length} tried)`).toBeGreaterThan(0);
    const createCall = made.at(-1)!;
    const created = json<ArtifactCreateResult & { held?: unknown[]; warnings?: unknown[] }>(createCall.result!);
    expect(created).toMatchObject({ status: 'created', kind: 'presentation' });
    const artifactId = created.artifactId;
    const sentFiles = Object.keys((createCall.args.files ?? {}) as Record<string, string>);
    const slideFilesSent = sentFiles.filter((path) => /^project\/slides\/[^/]+\.html$/.test(path));
    expect(sentFiles, 'the create from files carried deck.json').toContain('project/deck.json');
    expect(slideFilesSent.length, 'one create carried at least four slide files').toBeGreaterThanOrEqual(4);
    const order = await deck(page, 'order', artifactId);
    note(`G1: ${artifactId} created from ${sentFiles.length} files in one call (${slideFilesSent.length} slides; held ${JSON.stringify(created.held ?? [])}; ${(created.warnings ?? []).length} warnings); the deck's order ${JSON.stringify(order)}`);
    expect(order.length, 'a deck of at least four slides').toBeGreaterThanOrEqual(4);
    const lastCall = built.made.filter((c) => c.name.startsWith('artifact_')).at(-1)!;
    expect(lastCall.name, 'the turn ended on a read').toBe('artifact_read');
    expect(lastCall.result?.isError).toBeUndefined();
    const readRevision = json<{ revision: number }>(lastCall.result!).revision;
    expect(readRevision).toBe(await revisionOf(artifactId));
    for (const slideId of order) {
      const slide = await deck(page, 'slide', artifactId, slideId); // throws when the slide is held
      expect(family(find(slide.children, 'title')?.style['font-family']), `slide ${slideId}'s title in ${FIRST_FONT}`).toBe(family(FIRST_FONT));
    }

    // ---- 2: the owner's edits through the product, then the agent's stale deck-wide publish ---------------------------
    const [, conflicted, retitled, recoloured] = order as [string, string, string, string];
    await deck(page, 'edit', artifactId, { op: 'setStyle', slideId: conflicted, elementId: 'title', props: { 'font-family': OWNER_FONT } });
    await deck(page, 'edit', artifactId, { op: 'prependText', slideId: retitled, elementId: 'title', text: RETITLE });
    await deck(page, 'edit', artifactId, { op: 'setStyle', slideId: recoloured, elementId: 'title', props: { color: OWNER_COLOUR } });
    await deck(page, 'edit', artifactId, { op: 'setNotes', slideId: recoloured, text: OWNER_NOTES });
    const retitledText = textOf(find((await deck(page, 'slide', artifactId, retitled)).children, 'title'));
    expect(retitledText.startsWith(RETITLE)).toBe(true);
    const ownerRevision = await revisionOf(artifactId);
    const filesBeforeStale = await deck(page, 'files', artifactId);
    note(`G2: the owner, through a replica of the deck in the window (acknowledged by the host): ${conflicted}/title font-family → ${OWNER_FONT}; ${retitled}/title retitled ${JSON.stringify(retitledText)}; ${recoloured}/title color → ${OWNER_COLOUR} and its notes ${JSON.stringify(OWNER_NOTES)}; revision ${readRevision} → ${ownerRevision}`);

    const stale = await turn('turn 2 (the stale deck-wide publish)', PROMPTS.stale);
    const stalePublishes = stale.made.filter((c) => c.name === 'artifact_publish');
    expect(stale.made.filter((c) => c.name === 'artifact_read'), 'no read before the stale publish').toEqual([]);
    expect(stalePublishes, 'one publish').toHaveLength(1);
    const refusedCall = stalePublishes[0]!;
    const refusedPaths = Object.keys(refusedCall.args.files as Record<string, string>);
    expect(refusedCall.args.baseRevision, 'published from its stale read').toBe(readRevision);
    expect(refusedPaths, 'the publish carried the owner-changed slide').toContain(`project/slides/${conflicted}.html`);
    expect(refusedPaths.length, 'a multi-file publish').toBeGreaterThanOrEqual(4);
    expect(refusedCall.result?.isError, 'the stale publish was refused').toBe(true);
    const refusalText = resultText(refusedCall.result!);
    const refusal = JSON.parse(refusalText.slice(refusalText.indexOf(' {"reason":') + 1)) as { reason: string; paths: string[]; conflicts: { path: string; detail?: string }[] };
    note(`G3: refused ${JSON.stringify(refusal)}`);
    expect(refusal.reason).toBe('conflict');
    expect(refusal.conflicts, 'the refusal names the slide file, the element and the property').toContainEqual({ path: `project/slides/${conflicted}.html`, detail: 'element title: font-family changed since your read' });
    expect(refusal.conflicts.map((c) => c.path), 'only the owner-changed slide conflicts').toEqual([`project/slides/${conflicted}.html`]);
    expect(await deck(page, 'files', artifactId), 'nothing of the refused publish landed').toEqual(filesBeforeStale);
    expect(await revisionOf(artifactId), 'the revision unchanged across the refusal').toBe(ownerRevision);
    note(`G3b: the deck's files (${Object.keys(filesBeforeStale).length}) and revision (${ownerRevision}) unchanged across the refusal; the agent replied ${JSON.stringify(stale.reply.slice(0, 200))}`);

    // ---- 3: a re-read and the same change, landing whole at one revision with the owner's edits kept -----------------
    const reread = await turn('turn 3 (re-read and publish)', PROMPTS.reread);
    const rereads = reread.made.filter((c) => c.name === 'artifact_read' && c.result && !c.result.isError);
    const publishes = reread.made.filter((c) => c.name === 'artifact_publish');
    expect(rereads.length, 'the agent read again').toBeGreaterThanOrEqual(1);
    expect(publishes, 'one publish').toHaveLength(1);
    const publish = publishes[0]!;
    expect(publish.result?.isError, publish.result ? resultText(publish.result) : 'no answer').toBeUndefined();
    const published = json<ArtifactPublishResult>(publish.result!);
    const publishedSlides = published.changed.filter((path) => path.startsWith('project/slides/'));
    note(`G4: published at revision ${published.revision} (the owner's last ${ownerRevision}): changed ${JSON.stringify(published.changed)}; kept ${published.kept.length}`);
    expect(published.status).toBe('published');
    expect(publishedSlides.length, 'a multi-file publish').toBeGreaterThanOrEqual(4);
    expect.soft(published.revision, 'the whole publish is one revision: the store’s next after the owner’s last edit').toBe(ownerRevision + 1);
    expect(await revisionOf(artifactId)).toBe(published.revision);
    for (const slideId of order) {
      const slide = await deck(page, 'slide', artifactId, slideId);
      expect(family(find(slide.children, 'title')?.style['font-family']), `slide ${slideId}'s title in ${AGENT_FONT} at revision ${published.revision}`).toBe(family(AGENT_FONT));
    }
    const retitledAfter = await deck(page, 'slide', artifactId, retitled);
    const recolouredAfter = await deck(page, 'slide', artifactId, recoloured);
    expect(textOf(find(retitledAfter.children, 'title')), 'the owner’s retitle kept').toBe(retitledText);
    expect(find(recolouredAfter.children, 'title')?.style.color, 'the owner’s colour kept').toBe(OWNER_COLOUR);
    expect(recolouredAfter.notes, 'the owner’s notes kept').toBe(OWNER_NOTES);
    note(`G4b: every title in ${AGENT_FONT}; ${retitled}'s title ${JSON.stringify(textOf(find(retitledAfter.children, 'title')))}; ${recoloured}'s title colour ${find(recolouredAfter.children, 'title')?.style.color} and notes ${JSON.stringify(recolouredAfter.notes)}`);

    // ---- 4: the PPTX through artifact_export ---------------------------------------------------------------------------
    const exported = await turn('turn 4 (export)', PROMPTS.export);
    const exports = exported.made.filter((c) => c.name === 'artifact_export' && c.result && !c.result.isError);
    expect(exports.length, 'an artifact_export succeeded').toBeGreaterThanOrEqual(1);
    const exportAnswer = json<ArtifactExportResult>(exports.at(-1)!.result!);
    expect(exportAnswer).toMatchObject({ status: 'exported', artifactId, format: 'pptx' });
    const zip = await JSZip.loadAsync(readFileSync(exportAnswer.path));
    const slideParts = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort();
    const names = await Promise.all(slideParts.map(async (part) => [...(await zip.file(part)!.async('string')).matchAll(/<p:cNvPr id="\d+" name="([^"]*)"/g)].map((m) => m[1]!)));
    note(`G5: ${exportAnswer.path} (revision ${exportAnswer.revision}): ${slideParts.length} slide parts; shape names ${JSON.stringify(names)}`);
    expect(slideParts, 'one slide part per slide').toHaveLength(order.length);
    for (const [k, shapes] of names.entries()) expect(shapes, `${slideParts[k]} names its heading by its element id`).toContain('title');
    cpSync(exportAnswer.path, join(root, 'deck.pptx'));

    // the deck in the editor, as the owner opens it: every slide drawn, none held
    await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
    await page.locator('[data-library]').getByRole('article', { name: TITLE, exact: true }).click();
    const tab: Locator = page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`);
    await expect(tab.locator('[data-deck-editor]')).toBeVisible({ timeout: 30_000 });
    await expect(tab.locator('[data-slide-thumb] .maws-slide')).toHaveCount(order.length, { timeout: 30_000 });
    note(`G6: the deck opens in a main tab with ${order.length} thumbnails`);

    const errors = maws.consoleErrors();
    note(`the window's console errors: ${JSON.stringify(errors)}`);
    expect.soft(errors).toEqual([]);
    note(`tool time (P4-A2, X34): ${guardToolTime(journalPath).line}`); // after the last turn; throws over the bound
    note('PASS: built from a brief in one create; the stale deck-wide publish refused naming the slide file, the element and the property, nothing landed; re-read and published whole at one revision with the owner’s edits kept; exported as PPTX with shapes named by element ids');
  } catch (error) {
    failure = error;
    note(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // The session stopped, the app closed, the engine process gone, the spend from the journal's receipts
    // (e2e/support/live-lifecycle.ts), the owner file read again; the first error fails the test after the bookkeeping.
    const page = maws?.page;
    const ended = await endLiveRun({
      session: page && id !== '' ? { status: async () => value(await invoke(page, 'session.status', { appSessionId: id })), stop: async () => void value(await invoke(page, 'session.stop', { appSessionId: id, reason: 'stop' })) } : null,
      enginePid,
      beforeCleanup: () => {
        if (journalPath !== null && existsSync(journalPath)) cpSync(journalPath, join(root, 'journal.jsonl'));
      },
      cleanup: maws === null ? null : () => maws!.cleanup(),
      note,
    });
    failure ??= ended.errors[0] ?? null;
    const spend = liveSpend(journalPath !== null && existsSync(journalPath) ? journal(journalPath) : [], CAP_USD, prompted);
    note(`spend: receipts ${spend.receipts.length > 0 ? `${JSON.stringify(spend.receipts)}, total_cost_usd ${spend.receipted.toFixed(4)}` : 'none'}; accounted exposure US$${spend.accounted.toFixed(4)} (${spend.basis}); cap US$${CAP_USD}; journal ${journalPath ?? 'none (no launch)'}`);
    const a15After = a15Reading();
    note(a15Line('after the app closed', a15First, a15After, ours));
    note(`scratch kept for inspection: ${root}`);
    expect(compareA15(a15First.keys, a15After.keys, ours).breach, 'no project of the run’s scratch in the owner file (A-15)').toEqual([]);
    expect(spend.accounted, 'within the cap').toBeLessThanOrEqual(CAP_USD);
    if (failure === null) {
      expect(spend.receipts.length, 'a passing run has the engine’s receipt for each turn').toBeGreaterThanOrEqual(4);
      expect(spend.settled, 'the last receipt came after the last prompt').toBe(true);
    }
  }
  if (failure !== null) throw failure;
});
