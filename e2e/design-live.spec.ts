// P3-E1's live run (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M6, acceptance 1 and 5, the agent's half;
// the parent's E1 section). The form is P3-C's (e2e/presentations-live.spec.ts): the product app (the plain build the
// final mini run bundled) with the installed Claude Code (unmodified, D-1, named directly: no forwarding wrapper) under a
// scratch CLAUDE_CONFIG_DIR and scratch user data, through ClaudeUsage's relay, on Haiku in default permission mode, one
// session launched with `LaunchSpec.maxBudgetUsd = 1` and no retries, every permission allowed for the session through
// the request card docked in the composer, the tool journal recorded. The window is never shown.
// One session, four prompts through the real composer:
//   1. the agent reads the design guide and makes ONE `artifact_create` of a design from files: `project/canvas.json`
//      and four boards (a 390×844 phone, an 834×1194 tablet, a 1440×1024 desktop and a 1080×9000 poster, taller than
//      8,192 px), each heading an element `title` in Georgia; then it reads the design once;
//   2. the owner, through a replica of the design in the window (the human's edits acknowledged by the host), changes the
//      phone heading's font (the conflict) and, unrelated, moves the desktop board and recolours the tablet heading; the
//      agent, asked to set every heading in Verdana without reading again, publishes every board from its stale read in
//      one call: refused, naming the phone's file, the element `title` and `font-family`, and nothing of it landed (the
//      design's files and revision unchanged);
//   3. the agent reads again and publishes the same change in one call: it lands at one revision, every heading in
//      Verdana, the owner's desktop move and tablet colour kept;
//   4. the agent exports through `artifact_export`: the phone as a PNG at its native size; the poster as a PNG, refused
//      `exportTooLarge` with the scale that fits, then at that scale whole; every board as one PDF, a page per board at
//      its native size.
// A relay or engine preflight that fails is a blocked acceptance and fails the run; it is never a passing skip. The
// owner's ~/.claude.json is only read (the A-15 delta). The run's lines go to stdout and to `live-run.txt` under the
// scratch root, kept for inspection with the journal, the exported files and a screenshot of the design.
// It spends money, within US$1 (MAWS_LIVE_MAX_USD must say 1; the session's own cap is 1). The architect runs it once, on
// the final mini run's bundled plain `out/`, through the slot and never the package script's build prefix:
//   MAWS_LIVE=1 MAWS_LIVE_MAX_USD=1 pnpm exec playwright test e2e/design-live.spec.ts
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
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
import { boardOf, boardsOf, editDesign, filesOf, findIn, openFromLibrary, seamInstalled } from './support/design';
import { launchMaws, type MawsLaunch } from './support/launch';
import { liveMaxUsd } from './support/live-budget';
import { endLiveRun, liveSpend } from './support/live-lifecycle';
import { eventsOf, mcpCalls, mcpResultOf, ofKind, recordEvents, resultText, seedTranscripts, type McpResult } from './support/maws-tools';
import { a15Line, a15Reading, chargeOf, initPluginsOf, installedEngine } from './support/p1-live';
import { sidebarRow } from './support/sidebar';

test.skip(process.env.MAWS_LIVE !== '1', 'the P3-E1 live run runs only under MAWS_LIVE=1');
test.describe.configure({ timeout: 1_800_000, retries: 0 });

const CAP_USD = 1;
const TURN_MS = 600_000;
const TITLE = 'Harbor Tutoring — sign-up screens';
const FIRST_FONT = 'Georgia, serif';
const OWNER_FONT = 'Tahoma, sans-serif';
const AGENT_FONT = 'Verdana, sans-serif';
const OWNER_COLOUR = '#c0392b';
const OWNER_DESKTOP_Y = 400;
const BOARDS = {
  phone: { w: 390, h: 844 },
  tablet: { w: 834, h: 1194 },
  desktop: { w: 1440, h: 1024 },
  poster: { w: 1080, h: 9000 },
} as const;
type BoardId = keyof typeof BOARDS;
const IDS = Object.keys(BOARDS) as BoardId[];
const FITTING = Math.min(4, Math.floor((8192 / 9000) * 10_000) / 10_000); // the poster's largest PNG scale (0.9102)
const POPPLER = '/opt/homebrew/bin';

const PROMPTS = {
  build:
    `Make a MAWS design artifact from this brief: "${TITLE}", the sign-up screens for an after-school tutoring centre in Portland, Maine, on four boards: ` +
    'a phone sign-up screen, a tablet course list, a desktop landing page and a tall poster for the school noticeboard.\n' +
    'Do every step yourself, one after another, never through an agent:\n' +
    '1. Call mcp__maws__artifact_describe_type with kind "design" and read its guide.\n' +
    `2. Make ONE mcp__maws__artifact_create call with kind "design", title "${TITLE}" and files: "project/canvas.json" plus one "project/boards/<id>.html" per board, four boards with ids phone, tablet, desktop and poster, in that order, ` +
    `sized exactly phone 390×844, tablet 834×1194, desktop 1440×1024 and poster 1080×9000 (w×h in the manifest), laid out left to right with 100px gaps. ` +
    `On every board the heading is an h1 or h2 with id "title" whose style includes font-family: ${FIRST_FONT} (write that value literally, not as a var()). Give every other element an id too. No pictures.\n` +
    '3. If the create answers held boards or warnings, fix them with mcp__maws__artifact_publish.\n' +
    '4. Call mcp__maws__artifact_read on the design once, last.\n' +
    'Then reply with exactly one word: READY.',
  stale:
    `Set every board's heading in ${AGENT_FONT}: on every board, set the font-family of the element with id "title" to ${AGENT_FONT}, and change nothing else. ` +
    'Do NOT read the design again: start from the files your last mcp__maws__artifact_read returned, and make exactly ONE mcp__maws__artifact_publish call that sends every board file with that change, with baseRevision the revision that read returned. ' +
    'If the call is refused, do not retry, do not read, make no other call: reply REFUSED followed by the refusal’s reason.',
  reread:
    `Now read the design again with mcp__maws__artifact_read, apply the same change to what you read (on every board, the element with id "title" gets font-family: ${AGENT_FONT}; keep every other property, text, id and the manifest exactly as you read them), ` +
    'and send every board file in exactly ONE mcp__maws__artifact_publish call with baseRevision from that read. Make no other call. Reply DONE when the publish succeeds.',
  export:
    'Export the design with mcp__maws__artifact_export, these calls in this order and no other call: ' +
    '(1) format "png" with board "phone"; (2) format "png" with board "poster" and no scale; (3) if that call is refused because the board is too large, the same call again with the scale the refusal names; (4) format "pdf" with no board list (every board). ' +
    'Reply with the paths the successful calls returned, one per line.',
} as const;

/** A font stack compared by meaning: quotes, case and spaces after commas aside. */
const family = (v: string | undefined) => (v ?? '').replace(/["']/g, '').replace(/\s*,\s*/g, ',').trim().toLowerCase();
const pngSize = (bytes: Buffer) => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
/** Each page's size in PDF points: pdfinfo where it is installed, else the file's own MediaBoxes. */
function pageSizes(pdf: string): { sizes: [number, number][]; by: string } {
  if (existsSync(join(POPPLER, 'pdfinfo'))) {
    const info = execFileSync(join(POPPLER, 'pdfinfo'), ['-f', '1', '-l', '999', pdf], { encoding: 'utf8' });
    return { sizes: [...info.matchAll(/^Page\s+\d+ size:\s+([\d.]+) x ([\d.]+) pts/gm)].map((m) => [Number(m[1]), Number(m[2])]), by: 'pdfinfo' };
  }
  const text = readFileSync(pdf).toString('latin1');
  return { sizes: [...text.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [Number(m[1]), Number(m[2])]), by: 'the MediaBoxes' };
}

test('the agent creates a four-board design from a brief; its stale publish is refused naming the board, element and property with nothing landed; after a re-read it lands whole with the owner’s edits kept; it exports PNGs (the poster at the fitting scale after its refusal) and a native-page PDF', async () => {
  const root = realpathSync(mkdtempSync('/tmp/maws-p3e1-live-'));
  const config = join(root, 'claude-config');
  const repo = join(root, 'repo');
  const userData = join(root, 'user-data');
  for (const dir of [config, repo, userData]) mkdirSync(dir, { recursive: true });
  const logFile = join(root, 'live-run.txt');
  const note = (line: string) => {
    appendFileSync(logFile, `${line}\n`);
    console.log(line);
  };

  // the preflight: a blocked one fails the run (blocked acceptance), it never passes as a skip
  if (liveMaxUsd() !== CAP_USD) throw new Error(`blocked: budget (MAWS_LIVE_MAX_USD must be ${CAP_USD}, the run's hard cap; it is ${process.env.MAWS_LIVE_MAX_USD ?? 'unset'})`);
  if (process.env.MAWS_E2E_EXECUTABLE) {
    note(`MAWS_E2E_EXECUTABLE (${process.env.MAWS_E2E_EXECUTABLE}) cleared: the run takes the built app in out/`);
    delete process.env.MAWS_E2E_EXECUTABLE;
  }
  let relay = relaySkipReason(RELAY_URL);
  if (relay !== null) {
    note(`relay not ready (${relay}); waiting two minutes and retrying once`);
    await new Promise((resolve) => setTimeout(resolve, 120_000));
    relay = relaySkipReason(RELAY_URL);
  }
  if (relay !== null) {
    note(`blocked: relay (${relay}) at ${new Date().toISOString()}`);
    throw new Error(`blocked acceptance: relay: ${relay}`);
  }
  let engine: { bin: string; version: string };
  try {
    engine = installedEngine();
    if (!/^\d+\.\d+\.\d+$/.test(engine.version)) throw new Error(`no version from ${engine.bin} --version`);
  } catch (error) {
    note(`blocked: engine (${String(error)})`);
    throw new Error(`blocked acceptance: engine: ${String(error)}`, { cause: error });
  }

  writeFileSync(join(config, 'settings.json'), '{}\n');
  writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
  assertConfigHomeSafe({ configHome: config, controls: [] });
  writeFileSync(join(repo, 'README.md'), '# Harbor Tutoring\n\nAn after-school tutoring centre for high-school students in Portland, Maine.\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=P3-E1', '-c', 'user.email=p3e1@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  const [engineId] = seedTranscripts(config, repo, ['P3-E1 live: a design from a brief']);

  const a15First = a15Reading();
  const ours = [root];
  note(`==== P3-E1 live run (M6, acceptance 1 and 5, the agent's half), ${new Date().toISOString()}`);
  note(`engine: ${engine.bin.replace(homedir(), '~')} (${engine.version}), unmodified and named directly (no forwarding wrapper), through ClaudeUsage's relay ${RELAY_URL} (GET /api/hello 200), Haiku, default permission mode, LaunchSpec.maxBudgetUsd ${CAP_USD} (MAWS_LIVE_MAX_USD ${process.env.MAWS_LIVE_MAX_USD}), one session, no retries`);
  note(`scratch: ${root} (claude-config/ settings.json {} and .claude.json trusting repo/; repo/ a one-file project; user-data/ the app's profile, show: false); the app: the built out/main/index.js, every CLAUDE* variable of the runner dropped (launchEnvironment)`);
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
    await expect.poll(() => seamInstalled(page), { message: 'the window’s design seam is installed' }).toBe('object');
    const statusOf = async () => value(await invoke(page, 'session.status', { appSessionId: id }));
    const events = (): Promise<SessionEvent[]> => eventsOf(page, id);
    const rows = (): JournalRow[] => (journalPath !== null && existsSync(journalPath) ? journal(journalPath) : []);
    const mainTurnsEnded = (all: SessionEvent[]) => ofKind(all, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);
    const revisionOf = async (artifactId: string) => {
      const result = (await page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), ['artifacts.get', { artifactId }] as const)) as { ok: true; value: { artifact: { revision: number } | null } } | { ok: false; error: { code: string; message: string } };
      if (!result.ok) throw new Error(`artifacts.get failed: ${result.error.code} ${result.error.message}`);
      return result.value.artifact?.revision ?? -1;
    };
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
    const headingOf = async (artifactId: string, board: string) => findIn((await boardOf(page, artifactId, board)).children, 'title');

    // the session shown, launched fresh as the app launches (Haiku, default mode, the run's US$1 cap on the spec itself)
    await (await sidebarRow(page, { appSessionId: id })).click();
    await page.mouse.move(700, 20);
    await expect(pane.locator(`[data-composer="${id}"]`)).toBeVisible();
    const spec = { ...launchDefaults(id, repo), model: 'haiku', permissionMode: 'default' as const, subagentModel: 'haiku', maxBudgetUsd: CAP_USD };
    expect(value(await invoke(page, 'session.launch', { spec }))).toMatchObject({ status: 'launching' });
    journalPath = (await statusOf()).journalPath;
    await expect.poll(async () => (await statusOf()).process, { timeout: 120_000 }).toBe('ready');
    enginePid = (await statusOf()).pid;
    note(`engine pid ${enginePid}; journal ${journalPath}`);

    // ---- 1: the design from a brief, in one create from files, then one read ----------------------------------------
    const built = await turn('turn 1 (build)', PROMPTS.build);
    const [init] = ofKind(await events(), 'session.init');
    expect(ownerPlugins(init?.plugins ?? [], [root]), 'none of the owner plugins').toEqual([]);
    note(`init plugins ${JSON.stringify(initPluginsOf(rows()))} (none of the owner's)`);
    expect(built.made.some((c) => c.name === 'artifact_describe_type' && c.args.kind === 'design'), 'the agent read the design guide').toBe(true);
    const creates = built.made.filter((c) => c.name === 'artifact_create' && c.args.kind === 'design');
    const made = creates.filter((c) => c.result !== null && c.result.isError === undefined);
    expect(made, `one design artifact_create succeeded (${creates.length} tried)`).toHaveLength(1);
    const createCall = made[0]!;
    const created = json<ArtifactCreateResult>(createCall.result!);
    expect(created).toMatchObject({ status: 'created', kind: 'design' });
    const artifactId = created.artifactId;
    const sentFiles = Object.keys((createCall.args.files ?? {}) as Record<string, string>).sort();
    expect(sentFiles, 'the create from files carried the manifest and the four boards').toEqual(['project/canvas.json', ...IDS.map((b) => `project/boards/${b}.html`)].sort());
    const boards = await boardsOf(page, artifactId);
    note(`G1: ${artifactId} created from ${sentFiles.length} files in one call (held ${JSON.stringify(created.held ?? [])}; ${(created.warnings ?? []).length} warnings); its boards ${JSON.stringify(boards)}`);
    expect(boards.map((b) => b.id)).toEqual(IDS);
    for (const b of boards) expect(b.frame, `${b.id}'s size`).toMatchObject(BOARDS[b.id as BoardId]);
    expect(boards.find((b) => b.id === 'poster')!.frame!.h, 'the poster is taller than 8,192 px').toBeGreaterThan(8192);
    const lastCall = built.made.filter((c) => c.name.startsWith('artifact_')).at(-1)!;
    expect(lastCall.name, 'the turn ended on a read').toBe('artifact_read');
    expect(lastCall.result?.isError).toBeUndefined();
    const read = json<{ revision: number; files: Record<string, string> }>(lastCall.result!);
    expect(Object.keys(read.files).sort(), 'the read returned the design’s files').toEqual(sentFiles);
    expect(read.revision).toBe(await revisionOf(artifactId));
    for (const board of IDS) expect(family((await headingOf(artifactId, board))?.style['font-family']), `${board}'s title in ${FIRST_FONT}`).toBe(family(FIRST_FONT));

    // ---- 2: the owner's edits through the product's replica, then the agent's stale publish -------------------------
    await editDesign(page, artifactId, { op: 'setStyle', boardId: 'phone', elementId: 'title', props: { 'font-family': OWNER_FONT } });
    const desktopBefore = boards.find((b) => b.id === 'desktop')!.frame!;
    await editDesign(page, artifactId, { op: 'setFrame', boardId: 'desktop', frame: { y: OWNER_DESKTOP_Y } });
    await editDesign(page, artifactId, { op: 'setStyle', boardId: 'tablet', elementId: 'title', props: { color: OWNER_COLOUR } });
    const ownerRevision = await revisionOf(artifactId);
    const filesBeforeStale = await filesOf(page, artifactId);
    note(`G2: the owner, through a replica of the design in the window (acknowledged by the host): phone/title font-family → ${OWNER_FONT}; desktop moved y ${desktopBefore.y} → ${OWNER_DESKTOP_Y}; tablet/title color → ${OWNER_COLOUR}; revision ${read.revision} → ${ownerRevision}`);

    const stale = await turn('turn 2 (the stale publish)', PROMPTS.stale);
    const stalePublishes = stale.made.filter((c) => c.name === 'artifact_publish');
    expect(stale.made.filter((c) => c.name === 'artifact_read'), 'no read before the stale publish').toEqual([]);
    expect(stalePublishes, 'one publish').toHaveLength(1);
    const refusedCall = stalePublishes[0]!;
    const refusedPaths = Object.keys(refusedCall.args.files as Record<string, string>);
    expect(refusedCall.args.baseRevision, 'published from its stale read').toBe(read.revision);
    expect(refusedPaths, 'the publish carried every board').toEqual(expect.arrayContaining(IDS.map((b) => `project/boards/${b}.html`)));
    expect(refusedCall.result?.isError, 'the stale publish was refused').toBe(true);
    const refusalText = resultText(refusedCall.result!);
    const refusal = JSON.parse(refusalText.slice(refusalText.indexOf(' {"reason":') + 1)) as { reason: string; conflicts: { path: string; detail?: string }[] };
    note(`G3: refused ${JSON.stringify(refusal)}`);
    expect(refusal.reason).toBe('conflict');
    expect(refusal.conflicts.map((c) => c.path), 'only the owner-changed board conflicts').toEqual(['project/boards/phone.html']);
    expect(refusal.conflicts[0]!.detail, 'the refusal names the element and the property').toMatch(/element title: font-family changed since your read/);
    expect(await filesOf(page, artifactId), 'nothing of the refused publish landed').toEqual(filesBeforeStale);
    expect(await revisionOf(artifactId), 'the revision unchanged across the refusal').toBe(ownerRevision);
    note(`G3b: the design's files (${Object.keys(filesBeforeStale).length}) and revision (${ownerRevision}) unchanged across the refusal; the agent replied ${JSON.stringify(stale.reply.slice(0, 200))}`);

    // ---- 3: a re-read and the same change, landing whole at one revision with the owner's other edits kept -----------
    const reread = await turn('turn 3 (re-read and publish)', PROMPTS.reread);
    const rereads = reread.made.filter((c) => c.name === 'artifact_read' && c.result && !c.result.isError);
    const publishes = reread.made.filter((c) => c.name === 'artifact_publish');
    expect(rereads.length, 'the agent read again').toBeGreaterThanOrEqual(1);
    expect(publishes, 'one publish').toHaveLength(1);
    const publish = publishes[0]!;
    expect(publish.result?.isError, publish.result ? resultText(publish.result) : 'no answer').toBeUndefined();
    const published = json<ArtifactPublishResult>(publish.result!);
    note(`G4: published at revision ${published.revision} (the owner's last ${ownerRevision}): changed ${JSON.stringify(published.changed)}; kept ${published.kept.length}`);
    expect(published.status).toBe('published');
    expect(published.changed.filter((p) => p.startsWith('project/boards/')).length, 'a multi-file publish').toBeGreaterThanOrEqual(IDS.length);
    expect.soft(published.revision, 'the whole publish is one revision: the store’s next after the owner’s last edit').toBe(ownerRevision + 1);
    expect(await revisionOf(artifactId)).toBe(published.revision);
    for (const board of IDS) expect(family((await headingOf(artifactId, board))?.style['font-family']), `${board}'s title in ${AGENT_FONT}`).toBe(family(AGENT_FONT));
    const after = await boardsOf(page, artifactId);
    expect(after.find((b) => b.id === 'desktop')!.frame, 'the owner’s desktop move kept').toEqual({ ...desktopBefore, y: OWNER_DESKTOP_Y });
    expect((await headingOf(artifactId, 'tablet'))?.style.color, 'the owner’s tablet colour kept').toBe(OWNER_COLOUR);
    note(`G4b: every title in ${AGENT_FONT}; desktop frame ${JSON.stringify(after.find((b) => b.id === 'desktop')!.frame)}; tablet title colour ${(await headingOf(artifactId, 'tablet'))?.style.color}`);

    // ---- 4: PNGs and the PDF through artifact_export ------------------------------------------------------------------
    const exported = await turn('turn 4 (export)', PROMPTS.export);
    const exportCalls = exported.made.filter((c) => c.name === 'artifact_export');
    const ok = exportCalls.filter((c) => c.result && !c.result.isError).map((c) => ({ args: c.args, answer: json<ArtifactExportResult>(c.result!) }));
    for (const [k, e] of ok.entries()) cpSync(e.answer.path, join(root, `export-${k + 1}-${String(e.args.board ?? 'all')}.${e.answer.format}`));
    const phonePng = ok.find((e) => e.answer.format === 'png' && e.args.board === 'phone' && e.args.scale === undefined);
    expect(phonePng, 'the phone exported as a PNG at its native size').toBeDefined();
    expect(pngSize(readFileSync(phonePng!.answer.path)), 'the phone PNG at 390 × 844').toEqual([390, 844]);
    const posterRefused = exportCalls.find((c) => c.args.board === 'poster' && c.args.scale === undefined && c.result?.isError === true);
    expect(posterRefused, 'the poster’s native PNG was refused').toBeDefined();
    const tooLarge = resultText(posterRefused!.result!);
    const sized = JSON.parse(tooLarge.slice(tooLarge.indexOf(' {"reason":') + 1)) as Record<string, unknown>;
    note(`G5: the poster refused ${JSON.stringify(sized)}`);
    expect(sized).toEqual({ reason: 'exportTooLarge', board: 'poster', w: 1080, h: 9000, maxScale: FITTING });
    const posterPng = ok.find((e) => e.answer.format === 'png' && e.args.board === 'poster' && e.args.scale === FITTING);
    expect(posterPng, `the poster exported at the scale the refusal named (${FITTING})`).toBeDefined();
    expect(pngSize(readFileSync(posterPng!.answer.path)), 'the poster PNG whole at the fitting scale').toEqual([983, 8192]);
    const pdf = ok.find((e) => e.answer.format === 'pdf');
    expect(pdf, 'every board exported as one PDF').toBeDefined();
    const pages = pageSizes(pdf!.answer.path);
    note(`G6: ${phonePng!.answer.path} (390×844), ${posterPng!.answer.path} (983×8192), ${pdf!.answer.path}: pages ${JSON.stringify(pages.sizes)} by ${pages.by}`);
    expect(pages.sizes, 'one page per board').toHaveLength(IDS.length);
    IDS.forEach((board, k) => {
      const [w, h] = pages.sizes[k]!;
      expect(Math.abs(w - BOARDS[board].w * 0.75), `page ${k + 1} (${board}) width ${w} pt`).toBeLessThanOrEqual(1);
      expect(Math.abs(h - BOARDS[board].h * 0.75), `page ${k + 1} (${board}) height ${h} pt`).toBeLessThanOrEqual(1);
    });

    // the design in the editor, as the owner opens it: every board drawn, none held
    const tab = await openFromLibrary(page, TITLE, artifactId);
    await expect(tab.locator('[data-board-id] .maws-slide[data-board]')).toHaveCount(IDS.length, { timeout: 30_000 });
    await expect(tab.locator('[data-board-id][data-held]')).toHaveCount(0);
    await page.screenshot({ path: join(root, 'design.png') });
    note(`G7: the design opens in a main tab with ${IDS.length} boards drawn, none held (screenshot design.png)`);

    const errors = maws.consoleErrors();
    note(`the window's console errors: ${JSON.stringify(errors)}`);
    expect.soft(errors).toEqual([]);
    note(`tool time (P4-A2, X34): ${guardToolTime(journalPath).line}`); // after the last turn; throws over the bound
    note('PASS: created from a brief in one create with four boards; the stale publish refused naming the board file, the element and the property, nothing landed; re-read and published whole at one revision with the owner’s other edits kept; the phone and the fitted poster exported as PNGs after the poster’s refusal, every board as a native-page PDF');
  } catch (error) {
    failure = error;
    note(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // the session stopped, the app closed, the engine process gone, the spend from the journal's receipts
    // (e2e/support/live-lifecycle.ts), the owner file read again; the first error fails the test after the bookkeeping
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
      expect(ended.enginePid, 'the engine’s pid was recorded').not.toBeNull();
    }
  }
  if (failure !== null) throw failure;
});
