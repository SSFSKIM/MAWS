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
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { slugOf } from '../src/engine-host/fs/paths';
import { fixtureIdentity } from '../test/support/fixture-session-id';
import { runGit } from '../test/support/git-fixture';
import { ScratchRepo } from '../test/support/scratch-repo';
import { StoreFixture } from '../test/support/store-fixture';
import { addressed, localRef } from './support/address';
import { launchMaws, REPO_ROOT, test, type MawsLaunch } from './support/launch';
import { slashPaletteMovesNothing } from './support/palette-geometry';
import { clickRevealed } from './support/hover';
import { activeMainTab, mainTabById, mainTabs } from './support/shell';
import { processesNaming } from './support/processes'; // the UX wave, U9: A6's scene signals only its own engine host
import { backgroundAgentRecords, backgroundAgentSidecars, turnEndRecords, userRecord } from './support/lane-a';
import { newChatIn, openProject, projectLine, projectRow, showProjectList, sidebarRow } from './support/sidebar';

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
    await expect(page.getByRole('menuitem')).toHaveText(['Open', 'Open in new tab', 'Attach in a terminal tab', 'Hide']); // W12 I2: Open in new tab beside Open; UX wave U7, O-16: Hide after the opens
    await page.keyboard.press('Escape');
    await (await row(page, id)).click();
    const notice = page.locator('[data-region="main"]').getByRole('note');
    await expect(notice).toContainText(`Live as background job · pid ${pid} · read-only`);
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
    await expect(notice).toContainText(`Live in Terminal · pid ${pid} · read-only`, { timeout: 5_000 });
    await expect(notice.getByRole('button', { name: 'Attach in a terminal tab' })).toHaveCount(0);
    await expect(notice.getByRole('button', { name: 'Fork a copy' })).toBeVisible();
    await (await sidebarRow(page, { appSessionId: id })).click({ button: 'right' });
    await expect(page.getByRole('menuitem')).toHaveText(['Open', 'Open in new tab', 'Hide']); // UX wave U7, O-16
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
    await expect(main.getByRole('note')).toContainText(`Live in Terminal · pid ${pid} · read-only`, { timeout: 10_000 });
    const agentRow = main.locator('.transcript-subagent', { hasText: agent.description });
    await expect(agentRow, 'the turn ended while its agent works: the call stays in view').toContainText(`${agent.description} started working`, { timeout: 15_000 });

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

  // UX wave U6c (docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, Interfaces §E; A1 to A4): on this Mac a
  // file outside the session's folder opens, read-only, when the session's own transcript links it, and nothing else
  // there opens: not a path written in prose, not one linked only in a message that was typed and never delivered, not
  // one another session links, not a request that does not ask by the rule; its folder is not listed and the file is
  // not written. Every file and both transcripts are invented, in temporary folders.
  test("a file the transcript links opens read-only from outside the session's folder, and nothing else does", async () => {
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'maws-u6c-outside-'))); // the open log takes the real path
    try {
      const file = (name: string) => join(outside, name);
      const NOTES = 'Invented notes, kept outside the session’s folder.';
      const texts: Record<string, string> = {
        'notes.txt': `${NOTES}\n`, 'report.pdf': '%PDF-1.4\n% an invented report\n', 'unnamed.txt': 'never linked\n', 'typed-only.txt': 'typed, never sent\n', key: 'an invented key\n', 'key,backup': 'an invented backup\n',
      };
      for (const [name, text] of Object.entries(texts)) writeFileSync(file(name), text);
      const S = '5e551011-0000-4000-8000-0000000000e6';
      const T = '5e551011-0000-4000-8000-0000000000e7';
      const at = '2026-11-13T10:00:00.000Z';
      const row = (sessionId: string) => ({ cwd: repo.root, sessionId, timestamp: at, isSidechain: false, userType: 'external', version: '2.1.300' });
      const reply = `Here are [the notes](${file('notes.txt')}), [the report](${file('report.pdf')}) and [the backup](${file('key,backup')}). The other one is ${file('unnamed.txt')}.`;
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

      await chip('notes.txt').click();
      const machine = await localRef(page);
      await expect(mainTabById(page, `file:${machine}:${file('notes.txt')}`), 'a file tab of the strip, in front').toHaveAttribute('aria-selected', 'true');
      const notes = main.locator(`[data-file-viewer][data-path="${file('notes.txt')}"]`);
      const content = notes.locator('.cm-content');
      await expect(content).toHaveText(NOTES, { timeout: 20_000 });
      await expect(notes).toHaveAttribute('data-editable', 'false');
      await expect(content).toHaveAttribute('title', 'Read-only: the file is outside the folders this session works in');
      await content.click();
      await page.keyboard.type('xyz');
      await expect(content).toHaveText(NOTES);
      await expect(notes).toHaveAttribute('data-dirty', 'false');
      await expect(notes.locator('[data-editor-controls]')).toHaveCount(0);

      await mainTabById(page, sessionTabId!).click();
      await chip('report.pdf').click();
      const report = main.locator(`[data-file-viewer][data-path="${file('report.pdf')}"]`);
      await expect(report.locator('[data-external-row]')).toContainText('PDF files open outside MAWS', { timeout: 20_000 });
      await report.getByRole('button', { name: 'Open externally' }).click();
      await expect.poll(() => readFileSync(openLog, { encoding: 'utf8', flag: 'a+' }), { timeout: 20_000 }).toBe(`${file('report.pdf')}\n`);

      const refusal = { ok: false, error: { code: 'internal', message: "path outside the session's directories" } };
      const read = (appSessionId: string, name: string, named: boolean) => invoke(page, 'files.read', { appSessionId: appSessionId as never, path: file(name), ...(named ? { named: true as const } : {}) });
      expect(await read(s!, 'unnamed.txt', true), 'written only in prose').toMatchObject(refusal);
      expect(await read(s!, 'typed-only.txt', true), 'linked only in a message never delivered').toMatchObject(refusal);
      expect(await read(s!, 'key', true), 'the start of a longer linked name').toMatchObject(refusal);
      expect(await read(t!, 'notes.txt', true), 'linked only in another session').toMatchObject(refusal);
      expect(await read(s!, 'notes.txt', false), 'asked without the key').toMatchObject(refusal);
      expect(await invoke(page, 'files.list', { appSessionId: s! as never, path: outside }), 'its folder is not listed').toMatchObject(refusal);
      expect(await invoke(page, 'files.write', { appSessionId: s! as never, path: file('notes.txt'), content: 'overwritten', expectedHash: '0'.repeat(64) }), 'nor is it written').toMatchObject(refusal);
      expect(readFileSync(file('notes.txt'), 'utf8')).toBe(texts['notes.txt']);
      expect(maws.consoleErrors()).toEqual([]);
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
    // the transcript's words (src/renderer/src/transcript/model/copy.ts's HYDRATION)
    const loading = main.getByRole('status').filter({ hasText: /^Loading…$/ });
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
