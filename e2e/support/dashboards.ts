// The dashboard e2e groups' shared steps (P3-E2 M4 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md; product
// build, MAWS_HARNESS=0): the app over a fresh profile with the panel scenario's stub sessions, A's IPC from the page,
// a CSV bound as `artifact_dataset` binds it (the snapshot uploaded as an asset, its descriptor written through the
// host's MAWS_E2E test writer as the owner or as a session), the owner's editor writing blocks, and the surfaces a
// dashboard opens in (the panel's pinned Artifacts tool beside session A, where comments are offered; a main tab from
// the library). M3's `dashboard.spec.ts` keeps its own copies of the first few; M6 may fold them here.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import { DatasetError, parseDataset } from '../../src/artifacts/dashboard/parse';
import { launchMaws, type MawsLaunch } from './launch';
import { sidebarRow } from './sidebar';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
/** A's command from the page, its value or a thrown refusal. */
export async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}
export const hostState = (page: Page) => ok<{ state: string; pid: number | null }>(page, 'engine.hostState');

/** Session A of the panel scenario: the main area shows it beside the pinned tool, and the agent's writes are its. */
export const SESSION_A = 'A';
const SESSIONS = 'stub:test/fixtures/panel/harness-sessions.json';

export interface DashboardApp {
  launch: MawsLaunch;
  page: Page;
  close(): Promise<void>;
}

/** The product app over a fresh profile, the engine host ready. */
export async function startApp(proof: string): Promise<DashboardApp> {
  mkdirSync('/tmp/maws-harness/a', { recursive: true }); // session A's directory in the scenario
  mkdirSync(proof, { recursive: true });
  const userData = mkdtempSync('/tmp/maws-e2e-dashboard-');
  const launch = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: SESSIONS } });
  const { page } = launch;
  await expect.poll(async () => (await hostState(page)).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  return {
    launch,
    page,
    close: async () => {
      await launch.cleanup();
      rmSync(userData, { recursive: true, force: true });
    },
  };
}

/** The engine host killed and back, ready: what it keeps is what survives. */
export async function restartHost(page: Page): Promise<void> {
  const { pid } = await hostState(page);
  process.kill(pid!, 'SIGKILL');
  await expect.poll(async () => (await hostState(page)).pid, { timeout: 30_000, message: 'the host restarts' }).not.toBe(pid);
  await expect.poll(async () => (await hostState(page)).state, { timeout: 30_000, message: 'the restarted host is ready' }).toBe('ready');
}

let writes = 0;
/**
 * Binds `csv` as dataset `id`: the bytes uploaded as the dashboard's asset, the descriptor written whole as
 * artifact_dataset writes it, as the owner or (with `appSessionId`) as that session. `at` is the descriptor's update time.
 */
export async function bindCsv(page: Page, artifactId: string, id: string, { title, name, csv, at, appSessionId }: { title: string; name: string; csv: string; at: number; appSessionId?: string }): Promise<string> {
  const bytes = new TextEncoder().encode(csv);
  const parsed = parseDataset(bytes, 'csv');
  if (parsed instanceof DatasetError) throw new Error(parsed.reason);
  // the IPC takes a Uint8Array, made in the page
  const { ref } = (await page.evaluate(
    ([a, n, b]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<{ ok: boolean; value: { ref: string } }> } }).maws.invoke('artifacts.uploadAsset', { artifactId: a, name: n, mime: 'text/csv', bytes: new Uint8Array(b as number[]) }).then((r) => r.value),
    [artifactId, name, [...bytes]] as const,
  )) as { ref: string };
  const descriptor = {
    title,
    source: { kind: 'file', ref, name, format: 'csv', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length },
    columns: parsed.columns,
    rows: parsed.rows.length,
    updated: { at, by: appSessionId ? { kind: 'session', appSessionId } : { kind: 'human' } },
    state: { status: 'ok', at },
  };
  await ok(page, 'artifacts.testWrite', { artifactId, opId: `dashboard-bind-${Date.now()}-${++writes}`, ops: [{ op: 'setAttr', root: 'datasets', key: id, value: descriptor }], ...(appSessionId && { appSessionId }) });
  return ref;
}

export const chart = (source: string, spec: Record<string, unknown>) => ({ type: 'chart', attrs: { source, spec } });
export const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

/** The editor under `scope` (its first ProseMirror) inserts the blocks after its last one: the owner's own write. */
export async function insertBlocks(scope: Locator, blocks: unknown[]): Promise<void> {
  await scope.locator('.ds-doc .ProseMirror').first().evaluate((el, content) => {
    const editor = (el as HTMLElement & { editor: { state: { doc: { content: { size: number } } }; commands: { insertContentAt(at: number, content: unknown): boolean } } }).editor;
    editor.commands.insertContentAt(editor.state.doc.content.size, content);
  }, blocks);
}

export const figures = (scope: Locator) => scope.locator('.ds-doc figure.dash-view');
/** Each drawable point's or bar's tip in a chart figure, in drawing order. */
export const tipsOf = (figure: Locator) => figure.locator('svg [data-tip]').evaluateAll((els) => els.map((el) => el.getAttribute('data-tip')));

/** The panel's Artifacts tool, added in session A's panel and pinned: the main area keeps showing A, so comments are offered. */
export async function pinArtifactsTool(page: Page): Promise<void> {
  const panel = page.locator('[data-region="panel"]');
  await (await sidebarRow(page, 'Harness A')).click();
  await panel.getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name: 'Artifacts' }).click();
  await panel.getByRole('button', { name: 'Pin Artifacts' }).click();
}

/** The artifact in the pinned Artifacts tool's record view. */
export async function openInPanel(page: Page, artifactId: string): Promise<Locator> {
  const panel = page.locator('[data-region="panel"]');
  await panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /^Artifacts/ }).click();
  await panel.getByRole('button', { name: 'All', exact: true }).click();
  await panel.locator(`[data-artifact-row][data-artifact-id="${artifactId}"]`).click({ timeout: 15_000 });
  const record = panel.locator(`[data-artifact-record="${artifactId}"]`);
  await expect(record.locator('.ds-doc .ProseMirror').first()).toBeVisible({ timeout: 15_000 });
  return record;
}

/** The artifact opened from the library in an `artifact` main tab. */
export async function openInMain(page: Page, artifactId: string): Promise<Locator> {
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator(`[data-library] article[data-artifact-row="${artifactId}"]`).click({ timeout: 15_000 });
  const main = page.locator(`[data-artifact-tab="${artifactId}"]`);
  await expect(main.locator('.ds-doc .ProseMirror').first()).toBeVisible({ timeout: 15_000 });
  return main;
}

/** The durability barrier: the replica behind the editor under `scope` has nothing the host has not acknowledged. */
export async function durable(scope: Locator): Promise<void> {
  const unsaved = () =>
    scope
      .locator('.ds-doc .ProseMirror')
      .first()
      .evaluate((el) => {
        const editor = (el as HTMLElement & { editor?: { extensionManager: { extensions: Array<{ name: string; options: { hold?: { base: { state(): { unsaved: number } } } } }> } } }).editor;
        return editor?.extensionManager.extensions.find((extension) => extension.name === 'collaboration')?.options.hold?.base.state().unsaved ?? -1;
      });
  await expect.poll(unsaved, { timeout: 10_000, message: 'every edit acknowledged by the host' }).toBe(0);
}

/** The window's Edit command on the OS pasteboard, as ⌘C, ⌘X and ⌘V run it (the app menu's Edit roles). */
export async function edit(launch: MawsLaunch, command: 'copy' | 'cut' | 'paste'): Promise<void> {
  await launch.app.evaluate(({ BrowserWindow }, which) => {
    const [win] = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
    win!.webContents[which]();
  }, command);
}
