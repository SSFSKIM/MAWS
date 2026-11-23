// C10's end-to-end spec (C10 execution document, M4). The cases the M4 gate names start through C7's composer: the
// prompt typed into the unstarted tab's editor and sent, the location chosen with its Location chip, the trust and
// failure cards docked in the composer's place; the others start through `window.maws.invoke`, where the case needs
// no turn. Each case launches the built app with the replay transport
// (`MAWS_ENGINE_REPLAY=1`) and its own `MAWS_E2E_REPLAY_FIXTURES` (M3's seam: each launch takes the next fixture and
// pins its recorded id), a temp config home (`CLAUDE_CONFIG_DIR`) holding a synthetic `.claude.json` and any
// transcripts the case needs, a throwaway profile, and scratch repositories under the temp root. No engine runs; the
// owner's `~/.claude`, `~/.claude.json` and checkouts are never read or written, and Delete's Trash move lands in a
// temp directory (`MAWS_E2E_TRASH_DIR`, main's e2e seam), never the owner's `~/.Trash`. No native panel opens:
// under MAWS_E2E `layout.pickFiles` answers from `MAWS_E2E_PICK_PATHS` or as cancelled (main's pick seam).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto'; // UX wave U6e: the files service's content hash
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { slugOf } from '../src/engine-host/fs/paths';
import { fixtureIdentity } from '../test/support/fixture-session-id';
import { runGit } from '../test/support/git-fixture';
import { ScratchRepo } from '../test/support/scratch-repo';
import { StoreFixture } from '../test/support/store-fixture';
import { addressed, localRef } from './support/address';
import { expectDrawnWholeAtBothWidths } from './support/editor-notice'; // UX wave U1c round: the notice drawn whole, at the panel's narrowest too
import { launchMaws, REPO_ROOT, test, type MawsLaunch } from './support/launch';
import { slashPaletteMovesNothing } from './support/palette-geometry';
import { startBrowserServer } from './support/browser-server'; // UX wave U6b-4b: the loopback page a link opens
import { clickRevealed } from './support/hover';
import { activeMainTab, backToTabs, mainTabById, mainTabs, mountedTabs, openAppDestination, openSurface, sideColumn, sideTab, surface } from './support/shell'; // UX wave U6e: the side column, its tabs and the pages
import { markPixels, minimalPdf } from './support/media-fixtures'; // UX wave U6b-2: the linked PDF, drawn
import { created } from './support/nothing-created'; // UX wave U6b-2: B8
import { processesNaming } from './support/processes'; // the UX wave, U9: A6's scene signals only its own engine host
import { assistantRecord, backgroundAgentRecords, backgroundAgentSidecars, turnEndRecords, userRecord } from './support/lane-a'; // UX wave U6b-4c: assistantRecord, a subagent's answer
import { newChatIn, openProject, projectLine, projectRow, showProjectList, sidebarRow } from './support/sidebar';
import { unfoldInfoGroup } from './support/session-info'; // board ticket 421's M5: Session info's Engine group

const FIXTURES = 'spikes/protocol-probe/fixtures';
const AUTO_ROUTED = `${FIXTURES}/pass2/auto-routed.jsonl`;
const BOOTSTRAP = `${FIXTURES}/pass3/trust-bootstrap-recorded.jsonl`;
const FORK_START = `${FIXTURES}/pass3/fork-pinned-id-start.jsonl`;
const FORK_FORK = `${FIXTURES}/pass3/fork-pinned-id-fork.jsonl`;
const READ_ONLY = `${FIXTURES}/pass3/read-only-permission.jsonl`;

function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<CommandResult<N>> {
  return page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name as string, input as unknown] as const) as Promise<CommandResult<N>>;
}

function value<N extends CommandName>(result: CommandResult<N>) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

// The setup events, collected from before the first start.
async function collectSetup(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: unknown[] = [];
    (window as unknown as { __c10: unknown[] }).__c10 = log;
    window.maws.on('session.setup', (payload) => log.push(payload));
  });
}
type Setup = { appSessionId: string; phase: string; detail: string | null; outcome: { kind: string; engineSessionId?: string; message?: string } | null };
const setupOf = async (page: Page, id: string) => ((await page.evaluate(() => (window as unknown as { __c10: Setup[] }).__c10)) as Setup[]).filter((e) => e.appSessionId === id);
const untilPhase = (page: Page, id: string, phase: string) => expect.poll(async () => (await setupOf(page, id)).map((e) => e.phase), { timeout: 20_000 }).toContain(phase);

type Row = { direction: string; frame: Record<string, unknown> & { event?: string; cwd?: string; args?: string[]; request?: { subtype?: string; workspaceTrust?: unknown } } };
// Every journal row of a session, oldest file first (its `.jsonl` files alone).
function journal(maws: MawsLaunch, appSessionId: string): Row[] {
  const dir = join(maws.userData, 'engine-host', 'journal', appSessionId);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl')) // P5 O16: a hosted launch's host map (`<launchId>.hseq`) sits beside its journal
    .sort()
    .flatMap((file) => readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Row));
}
const spawnRow = (maws: MawsLaunch, id: string) => journal(maws, id).find((r) => r.direction === 'meta' && r.frame.event === 'spawn')!.frame;
// board ticket 421: the spawn row of one launch of a session, told apart by its launch id (a resume writes another)
const spawnRowOf = (maws: MawsLaunch, id: string, launchId: string) => journal(maws, id).find((r) => r.direction === 'meta' && r.frame.event === 'spawn' && r.frame.launchId === launchId)!.frame;
const initializeRequest = (maws: MawsLaunch, id: string) => journal(maws, id).find((r) => r.direction === 'out' && r.frame.request?.subtype === 'initialize')!.frame.request!;

interface Case {
  maws: MawsLaunch;
  page: Page;
  store: StoreFixture;
  trash: string; // where Delete's moves land (MAWS_E2E_TRASH_DIR), inside the temp config home
  repos: ScratchRepo[];
  dispose(): Promise<void>;
}

// One launch over a temp config home trusting `trusted`, with the case's replay fixtures in launch order; `env` adds to
// the launch's environment.
async function launchCase(opts: { fixtures: string[]; trusted: string[]; userData?: string; store?: StoreFixture; env?: Record<string, string> }): Promise<Omit<Case, 'repos'>> {
  const store = opts.store ?? (await StoreFixture.create());
  writeFileSync(join(store.configHome, '.claude.json'), `${JSON.stringify({ projects: Object.fromEntries(opts.trusted.map((key) => [key, { hasTrustDialogAccepted: true }])) }, null, 2)}\n`);
  // W3: the replayed launches were recorded in the default mode (C10's probes; auto-routed's initialize answers auto
  // either way), so the user's defaultMode says default: an auto seed would have the host send a fallback the
  // recordings never saw
  writeFileSync(join(store.configHome, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
  const trash = join(store.configHome, 'e2e-trash');
  mkdirSync(trash, { recursive: true });
  const maws = await launchMaws({
    env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: opts.fixtures.join(','), CLAUDE_CONFIG_DIR: store.configHome, MAWS_E2E_TRASH_DIR: trash, ...opts.env },
    ...(opts.userData ? { userData: opts.userData } : {}),
  });
  await expect(maws.page.locator('[data-region="main"]')).toBeVisible();
  await collectSetup(maws.page);
  return { maws, page: maws.page, store, trash, dispose: () => maws.cleanup() };
}

async function addProject(page: Page, directory: string): Promise<{ id: string; name: string }> {
  const project = value(await invoke(page, 'session.projects.add', { directory }));
  return { id: project.id, name: project.name };
}

// "+" on the project's row (W11: on hover; the project expanded too, so its rows show): C5's createSession runs C10's
// creator; the tab opens on the unstarted session's heading.
async function plus(page: Page, name: string): Promise<string> {
  await openProject(page, name);
  await newChatIn(page, name);
  await expect(page.getByRole('heading', { name: `New chat in ${name}` })).toBeVisible();
  const intents = value(await invoke(page, 'session.intent.list', undefined)).intents;
  return intents.at(-1)!.appSessionId;
}

// Direct, so the relay pre-check never depends on whether this Mac's relay is up (the replay transport ignores the
// route). No chip sets the route of an unstarted session (C7's frame has none; the relay card's "Run direct" is the
// owner's way), so the case sets it through the command the card's continuation would.
async function routeDirect(page: Page, id: string): Promise<void> {
  value(await invoke(page, 'session.intent.patch', { appSessionId: id, patch: { gateway: 'direct' } }));
}

// C7's composer in the focused tab: its editor, and Send (the submit control) once the text is in.
const editor = (page: Page) => page.locator('[data-region="main"]').getByRole('textbox', { name: 'Message' });
async function send(page: Page, text: string): Promise<void> {
  await editor(page).click();
  await page.keyboard.type(text);
  await expect(editor(page)).toHaveText(text);
  const control = page.locator('[data-region="main"] [data-submit-state]');
  await expect(control).toHaveText('Send');
  await control.click();
}

// The project row's Worktree checkbox (New chat, 2026-10-01, the owner's ruling after Codex): the first send creates a
// new worktree named for the project with a short id; answers the name the intent holds.
async function checkWorktree(page: Page, id: string, repoRoot: string): Promise<string> {
  const box = page.locator('[data-project-row]').getByRole('checkbox', { name: 'Worktree' });
  await box.click(); // controlled: checked once main has the patched location
  await expect(box).toBeChecked();
  const location = value(await invoke(page, 'session.intent.get', { appSessionId: id }))!.location;
  const name = location?.kind === 'newWorktree' ? location.name : '';
  expect(name).toMatch(/^[a-z0-9-]+-[0-9a-f]{4}$/);
  expect(location).toEqual({ kind: 'newWorktree', repoRoot, name, branch: { kind: 'new', name: `worktree-${name}`, base: 'HEAD' } });
  return name;
}

// The turns C3 reports ended, per session, from before the first start.
async function collectTurns(page: Page): Promise<void> {
  await page.evaluate(() => {
    const turns: unknown[] = [];
    (window as unknown as { __c10Turns: unknown[] }).__c10Turns = turns;
    window.maws.on('session.eventBatch', (b) => b.events.forEach((e) => e.kind === 'turn.ended' && turns.push(b.appSessionId)));
  });
}
const turnEnded = (page: Page, id: string) => expect.poll(() => page.evaluate(() => (window as unknown as { __c10Turns: string[] }).__c10Turns), { timeout: 20_000 }).toContain(id);

// Where the M4a cases need no turn, the chips' patch and the start go through the commands they call.
async function startDirect(page: Page, id: string, patch: CommandInput<'session.intent.patch'>['patch'] = {}, message: CommandInput<'session.start'>['message'] = null) {
  value(await invoke(page, 'session.intent.patch', { appSessionId: id, patch: { gateway: 'direct', ...patch } }));
  return value(await invoke(page, 'session.start', { appSessionId: id, message, options: {} }));
}

// A session's row in the sidebar (W11: inside its expanded project).
const row = async (page: Page, id: string) => page.locator(`[data-region="sidebar"] [role="treeitem"][data-menu="session:${await addressed(page, id)}"]`);

// Every text a transcript's load-failure alert showed (the alert stays until Retry), from before the first start: a
// session started through "+" hydrates once the engine host knows it, never failing on an id not yet launched or bound.
async function watchTranscriptFailures(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __loadFailures: string[] }).__loadFailures = seen;
    const note = () =>
      document.querySelectorAll('[role="alert"]').forEach((node) => {
        const text = (node.textContent ?? '').trim();
        // the alert's words (src/renderer/src/transcript/model/copy.ts's HYDRATION.failed) and, since the UX wave's U9, its
        // reason in its title
        const said = `${text} (${node.getAttribute('title') ?? ''})`;
        if (text.startsWith('Couldn’t load this conversation') && !seen.includes(said)) seen.push(said);
      });
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}
const transcriptFailures = (page: Page) => page.evaluate(() => (window as unknown as { __loadFailures: string[] }).__loadFailures);

// A main process built without the pick seam would put the native Open panel on this desktop at the first pick, so a
// case that picks first checks that the build it launched carries the seam.
function assertPickSeamBuilt(maws: MawsLaunch): void {
  const bundles = maws.packaged
    ? [join(dirname(dirname(process.env.MAWS_E2E_EXECUTABLE!)), 'Resources', 'app.asar')]
    : readdirSync(join(REPO_ROOT, 'out/main')).filter((f) => f.endsWith('.js')).map((f) => join(REPO_ROOT, 'out/main', f));
  const built = bundles.some((file) => existsSync(file) && readFileSync(file).includes('MAWS_E2E_PICK_PATHS'));
  if (!built) throw new Error(`the launched build has no e2e pick seam (${bundles.join(', ')}); rebuild before picking`);
}

async function menu(page: Page, id: string, item: string): Promise<void> {
  await (await sidebarRow(page, { appSessionId: id })).click({ button: 'right' });
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

// An application-menu item clicked in main by its id (Playwright's keyboard never reaches a macOS menu accelerator:
// shell.spec.ts); answers its accelerator.
async function appMenu(maws: MawsLaunch, id: string): Promise<string | null> {
  const accelerator = await maws.app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item?.enabled) return false;
    item.click();
    return item.accelerator ?? null;
  }, id);
  expect(accelerator, `menu item ${id} exists and is enabled`).not.toBe(false);
  return accelerator as string | null;
}

// The tab ids of the strip in order (both panes, left first), or of one pane's row by its tablist's name.
const tabIdsOf = (page: Page, strip?: 'Left pane tabs' | 'Right pane tabs') =>
  (strip ? page.getByRole('tablist', { name: strip }) : mainTabs(page)).getByRole('tab').evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-tab-id') ?? ''));

// Started sessions of `repo` for C4 to index, one transcript each (`first` its first prompt, and so its title).
async function seedSessions(store: StoreFixture, repo: ScratchRepo, sessions: { sid: string; first: string }[]): Promise<void> {
  for (const [n, { sid, first }] of sessions.entries()) {
    await store.addTranscript(repo.root, sid, [{ type: 'user', uuid: `u-${sid}`, parentUuid: null, cwd: repo.root, sessionId: sid, timestamp: `2026-09-29T10:0${n}:00.000Z`, message: { role: 'user', content: first } }]);
  }
}
// Their records once indexed, in the order given.
async function indexed(page: Page, sids: string[]): Promise<string[]> {
  await expect.poll(async () => value(await invoke(page, 'session.list', {})).sessions.filter((r) => sids.includes(r.engineSessionId ?? '')).length, { timeout: 20_000, message: 'the seeded sessions are indexed' }).toBe(sids.length);
  const records = value(await invoke(page, 'session.list', {})).sessions;
  return sids.map((sid) => records.find((r) => r.engineSessionId === sid)!.appId);
}

// The fork's app id: its intent while it sets up (or waits on a card), else its record once bound.
async function forkOf(page: Page, source: string): Promise<string> {
  let fork: string | undefined;
  await expect
    .poll(async () => {
      fork =
        value(await invoke(page, 'session.intent.list', undefined)).intents.find((i) => i.kind === 'fork')?.appSessionId ??
        value(await invoke(page, 'session.list', {})).sessions.find((r) => r.appId !== source)?.appId;
      return fork;
    }, { timeout: 20_000 })
    .toBeDefined();
  return fork!;
}

// UX wave U6e (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §G): an application-menu item's
// enabled state by its id (null: no such item); the files service's content hash; two sentences of tools/code/copy.ts
const menuEnabled = (maws: MawsLaunch, id: string) => maws.app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.enabled ?? null, id);
const sha256Of = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const MAWS_OWN = 'Read-only: MAWS does not edit its own files'; // the editor's title, which keeps its words
const MAWS_OWN_SENTENCE = 'MAWS does not edit its own files'; // the word cut (N16 to N20): "Read-only" button's description and its panel
const OUTSIDE_REFUSED = 'MAWS may no longer write this file for this session. Choose it with File ▸ Open File… to save it';
// A drawn box, and one held inside another (half a pixel for subpixel layout)
type Box = { left: number; top: number; right: number; bottom: number };
const boxOf = (locator: Locator): Promise<Box> =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
function expectInside(inner: Box, outer: Box, what: string): void {
  expect(inner.left, `${what}: its left edge inside`).toBeGreaterThanOrEqual(outer.left - 0.5);
  expect(inner.right, `${what}: its right edge inside`).toBeLessThanOrEqual(outer.right + 0.5);
  expect(inner.top, `${what}: its top inside`).toBeGreaterThanOrEqual(outer.top - 0.5);
  expect(inner.bottom, `${what}: its bottom inside`).toBeLessThanOrEqual(outer.bottom + 0.5);
}
// The side column at a width its resizer's keys set exactly: Home its least (280 px, app/regions.ts's PANEL_BOUNDS), each
// ← one step (8 px, app/Resizer.tsx) wider, End its widest the window allows
async function sideColumnAt(page: Page, width: number | 'widest'): Promise<void> {
  const resizer = page.locator('[data-region="panel"]').getByRole('separator', { name: 'Resize right panel', exact: true });
  await resizer.focus();
  if (width === 'widest') return void (await resizer.press('End'));
  await resizer.press('Home');
  for (let px = 280; px < width; px += 8) await resizer.press('ArrowLeft');
  await expect(resizer).toHaveAttribute('aria-valuenow', String(width));
}
// K1, K3, K14, K15: a save's failure in a file's bar is a line of its own below the path and the controls, at the bar's
// full width and drawn whole; Save and View (the glyph that holds Wrap since the word cut, T305) are one group on one
// line, which stays on the path's line where it fits
async function expectFailureLine(viewer: Locator, where: string, roomy: boolean): Promise<void> {
  const drawn = await viewer.evaluate((el) => {
    const rect = (node: Element) => {
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const failure = Array.from(el.querySelectorAll('[role="alert"]')).find((node) => node.textContent?.startsWith('Could not save')) as HTMLElement;
    const bar = failure.parentElement!;
    const style = getComputedStyle(bar);
    const group = el.querySelector('[data-bar-controls]')!;
    const button = (text: string) => Array.from(group.querySelectorAll('button')).find((node) => node.textContent === text);
    const [save, view] = [button('Save'), group.querySelector('button[data-file-view]')];
    return {
      failure: rect(failure),
      whole: failure.scrollWidth <= failure.clientWidth && failure.scrollHeight <= failure.clientHeight,
      bar: rect(bar),
      room: bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      lead: rect(el.querySelector('[data-path-lead]')!),
      group: rect(group),
      save: save ? rect(save) : null,
      view: view ? rect(view) : null,
    };
  });
  expect(drawn.whole, `${where}: the failure drawn whole, never cut`).toBe(true);
  expectInside(drawn.failure, drawn.bar, `${where}: the failure`);
  expect(drawn.failure.right - drawn.failure.left, `${where}: the failure at the bar's full width`).toBeGreaterThanOrEqual(drawn.room - 1);
  expect(drawn.failure.top, `${where}: the failure on a line below the path`).toBeGreaterThanOrEqual(drawn.lead.bottom - 0.5);
  expect(drawn.failure.top, `${where}: and below Save and View`).toBeGreaterThanOrEqual(drawn.group.bottom - 0.5);
  expect(drawn.save && drawn.view, `${where}: Save and View both in the controls' group`).not.toBeNull();
  const [save, view] = [drawn.save!, drawn.view!];
  expect(save.top < view.bottom && view.top < save.bottom, `${where}: Save and View on one line`).toBe(true);
  if (roomy) expect(drawn.group.top < drawn.lead.bottom && drawn.lead.top < drawn.group.bottom, `${where}: the group on the path's line, where it fits`).toBe(true);
}

test.describe('sessions', () => {
  let current: Case | null = null;
  test.afterEach(async () => {
    const c = current;
    current = null;
    if (!c) return;
    try {
      await c.dispose();
    } finally {
      c.repos.forEach((r) => r.dispose());
      await c.store.dispose();
    }
  });

  async function begin(opts: { fixtures: string[]; untrusted?: number; trusted?: number }): Promise<Case & { trustedRepos: ScratchRepo[]; untrustedRepos: ScratchRepo[] }> {
    const trustedRepos = await Promise.all(Array.from({ length: opts.trusted ?? 1 }, () => ScratchRepo.create()));
    const untrustedRepos = await Promise.all(Array.from({ length: opts.untrusted ?? 0 }, () => ScratchRepo.create()));
    const launched = await launchCase({ fixtures: opts.fixtures, trusted: trustedRepos.map((r) => r.root) });
    current = { ...launched, repos: [...trustedRepos, ...untrustedRepos] };
    return { ...current, trustedRepos, untrustedRepos };
  }

  test('new worktree: the Worktree checkbox creates a worktree and the first send runs in it, unattested and with no card in a trusted repository', async () => {
    const { page, maws, trustedRepos } = await begin({ fixtures: [AUTO_ROUTED] });
    const repo = trustedRepos[0]!;
    const project = await addProject(page, repo.root);
    const id = await plus(page, project.name);
    await expect(await row(page, id), 'an unstarted session has no sidebar row').toHaveCount(0);
    await routeDirect(page, id);
    const name = await checkWorktree(page, id, repo.root);
    await collectTurns(page);
    await watchTranscriptFailures(page);
    const early = await invoke(page, 'session.events', { appSessionId: id, afterSeq: null, limit: null });
    expect(!early.ok && early.error.message, 'the host refuses a read before the launch: what the transcript waits out').toBe(`unknown app session: ${id}`);
    const prompt = fixtureIdentity(AUTO_ROUTED).firstPrompt!;
    await send(page, prompt.display);
    await untilPhase(page, id, 'ready');
    expect((await setupOf(page, id)).map((e) => [e.phase, e.detail])).toEqual([
      ['worktree', `Creating worktree ${name}`],
      ['launching', 'Starting'],
      ['ready', null],
    ]);
    expect((await setupOf(page, id)).at(-1)!.outcome).toMatchObject({ kind: 'ready', firstTurn: 'sent' });
    const worktree = join(repo.root, '.claude/worktrees', name);
    expect(await runGit(repo.root, ['worktree', 'list', '--porcelain'])).toContain(`worktree ${worktree}\n`);
    expect(spawnRow(maws, id).cwd).toBe(worktree);
    expect(initializeRequest(maws, id).workspaceTrust, 'a trusted key attests nothing').toBeUndefined();
    await expect(page.getByRole('group', { name: 'Trust this folder?' }), 'no trust card for a trusted repository').toHaveCount(0);
    await expect(await row(page, id)).toBeVisible();
    await turnEnded(page, id);
    expect(value(await invoke(page, 'session.intent.get', { appSessionId: id })), 'bound: the intent is gone').toBeNull();
    const main = page.locator('[data-region="main"]');
    await expect(main.getByText(prompt.display, { exact: true }).first(), 'the transcript hydrated: the prompt shows as its bubble').toBeVisible();
    expect(await transcriptFailures(page), 'the transcript never failed to load').toEqual([]);
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('unstarted tab, trust bootstrap and first send: the prompt typed into the composer docks the trust card; Trust and start runs the bootstrap under an id of its own, then the session, and the turn plays to its end', async () => {
    const { page, maws, untrustedRepos } = await begin({ fixtures: [BOOTSTRAP, AUTO_ROUTED], untrusted: 1 });
    const repo = untrustedRepos[0]!;
    const project = await addProject(page, repo.root);
    const id = await plus(page, project.name);
    await expect(page.getByRole('button', { name: `Project ${project.name}` }), "C7's composer frame under the heading, its project row chosen").toBeVisible();
    await routeDirect(page, id);
    await collectTurns(page);
    const prompt = fixtureIdentity(AUTO_ROUTED).firstPrompt!;
    await send(page, prompt.display);
    const card = page.getByRole('group', { name: 'Trust this folder?' });
    await expect(card, 'docked in the composer’s place').toBeVisible();
    await expect(card.getByText(repo.root, { exact: true })).toBeVisible();
    expect(value(await invoke(page, 'session.intent.get', { appSessionId: id }))!.message, 'the message waits behind the card').toEqual({ content: prompt.content, display: prompt.display });
    await card.getByRole('button', { name: 'Trust and start' }).click();
    await untilPhase(page, id, 'ready');
    const events = await setupOf(page, id);
    const bootstrapId = fixtureIdentity(BOOTSTRAP).sessionId;
    expect(events.filter((e) => e.phase === 'trusting').map((e) => e.detail)).toEqual([`Trusting ${repo.root}`, `Trust recorded for ${repo.root} (bootstrap ${bootstrapId})`]);
    expect(events.at(-1)!.outcome).toEqual({ kind: 'ready', engineSessionId: fixtureIdentity(AUTO_ROUTED).sessionId, firstTurn: 'sent' });
    expect(bootstrapId).not.toBe(fixtureIdentity(AUTO_ROUTED).sessionId);
    await expect(await row(page, id)).toBeVisible();
    await expect(page.getByRole('heading', { name: `New chat in ${project.name}` }), 'the tab became the session').toHaveCount(0);
    await turnEnded(page, id);
    expect(value(await invoke(page, 'session.queue.list', { appSessionId: id })).entries).toEqual([]);
    expect(initializeRequest(maws, id).workspaceTrust).toEqual({ accepted: true, directory: repo.root });
    expect(readdirSync(join(maws.userData, 'engine-host', 'journal')), 'the bootstrap id was forgotten at release').toEqual([id]);
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('fork in place with distinct ids: a second tab, a pinned id, two records', async () => {
    const { page, maws, trustedRepos } = await begin({ fixtures: [FORK_START, FORK_FORK] });
    const project = await addProject(page, trustedRepos[0]!.root);
    const source = await plus(page, project.name);
    // P3-F L242: a fork copies the source's engine conversation, which a no-message start does not have yet; the source
    // starts with its recording's own first prompt (the probe forked once that turn had written the start transcript),
    // and Fork waits for the turn to end
    await collectTurns(page);
    const prompt = fixtureIdentity(FORK_START).firstPrompt!;
    await startDirect(page, source, {}, { content: prompt.content as string, display: prompt.display });
    await untilPhase(page, source, 'ready');
    await turnEnded(page, source);
    await expect(await row(page, source)).toBeVisible();

    await menu(page, source, 'Fork');
    const fork = await forkOf(page, source);
    // The source started Direct. Its replay's custom base URL is a mismatch, not a verified gateway route;
    // forkIntentOf carries that record's direct route. Relay health cannot tell us whether a card should exist.
    // Assert the inherited route itself, so a host with no relay exercises the same fork as the mini.
    await untilPhase(page, fork, 'ready');
    const sourceId = fixtureIdentity(FORK_START).sessionId;
    const forkId = fixtureIdentity(FORK_FORK).sessionId;
    expect(sourceId).not.toBe(forkId);
    const args = spawnRow(maws, fork).args!;
    expect(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2)).toEqual(['--resume', sourceId]);
    expect(args).toContain('--fork-session');
    expect(args[args.indexOf('--session-id') + 1]).toBe(forkId);
    const records = value(await invoke(page, 'session.list', {})).sessions;
    expect(records.map((r) => r.engineSessionId).sort()).toEqual([sourceId, forkId].sort());
    expect(records.map((r) => r.gateway.routed)).toEqual([false, false]);
    await expect(page.getByRole('tab')).toHaveCount(2); // the source, the fork (W5: the Overview is no tab)
  });

  // Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, D1 and D8; its M3): a new chat whose intent holds a
  // set of MAWS's tools that is not the full set launches with it, and its fork and its resume keep it, whatever the
  // machine's default. Each launch's own spawn row says so: the host's line has neither ask flag (the engine's question
  // tool) and the row records the set. The list itself is the unit proof's: these recordings hold no `tools/list`.
  // Its M4 (D5): the machine's default is set to another set after the fork; the resume keeps the session's own, and a
  // new chat made after it starts from the default, its first launch's spawn row holding it (MAWS's ask: both flags).
  test('the set of MAWS’s tools kept with the session: a new chat at Artifacts off and Question Default launches with no ask flag and the set in its spawn row; its fork and its resume, each by its own launch, say the same; a new chat takes the machine’s default', async () => {
    const tools = { artifacts: false, documents: false, dashboards: false, auxiliary: true, question: 'engine' } as const;
    const { page, maws, trustedRepos } = await begin({ fixtures: [FORK_START, FORK_FORK, FORK_START, AUTO_ROUTED] });
    const project = await addProject(page, trustedRepos[0]!.root);
    const source = await plus(page, project.name);
    await collectTurns(page);
    const prompt = fixtureIdentity(FORK_START).firstPrompt!;
    await startDirect(page, source, { mawsTools: tools }, { content: prompt.content as string, display: prompt.display });
    await untilPhase(page, source, 'ready');
    await turnEnded(page, source);
    const launchOf = async (id: string) => value(await invoke(page, 'session.status', { appSessionId: id as never })).launchId;
    const expectServed = (row: Row['frame'], what: string) => {
      expect(row.args, `${what}: no --disallowedTools AskUserQuestion`).not.toContain('--disallowedTools');
      expect(row.args, `${what}: no --allowedTools mcp__maws__ask`).not.toContain('--allowedTools');
      expect(row.mawsTools, `${what}: the set in its spawn row`).toEqual(tools);
    };
    const firstLaunch = await launchOf(source);
    expectServed(spawnRowOf(maws, source, firstLaunch), 'the first launch');
    expect(value(await invoke(page, 'session.get', { appSessionId: source as never }))!.mawsTools, 'the record holds the set').toEqual(tools);

    await menu(page, source, 'Fork');
    const fork = await forkOf(page, source);
    await untilPhase(page, fork, 'ready');
    expectServed(spawnRowOf(maws, fork, await launchOf(fork)), 'the fork');
    expect(value(await invoke(page, 'session.get', { appSessionId: fork as never }))!.mawsTools, 'the fork’s record holds its source’s set').toEqual(tools);

    // M4: the machine's default, set as Settings › Sessions sets it (this machine's spine, machine-session-defaults.json)
    const machineDefault = { artifacts: false, documents: false, dashboards: false, auxiliary: true, question: 'maws' } as const;
    const machine = await localRef(page);
    const chosen = await page.evaluate(([set, ref]) => window.maws.invoke('machineSettings.set', { patch: {}, mawsTools: set }, { machine: ref }), [machineDefault, machine] as const);
    expect(value(chosen).mawsTools, 'the spine answers the default it wrote').toEqual(machineDefault);

    // resumed: stopped, then started again; its second spawn row is the resume's, its own set whatever the default
    value(await invoke(page, 'session.stop', { appSessionId: source as never, reason: 'stop' }));
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: source as never })).process, { timeout: 15_000 }).toBe('exited');
    expect(value(await invoke(page, 'session.start', { appSessionId: source, message: null, options: {} }))).toMatchObject({ status: 'starting' });
    await expect.poll(async () => (await setupOf(page, source)).filter((e) => e.phase === 'ready').length, { timeout: 20_000 }).toBe(2);
    const resumed = await launchOf(source);
    expect(resumed, 'the resume is a launch of its own').not.toBe(firstLaunch);
    expectServed(spawnRowOf(maws, source, resumed), 'the resume');
    // M5 (A4): Session info reads the set the running session keeps, from its record, whatever the machine's default
    await mainTabById(page, `session:${await addressed(page, source)}`).click();
    await openSurface(page, 'Session info');
    const info = page.locator(`[data-session-info="${await addressed(page, source)}"]`);
    const engine = await unfoldInfoGroup(info, 'Engine'); // the word cut: the Engine group starts folded
    const infoValue = (label: string) => engine.getByRole('term').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');
    await expect(infoValue('MAWS tools')).toHaveText('Auxiliary');
    await expect(infoValue('Question tool')).toHaveText('Default');

    // M4: a new chat starts from the machine's default: its intent holds it, and its first launch serves it
    const fresh = await plus(page, project.name);
    expect(value(await invoke(page, 'session.intent.get', { appSessionId: fresh }))!.mawsTools, 'the new intent starts from the default').toEqual(machineDefault);
    const freshPrompt = fixtureIdentity(AUTO_ROUTED).firstPrompt!;
    await startDirect(page, fresh, {}, { content: freshPrompt.content as string, display: freshPrompt.display });
    await untilPhase(page, fresh, 'ready');
    const freshRow = spawnRowOf(maws, fresh, await launchOf(fresh));
    expect(freshRow.mawsTools, 'the default in its spawn row').toEqual(machineDefault);
    expect(freshRow.args!.flatMap((arg, k) => (arg === '--disallowedTools' ? [freshRow.args![k + 1]] : [])), 'MAWS’s ask: the built-in disallowed').toEqual(['AskUserQuestion']);
    expect(value(await invoke(page, 'session.get', { appSessionId: fresh as never }))!.mawsTools, 'its record holds the default').toEqual(machineDefault);
    expect(maws.consoleErrors()).toEqual([]);
  });

  // U1a §J (A13): a folder with nothing to load says so in one line, in place of the list of what trust would turn on
  test('trust card, nothing to load: a folder with no project settings and no .mcp.json shows its path, one line saying so and where trust is recorded, and no list; the frame reads its title alone', async () => {
    const repo = await ScratchRepo.create({ sentinels: false });
    const launched = await launchCase({ fixtures: [], trusted: [] });
    current = { ...launched, repos: [repo] };
    const { page, maws } = launched;
    const project = await addProject(page, repo.root);
    const id = await plus(page, project.name);
    await routeDirect(page, id);
    await send(page, 'Nothing loads in this folder.');
    const card = page.getByRole('group', { name: 'Trust this folder?', exact: true });
    await expect(card, 'docked in the composer’s place').toBeVisible();
    await expect(card.getByText(repo.root, { exact: true })).toBeVisible();
    await expect(card.getByText('Nothing in this folder loads or runs automatically.', { exact: true })).toBeVisible();
    await expect(card.getByText(/^Recorded in .*; the terminal will not ask again\.$/)).toBeVisible();
    await expect(card.getByText(/^Loads its settings, hooks, MCP servers and plugins/), 'no sentence of what loads').toHaveCount(0);
    await expect(card.locator('dl'), 'and no list').toHaveCount(0);
    await expect(card, 'the frame reads its title alone').not.toContainText('Composer paused');
    await expect(card.getByRole('button', { name: 'Trust and start' })).toBeVisible();
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('rollback keeps the tab: a launch past the fixture list is refused, the worktree and record go, the failure card stays, and Back to editing returns the message to the editor', async () => {
    const { page, untrustedRepos } = await begin({ fixtures: [BOOTSTRAP], untrusted: 1 });
    const repo = untrustedRepos[0]!;
    const project = await addProject(page, repo.root);
    const id = await plus(page, project.name);
    const removed: string[] = [];
    await page.exposeFunction('__c10Removed', (appSessionId: string) => void removed.push(appSessionId));
    await page.evaluate(() => window.maws.on('session.removed', (e) => (window as unknown as { __c10Removed(id: string): void }).__c10Removed(e.appSessionId)));
    await routeDirect(page, id);
    const name = await checkWorktree(page, id, repo.root);
    await send(page, 'This launch will be refused.');
    await page.getByRole('group', { name: 'Trust this folder?' }).getByRole('button', { name: 'Trust and start' }).click();
    await untilPhase(page, id, 'failed');
    await expect.poll(() => removed).toEqual([id]);
    const card = page.getByRole('group', { name: 'The session did not start' });
    await expect(card).toBeVisible();
    await expect(card.getByText('replay_disabled: MAWS_E2E_REPLAY_FIXTURES has no fixture left for this launch')).toBeVisible();
    await expect(card.getByText(`Worktree ${name} removed`)).toBeVisible();
    await expect(card.getByText(`Branch worktree-${name} deleted`)).toBeVisible();
    await expect(card.getByText('Record removed')).toBeVisible();
    await expect(page.getByRole('heading', { name: `New chat in ${project.name}` }), 'the tab stayed').toBeVisible();
    expect(await runGit(repo.root, ['worktree', 'list', '--porcelain'])).not.toContain(name);
    expect(await runGit(repo.root, ['branch', '--list', `worktree-${name}`])).toBe('');
    expect(value(await invoke(page, 'session.intent.get', { appSessionId: id }))).toMatchObject({ progress: { lastFailure: { phase: 'launching' } } });
    await card.getByRole('button', { name: 'Back to editing' }).click();
    await expect(card).toHaveCount(0);
    await expect(editor(page), 'the message is back in the editor').toHaveText('This launch will be refused.');
    await expect.poll(async () => value(await invoke(page, 'session.intent.get', { appSessionId: id }))!.message, { message: 'released in main' }).toBeNull();
  });

  test('archive and unarchive: the sheet archives, the row goes, Archived sessions brings it back', async () => {
    const { page, trustedRepos } = await begin({ fixtures: [AUTO_ROUTED] });
    const project = await addProject(page, trustedRepos[0]!.root);
    const id = await plus(page, project.name);
    await startDirect(page, id);
    await untilPhase(page, id, 'ready');
    await menu(page, id, 'Archive');
    const sheet = page.getByRole('dialog', { name: /^Archive “/ });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(await row(page, id)).toHaveCount(0);
    expect(value(await invoke(page, 'session.list', { includeArchived: true })).sessions.find((r) => r.appId === id)).toMatchObject({ archived: true });
    // the process stopped: C3's table lists it exited, or no longer at all
    await expect.poll(async () => value(await invoke(page, 'engine.sessions', undefined)).find((s) => s.appSessionId === id)?.process ?? 'gone').toMatch(/^(exited|gone)$/);

    await showProjectList(page);
    await projectLine(projectRow(page, project.name)).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Archived sessions…' }).click();
    const archived = page.getByRole('dialog', { name: `Archived sessions · ${project.name}` });
    await archived.getByRole('button', { name: 'Unarchive' }).click();
    await expect(archived.getByText('No archived sessions.')).toBeVisible();
    await page.keyboard.press('Escape');
    await openProject(page, project.name);
    await expect(await row(page, id)).toBeVisible();
  });

  test('delete and rename on discovered sessions: rename sets the override, delete moves the transcript away and the row goes', async () => {
    const trustedRepo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const user = (sid: string, text: string) => ({ type: 'user', uuid: `u-${sid}`, parentUuid: null, cwd: trustedRepo.root, sessionId: sid, timestamp: '2026-09-29T10:00:00.000Z', message: { role: 'user', content: text } });
    const keep = '5e551011-0000-4000-8000-000000000001';
    const doomed = '5e551011-0000-4000-8000-000000000002';
    await store.addTranscript(trustedRepo.root, keep, [user(keep, 'rename me')]);
    const transcript = await store.addTranscript(trustedRepo.root, doomed, [user(doomed, 'delete me')]);
    await store.addSidecar(doomed, 'subagents/agent-a1.jsonl', '');
    const launched = await launchCase({ fixtures: [], trusted: [trustedRepo.root], store });
    current = { ...launched, repos: [trustedRepo] };
    const { page } = launched;
    const recordOf = async (sid: string) => {
      await expect.poll(async () => value(await invoke(page, 'session.list', {})).sessions.some((r) => r.engineSessionId === sid), { timeout: 20_000 }).toBe(true);
      return value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === sid)!;
    };

    const renamed = await recordOf(keep);
    await menu(page, renamed.appId, 'Rename…');
    const rename = page.getByRole('dialog', { name: 'Rename' });
    await rename.getByRole('textbox', { name: 'Title' }).fill('C10 override');
    await page.keyboard.press('Enter');
    await expect(rename).toHaveCount(0);
    await expect(await row(page, renamed.appId)).toHaveAttribute('aria-label', 'C10 override');
    expect(value(await invoke(page, 'session.get', { appSessionId: renamed.appId }))!.title).toEqual({ text: 'C10 override', source: 'user' });

    const gone = await recordOf(doomed);
    await menu(page, gone.appId, 'Delete conversation…');
    const sheet = page.getByRole('dialog', { name: /^Delete “/ });
    await expect(sheet.getByText(`Removes the transcript and its 1 subagent transcript from ${store.configHome} to the Trash`, { exact: false }), 'the store in use, the temp config home').toBeVisible();
    await page.keyboard.press('Enter'); // not yet: the acknowledgement is unchecked
    await expect(sheet).toBeVisible();
    await sheet.getByRole('checkbox', { name: 'Move the transcript to the Trash' }).check();
    await sheet.getByRole('button', { name: 'Delete' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(await row(page, gone.appId)).toHaveCount(0);
    expect(existsSync(transcript), 'moved out of the store').toBe(false);
    expect(readdirSync(launched.trash).sort(), 'the transcript and its sidecar arrived in the e2e Trash').toEqual([doomed, `${doomed}.jsonl`].sort());
    expect(readdirSync(join(launched.trash, doomed, 'subagents'))).toEqual(['agent-a1.jsonl']);
    expect(value(await invoke(page, 'session.get', { appSessionId: gone.appId }))).toBeNull();
  });

  // C3 corrective (2026-09-30 ledger): a resume whose engine writes nothing at all (the C12 pre-run's stall) fails its
  // launch at the 30 s first-output bound, not at the long class's 120 s, and main launches it once more, visibly (the
  // retry's reconnect rows read attempt 2 of 2, and a notice). The engine is a stub under the Engine setting's binary
  // path: it answers `--version` as the pin; a silent spawn writes nothing and never reads its stdin; an answering one
  // (a node script) answers `initialize` with the fields the host requires and every other request with an error.
  async function silentResume(answerSecond: boolean) {
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const sid = '5e551011-0000-4000-8000-0000000000c3';
    await store.addTranscript(repo.root, sid, [{ type: 'user', uuid: `u-${sid}`, parentUuid: null, cwd: repo.root, sessionId: sid, timestamp: '2026-09-30T10:00:00.000Z', message: { role: 'user', content: 'resume me' } }]);
    const answering = join(store.configHome, 'stub-engine.mjs');
    writeFileSync(answering, [
      "import { createInterface } from 'node:readline';",
      "const out = (f) => process.stdout.write(JSON.stringify(f) + '\\n');",
      "createInterface({ input: process.stdin }).on('line', (line) => {",
      '  const f = JSON.parse(line);',
      "  if (f.type !== 'control_request') return;",
      "  if (f.request.subtype === 'initialize') out({ type: 'control_response', response: { subtype: 'success', request_id: f.request_id, response: { commands: [], current_permission_mode: 'default' } } });",
      "  else out({ type: 'control_response', response: { subtype: 'error', request_id: f.request_id, error: 'stub' } });",
      "}).on('close', () => process.exit(0));",
    ].join('\n'));
    const mark = join(store.configHome, 'stub-spawned-once');
    const stub = join(store.configHome, 'stub-engine.sh');
    const second = answerSecond ? `exec "${process.execPath}" "${answering}"` : 'exec sleep 300';
    writeFileSync(stub, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.283 (Claude Code)"; exit 0; fi\nif [ ! -e "${mark}" ]; then touch "${mark}"; exec sleep 300; fi\n${second}\n`);
    chmodSync(stub, 0o755);
    const launched = await launchCase({ fixtures: [], trusted: [repo.root], store });
    current = { ...launched, repos: [repo] };
    const { page } = launched;
    value(await invoke(page, 'settings.set', { engine: { binaryPath: stub } }));
    await expect.poll(async () => value(await invoke(page, 'session.list', {})).sessions.some((r) => r.engineSessionId === sid), { timeout: 20_000 }).toBe(true);
    const record = value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === sid)!;
    const startedAt = Date.now();
    expect(value(await invoke(page, 'session.start', { appSessionId: record.appId, message: null, options: { gateway: 'direct' } }))).toMatchObject({ status: 'starting' });
    return { ...launched, record, startedAt };
  }
  const metaRows = (maws: MawsLaunch, id: string) => journal(maws, id).filter((r) => r.direction === 'meta').map((r) => r.frame as Record<string, unknown>);

  test('a resume whose engine writes nothing on its first spawn is launched once more and reaches ready, the retry visible in its rows and notice', async () => {
    test.setTimeout(150_000);
    const { page, maws, record, startedAt } = await silentResume(true);
    await expect.poll(async () => (await setupOf(page, record.appId)).map((e) => e.phase), { timeout: 90_000 }).toContain('ready');
    expect(Date.now() - startedAt, 'one first-output bound, then the retry').toBeGreaterThanOrEqual(29_000);
    expect((await setupOf(page, record.appId)).map((e) => [e.phase, e.detail])).toEqual([['launching', 'Starting'], ['launching', 'No output from the engine for 30 s · trying once more'], ['ready', null]]);
    const metas = metaRows(maws, record.appId);
    expect(metas.filter((m) => m.event === 'spawn'), 'two spawn rows').toHaveLength(2);
    expect(metas.filter((m) => m.event === 'init_failed').map((m) => m.code)).toEqual(['no_output']);
    expect(metas.find((m) => m.event === 'notice')).toMatchObject({ key: 'launch:retry', text: 'The engine gave no output for 30 s. Trying once more (attempt 2 of 2).' });
    expect(metas.find((m) => m.event === 'reconnect' && m.phase === 'reconnected')).toMatchObject({ attempt: 2, maxAttempts: 2 });
    expect(value(await invoke(page, 'session.status', { appSessionId: record.appId }))).toMatchObject({ process: 'ready' });
    const events = value(await invoke(page, 'session.events', { appSessionId: record.appId, afterSeq: null, limit: null })).events;
    expect(events.filter((e) => e.kind === 'notice.posted').map((e) => (e as { key: string }).key), 'the notice reaches the session’s events').toContain('launch:retry');
  });

  test('a resume whose engine writes nothing twice fails for good with the reason shown, and the row can be resumed again', async () => {
    test.setTimeout(180_000);
    const { page, maws, record, startedAt } = await silentResume(false);
    await expect.poll(async () => (await setupOf(page, record.appId)).map((e) => e.phase), { timeout: 120_000 }).toContain('failed');
    const failedAfterMs = Date.now() - startedAt;
    expect(failedAfterMs, 'two first-output bounds, each well before the long class’s 120 s').toBeGreaterThanOrEqual(58_000);
    expect(failedAfterMs).toBeLessThan(110_000);
    const failure = (await setupOf(page, record.appId)).find((e) => e.phase === 'failed')!;
    expect(failure.outcome).toMatchObject({ kind: 'error' });
    expect(failure.outcome!.message).toContain('the engine wrote nothing in the 30 s after it started');
    await expect(page.getByText('the engine wrote nothing in the 30 s after it started', { exact: false }).first(), 'the owner sees the reason').toBeVisible();
    const metas = metaRows(maws, record.appId);
    expect(metas.filter((m) => m.event === 'spawn'), 'one retry, never chained').toHaveLength(2);
    expect(metas.filter((m) => m.event === 'init_failed').map((m) => m.code)).toEqual(['no_output', 'no_output']);
    expect(value(await invoke(page, 'session.status', { appSessionId: record.appId }))).toMatchObject({ process: 'exited', exit: { reason: 'crash' } });
    await (await sidebarRow(page, { appSessionId: record.appId })).click({ button: 'right' }); // W11: in its expanded project
    await expect(page.getByRole('menuitem', { name: 'Resume', exact: true }), 'the row can be resumed again').toBeEnabled();
    await page.keyboard.press('Escape');
  });

  // M5, acceptance items 12 and 13's renderer half, with no engine and no real job: a synthetic registry record under
  // the temp config home (C4's recipe: the pid of this test runner, its `procStart` as the engine renders it), and a
  // login shell that is not a shell. The PTY host runs `$SHELL -l`; the case's `$SHELL` records the directory it
  // started in and every line written to it, running none (a `read` loop at its own prompt, which C9's foreground read
  // calls idle): the attach command reaches `pty.spawn` and is never run (and the login-shell captures, which run
  // `$SHELL -ilc`, fail over to the app's own environment).
  test('foreign-live: a background job holds the session read-only, the fresh read answers held, Attach runs the pinned attach in the job’s directory in one tab, again at its prompt and after a reload; a terminal holder gets no Attach', async () => {
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const sid = '5e551011-0000-4000-8000-00000000000b';
    await store.addTranscript(repo.root, sid, [{ type: 'user', uuid: `u-${sid}`, parentUuid: null, cwd: repo.root, sessionId: sid, timestamp: '2026-09-29T10:00:00.000Z', message: { role: 'user', content: 'Wait; I will attach.' } }]);
    const jobDir = join(repo.root, 'job-cwd'); // a job may run somewhere other than the session's directory (a worktree)
    mkdirSync(jobDir);
    const shellDir = mkdtempSync(join(tmpdir(), 'maws-e2e-shell-'));
    const reached = join(shellDir, 'reached.txt');
    const shell = join(shellDir, 'login-shell');
    writeFileSync(shell, `#!/bin/sh\n[ "$1" = "-l" ] || exit 1\npwd -P > '${reached}'\nwhile IFS= read -r line; do printf '%s\\n' "$line" >> '${reached}'; done\n`);
    chmodSync(shell, 0o755);
    const launched = await launchCase({ fixtures: [], trusted: [repo.root], store, env: { SHELL: shell } });
    current = { ...launched, repos: [repo], dispose: async () => (await launched.maws.cleanup(), rmSync(shellDir, { recursive: true, force: true })) };
    const { page } = launched;
    await expect.poll(async () => value(await invoke(page, 'session.list', {})).sessions.some((r) => r.engineSessionId === sid), { timeout: 20_000 }).toBe(true);
    const id = value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === sid)!.appId;

    const pid = process.pid;
    const procStart = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { env: { LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8' }).trim();
    await store.addRegistryRecord(pid, { pid, sessionId: sid, cwd: jobDir, kind: 'bg', jobId: 'e6dcd828', procStart, status: 'busy' });
    const job = { kind: 'background_job', pid, jobId: 'e6dcd828' };
    const pinned = value(await invoke(page, 'engine.binaryInfo', undefined)).path;
    const command = `'${pinned}' attach e6dcd828`;
    expect(value(await invoke(page, 'session.start', { appSessionId: id, message: null, options: {} })), 'the fresh read, whatever the sidebar shows yet').toEqual({ status: 'held', appSessionId: id, holder: job, attach: { jobId: 'e6dcd828', command } });
    await expect.poll(async () => value(await invoke(page, 'session.get', { appSessionId: id }))!.holder, { timeout: 2_000, message: 'foreign-live in the sidebar within two seconds' }).toEqual(job);

    await (await sidebarRow(page, { appSessionId: id })).click({ button: 'right' }); // W11: in its expanded project
    await expect(page.getByRole('menuitem')).toHaveText(['Open', 'Open in new tab', 'Attach in a terminal tab', 'Open in', 'Hide']); // W12 I2: Open in new tab beside Open; UX wave U7, O-16: Hide after the opens; U6b-4a: Open in with the opens
    await page.keyboard.press('Escape');
    await (await row(page, id)).click();
    const notice = page.locator('[data-region="main"]').getByRole('note');
    // the word cut (C128): the line reads who holds the session and read-only; its pid waits on the line, its description
    const jobLine = notice.getByText('Live as background job · read-only', { exact: true });
    await expect(jobLine).toBeVisible();
    await expect(jobLine).toHaveAccessibleDescription(`pid ${pid}`);
    await notice.getByRole('button', { name: 'Attach in a terminal tab' }).click();
    const reachedShell = () => (existsSync(reached) ? readFileSync(reached, 'utf8') : '');
    await expect.poll(reachedShell, { timeout: 10_000 }).toBe(`${realpathSync(jobDir)}\n${command}\n`);
    const ptys = async () => value(await invoke(page, 'pty.list', undefined)).ptys.filter((p) => p.appSessionId === id && p.alive);
    const [pty] = await ptys();
    // the panel's list as C5 persists it (written a moment after the change)
    const panel = async () => value(await invoke(page, 'layout.get', { key: `panel.${await addressed(page, id)}` })).value as { tabs: { id: string; toolId: string }[]; activeTabId: string | null } | null;
    await expect.poll(panel, { message: 'one Terminal tab, selected, whose id is the pty’s label' }).toEqual({ tabs: [{ id: pty!.label, toolId: 'terminal', pinned: false }], activeTabId: pty!.label });
    // the shell is at its prompt (the attach was left): a second Attach runs it again in the same tab
    await notice.getByRole('button', { name: 'Attach in a terminal tab' }).click();
    await expect.poll(reachedShell, { timeout: 10_000 }).toBe(`${realpathSync(jobDir)}\n${command}\n${command}\n`);
    expect((await ptys()).map((p) => p.ptyId), 'no second pty').toEqual([pty!.ptyId]);
    // a reload keeps the tab and its shell (C9 re-adopts it under the tab id) and the layout remembers whose attach it is
    await expect.poll(async () => value(await invoke(page, 'layout.get', { key: 'sessions.attachTabs' })).value).toEqual({ version: 2, tabs: [{ tabId: pty!.label, appSessionId: await addressed(page, id), jobId: 'e6dcd828' }] });
    await page.reload();
    await notice.getByRole('button', { name: 'Attach in a terminal tab' }).click();
    await expect.poll(reachedShell, { timeout: 10_000 }).toBe(`${realpathSync(jobDir)}\n${command}\n${command}\n${command}\n`);
    expect((await ptys()).map((p) => p.ptyId), 'still the one pty after the reload').toEqual([pty!.ptyId]);
    await expect.poll(panel).toEqual({ tabs: [{ id: pty!.label, toolId: 'terminal', pinned: false }], activeTabId: pty!.label });

    // an interactive terminal holds it now: held with no attach, and no Attach anywhere
    await store.removeRegistryRecord(pid);
    await store.addRegistryRecord(pid, { pid, sessionId: sid, cwd: repo.root, kind: 'interactive', procStart, status: 'idle' });
    expect(value(await invoke(page, 'session.start', { appSessionId: id, message: null, options: {} }))).toEqual({ status: 'held', appSessionId: id, holder: { kind: 'terminal', pid }, attach: null });
    await expect(notice.getByText('Live in Terminal · read-only', { exact: true }), 'the word cut (C128): its pid its description').toHaveAccessibleDescription(`pid ${pid}`, { timeout: 5_000 });
    await expect(notice.getByRole('button', { name: 'Attach in a terminal tab' })).toHaveCount(0);
    await expect(notice.getByRole('button', { name: 'Fork a copy' })).toBeVisible();
    await (await sidebarRow(page, { appSessionId: id })).click({ button: 'right' });
    await expect(page.getByRole('menuitem')).toHaveText(['Open', 'Open in new tab', 'Open in', 'Hide']); // UX wave U7, O-16; U6b-4a: Open in with the opens
    await page.keyboard.press('Escape');
    await store.removeRegistryRecord(pid);
    expect(launched.maws.consoleErrors()).toEqual([]);
  });

  // UX wave U8b (A7, M6; X-168): a terminal session that MAWS only reads (a registry record names its live process, and
  // no bridge drives it) whose last turn ended while an agent it started in the background still works: the row of that
  // Agent call stays in view under the ended turn. The terminal's process goes (its registry record removed) and the
  // transcript never says the agent ended, yet the agent ended with the process: its row folds with the turn.
  test('X-168: a terminal session whose turn ended with a background agent still working; its process goes, its registry record removed, and the agent’s row folds with the ended turn', async () => {
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const sid = '5e551011-0000-4000-8000-00000000000c';
    const agent = { agentId: 'a5e55000000000001', description: 'Survey the folder', prompt: 'List what is in this folder.', at: '2026-09-29T10:00:01.000Z' };
    const ask = `u-${sid}`;
    const turn = backgroundAgentRecords(sid, repo.root, ask, agent);
    const end = turnEndRecords(sid, repo.root, turn.at(-1)!.uuid as string, '2026-09-29T10:00:02.000Z');
    await store.addTranscript(repo.root, sid, [userRecord(sid, repo.root, ask, null, 'Survey this folder in the background.', '2026-09-29T10:00:00.000Z'), ...turn, ...end].map((r) => JSON.stringify(r)));
    await backgroundAgentSidecars(store, sid, repo.root, agent);
    const launched = await launchCase({ fixtures: [], trusted: [repo.root], store });
    current = { ...launched, repos: [repo] };
    const { page } = launched;
    await expect.poll(async () => value(await invoke(page, 'session.list', {})).sessions.some((r) => r.engineSessionId === sid), { timeout: 20_000 }).toBe(true);
    const id = value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === sid)!.appId;

    const pid = process.pid;
    const procStart = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { env: { LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8' }).trim();
    await store.addRegistryRecord(pid, { pid, sessionId: sid, cwd: repo.root, kind: 'interactive', procStart, status: 'idle' });
    const holder = async () => value(await invoke(page, 'session.get', { appSessionId: id }))?.holder.kind;
    await expect.poll(holder, { timeout: 10_000 }).toBe('terminal');
    await (await sidebarRow(page, { appSessionId: id })).click();
    const main = page.locator('[data-region="main"]');
    await expect(main.getByRole('note').getByText('Live in Terminal · read-only', { exact: true }), 'the word cut (C128): its pid its description').toHaveAccessibleDescription(`pid ${pid}`, { timeout: 10_000 });
    const agentRow = main.locator('.transcript-subagent', { hasText: agent.description });
    // the word cut (T86): a working agent's line is the running ring, named Working, and the description its parent gave
    await expect(agentRow.locator('.transcript-subagent-sentence'), 'the turn ended while its agent works: the call stays in view').toHaveText(agent.description, { timeout: 15_000 });
    await expect(agentRow.getByRole('img', { name: 'Working', exact: true })).toBeVisible();

    await store.removeRegistryRecord(pid);
    await expect.poll(holder, { timeout: 10_000 }).toBe('none');
    await expect(agentRow, 'its process went: the agent ended with it, and its row folds with the turn').toHaveCount(0, { timeout: 15_000 });
    expect(launched.maws.consoleErrors()).toEqual([]);
  });

  // New chat (2026-10-01, the owner's request after Codex): the sidebar's New chat from the project list opens a tab with
  // no project; the composer's project row chooses one (or a new folder, or none) before the first send.
  test('New chat from the project list: "Choose a project" with Send disabled; a project enables Send with its branch and the Worktree checkbox; New project adds a folder; no project runs at home', async () => {
    const { page, maws, trustedRepos } = await begin({ fixtures: [], trusted: 2 });
    assertPickSeamBuilt(maws);
    const [first, second] = trustedRepos as [ScratchRepo, ScratchRepo];
    const alpha = await addProject(page, first.root);
    await showProjectList(page);
    await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New chat', exact: true })).toBeVisible();
    const id = value(await invoke(page, 'session.intent.list', undefined)).intents.at(-1)!.appSessionId;
    expect(value(await invoke(page, 'session.intent.get', { appSessionId: id }))).toMatchObject({ projectId: null, location: null });
    const row = page.locator('[data-region="main"] [data-project-row]');
    const chip = row.getByRole('button', { name: 'Choose a project' });
    await expect(chip).toBeVisible();
    await expect(row.getByRole('checkbox', { name: 'Worktree' })).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Composer tools' }).getByRole('button', { name: /^Location / }), 'the row stands for the toolbar’s location').toHaveCount(0);
    // W9 (H3): the new tab's composer has the keyboard, so typing needs no click (the button that opened it does not keep it)
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('hello');
    await expect(editor(page)).toHaveText('hello');
    const control = page.locator('[data-region="main"] [data-submit-state]');
    await expect(control).toBeDisabled();
    await expect(control).toHaveAttribute('title', 'Choose a project first');
    await page.screenshot({ path: test.info().outputPath('new-chat-choose-a-project.png') });

    // the chip's menu: search, the projects most recently active first, New project, Don't work in a project
    await chip.click();
    const menu = page.getByRole('dialog', { name: 'Choose a project' });
    await expect(menu.getByPlaceholder('Search projects')).toBeVisible();
    await expect(menu.getByRole('option')).toHaveText([alpha.name, 'New project', "Don't work in a project"]);
    await page.screenshot({ path: test.info().outputPath('new-chat-project-menu.png') });
    await menu.getByRole('option', { name: alpha.name }).click();
    await expect(page.getByRole('heading', { name: `New chat in ${alpha.name}` })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'New chat', exact: true }), 'UX2: the current project is not repeated in its tab label').toBeVisible();
    expect(value(await invoke(page, 'session.intent.get', { appSessionId: id }))).toMatchObject({ projectId: alpha.id, location: { kind: 'directory', path: first.root } });
    await expect(row.getByRole('button', { name: `Project ${alpha.name}` })).toBeVisible();
    await expect(row.getByLabel('Branch main')).toBeVisible();
    const worktree = row.getByRole('checkbox', { name: 'Worktree' });
    await expect(worktree).not.toBeChecked();
    await expect(control).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath('new-chat-project-chosen.png') });
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark')); // both themes render the row (tokens only)
    await expect(row.getByRole('button', { name: `Project ${alpha.name}` })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('new-chat-project-chosen-dark.png') });
    await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
    await checkWorktree(page, id, first.root); // a new worktree `<project>-<4 hex>` for the first send
    await worktree.click();
    await expect(worktree).not.toBeChecked();
    expect(value(await invoke(page, 'session.intent.get', { appSessionId: id }))!.location).toEqual({ kind: 'directory', path: first.root });

    // New project: the native folder dialog (main's e2e seam) and the folder becomes a project, chosen
    await maws.app.evaluate((_electron, dir) => void (process.env.MAWS_E2E_PICK_PATHS = dir), second.root);
    await row.getByRole('button', { name: `Project ${alpha.name}` }).click();
    await menu.getByRole('option', { name: 'New project' }).click();
    const addedOf = async () => value(await invoke(page, 'session.projects.list', undefined)).projects.find((p) => p.directory === second.root);
    await expect.poll(async () => (await addedOf())?.directory).toBe(second.root);
    const added = (await addedOf())!;
    await expect(page.getByRole('heading', { name: `New chat in ${added.name}` })).toBeVisible();
    expect(value(await invoke(page, 'session.intent.get', { appSessionId: id }))).toMatchObject({ projectId: added.id, location: { kind: 'directory', path: second.root } });

    // Don't work in a project: the home directory, the chip says so, no checkbox, and Send goes
    await row.getByRole('button', { name: `Project ${added.name}` }).click();
    await menu.getByRole('option', { name: "Don't work in a project" }).click();
    await expect(row.getByRole('button', { name: 'Project No project' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'New chat', exact: true })).toBeVisible();
    expect(value(await invoke(page, 'session.intent.get', { appSessionId: id }))).toMatchObject({ projectId: null, location: { kind: 'directory', path: realpathSync(homedir()) } });
    await expect(row.getByRole('checkbox', { name: 'Worktree' })).toHaveCount(0);
    await expect(control).toBeEnabled();
    expect(maws.consoleErrors()).toEqual([]);
  });

  // U13a (O-01, A3): with an empty New chat in the strip, New chat from any control brings that same chat to the front
  // with the keyboard in its composer and makes nothing; once the chat holds a draft, the same control opens one more
  // chat right after it and the first keeps its draft. Spaces typed into either open no tab. The title bar's chip starts
  // no chat any more (O-31: it reveals its row), so it is not one of the controls. A project row's "+" that reuses the
  // chat is pressed directly: `newChatIn` waits for a tab the strip did not hold.
  for (const entry of ['tab strip', 'project plus', 'sidebar New chat', 'File menu (⌘N)'] as const) {
    test(`new chat from ${entry} reuses an empty chat and adds one beside a draft, without Space opening more tabs`, async () => {
      const { page, maws, trustedRepos } = await begin({ fixtures: [] });
      const project = await addProject(page, trustedRepos[0].root);
      const first = await plus(page, project.name);
      const firstTab = `session:${await addressed(page, first)}`;
      await expect(editor(page)).toBeFocused();
      const intents = async () => value(await invoke(page, 'session.intent.list', undefined)).intents.map((i) => i.appSessionId);
      const press = async (draft: boolean) => {
        if (entry === 'tab strip') await mainTabs(page).getByRole('button', { name: 'New chat', exact: true }).click();
        else if (entry === 'project plus' && draft) await newChatIn(page, project.name);
        else if (entry === 'project plus') {
          await showProjectList(page);
          const row = projectRow(page, project.name);
          await clickRevealed(projectLine(row), row.getByRole('button', { name: `New chat in ${project.name}`, exact: true }));
        } else if (entry === 'sidebar New chat') await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'New chat', exact: true }).click();
        else expect(await appMenu(maws, 'session.new')).toBe('Cmd+N');
      };

      // the empty chat: the same one comes to the front with the keyboard, and nothing is made
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await expect(editor(page)).not.toBeFocused();
      await press(false);
      await expect(editor(page), 'the same chat takes the keyboard').toBeFocused();
      await expect(activeMainTab(page)).toHaveAttribute('data-tab-id', firstTab);
      await page.waitForTimeout(500); // past where a chat made by the press would have arrived
      expect(await tabIdsOf(page), 'one empty chat, the same one').toEqual([firstTab]);
      expect(await intents(), 'nothing was made').toEqual([first]);
      await page.keyboard.type('A prompt with several spaces');
      await expect(editor(page)).toHaveText('A prompt with several spaces');
      expect(await tabIdsOf(page)).toEqual([firstTab]);
      await expect.poll(async () => JSON.stringify(value(await invoke(page, 'session.intent.get', { appSessionId: first }))!.draft), { message: 'the draft is kept in its intent' }).toContain('A prompt with several spaces');

      // a draft keeps its chat: one more chat, right after it, with the keyboard, and the first keeps its draft
      await press(true);
      await expect.poll(async () => (await tabIdsOf(page)).length, { message: 'one more tab' }).toBe(2);
      const [kept, added] = await tabIdsOf(page);
      expect(kept, 'the new chat comes right after the one with the draft').toBe(firstTab);
      await expect(activeMainTab(page)).toHaveAttribute('data-tab-id', added!);
      await expect(editor(page)).toBeFocused();
      await expect(editor(page)).toHaveText('');
      await page.keyboard.type('another thought');
      expect(await tabIdsOf(page)).toHaveLength(2);
      await mainTabById(page, firstTab).click();
      await expect(editor(page), 'the first chat keeps its draft').toHaveText('A prompt with several spaces');
      expect(maws.consoleErrors()).toEqual([]);
    });
  }

  // U13a (O-01, A2): with three sessions open, New chat from each control adds exactly one tab, right after the tab in
  // front, and the three stay. Each new chat is closed again (an empty chat closes without a question) before the next
  // control, so every press meets the same three tabs and no empty chat to reuse (A3). The empty main area's New chat
  // has no three tabs beside it, and the Overview's shows on an empty board only; the unit tests hold those two.
  test('New chat from each control, with three sessions open, adds one tab right after the tab in front and the three stay', async () => {
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const seeded = [1, 2, 3].map((n) => ({ sid: `5e551011-0000-4000-8000-0000000000b${n}`, first: `open session ${n}` }));
    await seedSessions(store, repo, seeded);
    const launched = await launchCase({ fixtures: [], trusted: [repo.root], store });
    current = { ...launched, repos: [repo] };
    const { page, maws } = launched;
    const ids = await indexed(page, seeded.map((s) => s.sid));
    await (await sidebarRow(page, { appSessionId: ids[0]! })).click();
    for (const id of ids.slice(1)) await (await sidebarRow(page, { appSessionId: id })).click({ modifiers: ['Meta'] });
    const three = await Promise.all(ids.map(async (id) => `session:${await addressed(page, id)}`));
    await expect.poll(() => tabIdsOf(page), { message: 'three session tabs' }).toEqual(three);
    const project = value(await invoke(page, 'session.projects.list', undefined)).projects.find((p) => p.directory === repo.root)!;
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    const controls: [string, () => Promise<unknown>][] = [
      ['the strip’s "+"', () => mainTabs(page).getByRole('button', { name: 'New chat', exact: true }).click()],
      ['the sidebar’s New chat', () => page.locator('[data-region="sidebar"]').getByRole('button', { name: 'New chat', exact: true }).click()],
      ['the project row’s "+"', () => newChatIn(page, project.name)],
      ['File › New chat (⌘N)', () => appMenu(maws, 'session.new')],
      ['the palette', async () => {
        await appMenu(maws, 'palette.open');
        await expect(palette.getByRole('combobox')).toBeFocused();
        await page.keyboard.type('new chat');
        await palette.getByRole('group', { name: 'Actions' }).getByRole('option', { name: /^New chat/ }).first().click();
      }],
    ];
    for (const [control, press] of controls) {
      await mainTabById(page, three[1]!).click(); // the middle tab in front
      await expect(activeMainTab(page)).toHaveAttribute('data-tab-id', three[1]!);
      await press();
      await expect.poll(async () => (await tabIdsOf(page)).length, { message: `${control}: one tab more` }).toBe(4);
      const now = await tabIdsOf(page);
      const added = now.find((id) => !three.includes(id))!;
      expect(now, `${control}: right after the tab in front, the three kept`).toEqual([three[0], three[1], added, three[2]]);
      await expect(activeMainTab(page), `${control}: the new chat in front`).toHaveAttribute('data-tab-id', added);
      await expect(page.getByRole('heading', { name: `New chat in ${project.name}` }), `${control}: in the project of the session in front`).toBeVisible();
      await appMenu(maws, 'tab.close');
      await expect.poll(() => tabIdsOf(page), { message: `${control}: the empty chat closed again` }).toEqual(three);
    }
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('Overview New chat on an empty board closes the panel and hands typing to the new composer', async () => {
    const { page, maws } = await begin({ fixtures: [] });
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    const overview = page.getByRole('dialog', { name: 'Overview' });
    await expect(overview.getByText('Nothing live or unread', { exact: true })).toBeVisible();
    await overview.getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(overview).toHaveCount(0);
    await expect(editor(page), 'W9 (H3): the Overview must not obscure the composer that takes focus').toBeFocused();
    await page.keyboard.type('a thought from the Overview');
    await expect(editor(page)).toHaveText('a thought from the Overview');
    expect(maws.consoleErrors()).toEqual([]);
  });

  // E11 F2b (plan 2.1): an unstarted New chat's composer is centred in its pane, so the room above and below the caret
  // are alike and neither holds the palette's 384px; the old bottom-first palette hung past the window's foot and its
  // row reveal scrolled the whole window. Now it opens above, capped by the room there, and moves nothing
  // (support/palette-geometry.ts; shell.spec.ts runs the same over a started session's docked composer).
  test('the slash palette opens above an unstarted New chat’s centred composer and moves nothing', async () => {
    const { page, maws } = await begin({ fixtures: [] });
    await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 72, y: 48, width: 1200, height: 640 }));
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    const overview = page.getByRole('dialog', { name: 'Overview' });
    await overview.getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(overview).toHaveCount(0);
    await expect(editor(page)).toBeFocused();
    await slashPaletteMovesNothing(page, 'an unstarted New chat');
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('⌘N (File › New chat) from an open session starts a New chat in that session’s project', async () => {
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const sid = '5e551011-0000-4000-8000-0000000000aa';
    await store.addTranscript(repo.root, sid, [{ type: 'user', uuid: `u-${sid}`, parentUuid: null, cwd: repo.root, sessionId: sid, timestamp: '2026-09-29T10:00:00.000Z', message: { role: 'user', content: 'an open session' } }]);
    const launched = await launchCase({ fixtures: [], trusted: [repo.root], store });
    current = { ...launched, repos: [repo] };
    const { page, maws } = launched;
    await expect.poll(async () => value(await invoke(page, 'session.list', {})).sessions.some((r) => r.engineSessionId === sid), { timeout: 20_000 }).toBe(true);
    const open = value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === sid)!;
    const project = value(await invoke(page, 'session.projects.list', undefined)).projects.find((p) => p.id === open.projectId)!;
    expect(project.directory).toBe(repo.root);
    await (await sidebarRow(page, { appSessionId: open.appId })).click();
    await expect(page.getByRole('tab', { name: new RegExp(`^an open session`) })).toHaveAttribute('aria-selected', 'true');
    const label = await maws.app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('session.new');
      item?.click();
      return item?.label ?? null;
    });
    expect(label, 'File › New chat').toBe('New chat');
    await expect(page.getByRole('heading', { name: `New chat in ${project.name}` })).toBeVisible();
    await expect(editor(page), 'W9 (H3): ⌘N hands the keyboard to the new tab').toBeFocused();
    const created = value(await invoke(page, 'session.intent.list', undefined)).intents.at(-1)!;
    expect(created).toMatchObject({ projectId: project.id, location: { kind: 'directory', path: repo.root } });
    await expect(page.locator('[data-region="main"] [data-project-row]').getByRole('button', { name: `Project ${project.name}` })).toBeVisible();
    expect(maws.consoleErrors()).toEqual([]);
  });

  test("Add project picks through main's e2e seam: cancelled when MAWS_E2E_PICK_PATHS is unset, the listed directory when set; no native panel", async () => {
    const { page, maws, trustedRepos } = await begin({ fixtures: [] });
    assertPickSeamBuilt(maws);
    const repo = trustedRepos[0]!;
    expect(value(await invoke(page, 'layout.pickFiles', { kind: 'directory', directory: null, multiple: false })), 'unset: answered as cancelled').toEqual({ files: [] });
    const addDialog = page.getByRole('dialog', { name: 'Add project', exact: true });
    await page.getByRole('button', { name: 'Add project', exact: true }).first().click();
    await expect(addDialog).toBeVisible();
    await addDialog.getByRole('button', { name: 'Choose folder…', exact: true }).click();
    await expect(addDialog).toHaveCount(0);
    await expect.poll(async () => value(await invoke(page, 'session.projects.list', undefined)).projects.length, { message: 'a cancelled pick adds nothing' }).toBe(0);
    await maws.app.evaluate((_electron, dir) => void (process.env.MAWS_E2E_PICK_PATHS = dir), repo.root);
    await page.getByRole('button', { name: 'Add project', exact: true }).first().click();
    await expect(addDialog).toBeVisible();
    await addDialog.getByRole('button', { name: 'Choose folder…', exact: true }).click();
    await expect(addDialog).toHaveCount(0);
    await expect.poll(async () => value(await invoke(page, 'session.projects.list', undefined)).projects.map((p) => p.directory)).toEqual([repo.root]);
    const [added] = value(await invoke(page, 'session.projects.list', undefined)).projects;
    await expect(projectRow(page, added!.name)).toBeVisible();
    expect(maws.consoleErrors()).toEqual([]);
  });

  // A5 (O-01; l7-shell-12, kept but for one case the owner narrowed on 2026-11-12): a relaunch brings the strip back with
  // its tabs in their order, the pin, the split and its ratio, and the same tab in front; a New chat with a draft comes
  // back with it; a New chat with nothing in it does not (Q1, "No, only chats with content").
  test('a relaunch brings the strip back: the order, a pin, the split and its ratio, the tab in front and a chat with its draft; an empty New chat does not come back', async () => {
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const seeded = [1, 2].map((n) => ({ sid: `5e551011-0000-4000-8000-0000000000c${n}`, first: `kept session ${n}` }));
    await seedSessions(store, repo, seeded);
    const first = await launchCase({ fixtures: [], trusted: [repo.root], store });
    current = { ...first, repos: [repo] };
    const { page } = first;
    const [s1, s2] = await indexed(page, seeded.map((s) => s.sid));
    // two sessions, the first pinned
    await (await sidebarRow(page, { appSessionId: s1! })).click();
    await (await sidebarRow(page, { appSessionId: s2! })).click({ modifiers: ['Meta'] });
    const [t1, t2] = [`session:${await addressed(page, s1!)}`, `session:${await addressed(page, s2!)}`];
    await expect.poll(() => tabIdsOf(page)).toEqual([t1, t2]);
    await mainTabById(page, t1).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Pin tab', exact: true }).click();
    await expect(mainTabById(page, t1).getByRole('img', { name: 'Pinned' })).toBeVisible();
    // a New chat holding a draft, after the second session
    const project = value(await invoke(page, 'session.projects.list', undefined)).projects.find((p) => p.directory === repo.root)!;
    const id = await plus(page, project.name);
    const chat = `session:${await addressed(page, id)}`;
    await expect(editor(page), 'W9 (H3): the project row\'s "+" hands the keyboard to the new tab').toBeFocused();
    await page.keyboard.type('half a thought');
    // C7 keeps an unstarted session's draft through C10's hook (the intent), written a moment after the typing
    await expect.poll(async () => JSON.stringify(value(await invoke(page, 'session.intent.get', { appSessionId: id }))!.draft)).toContain('half a thought');
    // the second session moved to the other pane (⌘\), and the split's ratio moved off its default
    await mainTabById(page, t2).click();
    await appMenu(first.maws, 'pane.split');
    await expect.poll(() => tabIdsOf(page, 'Right pane tabs'), { message: 'the split' }).toEqual([t2]);
    const resizer = page.locator('[data-region="main"]').getByRole('separator', { name: 'Resize panes' });
    const box = (await resizer.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    // back in the left pane: an empty New chat (the draft keeps its chat, so a new one is made), then the draft's chat in front
    await mainTabById(page, chat).click();
    await appMenu(first.maws, 'session.new');
    await expect.poll(async () => (await tabIdsOf(page, 'Left pane tabs')).length, { message: 'an empty New chat beside the one with a draft' }).toBe(3);
    const left = await tabIdsOf(page, 'Left pane tabs');
    const empty = left.find((tab) => ![t1, chat].includes(tab))!;
    expect(left).toEqual([t1, chat, empty]);
    await mainTabById(page, chat).click();
    await expect(activeMainTab(page)).toHaveAttribute('data-tab-id', chat);
    expect(value(await invoke(page, 'session.intent.list', undefined)).intents, 'two New chats at the quit, one of them empty').toHaveLength(2);
    type Stored = { sets: Record<string, { panes: { tabs: { id: string; pinned: boolean }[]; activeTabId: string }[]; focusedPane: number; splitRatio: number }> };
    const stored = async (p: Page) => (value(await invoke(p, 'layout.get', { key: 'main.tabs' })).value as Stored).sets.none!;
    await expect
      .poll(async () => {
        const set = await stored(page);
        return [set.panes.map((pane) => pane.tabs.map((tab) => tab.id)), set.panes[0]!.activeTabId, set.focusedPane, set.splitRatio !== 0.5];
      }, { message: 'the strip is written, the empty chat in it' })
      .toEqual([[[t1, chat, empty], [t2]], chat, 0, true]);
    const divider = await resizer.getAttribute('aria-valuenow');
    await first.maws.app.close();

    const second = await launchCase({ fixtures: [], trusted: [repo.root], store, userData: first.maws.userData });
    current = { ...second, repos: [repo], dispose: async () => (await second.maws.cleanup(), await first.maws.cleanup()) };
    const again = second.page;
    await expect(again.getByRole('heading', { name: `New chat in ${project.name}` }), 'hydration kept the chat with a draft').toBeVisible();
    await expect.poll(() => tabIdsOf(again, 'Left pane tabs'), { message: 'the order and the split back, the empty chat gone' }).toEqual([t1, chat]);
    expect(await tabIdsOf(again, 'Right pane tabs')).toEqual([t2]);
    await expect(mainTabById(again, t1).getByRole('img', { name: 'Pinned' }), 'the pin is back').toBeVisible();
    await expect(activeMainTab(again), 'the same tab in front').toHaveAttribute('data-tab-id', chat);
    // two panes, two composers: the chat's is the one holding the draft
    await expect(editor(again).filter({ hasText: 'half a thought' }), 'the draft is back in the chat’s editor').toBeVisible();
    await expect(mainTabById(again, chat).getByRole('img', { name: 'Pinned' }), 'the chat unpinned').toHaveCount(0);
    await expect(again.locator('[data-region="main"]').getByRole('separator', { name: 'Resize panes' }), 'the split’s ratio, as the divider draws it').toHaveAttribute('aria-valuenow', divider!);
    const intents = value(await invoke(again, 'session.intent.list', undefined)).intents.map((i) => i.appSessionId);
    expect(intents, 'the chat with a draft keeps its intent; the empty chat’s was discarded at the start').toEqual([id]);
    expect(second.maws.consoleErrors()).toEqual([]);
  });

  test("C5's acceptance item 10, replay clause: a replayed read-only request reaches the session's row through a recorded session and its hover card's Allow once answers the broker", async () => {
    const { page, trustedRepos } = await begin({ fixtures: [READ_ONLY] });
    const project = await addProject(page, trustedRepos[0]!.root);
    const id = await plus(page, project.name);
    await collectTurns(page);
    const prompt = fixtureIdentity(READ_ONLY).firstPrompt!;
    expect(await startDirect(page, id, {}, { content: prompt.content as string, display: prompt.display })).toEqual({ status: 'starting', appSessionId: id });
    await untilPhase(page, id, 'ready');
    expect((await setupOf(page, id)).at(-1)!.outcome).toMatchObject({ kind: 'ready', firstTurn: 'sent' });

    // W5: the session's row (in its project, expanded by the "+" helper) waits with the approval glyph; its hover card holds
    // C7's X4 card in C5's hover placement (registered in C5's requestCard slot), the tool as its heading.
    const entry = await row(page, id);
    await expect(entry.getByRole('img', { name: 'Needs approval' })).toBeVisible({ timeout: 20_000 });
    const card = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Read' }) });
    await expect(async () => {
      await page.mouse.move(700, 400);
      await entry.hover();
      await expect(card).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 10_000 });
    await expect(card.getByText('Approval needed')).toBeVisible();
    await card.getByRole('button', { name: 'Allow once', exact: true }).click(); // U1a §H: the hover card's once-only allow
    await expect(entry.getByRole('img', { name: 'Needs approval' })).toHaveCount(0);
    await expect(entry, 'the project tree row survives attention retirement').toBeVisible();
    await turnEnded(page, id);
  });
  // U8c-1 (M1 decision 9): on EnterWorktree the engine renames the session's transcript, and its folder beside it, into
  // the worktree's project folder, then appends a `relocated` row and the next turn's rows there (engine 2.1.322,
  // cli.pretty.js:381469-381548). An open transcript reads on, and the session is listed throughout, never archived.
  test('a session whose transcript the engine moves stays listed and goes on reading', async () => {
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const sid = '5e551011-0000-4000-8000-0000000000c8';
    const user = (uuid: string, parentUuid: string | null, cwd: string, text: string) => ({ type: 'user', uuid, parentUuid, cwd, sessionId: sid, timestamp: '2026-11-13T10:00:00.000Z', message: { role: 'user', content: text } });
    const from = await store.addTranscript(repo.root, sid, [user(`u-${sid}`, null, repo.root, 'Written before the move')]);
    await store.addSidecar(sid, 'subagents/agent-a1.jsonl', '');
    const worktree = await repo.addManagedWorktree('w1');
    const launched = await launchCase({ fixtures: [], trusted: [repo.root], store });
    current = { ...launched, repos: [repo] };
    const { page } = launched;
    await expect.poll(async () => value(await invoke(page, 'session.list', {})).sessions.some((r) => r.engineSessionId === sid), { timeout: 20_000 }).toBe(true);
    const record = value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === sid)!;
    // Every record the window is sent for the session from here on, and any removal.
    await page.evaluate((id) => {
      const seen: unknown[] = [];
      (window as unknown as { __u8c: unknown[] }).__u8c = seen;
      window.maws.on('session.changed', ({ record: changed }) => changed.appId === id && seen.push(changed.archived ? 'archived' : 'listed'));
      window.maws.on('session.removed', ({ appSessionId }) => appSessionId === id && seen.push('removed'));
    }, record.appId);
    await (await sidebarRow(page, { appSessionId: record.appId })).click();
    const main = page.locator('[data-region="main"]');
    await expect(main.getByText('Written before the move', { exact: true })).toBeVisible({ timeout: 20_000 });

    const project = join(store.paths.projects, slugOf(worktree));
    const target = join(project, `${sid}.jsonl`);
    mkdirSync(project, { recursive: true });
    renameSync(from, target);
    renameSync(join(dirname(from), sid), join(project, sid));
    appendFileSync(target, [{ type: 'relocated', relocatedCwd: worktree, sessionId: sid }, user('u-after-move', `u-${sid}`, worktree, 'Written after the move')].map((r) => `${JSON.stringify(r)}\n`).join(''));

    await expect(main.getByText('Written after the move', { exact: true }), 'the open transcript reads on at the new path').toBeVisible({ timeout: 20_000 });
    await expect(await sidebarRow(page, { appSessionId: record.appId })).toBeVisible();
    expect(value(await invoke(page, 'session.list', {})).sessions.some((r) => r.appId === record.appId), 'listed, not among the archived').toBe(true);
    expect(value(await invoke(page, 'session.get', { appSessionId: record.appId }))!.archived).toBe(false);
    const seen = await page.evaluate(() => (window as unknown as { __u8c: unknown[] }).__u8c);
    expect(seen, 'never told archived or removed across the move').not.toContain('archived');
    expect(seen).not.toContain('removed');
  });

  // UX wave U6c (docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, Interfaces §E; A1 to A4), as U6e leaves it
  // (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §G; A1, A2, A5, A9): on this Mac a file
  // outside the session's folder opens beside the chat when the session's own transcript links it, is edited, and is
  // written only by Save; nothing else there opens or is written: not a path written in prose, not one linked only in a
  // message that was typed and never delivered, not one another session links, not a request that does not ask by the
  // rule; its folder is not listed. Every file and both transcripts are invented, in temporary folders. UX wave U6b-1
  // (Interfaces §G): the linked file opens beside the chat, the text file and then the PDF's row in the session's one
  // preview tab, and the main strip stays as it was, the session's tab in front. UX wave U6b-2 (docs/doperpowers/plans/
  // 2026-11-15-ux-wave-U6b-2-file-frames.md, M6; B4): the linked PDF is drawn in its frame, as one inside the folder is, its
  // Open externally the bar's; a PDF the transcript does not name is refused a frame as it is refused a read. UX wave
  // U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, §G; L1 to L5, L7): a `file:///` link to an outside
  // file opens it as its path link does, and one with a host is text; a relative link opens against the working folder; a
  // relative link to an outside file the transcript never writes whole shows the first notice in the window, and reads
  // nothing.
  test("a file the transcript links opens from outside the session's folder, is edited, and is written only by Save; nothing else is", async () => {
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'maws-u6c-outside-'))); // the open log takes the real path
    try {
      const file = (name: string) => join(outside, name);
      const NOTES = 'Invented notes, kept outside the session’s folder.';
      const texts: Record<string, string | Buffer> = {
        'notes.txt': `${NOTES}\n`, 'report.pdf': minimalPdf(), 'unnamed.txt': 'never linked\n', 'unnamed.pdf': minimalPdf(), 'typed-only.txt': 'typed, never sent\n', key: 'an invented key\n', 'key,backup': 'an invented backup\n',
        'by-url.txt': 'Invented, linked as a file: URL.\n', 'by-host.txt': 'Invented, linked with a host.\n', 'secret.md': 'Invented, reached only by a relative link.\n', // U6b-4b
      };
      for (const [name, text] of Object.entries(texts)) writeFileSync(file(name), text);
      // UX wave U6b-4b: a file of the working folder a relative link names, and the relative way from that folder to an
      // outside file the transcript never writes whole
      const GUIDE = 'An invented guide, in the working folder.';
      mkdirSync(join(repo.root, 'docs'));
      writeFileSync(join(repo.root, 'docs', 'guide.md'), `${GUIDE}\n`);
      const toSecret = relative(repo.root, file('secret.md'));
      const S = '5e551011-0000-4000-8000-0000000000e6';
      const T = '5e551011-0000-4000-8000-0000000000e7';
      const at = '2026-11-13T10:00:00.000Z';
      const row = (sessionId: string) => ({ cwd: repo.root, sessionId, timestamp: at, isSidechain: false, userType: 'external', version: '2.1.300' });
      const reply =
        `Here are [the notes](${file('notes.txt')}), [the report](${file('report.pdf')}) and [the backup](${file('key,backup')}). The other one is ${file('unnamed.txt')}.` +
        ` Also [by URL](file://${file('by-url.txt')}), [by host](file://invented-host${file('by-host.txt')}), [the guide](docs/guide.md) and [the secret](${toSecret}).`; // U6b-4b
      await store.addTranscript(repo.root, S, [
        { ...row(S), type: 'user', uuid: 'u-u6c-s1', parentUuid: null, message: { role: 'user', content: 'Where are the files from outside?' } },
        { type: 'queue-operation', operation: 'enqueue', timestamp: at, sessionId: S, content: `Also [the typed one](${file('typed-only.txt')})` },
        {
          ...row(S), type: 'assistant', uuid: 'a-u6c-s1', parentUuid: 'u-u6c-s1',
          message: { id: 'msg_u6c0001', type: 'message', role: 'assistant', model: 'claude-opus-4-5', content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } },
        },
      ]);
      await store.addTranscript(repo.root, T, [{ ...row(T), type: 'user', uuid: 'u-u6c-t1', parentUuid: null, message: { role: 'user', content: 'Another session, which links nothing.' } }]);
      const openLog = join(store.configHome, 'open.log');
      const launched = await launchCase({ fixtures: [], trusted: [repo.root], store, env: { MAWS_E2E_OPEN_LOG: openLog } });
      current = { ...launched, repos: [repo] };
      const { page, maws } = launched;
      const [s, t] = await indexed(page, [S, T]);

      await (await sidebarRow(page, { appSessionId: s! })).click();
      const main = page.locator('[data-region="main"]');
      const chip = (name: string) => main.locator(`[data-chip="path"][title="${file(name)}"]`);
      await expect(chip('notes.txt')).toBeVisible({ timeout: 20_000 });
      await expect(chip('unnamed.txt'), 'a path in prose is no chip').toHaveCount(0);
      const sessionTabId = await activeMainTab(page).getAttribute('data-tab-id');
      const stripIds = () => mountedTabs(page).evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-tab-id') ?? ''));
      const strip = await stripIds();
      const asItWas = async () => {
        expect(await stripIds(), 'the main strip as it was').toEqual(strip);
        await expect(activeMainTab(page), 'the session’s tab in front').toHaveAttribute('data-tab-id', sessionTabId!);
      };

      // U6b-1: the click opens the file beside the chat; U6e: editable, its bar the path alone, which says where Save writes
      await chip('notes.txt').click();
      const machine = await localRef(page);
      const side = sideColumn(page);
      const notes = side.locator(`[data-file-viewer][data-path="${file('notes.txt')}"]`);
      await expect(notes, 'the file beside the chat').toBeVisible({ timeout: 20_000 });
      await expect(mainTabById(page, `file:${machine}:${file('notes.txt')}`), 'no file tab of the strip').toHaveCount(0);
      await asItWas();
      const content = notes.locator('.cm-content');
      await expect(content).toHaveText(NOTES, { timeout: 20_000 });
      await asItWas();
      await expect(sideTab(side, 'notes.txt'), 'the file’s tab has its full path as its tooltip').toHaveAttribute('title', file('notes.txt'));
      await expect(notes.locator('[data-read-only]'), 'no label on a file that can be saved').toHaveCount(0);
      const lead = notes.locator('[data-path-lead]');
      await expect(lead).toHaveAttribute('data-outside', 'writable');
      await expect(lead).toHaveAttribute('title', `Save writes to ${file('notes.txt')}`);
      await expect(lead).toHaveAttribute('aria-description', `Save writes to ${file('notes.txt')}`);
      await expect(notes).toHaveAttribute('data-editable', 'true');
      await expect(content).not.toHaveAttribute('title');
      await expect(notes).toHaveAttribute('data-dirty', 'false');
      const save = notes.locator('[data-editor-controls]').getByRole('button', { name: 'Save', exact: true });
      await expect(save, 'no Save before an edit').toHaveCount(0);

      // A2: typing changes the tab alone; ⌘S (File › Save file) writes the typed text, and nothing beside the file changes
      const EDITED = 'Notes edited in MAWS, outside the session’s folder.';
      await content.click();
      await page.keyboard.press('Meta+a');
      await page.keyboard.type(EDITED);
      await expect(notes).toHaveAttribute('data-dirty', 'true');
      await expect(save).toBeVisible();
      expect(readFileSync(file('notes.txt'), 'utf8'), 'nothing written before Save').toBe(texts['notes.txt']);
      await appMenu(maws, 'file.save');
      await expect.poll(() => readFileSync(file('notes.txt'), 'utf8'), { timeout: 20_000, message: 'File › Save file wrote the typed text' }).toBe(EDITED);
      await expect(notes).toHaveAttribute('data-dirty', 'false');
      await expect(notes).toHaveAttribute('data-pending', '0');
      for (const [name, text] of Object.entries(texts)) if (name !== 'notes.txt') expect(readFileSync(file(name)), `${name} untouched`).toEqual(Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8'));

      // A9: the file changed on disk meanwhile (no watch outside the folders): the next Save meets the merge view, and the
      // disk's version stays until the person resolves
      const THEIRS = 'Notes changed on disk by other means.\n';
      writeFileSync(file('notes.txt'), THEIRS);
      await content.click();
      await page.keyboard.press('Meta+End');
      await page.keyboard.type(' And a second edit.');
      await expect(notes).toHaveAttribute('data-dirty', 'true');
      await save.click();
      await expect(notes).toHaveAttribute('data-theirs', 'merge', { timeout: 20_000 });
      const reason = notes.locator('[data-theirs-notice="merge"]');
      await expect(reason).toHaveText('Changed on disk'); // the word cut (T341): the merge view's notice reads as the plain notice does
      await expectDrawnWholeAtBothWidths(page, reason);
      expect(readFileSync(file('notes.txt'), 'utf8'), 'the conflicting save wrote nothing').toBe(THEIRS);

      const before = await created(page, maws.userData, s!); // UX wave U6b-2: B8, nothing created by the frame
      await chip('report.pdf').click(); // the session's tab never left the front, so its transcript is where it was
      const report = side.locator(`[data-file-viewer][data-path="${file('report.pdf')}"]`);
      // UX wave U6b-2: drawn in its frame from a token whose URL names the file and no folder, with the side tab's fragment,
      // its page's black square painted (not an error or blank page)
      await expect(report, 'the linked PDF drawn').toHaveAttribute('data-frame', 'pdf', { timeout: 20_000 });
      await expect(report.locator('[data-artifact-frame="pdf"]')).toHaveAttribute('src', /^maws-artifact:\/\/[0-9a-f]{32}\/report\.pdf#toolbar=0&navpanes=0$/);
      await expect.poll(() => markPixels(maws.app, page, report.locator('[data-artifact-frame="pdf"]')), { timeout: 15_000, message: 'the page drawn: its black square' }).toBeGreaterThan(2_000);
      await expect(report.locator('[data-external-row]'), 'no row').toHaveCount(0);
      await expect(side.locator(`[data-files-tab][data-file="${file('report.pdf')}"]`), 'in the preview tab the text file was shown in').toBeVisible();
      await expect(side.locator(`[data-files-tab][data-file="${file('notes.txt')}"]`)).toHaveCount(0);
      await asItWas();
      await report.getByRole('button', { name: 'Open externally' }).click(); // the bar's
      // the open seam's lines, less the file frames' own (`frame-decision`, `frame-entry`), which share its log
      const opened = () => readFileSync(openLog, { encoding: 'utf8', flag: 'a+' }).split('\n').filter((line) => line !== '' && !line.startsWith('frame-'));
      await expect.poll(opened, { timeout: 20_000 }).toEqual([file('report.pdf')]);
      expect(await created(page, maws.userData, s!), 'nothing created').toEqual(before);

      // UX wave U6b-4b (L1, L2, R1): a `file:///` link to an outside file is a path link of that path and opens the file
      // beside the chat, as its scheme-less link does; one with a host is the link's text with no chip; and no element of
      // the page carries a `file:` address. The page's own body is what is read (N1.9: an element drawn in the window): the
      // head holds the `<link>`s Vite's preload helper adds for each lazy chunk, whose hrefs are absolute `file:` URLs
      // because the build's base is relative and the window loads its page from a file. The control below shows the
      // selector still finds such an address on any element of the body, and passes over the head's links.
      await expect(chip('by-url.txt'), 'the file: URL drawn as a path link').toBeVisible();
      await expect(main.getByText('by host', { exact: true }), 'the link with a host is drawn, as text').toBeVisible();
      await expect(chip('by-host.txt'), 'and is no chip').toHaveCount(0);
      const addressed = page.locator('body').locator('[href^="file:"], [href^="maws-path:"]');
      await expect(addressed, 'no file: or maws-path: address on any element of the window').toHaveCount(0);
      await page.evaluate(() => {
        const planted = (tag: string, href: string, into: HTMLElement) => {
          const element = document.createElement(tag);
          element.setAttribute('href', href);
          element.setAttribute('data-e2e-planted', '');
          into.append(element);
        };
        planted('a', 'file:///planted/notes.txt', document.querySelector('[data-region="main"]') ?? document.body);
        planted('span', 'maws-path:/planted/notes.txt', document.body);
        planted('link', 'file:///planted/chunk.js', document.head);
      });
      await expect(addressed, 'the control: an anchor and a span planted in the window are found').toHaveCount(2);
      await page.evaluate(() => document.querySelectorAll('[data-e2e-planted]').forEach((element) => element.remove()));
      await expect(addressed, 'the control removed').toHaveCount(0);
      await chip('by-url.txt').click();
      const byUrl = side.locator(`[data-file-viewer][data-path="${file('by-url.txt')}"]`);
      await expect(byUrl.locator('.cm-content'), 'the outside file the file: link names, read by the rule').toHaveText('Invented, linked as a file: URL.', { timeout: 20_000 });
      await asItWas();

      // L4 (R2): a relative link opens the file of that name in the session's working folder
      const guidePath = join(repo.root, 'docs', 'guide.md');
      const guide = main.locator('[data-chip="path"][title="docs/guide.md"]');
      await expect(guide, 'the relative link drawn as a path link').toBeVisible();
      await guide.click();
      await expect(side.locator(`[data-file-viewer][data-path="${guidePath}"]`), 'opened at the working folder’s path').toBeVisible({ timeout: 20_000 });
      await expect(side.locator(`[data-file-viewer][data-path="${guidePath}"]`)).toContainText(GUIDE, { timeout: 20_000 });

      // L5, L7: a relative link to an outside file the transcript never writes whole opens its tab at the path it names,
      // whose notice says why in the window, in three sentences, with the path and Copy path (the service's words no longer
      // under it since the word cut, N11); no line begins with "Refused"; nothing of the file is read
      const toSecretChip = main.locator(`[data-chip="path"][title="${toSecret}"]`);
      await expect(toSecretChip).toBeVisible();
      await toSecretChip.click();
      const secret = side.locator(`[data-file-viewer][data-path="${file('secret.md')}"]`);
      const notice = secret.locator('[data-refusal]');
      await expect(notice, 'the first notice').toHaveAttribute('data-notice-cause', 'outside', { timeout: 20_000 });
      await expect(notice).toHaveAttribute('role', 'alert');
      await expect
        .poll(() => notice.locator('p').allTextContents(), { message: 'the three sentences and the path' })
        .toEqual([
          'This file is outside the folders this session works in.',
          'Choose it with File ▸ Open File…', // the word cut (N7): the way in, without how the app opens files
          'Ask the agent to copy the file into this session’s folders to see it here.',
          file('secret.md'),
        ]);
      await expect(notice.locator('[data-notice-copy]'), 'Copy path, after the path').toHaveText('Copy path');
      await expect(notice.locator('[data-notice-retry]'), 'no Retry: trying again cannot help').toHaveCount(0);
      // the word cut (N11): the command's own words show only under the generic "could not be opened" notice
      await expect(notice.locator('[data-notice-detail]')).toHaveCount(0);
      expect((await notice.locator('p').allTextContents()).filter((line) => line.startsWith('Refused') || line.startsWith('files.')), 'no line in the command’s words first').toEqual([]);
      await expect(secret.locator('.cm-content'), 'nothing of the file is read').toHaveCount(0);
      await asItWas();

      // A5: every other way is refused, and the bytes are read back
      const refusal = { ok: false, error: { code: 'internal', message: "path outside the session's directories" } };
      const read = (appSessionId: string, name: string, named: boolean) => invoke(page, 'files.read', { appSessionId: appSessionId as never, path: file(name), ...(named ? { named: true as const } : {}) });
      expect(await read(s!, 'unnamed.txt', true), 'written only in prose').toMatchObject(refusal);
      // UX wave U6b-2: a PDF the transcript does not name: no read, and no frame (main's command refuses it with the
      // files service's words)
      expect(await read(s!, 'unnamed.pdf', true), 'a PDF the transcript does not name').toMatchObject(refusal);
      expect(await invoke(page, 'layout.frameFile', { appSessionId: s! as never, path: file('unnamed.pdf') }), 'nor a frame of it').toMatchObject({ ok: false, error: { message: refusal.error.message } });
      expect(await read(s!, 'typed-only.txt', true), 'linked only in a message never delivered').toMatchObject(refusal);
      expect(await read(s!, 'key', true), 'the start of a longer linked name').toMatchObject(refusal);
      expect(await read(t!, 'notes.txt', true), 'linked only in another session').toMatchObject(refusal);
      expect(await read(s!, 'notes.txt', false), 'asked without the key').toMatchObject(refusal);
      expect(await invoke(page, 'files.list', { appSessionId: s! as never, path: outside }), 'its folder is not listed').toMatchObject(refusal);
      const saveOutside = (appSessionId: string, name: string) =>
        invoke(page, 'files.writeOutside', { appSessionId: appSessionId as never, path: file(name), real: file(name), content: 'overwritten', expectedHash: sha256Of(readFileSync(file(name))) });
      expect(await saveOutside(s!, 'unnamed.txt'), 'a save of a path written only in prose').toMatchObject(refusal);
      expect(await saveOutside(s!, 'key'), 'a save of the start of a longer linked name').toMatchObject(refusal);
      expect(await saveOutside(t!, 'notes.txt'), 'a save under a session that links nothing').toMatchObject(refusal);
      expect(await invoke(page, 'files.write', { appSessionId: s! as never, path: file('notes.txt'), content: 'overwritten', expectedHash: sha256Of(readFileSync(file('notes.txt'))) }), 'files.write takes the folders alone').toMatchObject(refusal);
      expect(readFileSync(file('notes.txt'), 'utf8')).toBe(THEIRS);
      for (const [name, text] of Object.entries(texts)) if (name !== 'notes.txt') expect(readFileSync(file(name)), `${name} untouched`).toEqual(Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8'));
      expect(maws.consoleErrors()).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  // UX wave U6b-4c (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md, §H; acceptance K1, K2, K3, K6,
  // K7): a link in a Markdown file shown in MAWS opens the file it names from outside the session's folder, editable,
  // once the files service has read the Markdown file itself and found the link (`files.follow`), and records what it
  // found in the profile (`sessions/file-links.json`), so the tab comes back after a relaunch and saves again. A relative
  // link in a Markdown file outside the folder, chosen with Open File…, opens the file beside it. A path the Markdown file
  // writes only in a code fence, or a link in a file that is not Markdown, is followed to nothing. Staged as the case above
  // stages its files: invented files under a temporary folder outside the session's, by their real paths.
  test("a link in a shown Markdown file opens a file from outside the session's folder, editable, and the tab comes back", async () => {
    test.setTimeout(240_000);
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'maws-u6b4c-outside-'))); // the chooser and the record take real paths
    try {
      const file = (name: string) => join(outside, name);
      const NOTES = 'Invented notes, linked from a guide in the working folder.';
      const NEXT = 'The invented next page, beside the index.';
      const texts: Record<string, string> = {
        'notes.txt': `${NOTES}\n`, 'fenced.txt': 'Written only in a code fence.\n', 'next.md': `${NEXT}\n`,
        'index.md': '# An invented index\n\nRead [next](next.md) after this.\n',
      };
      for (const [name, text] of Object.entries(texts)) writeFileSync(file(name), text);
      const guidePath = join(repo.root, 'guide.md');
      writeFileSync(guidePath, `# An invented guide\n\nSee [the notes](${file('notes.txt')}).\n\n\`\`\`text\n[fenced](${file('fenced.txt')})\n\`\`\`\n`);
      const plainPath = join(repo.root, 'links.txt'); // the same link's text in a file the window does not draw as Markdown
      writeFileSync(plainPath, `See [the notes](${file('notes.txt')}).\n`);
      const S = '5e551011-0000-4000-8000-0000000000f1';
      await store.addTranscript(repo.root, S, [{ type: 'user', uuid: `u-${S}`, parentUuid: null, cwd: repo.root, sessionId: S, timestamp: '2026-11-18T10:00:00.000Z', message: { role: 'user', content: 'A session whose guide links a file' } }]);
      const first = await launchCase({ fixtures: [], trusted: [repo.root], store });
      current = { ...first, repos: [repo] };
      const { page, maws } = first;
      const [s] = await indexed(page, [S]);
      await (await sidebarRow(page, { appSessionId: s! })).click();
      const linksFile = join(maws.userData, 'sessions', 'file-links.json');
      type Links = { version: number; sessions: Record<string, { real: string; from: { file: string } | { agent: string; engineSessionId?: string }; why?: string }[]> };
      const linksHeld = () => (existsSync(linksFile) ? (JSON.parse(readFileSync(linksFile, 'utf8')) as Links) : null);
      const viewerOf = (path: string, scope: Locator = sideColumn(page)) => scope.locator(`[data-file-viewer][data-path="${path}"]`);
      const linkIn = (viewer: Locator, title: string) => viewer.locator(`[data-markdown-view] [data-chip="path"][title="${title}"]`);

      await test.step('K1: the guide opened from Files’ tree; its link opens the outside file beside the chat, editable, and Save writes it', async () => {
        await openSurface(page, 'Files');
        const files = surface(page, 'files');
        const treeRow = (path: string) => files.locator(`[data-tool="files"] [role="treeitem"][data-kind][data-path="${path}"]`).first();
        await expect(treeRow(repo.root)).toBeVisible({ timeout: 20_000 });
        if ((await treeRow(repo.root).getAttribute('aria-expanded')) !== 'true') await treeRow(repo.root).click();
        await treeRow(guidePath).click({ timeout: 20_000 });
        const guide = viewerOf(guidePath);
        await expect(linkIn(guide, file('notes.txt')), 'the guide drawn as Markdown, its link a path link').toBeVisible({ timeout: 20_000 });
        await expect(linkIn(guide, file('fenced.txt')), 'a link in a code fence is no link').toHaveCount(0);
        await linkIn(guide, file('notes.txt')).click();
        const notes = viewerOf(file('notes.txt'));
        const content = notes.locator('.cm-content');
        await expect(content, 'the outside file, read').toHaveText(NOTES, { timeout: 20_000 });
        await expect(notes).toHaveAttribute('data-editable', 'true');
        await expect(notes.locator('[data-read-only]'), 'no "Read-only" label').toHaveCount(0);
        await expect(notes.locator('[data-path-lead]')).toHaveAttribute('title', `Save writes to ${file('notes.txt')}`);
        await content.click();
        await page.keyboard.press('Meta+a');
        await page.keyboard.type('Notes edited through the guide’s link.');
        await expect(notes).toHaveAttribute('data-dirty', 'true');
        expect(readFileSync(file('notes.txt'), 'utf8'), 'nothing written before Save').toBe(texts['notes.txt']);
        await appMenu(maws, 'file.save');
        await expect.poll(() => readFileSync(file('notes.txt'), 'utf8'), { timeout: 20_000, message: '⌘S wrote the linked file' }).toBe('Notes edited through the guide’s link.');
        await expect(notes).toHaveAttribute('data-dirty', 'false');
        // K2: the daemon's record of the link, one entry for the session, where the link stood
        const held = linksHeld();
        expect(held && Object.keys(held.sessions), 'the links file names the one session').toHaveLength(1);
        expect(Object.values(held!.sessions).flat(), 'one entry: the outside file, from the guide, savable').toEqual([expect.objectContaining({ real: file('notes.txt'), from: { file: guidePath } })]);
        expect(Object.values(held!.sessions).flat()[0]!.why, 'a record that admits a save holds no why').toBeUndefined();
      });
      expect(maws.consoleErrors()).toEqual([]);
      await maws.app.close();

      const again = await launchCase({ fixtures: [], trusted: [repo.root], store, userData: maws.userData });
      current = { ...again, repos: [repo], dispose: async () => (await again.maws.cleanup(), await maws.cleanup()) };
      const p2 = again.page;
      const m2 = again.maws;
      const side2 = () => sideColumn(p2);
      const notes2 = side2().locator(`[data-file-viewer][data-path="${file('notes.txt')}"]`);

      await test.step('K2: after a relaunch the tab is there, reads the saved text, and saves again', async () => {
        await expect(sideTab(side2(), 'notes.txt'), 'the linked file’s tab is back beside the chat').toBeVisible({ timeout: 20_000 });
        await sideTab(side2(), 'notes.txt').click();
        const content2 = notes2.locator('.cm-content');
        await expect(content2).toHaveText('Notes edited through the guide’s link.', { timeout: 20_000 });
        await expect(notes2).toHaveAttribute('data-editable', 'true');
        await content2.click();
        await p2.keyboard.press('Meta+End');
        await p2.keyboard.type(' Kept across a relaunch.');
        await appMenu(m2, 'file.save');
        await expect.poll(() => readFileSync(file('notes.txt'), 'utf8'), { timeout: 20_000, message: 'the restored tab saves' }).toBe('Notes edited through the guide’s link. Kept across a relaunch.');
        await expect(notes2).toHaveAttribute('data-dirty', 'false');
      });

      await test.step('K3: a Markdown file outside the folder, chosen with Open File…, opens the file its relative link names beside it', async () => {
        assertPickSeamBuilt(m2);
        await (await sidebarRow(p2, { appSessionId: s! })).click();
        await expect.poll(() => menuEnabled(m2, 'file.open'), { message: 'the session’s chat in front' }).toBe(true);
        await m2.app.evaluate((_electron, p) => void (process.env.MAWS_E2E_PICK_PATHS = p), file('index.md'));
        await appMenu(m2, 'file.open');
        const index = side2().locator(`[data-file-viewer][data-path="${file('index.md')}"]`);
        await expect(index.locator('[data-markdown-view] [data-chip="path"][title="next.md"]'), 'the chosen index drawn as Markdown').toBeVisible({ timeout: 20_000 });
        await index.locator('[data-markdown-view] [data-chip="path"][title="next.md"]').click();
        const next = side2().locator(`[data-file-viewer][data-path="${file('next.md')}"]`);
        await expect(next.locator('[data-markdown-view]'), 'the file beside the index, read').toContainText(NEXT, { timeout: 20_000 });
        await expect(next.locator('[data-read-only]'), 'with no "Read-only" label').toHaveCount(0);
      });

      await test.step('K6, K7: a path written only in a code fence, and a link in a file that is not Markdown, are followed to nothing', async () => {
        const recorded = () => Object.values(linksHeld()?.sessions ?? {}).flat().map((entry) => entry.real).sort();
        const clicked = [file('next.md'), file('notes.txt')].sort();
        expect(recorded(), 'the two links a click followed').toEqual(clicked);
        const before = readFileSync(linksFile);
        const follow = (path: string, from: string) => invoke(p2, 'files.follow', { appSessionId: s! as never, path, from: { file: from } });
        expect(value(await follow(file('fenced.txt'), guidePath)), 'a path the guide writes only in a code fence').toEqual({ status: 'not-linked' });
        expect(await invoke(p2, 'files.read', { appSessionId: s! as never, path: file('fenced.txt'), named: true }), 'and a read of it is refused').toMatchObject({ ok: false, error: { message: "path outside the session's directories" } });
        expect(value(await follow(file('notes.txt'), plainPath)), 'the same link’s text in a .txt file').toEqual({ status: 'not-linked' });
        expect(readFileSync(linksFile), 'neither wrote the links file').toEqual(before);
        expect(value(await follow(file('notes.txt'), guidePath)), 'the control: the guide’s own link, followed directly').toEqual({ status: 'linked' });
        expect(recorded(), 'it renews the entry it had, and nothing more is recorded').toEqual(clicked);
      });
      expect(m2.consoleErrors()).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  // UX wave U6b-4c (§H; acceptance K5): a link in a subagent's own text opens by the rule of the session's own transcript,
  // read over that subagent's file. Staged as the X-168 case above stages its background agent (the parent's Agent call
  // and its launch result in the session's transcript, the child's file and its meta beside it), with no terminal holding
  // the session: nobody holds its transcript, so its agent reads as ended with the session and its row folds with the
  // turn, which the scene unfolds as a person does. The child's answer links a file outside the session's folder that
  // neither the parent's records nor the call's prompt and result write. The agent is opened by the app's own drill-in (its
  // row in the transcript opens Agents on it) and the link is clicked there: the click is the proof.
  test("a link in a subagent's transcript, clicked in its drill-in, opens a file from outside the session's folder, editable, and saves", async () => {
    test.setTimeout(180_000);
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'maws-u6b4c-agent-'))); // the record takes the real path
    try {
      const byAgent = join(outside, 'by-agent.txt');
      const TEXT = 'Invented findings the subagent wrote down.\n';
      writeFileSync(byAgent, TEXT);
      const sid = '5e551011-0000-4000-8000-0000000000f2';
      const agent = { agentId: 'a5e55000000000002', description: 'Gather the findings', prompt: 'Gather the findings in this folder.', at: '2026-11-18T10:00:01.000Z' };
      const ask = `u-${sid}`;
      const turn = backgroundAgentRecords(sid, repo.root, ask, agent);
      const end = turnEndRecords(sid, repo.root, turn.at(-1)!.uuid as string, '2026-11-18T10:00:02.000Z');
      const parentRows = [userRecord(sid, repo.root, ask, null, 'Gather the findings in the background.', '2026-11-18T10:00:00.000Z'), ...turn, ...end].map((r) => JSON.stringify(r));
      expect(parentRows.filter((line) => line.includes(byAgent)), 'the parent’s records do not write the path').toEqual([]);
      await store.addTranscript(repo.root, sid, parentRows);
      const child = await backgroundAgentSidecars(store, sid, repo.root, agent);
      const answer = { ...assistantRecord(sid, repo.root, 'a-u6b4c-agent-1', child.last, `I wrote them to [the findings](${byAgent}).`, '2026-11-18T10:00:03.000Z'), isSidechain: true, agentId: agent.agentId };
      await store.appendLines(child.transcript, [JSON.stringify(answer)]);
      const launched = await launchCase({ fixtures: [], trusted: [repo.root], store });
      current = { ...launched, repos: [repo] };
      const { page, maws } = launched;
      const [id] = await indexed(page, [sid]);
      await (await sidebarRow(page, { appSessionId: id! })).click();
      const main = page.locator('[data-region="main"]');
      await expect(main.getByText('It is working in the background.').first(), 'the session’s transcript drawn').toBeVisible({ timeout: 20_000 });

      // the agent's row, under its turn's line unfolded (the line is unfolded only where it was folded); its row opens the
      // drill-in, which draws the child's own transcript
      const turnLine = main.locator('.transcript-row[data-kind="divider"] button.transcript-disclosure').first(); // the one turn's
      await expect(turnLine, 'the turn’s line').toBeVisible({ timeout: 20_000 });
      if ((await turnLine.getAttribute('aria-expanded')) !== 'true') await turnLine.click();
      await expect(turnLine).toHaveAttribute('aria-expanded', 'true');
      const agentRow = main.locator('.transcript-subagent', { hasText: agent.description });
      await expect(agentRow, 'the agent’s row in the session’s transcript').toBeVisible({ timeout: 15_000 });
      await agentRow.locator('button.transcript-subagent-line').click();
      const drillIn = surface(page, 'subagents').locator('[data-view="agent"]');
      const link = drillIn.locator(`[data-chip="path"][title="${byAgent}"]`);
      await expect(link, 'the drill-in draws the child’s answer with its link').toBeVisible({ timeout: 20_000 });

      // the click: the file opens beside the chat, editable, and saves
      await link.click();
      const viewer = sideColumn(page).locator(`[data-file-viewer][data-path="${byAgent}"]`);
      const content = viewer.locator('.cm-content');
      await expect(content, 'the outside file the subagent linked, read').toHaveText(TEXT.trimEnd(), { timeout: 20_000 });
      await expect(viewer).toHaveAttribute('data-editable', 'true');
      await expect(viewer.locator('[data-read-only]'), 'no "Read-only" label').toHaveCount(0);
      await content.click();
      await page.keyboard.press('Meta+End');
      await page.keyboard.type(' Checked in MAWS.');
      await expect(viewer).toHaveAttribute('data-dirty', 'true');
      expect(readFileSync(byAgent, 'utf8'), 'nothing written before Save').toBe(TEXT);
      await appMenu(maws, 'file.save');
      await expect.poll(() => readFileSync(byAgent, 'utf8'), { timeout: 20_000, message: '⌘S wrote the file the subagent linked' }).toBe(`${TEXT} Checked in MAWS.`);
      await expect(viewer).toHaveAttribute('data-dirty', 'false');
      const links = JSON.parse(readFileSync(join(maws.userData, 'sessions', 'file-links.json'), 'utf8')) as { sessions: Record<string, { real: string; from: unknown; why?: string }[]> };
      expect(Object.values(links.sessions).flat(), 'one record: the file, from the subagent, savable').toEqual([expect.objectContaining({ real: byAgent, from: { agent: agent.agentId, engineSessionId: sid } })]); // the conversation the drill-in was drawn for, as the follow asked (Decision Log 17)
      expect(Object.values(links.sessions).flat()[0]!.why).toBeUndefined();
      expect(maws.consoleErrors()).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  // UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, §G; acceptance L12, R3): a session on this
  // Mac whose transcript links a page on this Mac's loopback, which the scene serves itself (e2e/support/browser-server.ts,
  // on 127.0.0.1). The Browser e2e harness registers its own openExternal, so the scene runs in the app. A click on
  // `http://localhost:<port>/…` opens a Browser tab at that address beside the chat and writes no `openExternal` line to
  // main's open seam (MAWS_E2E_OPEN_LOG), and the page loads from the scene's server; ⌘-click on a loopback address not
  // yet open writes the line and opens no tab; `app.localhost` opens and loads as `localhost` does; a link off this Mac
  // writes the line and opens no tab. Waits on the session's tabs as main lists them for it, the server's requests and
  // the seam's lines. The last plain click is the barrier for the absences before it: the window's commands reach main
  // in order, so once its tab is listed, a tab the ⌘-click or the outside link had opened would be listed too.
  const loopbackLaunch = async (opts: { sid: string; reply: string }) => {
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const at = '2026-11-18T10:00:00.000Z';
    const row = { cwd: repo.root, sessionId: opts.sid, timestamp: at, isSidechain: false, userType: 'external', version: '2.1.300' };
    await store.addTranscript(repo.root, opts.sid, [
      { ...row, type: 'user', uuid: 'u-u6b4b-1', parentUuid: null, message: { role: 'user', content: 'Where does the app run?' } },
      {
        ...row, type: 'assistant', uuid: 'a-u6b4b-1', parentUuid: 'u-u6b4b-1',
        message: { id: 'msg_u6b4b001', type: 'message', role: 'assistant', model: 'claude-opus-4-5', content: [{ type: 'text', text: opts.reply }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } },
      },
    ]);
    const openLog = join(store.configHome, 'open.log');
    const launched = await launchCase({ fixtures: [], trusted: [repo.root], store, env: { MAWS_E2E_OPEN_LOG: openLog } });
    current = { ...launched, repos: [repo] };
    const { page } = launched;
    const [id] = await indexed(page, [opts.sid]);
    await (await sidebarRow(page, { appSessionId: id! })).click();
    // main's open seam: one line per URL main would hand the system browser
    const handedOut = () => (existsSync(openLog) ? readFileSync(openLog, 'utf8').split('\n').filter((line) => line.startsWith('openExternal ')) : []);
    // the session's own tabs, as main lists them for it (fix wave 1: scoped to the session)
    const sessionTabs = async () => value(await invoke(page, 'browser.tabs.list', { appSessionId: id! as never })).tabs.map((tab) => tab.url);
    const tabsAt = async (url: string) => (await sessionTabs()).filter((at) => at === url);
    return { page, handedOut, tabsAt, sessionTabs };
  };

  test('a loopback link of a session on this Mac opens in its in-app browser beside the chat; ⌘-click opens it in the system browser', async () => {
    const server = await startBrowserServer();
    try {
      const port = new URL(server.origin).port;
      const APP = `http://localhost:${port}/marker.html`;
      const STATUS = `http://localhost:${port}/c.html`; // ⌘-clicked only, never open in the app
      const ADMIN = `http://app.localhost:${port}/b.html`;
      const DOCS = 'https://example.test/docs';
      const { page, handedOut, tabsAt, sessionTabs } = await loopbackLaunch({
        sid: '5e551011-0000-4000-8000-0000000000f1',
        reply: `It runs at [the app](${APP}), with [the status](${STATUS}) and [the admin](${ADMIN}); [the docs](${DOCS}) are elsewhere.`,
      });
      const main = page.locator('[data-region="main"]');
      const link = (name: string) => main.getByRole('link', { name, exact: true });
      await expect(link('the app')).toBeVisible({ timeout: 20_000 });

      // a click: a tab of the session's browser at the address, beside the chat, whose page loads from the scene's server;
      // nothing handed to the system browser
      await link('the app').click();
      await expect.poll(async () => (await tabsAt(APP)).length, { timeout: 20_000, message: 'a Browser tab at the link’s address' }).toBe(1);
      await expect(sideColumn(page).locator('[data-surface="browser"]'), 'the Browser surface beside the chat').toBeVisible({ timeout: 20_000 });
      await expect.poll(() => server.hits('/marker.html'), { timeout: 20_000, message: 'the page loaded in the tab' }).toBeGreaterThan(0);
      expect(handedOut(), 'nothing reached the system browser').toEqual([]);
      const before = await sessionTabs();

      // ⌘-click on a loopback address not open: the system browser; then a link off this Mac: the system browser too
      await link('the status').click({ modifiers: ['Meta'] });
      await expect.poll(handedOut, { timeout: 20_000, message: '⌘-click hands the link to the system browser' }).toEqual([`openExternal ${STATUS}`]);
      await link('the docs').click();
      await expect.poll(handedOut, { timeout: 20_000, message: 'a link off this Mac reaches the system browser' }).toEqual([`openExternal ${STATUS}`, `openExternal ${DOCS}`]);

      // `app.localhost` is this Mac's loopback too: its tab, its page loaded; and the session's tabs are what they were
      // and that one, so neither the ⌘-click nor the outside link opened a tab
      await link('the admin').click();
      await expect.poll(async () => (await tabsAt(ADMIN)).length, { timeout: 20_000, message: 'a Browser tab at app.localhost' }).toBe(1);
      await expect.poll(() => server.hits('/b.html'), { timeout: 20_000, message: 'its page loaded' }).toBeGreaterThan(0);
      expect((await sessionTabs()).sort(), 'the session’s tabs: those before, and app.localhost’s').toEqual([...before, ADMIN].sort());
      expect(server.hits('/c.html'), 'the ⌘-clicked page was never asked for here').toBe(0);
      expect(handedOut(), 'and nothing more handed out').toEqual([`openExternal ${STATUS}`, `openExternal ${DOCS}`]);
    } finally {
      await server.close();
    }
  });

  // UX wave U6b-4b (§G; L12, decision 14): a terminal opens a link only on ⌘-click, and a loopback link printed in a
  // terminal of a session on this Mac opens in its in-app browser, while a link off this Mac reaches the system browser
  // (main's open seam). The terminal draws on a canvas and the app has no harness, so the scene finds each link's cell
  // itself: the shell prints each address at a row and column the scene chooses (a cursor move after clearing the
  // screen), says the terminal's rows and columns (`stty size`), and the cell's point is taken from the box of the
  // terminal's `.xterm-screen`. What the shell printed is read from the terminals' e2e seam (`window.__maws_terminals`).
  // Waits on the printed lines, the session's tabs as main lists them, and the seam's lines.
  test('a loopback link ⌘-clicked in a terminal of a session on this Mac opens in its in-app browser; another link in the system browser', async () => {
    const server = await startBrowserServer();
    try {
      const port = new URL(server.origin).port;
      const LOCAL = `http://127.0.0.1:${port}/marker.html`;
      const ELSEWHERE = 'https://example.org';
      const [LOCAL_ROW, ELSEWHERE_ROW, COLUMN] = [6, 9, 4]; // where the shell prints each, one-based as the cursor moves are
      const { page, handedOut, tabsAt, sessionTabs } = await loopbackLaunch({ sid: '5e551011-0000-4000-8000-0000000000f2', reply: 'The app runs in the terminal.' });
      await expect(page.locator('[data-region="main"]').getByText('The app runs in the terminal.')).toBeVisible({ timeout: 20_000 });
      await openSurface(page, 'Terminal');
      const shown = surface(page, 'terminal').locator('[data-terminal-id]:visible');
      await expect(shown, 'one terminal in view').toHaveCount(1, { timeout: 20_000 });
      const id = (await shown.getAttribute('data-terminal-id'))!;
      await expect(surface(page, 'terminal').getByText('Starting shell…', { exact: true }), 'the shell has started').toHaveCount(0, { timeout: 20_000 });
      const lines = () => page.evaluate((tid) => (window as unknown as { __maws_terminals?: { lines(id: string): string[] | null } }).__maws_terminals?.lines(tid) ?? [], id);
      // The screen cleared first, so the typed line is gone before the addresses are placed; then the size, on a line marked
      // with the try's own number, so a line an earlier try left is never read as this one's (fix wave 1). A try is
      // accepted once its marked line and both addresses at their rows are on the screen together, read in one reading.
      type Placed = { rows: number; cols: number; viewport: string[] };
      const placed = (written: string[], attempt: number): Placed | null => {
        const marked = written.map((line) => new RegExp(`^U6B4B-SIZE-${attempt} (\\d+) (\\d+)$`).exec(line.trim())).find((match) => match !== null);
        if (!marked) return null;
        const [rows, cols] = [Number(marked[1]), Number(marked[2])];
        const viewport = written.slice(-rows); // the buffer's last `rows` lines are the screen
        const at = (row: number) => viewport[row - 1]?.slice(COLUMN - 1);
        return at(LOCAL_ROW) === LOCAL && at(ELSEWHERE_ROW) === ELSEWHERE ? { rows, cols, viewport } : null;
      };
      let attempt = 0;
      let screen: Placed | null = null;
      await expect(async () => {
        attempt += 1;
        const command = `printf '\\033[2J\\033[${LOCAL_ROW};${COLUMN}H%s\\033[${ELSEWHERE_ROW};${COLUMN}H%s\\033[12;1H' '${LOCAL}' '${ELSEWHERE}'; printf 'U6B4B-SIZE-${attempt} %s\\n' "$(stty size)"`;
        await surface(page, 'terminal').locator('[data-testid="terminal-surface"]').filter({ visible: true }).click();
        await page.keyboard.type(command);
        await page.keyboard.press('Enter');
        const tried = attempt;
        await expect.poll(async () => (screen = placed(await lines(), tried)) !== null, { timeout: 5_000 }).toBe(true);
      }).toPass({ timeout: 30_000 });
      const { rows, cols } = screen!;
      // A ⌘-click a few cells into the address, once the link under the pointer is hovered: xterm marks its screen
      // `xterm-cursor-pointer` while a link is hovered (@xterm/xterm 6.0.0, the linkifier's hover), so the click waits on
      // that state rather than on a time. A hover that has not taken is moved again.
      const commandClick = async (row: number) => {
        const screenOf = surface(page, 'terminal').locator(`[data-terminal-id="${id}"] .xterm-screen`);
        const box = (await screenOf.boundingBox())!;
        const [x, y] = [box.x + (COLUMN - 1 + 6.5) * (box.width / cols), box.y + (row - 0.5) * (box.height / rows)];
        await expect(async () => {
          await page.mouse.move(x - 3, y);
          await page.mouse.move(x, y);
          await expect(screenOf, 'the link under the pointer hovered').toHaveClass(/\bxterm-cursor-pointer\b/, { timeout: 2_000 });
        }).toPass({ timeout: 20_000 });
        await page.keyboard.down('Meta');
        await page.mouse.click(x, y);
        await page.keyboard.up('Meta');
      };

      await commandClick(LOCAL_ROW);
      await expect.poll(async () => (await tabsAt(LOCAL)).length, { timeout: 20_000, message: 'a Browser tab at the printed loopback address' }).toBe(1);
      await expect.poll(() => server.hits('/marker.html'), { timeout: 20_000, message: 'the page loaded in it' }).toBeGreaterThan(0);
      expect(handedOut(), 'nothing reached the system browser').toEqual([]);
      const tabsBefore = await sessionTabs();

      await openSurface(page, 'Terminal'); // the Browser took the side column's place
      await expect(surface(page, 'terminal').locator(`[data-terminal-id="${id}"]`)).toBeVisible();
      await commandClick(ELSEWHERE_ROW);
      await expect.poll(handedOut, { timeout: 20_000, message: 'the other link reaches the system browser' }).toEqual([`openExternal ${ELSEWHERE}`]);
      expect(await sessionTabs(), 'the session’s tabs as they were: the other link opened none').toEqual(tabsBefore);
      expect(tabsBefore.filter((url) => url === LOCAL), 'and the loopback one is there once').toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  // UX wave U6e (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §G; A3, A4, A7, A8, A11, and the
  // look's measures K1, K3, K11 to K15): File › Open File… asks main's chooser (the e2e pick seam, MAWS_E2E_PICK_PATHS,
  // read at each pick) and opens the chosen file beside the chat as a kept tab, savable; the Files list's menu row does
  // the same; a relaunch keeps the tab, its text and its saves (the grants are a file of the profile). A file of MAWS's
  // own profile reads "Read-only" with its panel and is never written. Where it is offered, and the geometry the owner's
  // look rests on, each measured on the drawn window. Every file is invented, in temporary folders.
  test('Open File… opens a chosen file beside the chat, it saves, and a relaunch keeps it', async () => {
    test.setTimeout(240_000);
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'maws-u6e-chosen-'))); // the chooser answers a real path
    try {
      // a deep folder, so the path is cut at a narrow column; a second file for the Files list's row; a folder of the
      // same name and bytes elsewhere, for the swap of A7
      const deep = join(outside, 'invented-notes', 'quarterly-plans', 'second-draft');
      mkdirSync(deep, { recursive: true });
      const chosen = join(deep, 'todo.txt');
      const second = join(outside, 'second.txt');
      const TODO = 'Ship the editor first.\n';
      writeFileSync(chosen, TODO);
      writeFileSync(second, 'A second invented file.\n');
      const S = '5e551011-0000-4000-8000-0000000000e8';
      await store.addTranscript(repo.root, S, [{ type: 'user', uuid: `u-${S}`, parentUuid: null, cwd: repo.root, sessionId: S, timestamp: '2026-11-14T10:00:00.000Z', message: { role: 'user', content: 'A session that links no file' } }]);
      const first = await launchCase({ fixtures: [], trusted: [repo.root], store });
      current = { ...first, repos: [repo] };
      const { page, maws } = first;
      assertPickSeamBuilt(maws);
      const pick = (path: string | null) => maws.app.evaluate((_electron, p) => void (process.env.MAWS_E2E_PICK_PATHS = p), path ?? ''); // empty: the seam answers cancelled
      // wide enough for the side column's widest (the Files tree beside a file needs 540 px of it), as a group's
      // MAWS_E2E_WINDOW_SIZE sets it (e2e/support/launch.ts)
      await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())!.setContentSize(1600, 900));
      await page.waitForFunction(() => window.innerWidth === 1600 && window.innerHeight === 900);
      const [s] = await indexed(page, [S]);

      await test.step('A11: with no session’s chat in front, File › Open File… is disabled; with one, enabled; under a page or the Overview, disabled', async () => {
        await expect.poll(() => menuEnabled(maws, 'file.open'), { message: 'no session in front' }).toBe(false);
        await (await sidebarRow(page, { appSessionId: s! })).click();
        await expect(page.getByRole('tab', { name: /^A session that links no file/ })).toHaveAttribute('aria-selected', 'true');
        await expect.poll(() => menuEnabled(maws, 'file.open'), { message: 'a session of this Mac in front' }).toBe(true);
        await openAppDestination(page, 'Customize');
        await expect.poll(() => menuEnabled(maws, 'file.open'), { message: 'a page over the session’s tab' }).toBe(false);
        await backToTabs(page);
        await expect.poll(() => menuEnabled(maws, 'file.open'), { message: 'the session’s chat in front again' }).toBe(true);
        // decision 15: the floating Overview over the session's chat (the toolbar's toggle)
        const overviewButton = page.locator('[data-toolbar]').getByRole('button', { name: 'Overview', exact: true });
        await overviewButton.click();
        await expect(page.getByRole('dialog', { name: 'Overview' })).toBeVisible();
        await expect.poll(() => menuEnabled(maws, 'file.open'), { message: 'the Overview over the session’s chat' }).toBe(false);
        await overviewButton.click();
        await expect(page.getByRole('dialog', { name: 'Overview' })).toHaveCount(0);
        await expect.poll(() => menuEnabled(maws, 'file.open'), { message: 'the Overview closed' }).toBe(true);
      });

      const strip = await tabIdsOf(page);
      const viewerOf = (path: string, scope: Locator = sideColumn(page)) => scope.locator(`[data-file-viewer][data-path="${path}"]`);
      const todo = viewerOf(chosen);
      const content = todo.locator('.cm-content');
      const saveButton = (viewer: Locator) => viewer.locator('[data-editor-controls]').getByRole('button', { name: 'Save', exact: true });

      await test.step('A3: cancelled, nothing opens; chosen, the file opens beside the chat as a kept tab and saves', async () => {
        await pick(null);
        await appMenu(maws, 'file.open');
        expect(value(await invoke(page, 'layout.openFile', { appSessionId: s! as never })), 'the seam unset: the chooser cancelled').toEqual({ status: 'cancelled' });
        await expect(sideColumn(page).locator('[data-file-viewer]'), 'a cancel opens nothing').toHaveCount(0);
        await expect(page.locator('[data-toast-viewport]').getByText(/Open File/), 'and says nothing').toHaveCount(0);

        await pick(chosen);
        await appMenu(maws, 'file.open');
        await expect(content).toHaveText(TODO.trimEnd(), { timeout: 20_000 });
        expect(await tabIdsOf(page), 'beside the chat: the main strip as it was').toEqual(strip);
        await expect(sideTab(sideColumn(page), 'todo.txt')).toHaveAttribute('title', chosen);
        await expect(sideColumn(page).locator('[data-side-strip] [data-tab-id][data-preview="true"]'), 'a kept tab, not the preview').toHaveCount(0);
        await expect(todo.locator('[data-path-lead]')).toHaveAttribute('title', `Save writes to ${chosen}`);
        await expect(todo).toHaveAttribute('data-editable', 'true');
        await expect(todo.locator('[data-read-only]')).toHaveCount(0);
        await content.click();
        await page.keyboard.press('Meta+a');
        await page.keyboard.type('Ship the editor first, then Open File.');
        await expect(todo).toHaveAttribute('data-dirty', 'true');
        expect(readFileSync(chosen, 'utf8'), 'nothing written before Save').toBe(TODO);
        await appMenu(maws, 'file.save');
        await expect.poll(() => readFileSync(chosen, 'utf8'), { timeout: 20_000, message: '⌘S wrote the chosen file' }).toBe('Ship the editor first, then Open File.');
        await expect(todo).toHaveAttribute('data-dirty', 'false');
      });

      await test.step('A3, K12: the Files list’s menu lies inside the tree at its real width, opened low and near its right edge; its row opens a second chosen file', async () => {
        await sideColumnAt(page, 'widest');
        const tree = sideColumn(page).locator('[data-files-tree][data-place="beside"]');
        await expect(tree, 'the tree at the file’s left, at its own width').toBeVisible({ timeout: 20_000 });
        const treeBox = await boxOf(tree);
        expect(treeBox.right - treeBox.left, `the tree no narrower than its least (tools/code/files/tree-state.ts): the column ${JSON.stringify(treeBox)}`).toBeGreaterThanOrEqual(160);
        // UX wave U6b-3b (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, Decision Log 13): the column holds
        // Go to file's field above the tree's list, and the menu is the list's (its trigger, and its collision boundary), so
        // the presses and the bound are the list's box, under the field
        const listBox = await boxOf(tree.locator('[data-tool="files"]'));
        const filesMenu = page.locator('[data-files-menu]');
        for (const [x, y, where] of [[listBox.left + 8, listBox.bottom - 8, 'low in the tree'], [listBox.right - 12, listBox.bottom - 8, 'low, near the right edge'], [listBox.right - 12, listBox.top + 48, 'near the right edge']] as const) {
          await page.mouse.click(x, y, { button: 'right' });
          await expect(filesMenu, where).toBeVisible();
          await expect(filesMenu.locator('[data-open-file]'), 'one row, no chord').toHaveText('Open File…');
          const menuBox = await boxOf(filesMenu);
          expectInside(menuBox, listBox, `the menu opened ${where} (the menu ${JSON.stringify(menuBox)}, the list ${JSON.stringify(listBox)}, the column ${JSON.stringify(treeBox)})`);
          await page.keyboard.press('Escape');
          await expect(filesMenu).toHaveCount(0);
        }
        await pick(second);
        await page.mouse.click(listBox.right - 12, listBox.bottom - 8, { button: 'right' }); // clear of the divider, which straddles the tree's edge
        await filesMenu.locator('[data-open-file]').click();
        await expect(viewerOf(second).locator('.cm-content'), 'the row opened the chosen file beside the chat').toHaveText('A second invented file.', { timeout: 20_000 });
        await expect(sideTab(sideColumn(page), 'second.txt')).toHaveAttribute('aria-selected', 'true');
        await expect(sideColumn(page).locator('[data-side-strip] [data-tab-id][data-preview="true"]'), 'kept').toHaveCount(0);
        expect(await tabIdsOf(page)).toEqual(strip);
        await sideTab(sideColumn(page), 'todo.txt').click();
        await expect(content).toHaveText('Ship the editor first, then Open File.');
      });
      expect(maws.consoleErrors()).toEqual([]);
      await maws.app.close();

      const again = await launchCase({ fixtures: [], trusted: [repo.root], store, userData: maws.userData });
      current = { ...again, repos: [repo], dispose: async () => (await again.maws.cleanup(), await maws.cleanup()) };
      const p2 = again.page;
      const m2 = again.maws;
      assertPickSeamBuilt(m2);
      await m2.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())!.setContentSize(1600, 900));
      await p2.waitForFunction(() => window.innerWidth === 1600 && window.innerHeight === 900);
      const pick2 = (path: string) => m2.app.evaluate((_electron, p) => void (process.env.MAWS_E2E_PICK_PATHS = p), path);
      const side2 = () => sideColumn(p2);
      const todo2 = side2().locator(`[data-file-viewer][data-path="${chosen}"]`);
      const content2 = todo2.locator('.cm-content');
      await test.step('A4: a relaunch brings the tab back with the saved text, and it saves again', async () => {
        await expect(sideTab(side2(), 'todo.txt'), 'the chosen file’s tab is back beside the chat').toBeVisible({ timeout: 20_000 });
        await sideTab(side2(), 'todo.txt').click();
        await expect(content2).toHaveText('Ship the editor first, then Open File.', { timeout: 20_000 });
        await expect(todo2).toHaveAttribute('data-editable', 'true');
        await expect(todo2.locator('[data-path-lead]')).toHaveAttribute('title', `Save writes to ${chosen}`);
        await content2.click();
        await p2.keyboard.press('Meta+End');
        await p2.keyboard.type(' Kept across a relaunch.');
        await appMenu(m2, 'file.save');
        await expect.poll(() => readFileSync(chosen, 'utf8'), { timeout: 20_000, message: 'the restored tab saves' }).toBe('Ship the editor first, then Open File. Kept across a relaunch.');
        await expect(todo2).toHaveAttribute('data-dirty', 'false');
      });

      await test.step('A8, K2, K12, K13: a file of the profile opens read-only; "Read-only" opens its panel, inside the column at 360 and 320 px; it is never written', async () => {
        const OWN = 'An invented note in the profile folder.\n';
        writeFileSync(join(m2.userData, 'u6e-own-notes.txt'), OWN);
        const own = realpathSync(join(m2.userData, 'u6e-own-notes.txt'));
        await pick2(own);
        await appMenu(m2, 'file.open');
        const ownViewer = side2().locator(`[data-file-viewer][data-path="${own}"]`);
        const ownContent = ownViewer.locator('.cm-content');
        await expect(ownContent).toHaveText(OWN.trimEnd(), { timeout: 20_000 });
        const label = ownViewer.locator('[data-read-only="maws"]');
        await expect(label).toHaveText('Read-only');
        await expect(label).toHaveAttribute('aria-description', MAWS_OWN_SENTENCE);
        expect((await boxOf(label)).right, 'K2: "Read-only" before the path').toBeLessThanOrEqual((await boxOf(ownViewer.locator('[data-path-lead]'))).left + 0.5);
        await expect(ownViewer).toHaveAttribute('data-editable', 'false');
        await expect(ownContent).toHaveAttribute('title', MAWS_OWN);
        await ownContent.click();
        await p2.keyboard.type('xyz');
        await expect(ownContent).toHaveText(OWN.trimEnd());
        await expect(ownViewer).toHaveAttribute('data-dirty', 'false');
        await expect(ownViewer.locator('[data-editor-controls]'), 'no Save on a file that cannot be saved').toHaveCount(0);
        const panel = p2.locator('[data-read-only-panel]');
        for (const width of [360, 320]) {
          await sideColumnAt(p2, width);
          await label.click();
          await expect(panel).toBeVisible();
          await expect(panel).toHaveText(MAWS_OWN_SENTENCE);
          await expect(panel.getByRole('button'), 'no Open File… where choosing the file changes nothing').toHaveCount(0);
          expectInside(await boxOf(panel), await boxOf(ownViewer), `the panel at a ${width} px column`);
          await p2.keyboard.press('Escape');
          await expect(panel).toHaveCount(0);
        }
        const hash = sha256Of(readFileSync(own));
        expect(await invoke(p2, 'files.writeOutside', { appSessionId: s! as never, path: own, real: own, content: 'overwritten', expectedHash: hash }), 'files.writeOutside refuses MAWS’s own file').toMatchObject({ ok: false, error: { message: `not writable: ${own}` } });
        expect(await invoke(p2, 'files.write', { appSessionId: s! as never, path: own, content: 'overwritten', expectedHash: hash }), 'and so does files.write').toMatchObject({ ok: false });
        expect(readFileSync(own, 'utf8'), 'the bytes as they were').toBe(OWN);
      });

      await test.step('K11, A1: at a 320 px column the bar keeps the path, cut in its middle with both ends drawn and no stray glyph; its description the whole path', async () => {
        await sideTab(side2(), 'todo.txt').click();
        await expect(content2).toHaveText('Ship the editor first, then Open File. Kept across a relaunch.');
        await sideColumnAt(p2, 320);
        const lead = todo2.locator('[data-path-lead]');
        await expect(lead).toHaveAttribute('aria-description', `Save writes to ${chosen}`);
        await expect(lead).toHaveAttribute('title', `Save writes to ${chosen}`);
        const drawn = await lead.evaluate((el) => {
          const [folder, , name] = Array.from(el.children) as HTMLElement[];
          const rect = (node: Element) => node.getBoundingClientRect();
          const box = (node: Element) => ({ left: rect(node).left, top: rect(node).top, right: rect(node).right, bottom: rect(node).bottom });
          const style = getComputedStyle(folder!);
          return {
            lead: { left: rect(el).left, right: rect(el).right },
            boxes: { lead: box(el), bar: box(el.parentElement!), viewer: box(el.closest('[data-file-viewer]')!) },
            folder: { text: folder!.textContent, left: rect(folder!).left, width: rect(folder!).width, cut: folder!.scrollWidth > folder!.clientWidth, clipped: [style.textOverflow, style.overflowX] },
            name: { text: name!.textContent, right: rect(name!).right, whole: name!.scrollWidth <= name!.clientWidth },
            ch: rect(name!).width / Math.max(1, name!.textContent?.length ?? 1), // the mono font's character, from the name drawn whole
          };
        });
        expect(drawn.folder.text, 'the folder part holds the whole folder').toBe(dirname(chosen));
        expect(drawn.folder.cut, 'cut where the column is narrow').toBe(true);
        expect(drawn.folder.clipped, 'the folder part clipped with an ellipsis').toEqual(['ellipsis', 'hidden']);
        expectInside(drawn.boxes.lead, drawn.boxes.bar, 'the path inside the bar');
        expectInside(drawn.boxes.bar, drawn.boxes.viewer, 'the bar inside the file viewer');
        expect(drawn.folder.left, 'the path’s start drawn').toBeCloseTo(drawn.lead.left, 0);
        expect([drawn.name.text, drawn.name.whole], 'the name drawn whole').toEqual(['todo.txt', true]);
        expect(drawn.name.right, 'the path’s end drawn, inside the bar').toBeLessThanOrEqual(drawn.lead.right + 0.5);
        expect(drawn.folder.width, 'K11: two characters at the cut, so no lone glyph').toBeGreaterThanOrEqual(2 * drawn.ch - 0.5);
      });

      await test.step('A7, K1, K3, K14, K15: a save the path no longer leads to fails on a line of its own, whole, in a side tab and a main tab, Save and View one group; the path put back, it saves', async () => {
        await content2.click();
        await p2.keyboard.press('Meta+End');
        await p2.keyboard.type(' Then the swap.');
        await expect(todo2).toHaveAttribute('data-dirty', 'true');
        // a folder on the path swapped for a link to a folder that holds a file of the same name and bytes
        const elsewhere = join(outside, 'elsewhere');
        mkdirSync(elsewhere);
        writeFileSync(join(elsewhere, 'todo.txt'), readFileSync(chosen));
        renameSync(deep, `${deep}-was`);
        symlinkSync(elsewhere, deep);
        const bytes = () => [readFileSync(join(`${deep}-was`, 'todo.txt'), 'utf8'), readFileSync(join(elsewhere, 'todo.txt'), 'utf8')];
        const before = bytes();
        const failure = (viewer: Locator) => viewer.getByRole('alert').filter({ hasText: 'Could not save' });
        await saveButton(todo2).click();
        await expect(failure(todo2)).toHaveText(`Could not save: ${OUTSIDE_REFUSED}`, { timeout: 20_000 });
        expect(bytes(), 'both files unchanged').toEqual(before);
        await expect(todo2, 'the edit still in the tab').toHaveAttribute('data-dirty', 'true');
        await expectFailureLine(todo2, 'a side tab at a 320 px column', false);

        await todo2.locator('[data-move-to-main]').click();
        const machine = await localRef(p2);
        await expect(mainTabById(p2, `file:${machine}:${chosen}`), 'moved to the main area, in front').toHaveAttribute('aria-selected', 'true', { timeout: 20_000 });
        await expect(mainTabById(p2, `file:${machine}:${chosen}`), 'its tooltip the full path').toHaveAttribute('title', chosen);
        const inMain = p2.locator('[data-region="main"]').locator(`[data-file-viewer][data-path="${chosen}"]`);
        await expect(inMain).toHaveAttribute('data-dirty', 'true', { timeout: 20_000 });
        await saveButton(inMain).click();
        await expect(failure(inMain)).toHaveText(`Could not save: ${OUTSIDE_REFUSED}`, { timeout: 20_000 });
        expect(bytes(), 'both files unchanged').toEqual(before);
        await expectFailureLine(inMain, 'a main tab', true);

        unlinkSync(deep);
        renameSync(`${deep}-was`, deep);
        await saveButton(inMain).click();
        await expect.poll(() => readFileSync(chosen, 'utf8'), { timeout: 20_000, message: 'the path put back: the save lands' }).toBe('Ship the editor first, then Open File. Kept across a relaunch. Then the swap.');
        expect(readFileSync(join(elsewhere, 'todo.txt'), 'utf8'), 'the other file untouched').toBe(before[1]);
        await expect(inMain).toHaveAttribute('data-dirty', 'false');
        await expect(failure(inMain)).toHaveCount(0);
      });
      expect(m2.consoleErrors()).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  // The UX wave, U9 (docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, M3; the section's A3 and A6, O-11b):
  // a first read of a session on this Mac that fails because its engine host is away says "Loading…" while it waits, is
  // made again at the host's next ready, and loads with no click; one that has waited past 15 s says "Couldn’t load this
  // conversation" with Retry, and a later ready still loads it, again with no click. The host is taken away as C1's
  // ladder leaves it: three unexpected exits within a minute and it stays crashed, so main answers its reads
  // `host_unavailable` until Restart now (`host.restart`, the banners' and Diagnostics' act). Each step settles on what the
  // app shows: the host's state as main reports it, and the pane's words and rows.
  test('U9 A3 and A6: a first read the engine host’s absence failed says Loading…, and heals at the host’s next ready; one past 15 s says it could not load, and a later ready still loads it', async () => {
    test.setTimeout(240_000);
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const sids = { soon: '5e551011-0000-4000-8000-0000000000a6', late: '5e551011-0000-4000-8000-0000000000a7' } as const;
    const words = { soon: 'Read again at the host’s next ready', late: 'Read again at a later ready' } as const;
    for (const key of ['soon', 'late'] as const) {
      const sid = sids[key];
      await store.addTranscript(repo.root, sid, [{ type: 'user', uuid: `u-${sid}`, parentUuid: null, cwd: repo.root, sessionId: sid, timestamp: '2026-11-13T10:00:00.000Z', message: { role: 'user', content: words[key] } }]);
    }
    const launched = await launchCase({ fixtures: [], trusted: [repo.root], store });
    current = { ...launched, repos: [repo] };
    const { page } = launched;
    const main = page.locator('[data-region="main"]');
    await expect.poll(async () => value(await invoke(page, 'session.list', {})).sessions.filter((r) => r.engineSessionId === sids.soon || r.engineSessionId === sids.late).length, { timeout: 20_000 }).toBe(2);
    const listed = value(await invoke(page, 'session.list', {})).sessions;
    const appOf = (key: 'soon' | 'late') => listed.find((r) => r.engineSessionId === sids[key])!.appId;
    const host = async () => value(await invoke(page, 'engine.hostState', undefined));
    // C1's ladder to its limit: each exit is waited out to the successor's ready, and the third within the minute leaves
    // the host crashed for good
    const crashForGood = async () => {
      let killed: number | null = null;
      for (let exits = 0; exits < 5; exits++) {
        let now = await host();
        await expect
          .poll(async () => ((now = await host()).state === 'crashed' || (now.state === 'ready' && now.pid !== killed) ? now.state : `${now.state} ${now.pid}`), { timeout: 30_000, message: `the engine host after ${exits} exits` })
          .toMatch(/^(ready|crashed)$/);
        if (now.state === 'crashed') return;
        killed = now.pid!;
        // only the scene's own engine host: a process whose command line names this launch's profile
        expect(processesNaming(launched.maws.userData).map((p) => p.pid), `pid ${killed} is this launch's engine host`).toContain(killed);
        process.kill(killed, 'SIGKILL');
      }
      throw new Error('the engine host was not left crashed by its exits');
    };
    const restart = async () => {
      value(await invoke(page, 'host.restart', { stopSessions: true }));
      await expect.poll(async () => (await host()).state, { timeout: 30_000, message: 'the engine host is ready again' }).toBe('ready');
    };
    // the transcript's words (src/renderer/src/transcript/model/copy.ts's HYDRATION); the word cut (T111): the wait is a
    // quiet spinner named by them, drawn from half a second into the read
    const loading = main.getByRole('progressbar', { name: 'Loading…', exact: true });
    const failed = main.getByRole('alert').filter({ hasText: 'Couldn’t load this conversation' });

    await test.step('opened while the host is away: Loading…, and its rows once the host is back, with no click', async () => {
      await crashForGood();
      await (await sidebarRow(page, { appSessionId: appOf('soon') })).click();
      await expect(loading, 'the pane says it is loading while its read waits for the host').toBeVisible({ timeout: 10_000 });
      await expect(failed).toHaveCount(0);
      await restart();
      await expect(main.getByText(words.soon, { exact: true }), 'read again at the next ready').toBeVisible({ timeout: 30_000 });
      await expect(loading).toHaveCount(0);
      await expect(failed).toHaveCount(0);
    });

    await test.step('past 15 s with no ready: it could not load, with Retry; a later ready still loads it, with no click', async () => {
      await crashForGood();
      await (await sidebarRow(page, { appSessionId: appOf('late') })).click();
      await expect(loading, 'Loading… while it waits').toBeVisible({ timeout: 10_000 });
      await expect(failed, 'the wait ran out (15 s, and margin for a loaded Mac)').toBeVisible({ timeout: 45_000 });
      await expect(failed.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
      await restart();
      await expect(main.getByText(words.late, { exact: true }), 'a later ready loads it').toBeVisible({ timeout: 30_000 });
      await expect(failed).toHaveCount(0);
    });
  });
});
