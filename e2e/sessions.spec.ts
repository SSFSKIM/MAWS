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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { fixtureIdentity } from '../test/support/fixture-session-id';
import { runGit } from '../test/support/git-fixture';
import { ScratchRepo } from '../test/support/scratch-repo';
import { StoreFixture } from '../test/support/store-fixture';
import { launchMaws, REPO_ROOT, test, type MawsLaunch } from './support/launch';
import { newChatIn, openProject, projectLine, projectRow, showProjectList, sidebarRow } from './support/sidebar';

const FIXTURES = 'spikes/protocol-probe/fixtures';
const AUTO_ROUTED = `${FIXTURES}/pass2/auto-routed.jsonl`;
const BOOTSTRAP = `${FIXTURES}/pass3/trust-bootstrap-recorded.jsonl`;
const FORK_START = `${FIXTURES}/pass3/fork-pinned-id-start.jsonl`;
const FORK_FORK = `${FIXTURES}/pass3/fork-pinned-id-fork.jsonl`;
const READ_ONLY = `${FIXTURES}/pass3/read-only-permission.jsonl`;

function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<CommandResult<N>> {
  return page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const) as Promise<CommandResult<N>>;
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
// Every journal row of a session, oldest file first.
function journal(maws: MawsLaunch, appSessionId: string): Row[] {
  const dir = join(maws.userData, 'engine-host', 'journal', appSessionId);
  return readdirSync(dir)
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
const row = (page: Page, id: string) => page.locator(`[data-region="sidebar"] [data-menu="session:${id}"]`);

// Every text a transcript's load-failure alert showed (the alert stays until Retry), from before the first start: a
// session started through "+" hydrates once the engine host knows it, never failing on an id not yet launched or bound.
async function watchTranscriptFailures(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __loadFailures: string[] }).__loadFailures = seen;
    const note = () =>
      document.querySelectorAll('[role="alert"]').forEach((node) => {
        const text = (node.textContent ?? '').trim();
        if (text.startsWith('Could not load this transcript') && !seen.includes(text)) seen.push(text);
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

// A replayed launch's record carries the route C3's prelude verified, so a fork of it is routed and meets the relay
// pre-check: when this Mac's relay is down, the fork's tab docks the relay card, and "Run direct" goes on.
async function passRelay(page: Page): Promise<void> {
  const health = value(await invoke(page, 'engine.relayHealth', { force: true }));
  if (health.ok) return;
  const card = page.getByRole('group', { name: 'Relay not answering' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Run direct' }).click();
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
    await expect(row(page, id), 'an unstarted session has no sidebar row').toHaveCount(0);
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
    await expect(row(page, id)).toBeVisible();
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
    await expect(row(page, id)).toBeVisible();
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
    await startDirect(page, source);
    await untilPhase(page, source, 'ready');
    await expect(row(page, source)).toBeVisible();

    await menu(page, source, 'Fork');
    const fork = await forkOf(page, source);
    await passRelay(page);
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
    await expect(page.getByRole('tab')).toHaveCount(2); // the source, the fork (W5: the Overview is no tab)
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
    await expect(row(page, id)).toHaveCount(0);
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
    await expect(row(page, id)).toBeVisible();
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
    await expect(row(page, renamed.appId)).toHaveAttribute('aria-label', 'C10 override');
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
    await expect(row(page, gone.appId)).toHaveCount(0);
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
    await expect(page.getByRole('menuitem')).toHaveText(['Open', 'Attach in a terminal tab']);
    await page.keyboard.press('Escape');
    await row(page, id).click();
    const notice = page.locator('[data-region="main"]').getByRole('note');
    await expect(notice).toContainText(`Live as background job · pid ${pid} · read-only`);
    await notice.getByRole('button', { name: 'Attach in a terminal tab' }).click();
    const reachedShell = () => (existsSync(reached) ? readFileSync(reached, 'utf8') : '');
    await expect.poll(reachedShell, { timeout: 10_000 }).toBe(`${realpathSync(jobDir)}\n${command}\n`);
    const ptys = async () => value(await invoke(page, 'pty.list', undefined)).ptys.filter((p) => p.appSessionId === id && p.alive);
    const [pty] = await ptys();
    // the panel's list as C5 persists it (written a moment after the change)
    const panel = async () => value(await invoke(page, 'layout.get', { key: `panel.${id}` })).value as { tabs: { id: string; toolId: string }[]; activeTabId: string | null } | null;
    await expect.poll(panel, { message: 'one Terminal tab, selected, whose id is the pty’s label' }).toEqual({ tabs: [{ id: pty!.label, toolId: 'terminal', pinned: false }], activeTabId: pty!.label });
    // the shell is at its prompt (the attach was left): a second Attach runs it again in the same tab
    await notice.getByRole('button', { name: 'Attach in a terminal tab' }).click();
    await expect.poll(reachedShell, { timeout: 10_000 }).toBe(`${realpathSync(jobDir)}\n${command}\n${command}\n`);
    expect((await ptys()).map((p) => p.ptyId), 'no second pty').toEqual([pty!.ptyId]);
    // a reload keeps the tab and its shell (C9 re-adopts it under the tab id) and the layout remembers whose attach it is
    await expect.poll(async () => value(await invoke(page, 'layout.get', { key: 'sessions.attachTabs' })).value).toEqual({ version: 1, tabs: [{ tabId: pty!.label, appSessionId: id, jobId: 'e6dcd828' }] });
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
    await expect(page.getByRole('menuitem')).toHaveText(['Open']);
    await page.keyboard.press('Escape');
    await store.removeRegistryRecord(pid);
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
    await expect(page.getByRole('tab', { name: `New chat · ${alpha.name}` }), 'the tab names the project too').toBeVisible();
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
    await page.getByRole('button', { name: 'Add project' }).first().click();
    await expect.poll(async () => value(await invoke(page, 'session.projects.list', undefined)).projects.length, { message: 'a cancelled pick adds nothing' }).toBe(0);
    await maws.app.evaluate((_electron, dir) => void (process.env.MAWS_E2E_PICK_PATHS = dir), repo.root);
    await page.getByRole('button', { name: 'Add project' }).first().click();
    await expect.poll(async () => value(await invoke(page, 'session.projects.list', undefined)).projects.map((p) => p.directory)).toEqual([repo.root]);
    const [added] = value(await invoke(page, 'session.projects.list', undefined)).projects;
    await expect(projectRow(page, added!.name)).toBeVisible();
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('an unstarted tab with a draft survives a relaunch', async () => {
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const first = await launchCase({ fixtures: [], trusted: [repo.root], store });
    current = { ...first, repos: [repo] };
    const project = await addProject(first.page, repo.root);
    const id = await plus(first.page, project.name);
    await expect(editor(first.page), 'W9 (H3): the project row\'s "+" hands the keyboard to the new tab').toBeFocused();
    await first.page.keyboard.type('half a thought');
    // C7 keeps an unstarted session's draft through C10's hook (the intent), written a moment after the typing
    await expect.poll(async () => JSON.stringify(value(await invoke(first.page, 'session.intent.get', { appSessionId: id }))!.draft)).toContain('half a thought');
    await expect.poll(async () => JSON.stringify(value(await invoke(first.page, 'layout.get', { key: 'main.tabs' })).value)).toContain(id);
    await first.maws.app.close();

    const second = await launchCase({ fixtures: [], trusted: [repo.root], store, userData: first.maws.userData });
    current = { ...second, repos: [repo], dispose: async () => (await second.maws.cleanup(), await first.maws.cleanup()) };
    await expect(second.page.getByRole('heading', { name: `New chat in ${project.name}` }), 'hydration kept the unstarted tab').toBeVisible();
    await expect(editor(second.page), 'the draft is back in the editor').toHaveText('half a thought');
    expect(second.maws.consoleErrors()).toEqual([]);
  });

  test("C5's acceptance item 10, replay clause: a replayed read-only request reaches the session's row through a recorded session and its hover card's Approve answers the broker", async () => {
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
    const entry = row(page, id);
    await expect(entry.getByRole('img', { name: 'Needs approval' })).toBeVisible({ timeout: 20_000 });
    const card = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Read' }) });
    await expect(async () => {
      await page.mouse.move(700, 400);
      await entry.hover();
      await expect(card).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 10_000 });
    await expect(card.getByText('Approval needed')).toBeVisible();
    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(entry.getByRole('img', { name: 'Needs approval' })).toHaveCount(0);
    await turnEnded(page, id);
  });
});
