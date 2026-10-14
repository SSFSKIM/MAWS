// A session for the library's viewer case (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5b; `e2e/library.spec.ts`),
// run as E3's side spec runs one (`e2e/side.spec.ts`): C3's replay transport and C10's replay seam over journals built
// by `side-replay.ts`, a scratch repository trusted in a temp config home, a throwaway profile. The parent's first turn
// makes its page through the artifact store (`artifact_create`, allowed by a rule, served by the engine host), so the
// store holds an `html` artifact linked to the parent; a comment's side thread replies once. No engine runs and the
// owner's `~/.claude` is never read or written.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { ScratchRepo } from '../../test/support/scratch-repo';
import { StoreFixture } from '../../test/support/store-fixture';
import { launchMaws, type MawsLaunch } from './launch';
import { SideJournal } from './side-replay';
import { newChatIn, openProject } from './sidebar';

export const PARENT = 'e3e50000-0000-4000-8000-0000000000b1';
export const CHILD = 'e3e50000-0000-4000-8000-0000000000b2';
export const FIRST_PROMPT = 'Make me a dashboard page.';
export const FIRST_REPLY = 'The dashboard page is in your artifacts.';

export function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<CommandResult<N>> {
  return page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const) as Promise<CommandResult<N>>;
}
export function value<N extends CommandName>(result: CommandResult<N>) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

// The parent: one turn whose `artifact_create` makes the page `title` (its handle `dash`), then the reply.
export function pageParentJournal(cwd: string, page: string, title: string): SideJournal {
  const journal = new SideJournal(PARENT, cwd);
  const prompt = journal.prompt();
  journal.mawsToolCall('artifact_create', { id: 'dash', content: page, title }, { status: 'created', id: 'dash', version: 1, title }, { asked: false });
  journal.reply(prompt, FIRST_REPLY);
  journal.completed(prompt);
  return journal;
}

// A side thread: its first prompt (the anchored comment), the rename the host writes (the anchor's label), one reply.
export function threadJournal(cwd: string, label: string, reply: string): SideJournal {
  const journal = new SideJournal(CHILD, cwd);
  const first = journal.prompt();
  journal.rename(label);
  journal.reply(first, reply);
  journal.completed(first);
  return journal;
}

export interface SessionCase {
  maws: MawsLaunch;
  page: Page;
  repo: ScratchRepo;
  parent: string; // the parent's app session id
  cleanup(): Promise<void>;
}

// The product on the journals `build` writes, a project of the scratch repository, and the parent started through "+"
// with its first prompt; answers once that turn is over.
export async function startSessionCase(build: (cwd: string) => SideJournal[], env: Record<string, string> = {}): Promise<SessionCase> {
  const repo = await ScratchRepo.create({ sentinels: false });
  const store = await StoreFixture.create();
  const journals = realpathSync(mkdtempSync(join(tmpdir(), 'maws-e2e-library-journals-')));
  const disposers: (() => Promise<void> | void)[] = [() => rmSync(journals, { recursive: true, force: true }), () => store.dispose(), () => repo.dispose()];
  const cleanup = async () => {
    for (const dispose of disposers.splice(0).reverse()) await dispose();
  };
  try {
    writeFileSync(join(store.configHome, '.claude.json'), `${JSON.stringify({ projects: { [repo.root]: { hasTrustDialogAccepted: true } } }, null, 2)}\n`);
    writeFileSync(join(store.configHome, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
    const fixtures = build(repo.root).map((journal, k) => journal.write(journals, `journal-${k}`));
    const maws = await launchMaws({ env: { MAWS_ENGINE_REPLAY: '1', MAWS_E2E_REPLAY_FIXTURES: fixtures.join(','), CLAUDE_CONFIG_DIR: store.configHome, ...env } });
    disposers.push(() => maws.cleanup());
    await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
    const { page } = maws;
    await expect(page.locator('[data-region="main"]')).toBeVisible();
    const project = value(await invoke(page, 'session.projects.add', { directory: repo.root }));
    await openProject(page, project.name);
    await newChatIn(page, project.name);
    await expect(page.getByRole('heading', { name: `New chat in ${project.name}` })).toBeVisible();
    const parent = value(await invoke(page, 'session.intent.list', undefined)).intents.at(-1)!.appSessionId;
    value(await invoke(page, 'session.intent.patch', { appSessionId: parent, patch: { gateway: 'direct' } }));
    value(await invoke(page, 'session.start', { appSessionId: parent, message: { content: FIRST_PROMPT, display: FIRST_PROMPT }, options: {} }));
    await expect(page.locator('[data-region="main"]').getByText(FIRST_REPLY)).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: parent as never })).turn, { timeout: 10_000 }).toBeNull();
    return { maws, page, repo, parent, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

// The side thread of `parent` a comment opened (its record exists before the engine runs).
export async function sideThreadOf(page: Page, parent: string): Promise<string> {
  let child = '';
  await expect
    .poll(async () => {
      const records = value(await invoke(page, 'session.list', {})).sessions;
      child = records.find((r) => r.lineage?.kind === 'side-thread' && r.lineage.parentAppSessionId === parent && r.lineage.openedBy === 'comment')?.appId ?? '';
      return child;
    }, { timeout: 20_000 })
    .not.toBe('');
  return child;
}
