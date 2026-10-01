// C12's Worktrees… dialog end to end (C12 execution document, M5 task 1, Acceptance item 10): the built app over a
// scratch repository with three linked worktrees (one made through the product's worktree creation, which writes the
// engine's runtime exclude block, and bound to a discovered session; one dirty with no session; one whose directory is
// gone, so git lists it prunable) under a temp config home, with the replay transport and no engine. The
// dialog opens from the project menu, lists the main checkout and the three with their states and the bound session
// from main's occupancy; New session here opens an unstarted tab whose Location chip names the worktree, and the
// dialog then shows that checkout busy with Remove… disabled; Remove… on the orphan runs C10's ladder to removal and
// the dialog, back from the cleanup, reads the repository again without it. Run by `pnpm e2e:c12` (MAWS_C12_E2E=1).
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ScratchRepo } from '../test/support/scratch-repo';
import { StoreFixture } from '../test/support/store-fixture';
import { invoke, value } from './support/c7-replay';
import { launchMaws, type MawsLaunch } from './support/launch';

test.skip(process.env.MAWS_C12_E2E !== '1', 'the Worktrees… e2e runs under pnpm e2e:c12 (MAWS_C12_E2E=1)');

const BOUND_SESSION = 'c12c12c1-2000-4000-8000-000000000001';

let repo: ScratchRepo | null = null;
let store: StoreFixture | null = null;
let maws: MawsLaunch | null = null;
test.afterEach(async () => {
  await maws?.cleanup();
  await store?.dispose();
  repo?.dispose();
  maws = null;
  store = null;
  repo = null;
});

async function openWorktrees(page: Page, projectId: string, name: string): Promise<Locator> {
  await page.locator(`[data-menu="project:${projectId}"]`).first().click({ button: 'right' }); // W5: the project list's row is the menu target itself
  await page.getByRole('menuitem', { name: 'Worktrees…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Worktrees · ${name}` });
  await expect(dialog.getByRole('list', { name: 'Worktrees' })).toBeVisible();
  return dialog;
}
const rowOf = (dialog: Locator, name: string) => dialog.getByRole('list', { name: 'Worktrees' }).getByRole('listitem', { name, exact: true });

test('Worktrees…: every checkout with its state and bound session; New session here claims one; Remove… on the orphan runs the cleanup ladder and the list is read again', async () => {
  repo = await ScratchRepo.create({ sentinels: false });
  const orphan = await repo.addManagedWorktree('orphan'); // made by hand: `.claude/` is untracked in the main checkout now
  const gone = await repo.addManagedWorktree('gone');
  writeFileSync(join(orphan, 'scratch.txt'), 'uncommitted\n'); // dirty, no session
  rmSync(gone, { recursive: true, force: true }); // git now lists it prunable
  const exclude = join(repo.root, '.git', 'info', 'exclude');
  expect(readFileSync(exclude, 'utf8')).not.toContain('# claude-code-runtime');
  store = await StoreFixture.create();
  writeFileSync(join(store.configHome, '.claude.json'), `${JSON.stringify({ projects: { [repo.root]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);

  maws = await launchMaws({ env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: '', CLAUDE_CONFIG_DIR: store.configHome } });
  const page = maws.page;
  await expect(page.locator('[data-region="main"]')).toBeVisible();
  const project = value(await invoke(page, 'session.projects.add', { directory: repo.root }));
  // `bound` is made by the product (C10's worktree creation), which writes the engine's runtime exclude block once, so
  // the main checkout reads clean beside its worktrees; then a discovered session's transcript binds it
  const bound = value(await invoke(page, 'git.worktree.add', { repoRoot: repo.root, name: 'bound', branch: { kind: 'new', name: 'worktree-bound', base: 'HEAD' } })).path;
  const written = readFileSync(exclude, 'utf8');
  expect(written.split('\n').filter((line) => line === '# claude-code-runtime' || line === '**/.claude/worktrees/')).toEqual(['# claude-code-runtime', '**/.claude/worktrees/']);
  await store.addTranscript(bound, BOUND_SESSION, [
    { type: 'user', uuid: 'u-bound', parentUuid: null, cwd: bound, sessionId: BOUND_SESSION, timestamp: '2026-09-30T10:00:00.000Z', message: { role: 'user', content: 'Work in the bound worktree' } },
  ] as never);
  await expect.poll(async () => value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === BOUND_SESSION)?.appId ?? null, { timeout: 20_000 }).not.toBeNull();
  const boundRecord = value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === BOUND_SESSION)!;

  let dialog = await openWorktrees(page, project.id, project.name);
  const names = await dialog.getByRole('list', { name: 'Worktrees' }).locator(':scope > li').evaluateAll((items) => items.map((li) => [li.getAttribute('aria-label'), (li as HTMLElement).dataset.state]));
  expect(names[0]).toEqual([project.name, 'clean']); // the main checkout first, then the linked ones in the listing's order
  expect(names.slice(1).sort()).toEqual([
    ['bound', 'clean'],
    ['gone', 'missing'],
    ['orphan', 'dirty'],
  ]);
  await expect(rowOf(dialog, 'bound').getByRole('button', { name: boundRecord.title.text })).toBeVisible();
  await expect(rowOf(dialog, 'orphan').getByText('dirty · 1 change')).toBeVisible();
  await expect(rowOf(dialog, 'orphan').getByText('No session')).toBeVisible();
  await expect(rowOf(dialog, 'gone').getByText('missing', { exact: true })).toBeVisible();
  await expect(rowOf(dialog, project.name).getByRole('button', { name: 'Remove…' })).toHaveCount(0);

  // New session here on the bound worktree: an unstarted tab whose Location chip names it, then that checkout is busy
  await rowOf(dialog, 'bound').getByRole('button', { name: 'New session here' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Location ${bound}` })).toBeVisible();
  const intent = value(await invoke(page, 'session.intent.list', undefined)).intents.at(-1)!;
  expect(intent.location).toEqual({ kind: 'existingWorktree', repoRoot: repo.root, path: bound });
  dialog = await openWorktrees(page, project.id, project.name);
  await expect(rowOf(dialog, 'bound')).toHaveAttribute('data-state', 'busy');
  await expect(rowOf(dialog, 'bound').getByText('An unstarted tab uses this checkout')).toBeVisible();
  await expect(rowOf(dialog, 'bound').getByRole('button', { name: 'Remove…' })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('worktrees-dialog.png') });

  // Remove… on the orphan: C10's ladder (discard, acknowledged), then back to the list, read again without it
  await rowOf(dialog, 'orphan').getByRole('button', { name: 'Remove…' }).click();
  const cleanup = page.getByRole('dialog', { name: 'Clean up worktree orphan' });
  await cleanup.getByRole('checkbox', { name: 'Discard changes and remove' }).check();
  await cleanup.getByRole('checkbox', { name: 'Discard 1 uncommitted change; this cannot be undone' }).check();
  await cleanup.getByRole('button', { name: 'Discard and remove' }).click();
  await expect(cleanup.getByText(/^gone$|Nothing to remove/).first()).toBeVisible();
  await cleanup.getByRole('button', { name: 'Cancel' }).click();
  dialog = page.getByRole('dialog', { name: `Worktrees · ${project.name}` });
  await expect(dialog.getByRole('list', { name: 'Worktrees' })).toBeVisible();
  await expect(rowOf(dialog, 'orphan')).toHaveCount(0);
  await expect(rowOf(dialog, 'bound')).toBeVisible();
  expect(await repo.worktreePaths()).not.toContain(orphan);
  expect(readFileSync(exclude, 'utf8'), 'MAWS never removes the block').toBe(written);
});
