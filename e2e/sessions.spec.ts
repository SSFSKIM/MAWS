// C10's end-to-end spec (C10 execution document, M4; M4a's half: every start goes through `window.maws.invoke`; the
// first send through C7's composer is M4b's). Each case launches the built app with the replay transport
// (`MAWS_ENGINE_REPLAY=1`) and its own `MAWS_E2E_REPLAY_FIXTURES` (M3's seam: each launch takes the next fixture and
// pins its recorded id), a temp config home (`CLAUDE_CONFIG_DIR`) holding a synthetic `.claude.json` and any
// transcripts the case needs, a throwaway profile, and scratch repositories under the temp root. No engine runs; the
// owner's `~/.claude`, `~/.claude.json` and checkouts are never read or written. The Trash is per user, so what moves
// there is asserted by absence.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { fixtureIdentity } from '../test/support/fixture-session-id';
import { runGit } from '../test/support/git-fixture';
import { ScratchRepo } from '../test/support/scratch-repo';
import { StoreFixture } from '../test/support/store-fixture';
import { launchMaws, test, type MawsLaunch } from './support/launch';

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
  repos: ScratchRepo[];
  dispose(): Promise<void>;
}

// One launch over a temp config home trusting `trusted`, with the case's replay fixtures in launch order.
async function launchCase(opts: { fixtures: string[]; trusted: string[]; userData?: string; store?: StoreFixture }): Promise<Omit<Case, 'repos'>> {
  const store = opts.store ?? (await StoreFixture.create());
  writeFileSync(join(store.configHome, '.claude.json'), `${JSON.stringify({ projects: Object.fromEntries(opts.trusted.map((key) => [key, { hasTrustDialogAccepted: true }])) }, null, 2)}\n`);
  const maws = await launchMaws({
    env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: opts.fixtures.join(','), CLAUDE_CONFIG_DIR: store.configHome },
    ...(opts.userData ? { userData: opts.userData } : {}),
  });
  await expect(maws.page.locator('[data-region="main"]')).toBeVisible();
  await collectSetup(maws.page);
  return { maws, page: maws.page, store, dispose: () => maws.cleanup() };
}

async function addProject(page: Page, directory: string): Promise<{ id: string; name: string }> {
  const project = value(await invoke(page, 'session.projects.add', { directory }));
  return { id: project.id, name: project.name };
}

// "+" on the project: C5's createSession runs C10's creator; the tab opens on the unstarted session's heading.
async function plus(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: `New session in ${name}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: `New session in ${name}` })).toBeVisible();
  const intents = value(await invoke(page, 'session.intent.list', undefined)).intents;
  return intents.at(-1)!.appSessionId;
}

// The chips are C7's: until M4b the case sets the intent through the same command they call. Direct, so the relay
// pre-check never depends on whether this Mac's relay is up (the replay transport ignores the route).
async function startDirect(page: Page, id: string, patch: CommandInput<'session.intent.patch'>['patch'] = {}, message: CommandInput<'session.start'>['message'] = null) {
  value(await invoke(page, 'session.intent.patch', { appSessionId: id, patch: { gateway: 'direct', ...patch } }));
  return value(await invoke(page, 'session.start', { appSessionId: id, message, options: {} }));
}

const row = (page: Page, id: string) => page.locator(`[data-menu="session:${id}"]`);

async function menu(page: Page, id: string, item: string): Promise<void> {
  await row(page, id).click({ button: 'right' });
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

// A replayed launch's record carries the route C3's prelude verified, so a fork of it is routed and meets the relay
// pre-check: when this Mac's relay is down, the fork's tab docks the relay card, and "Run direct" goes on.
async function passRelay(page: Page): Promise<void> {
  const health = value(await invoke(page, 'engine.relayHealth', { force: true }));
  if (health.ok) return;
  const card = page.getByRole('region', { name: 'Relay not answering' });
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

  test('new worktree: the location creates the worktree and the launch runs in it, unattested in a trusted repository', async () => {
    const { page, maws, trustedRepos } = await begin({ fixtures: [AUTO_ROUTED] });
    const repo = trustedRepos[0]!;
    const project = await addProject(page, repo.root);
    const id = await plus(page, project.name);
    await expect(row(page, id), 'an unstarted session has no sidebar row').toHaveCount(0);
    const location = { kind: 'newWorktree' as const, repoRoot: repo.root, name: 'e2e-one', branch: { kind: 'new' as const, name: 'worktree-e2e-one', base: 'HEAD' } };
    expect(await startDirect(page, id, { location })).toEqual({ status: 'starting', appSessionId: id });
    await untilPhase(page, id, 'ready');
    expect((await setupOf(page, id)).map((e) => [e.phase, e.detail])).toEqual([
      ['worktree', 'Creating worktree e2e-one'],
      ['launching', 'Starting'],
      ['ready', null],
    ]);
    const worktree = join(repo.root, '.claude/worktrees/e2e-one');
    expect(await runGit(repo.root, ['worktree', 'list', '--porcelain'])).toContain(`worktree ${worktree}\n`);
    expect(spawnRow(maws, id).cwd).toBe(worktree);
    expect(initializeRequest(maws, id).workspaceTrust, 'a trusted key attests nothing').toBeUndefined();
    await expect(row(page, id)).toBeVisible();
    expect(value(await invoke(page, 'session.intent.get', { appSessionId: id })), 'bound: the intent is gone').toBeNull();
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('trust bootstrap: an untrusted repository attests under a bootstrap id of its own, then launches the session', async () => {
    const { page, maws, untrustedRepos } = await begin({ fixtures: [BOOTSTRAP, AUTO_ROUTED], untrusted: 1 });
    const repo = untrustedRepos[0]!;
    const project = await addProject(page, repo.root);
    const id = await plus(page, project.name);
    const guarded = await startDirect(page, id);
    expect(guarded).toMatchObject({ status: 'needs_trust', appSessionId: id, trust: { trustKey: repo.root, trusted: false } });
    expect(value(await invoke(page, 'session.start', { appSessionId: id, message: null, options: { trust: 'accepted' } }))).toEqual({ status: 'starting', appSessionId: id });
    await untilPhase(page, id, 'ready');
    const events = await setupOf(page, id);
    const bootstrapId = fixtureIdentity(BOOTSTRAP).sessionId;
    expect(events.filter((e) => e.phase === 'trusting').map((e) => e.detail)).toEqual([`Trusting ${repo.root}`, `Trust recorded for ${repo.root} (bootstrap ${bootstrapId})`]);
    expect(events.at(-1)!.outcome).toEqual({ kind: 'ready', engineSessionId: fixtureIdentity(AUTO_ROUTED).sessionId, firstTurn: 'none' });
    expect(bootstrapId).not.toBe(fixtureIdentity(AUTO_ROUTED).sessionId);
    expect(initializeRequest(maws, id).workspaceTrust).toEqual({ accepted: true, directory: repo.root });
    expect(readdirSync(join(maws.userData, 'engine-host', 'journal')), 'the bootstrap id was forgotten at release').toEqual([id]);
    await expect(row(page, id)).toBeVisible();
    expect(value(await invoke(page, 'session.queue.list', { appSessionId: id })).entries).toEqual([]);
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
    await expect(page.getByRole('tab')).toHaveCount(3); // Overview, the source, the fork
  });

  test('rollback keeps the tab: a launch past the fixture list is refused, the worktree and record go, the failure card stays', async () => {
    const { page, untrustedRepos } = await begin({ fixtures: [BOOTSTRAP], untrusted: 1 });
    const repo = untrustedRepos[0]!;
    const project = await addProject(page, repo.root);
    const id = await plus(page, project.name);
    const removed: string[] = [];
    await page.exposeFunction('__c10Removed', (appSessionId: string) => void removed.push(appSessionId));
    await page.evaluate(() => window.maws.on('session.removed', (e) => (window as unknown as { __c10Removed(id: string): void }).__c10Removed(e.appSessionId)));
    const location = { kind: 'newWorktree' as const, repoRoot: repo.root, name: 'e2e-fail', branch: { kind: 'new' as const, name: 'worktree-e2e-fail', base: 'HEAD' } };
    expect(await startDirect(page, id, { location, trust: 'accepted' })).toEqual({ status: 'starting', appSessionId: id });
    await untilPhase(page, id, 'failed');
    await expect.poll(() => removed).toEqual([id]);
    const card = page.getByRole('region', { name: 'The session did not start' });
    await expect(card).toBeVisible();
    await expect(card.getByText('replay_disabled: MAWS_E2E_REPLAY_FIXTURES has no fixture left for this launch')).toBeVisible();
    await expect(card.getByText('Worktree e2e-fail removed')).toBeVisible();
    await expect(card.getByText('Branch worktree-e2e-fail deleted')).toBeVisible();
    await expect(card.getByText('Record removed')).toBeVisible();
    await expect(page.getByRole('heading', { name: `New session in ${project.name}` }), 'the tab stayed').toBeVisible();
    expect(await runGit(repo.root, ['worktree', 'list', '--porcelain'])).not.toContain('e2e-fail');
    expect(await runGit(repo.root, ['branch', '--list', 'worktree-e2e-fail'])).toBe('');
    expect(value(await invoke(page, 'session.intent.get', { appSessionId: id }))).toMatchObject({ progress: { lastFailure: { phase: 'launching' } } });
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

    await page.locator(`[data-menu="project:${project.id}"]`).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Archived sessions…' }).click();
    const archived = page.getByRole('dialog', { name: `Archived sessions · ${project.name}` });
    await archived.getByRole('button', { name: 'Unarchive' }).click();
    await expect(archived.getByText('No archived sessions.')).toBeVisible();
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
    await expect(sheet.getByText(/Removes the transcript and its 1 subagent transcript from ~\/.claude to the Trash/)).toBeVisible();
    await page.keyboard.press('Enter'); // not yet: the acknowledgement is unchecked
    await expect(sheet).toBeVisible();
    await sheet.getByRole('checkbox', { name: 'Move the transcript to the Trash' }).check();
    await sheet.getByRole('button', { name: 'Delete' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(row(page, gone.appId)).toHaveCount(0);
    expect(existsSync(transcript), 'moved to the Trash (asserted by absence)').toBe(false);
    expect(value(await invoke(page, 'session.get', { appSessionId: gone.appId }))).toBeNull();
  });

  test('an unstarted tab with a draft survives a relaunch', async () => {
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const first = await launchCase({ fixtures: [], trusted: [repo.root], store });
    current = { ...first, repos: [repo] };
    const project = await addProject(first.page, repo.root);
    const id = await plus(first.page, project.name);
    const draft = { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'half a thought' }] }] }, attachments: [], updatedAt: '2026-09-29T10:00:00.000Z' };
    value(await invoke(first.page, 'session.intent.patch', { appSessionId: id, patch: { draft } }));
    await expect.poll(async () => JSON.stringify(value(await invoke(first.page, 'layout.get', { key: 'main.tabs' })).value)).toContain(id);
    await first.maws.app.close();

    const second = await launchCase({ fixtures: [], trusted: [repo.root], store, userData: first.maws.userData });
    current = { ...second, repos: [repo], dispose: async () => (await second.maws.cleanup(), await first.maws.cleanup()) };
    await expect(second.page.getByRole('heading', { name: `New session in ${project.name}` }), 'hydration kept the unstarted tab').toBeVisible();
    expect(value(await invoke(second.page, 'session.intent.get', { appSessionId: id }))!.draft).toEqual(draft);
    expect(second.maws.consoleErrors()).toEqual([]);
  });

  test("C5's acceptance item 10, replay clause: a replayed read-only request reaches Needs you through a recorded session and the hover card's Approve answers the broker", async () => {
    const { page, trustedRepos } = await begin({ fixtures: [READ_ONLY] });
    const project = await addProject(page, trustedRepos[0]!.root);
    const id = await plus(page, project.name);
    await page.evaluate(() => {
      const turns: unknown[] = [];
      (window as unknown as { __c10Turns: unknown[] }).__c10Turns = turns;
      window.maws.on('session.eventBatch', (b) => b.events.forEach((e) => e.kind === 'turn.ended' && turns.push(b.appSessionId)));
    });
    const prompt = fixtureIdentity(READ_ONLY).firstPrompt!;
    expect(await startDirect(page, id, {}, { content: prompt.content as string, display: prompt.display })).toEqual({ status: 'starting', appSessionId: id });
    await untilPhase(page, id, 'ready');
    expect((await setupOf(page, id)).at(-1)!.outcome).toMatchObject({ kind: 'ready', firstTurn: 'sent' });

    const needsYou = page.getByRole('list', { name: 'Needs you' });
    const entry = needsYou.getByRole('listitem').first();
    await expect(entry).toBeVisible({ timeout: 20_000 });
    const title = (await entry.getAttribute('data-title'))!;
    const card = page.getByRole('dialog', { name: title });
    await expect(async () => {
      await page.mouse.move(700, 400);
      await entry.getByRole('button').first().hover();
      await expect(card).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 10_000 });
    await expect(card.getByText('Read')).toBeVisible();
    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(needsYou.getByRole('listitem')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __c10Turns: string[] }).__c10Turns), { timeout: 20_000 }).toContain(id);
  });
});
