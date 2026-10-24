// The dashboard e2e groups' shared steps (P3-E2 M4 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md; product
// build, MAWS_HARNESS=0): the app over a fresh profile with the panel scenario's stub sessions, A's IPC from the page,
// a CSV bound as `artifact_dataset` binds it (the snapshot uploaded as an asset, its descriptor written through the
// host's MAWS_E2E test writer as the owner or as a session), the owner's editor writing blocks, and the surfaces a
// dashboard opens in (the panel's pinned Artifacts tool beside session A, where comments are offered; a main tab from
// the library). M3's `dashboard.spec.ts` keeps its own copies of the first few; M6 may fold them here.
// M6: the agent's half through the host's acceptance seam (src/engine-host/dashboards/e2e-seam.ts, MAWS_E2E=1 and
// MAWS_DASHBOARD_E2E=1, which every app of these groups starts with): the `maws` server's real tools as a named session,
// with a real scratch working directory the spec writes the agent's files into.
import { openArtifactInPanel, openArtifactReplicaInPanel, pinSurfaceForSessions } from './shell';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  /** The agent's tools, as the host's acceptance seam runs them (M6). */
  agent: AgentSeam;
  close(): Promise<void>;
}

/** The product app over a fresh profile, the engine host ready. */
export async function startApp(proof: string, env: Record<string, string> = {}): Promise<DashboardApp> {
  mkdirSync('/tmp/maws-harness/a', { recursive: true }); // session A's directory in the scenario
  mkdirSync(proof, { recursive: true });
  const userData = mkdtempSync('/tmp/maws-e2e-dashboard-');
  const launch = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: SESSIONS, MAWS_DASHBOARD_E2E: '1', ...env } });
  const { page } = launch;
  await expect.poll(async () => (await hostState(page)).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  return {
    launch,
    page,
    agent: new AgentSeam(join(userData, 'dashboard-e2e')),
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
export async function bindCsv(
  page: Page,
  artifactId: string,
  id: string,
  { title, name, csv, at, appSessionId, state, shape }: { title: string; name: string; csv: string; at: number; appSessionId?: string; state?: { status: 'ok' | 'error' | 'stale' | 'paused'; message?: string; at: number }; shape?: string },
): Promise<string> {
  const bytes = new TextEncoder().encode(csv);
  // M6: `shape`, the CSV the descriptor's columns and rows are read from when they are not the snapshot's (a fixture of
  // a snapshot that no longer reads as its format)
  const parsed = parseDataset(shape === undefined ? bytes : new TextEncoder().encode(shape), 'csv');
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
    state: state ?? { status: 'ok', at },
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

/** Select Harness A so the record's panel surface has a session for comments. */
export async function selectPanelSession(page: Page): Promise<void> {
  await (await sidebarRow(page, 'Harness A')).click();
}

/** The artifact in the pinned Artifacts tool's record view. */
export async function openInPanel(page: Page, artifactId: string, retainMain = false): Promise<Locator> {
  const panel = page.locator('[data-region="panel"]');
  if (retainMain) await openArtifactReplicaInPanel(page, artifactId);
  else {
    await openArtifactInPanel(page, artifactId);
    await pinSurfaceForSessions(page, 'Artifacts');
  }
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

/** The dashboard's Datasets action, direct when it fits or through the header's real overflow menu. */
export async function toggleDatasets(header: Locator): Promise<void> {
  const direct = header.getByRole('button', { name: 'Datasets', exact: true });
  if (await direct.isVisible()) await direct.click();
  else {
    await header.getByRole('button', { name: 'More actions', exact: true }).click();
    await header.page().getByRole('menuitemcheckbox', { name: 'Datasets', exact: true }).click();
  }
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

/**
 * The owner's way back to a page under P3-F1's narrow-panel drawer: in a body under 720 px an open rail (comments or
 * history) is a drawer over the page (rail-layout.ts), so before a pointer action on the page's content the owner closes
 * it with its Close button, holding no draft there. Nothing when the rail is closed or sits beside the page. A step that
 * reads the rail afterwards opens it again (`railOf`).
 */
export async function closeDrawer(record: Locator): Promise<void> {
  const body = record.locator('.doc-editor-body').first();
  if ((await body.getAttribute('data-rail-layout')) !== 'drawer') return;
  expect(await body.locator('.doc-rail textarea').evaluateAll((fields) => fields.filter((field) => (field as HTMLTextAreaElement).value !== '').length), 'no draft in the drawer it closes').toBe(0);
  await body.locator('.doc-rail-header').getByRole('button', { name: /^Close / }).click(); // the comments' or the history's
  await expect(body).not.toHaveAttribute('data-rail-layout');
}

// P3-E2 M5 (moved from dashboard-comments.spec.ts, shared with dashboard-export.spec.ts): the owner's block comment steps.
/** Selects the drawn chart as a person does, with a click on its caption (an open drawer closed first): the block selected whole, the editor focused. */
export async function selectChart(record: Locator): Promise<void> {
  await closeDrawer(record);
  await figures(record).first().locator('.dash-caption').click();
  await expect(record.locator('.doc-chart.ProseMirror-selectednode')).toHaveCount(1);
  await expect.poll(() => record.locator('.ds-doc .ProseMirror').first().evaluate((el) => el.contains(document.activeElement)), { message: 'the editor has the focus' }).toBe(true);
}

export async function railOf(record: Locator): Promise<Locator> {
  const rail = record.getByRole('complementary', { name: 'Comments' });
  if (!(await rail.isVisible())) await record.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: /^Comments/ }).click();
  await expect(rail).toBeVisible();
  return rail;
}

export async function reply(rail: Locator, threadId: string, text: string): Promise<void> {
  const field = rail.locator(`article[data-thread="${threadId}"]`).getByRole('textbox', { name: 'Reply' });
  await field.fill(text);
  await field.press('Enter');
}

// ---- P3-E2 M6: the agent's tools through the host's acceptance seam ---------------------------------------------------

/** One tool call's answer at the seam (src/engine-host/dashboards/e2e-seam.ts's DashboardCallAnswer). */
export interface AgentCall<R = Record<string, unknown>> {
  ok: true;
  isError: boolean;
  result?: R;
  text: string;
  toolUseId: string;
  wallMs: number;
  startedAt: number; // when the production call started, epoch ms on the host's clock
  endedAt: number; // when the call answered (never its commit), epoch ms on the host's clock
  announcedAt?: number; // the first observed post-write revision announcement at the answer's revision, host clock
  loop: { max: number; p99: number; mean: number };
  busyMs: number;
}

/** The refusal an artifact tool answers: its words, then `{reason, …}` (the shape A's `artifactRefusalOf` reads). */
export const refusalOf = (call: AgentCall<unknown>): Record<string, unknown> & { reason: string } => {
  expect(call.isError, `a refusal, not ${JSON.stringify(call.result)}`).toBe(true);
  const at = call.text.indexOf(' {"reason":');
  expect(at, `a refusal with its reason: ${call.text}`).toBeGreaterThan(-1);
  return JSON.parse(call.text.slice(at + 1)) as Record<string, unknown> & { reason: string };
};

/** An agent session's tools at the seam: its working directory, and its calls, each answered with its wall time. */
export class AgentSeam {
  private seq = 0;
  constructor(readonly dir: string) {}

  private async send<T>(command: Record<string, unknown>, timeoutMs = 60_000): Promise<T> {
    const inbox = join(this.dir, 'in');
    const deadline = Date.now() + timeoutMs;
    while (!existsSync(inbox)) {
      if (Date.now() > deadline) throw new Error(`the host started no dashboard seam in ${this.dir} (MAWS_DASHBOARD_E2E=1)`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const name = `${String(++this.seq).padStart(8, '0')}.json`;
    writeFileSync(join(inbox, `${name}.tmp`), JSON.stringify(command));
    renameSync(join(inbox, `${name}.tmp`), join(inbox, name));
    const out = join(this.dir, 'out', name);
    for (;;) {
      if (existsSync(out)) {
        const answer = JSON.parse(readFileSync(out, 'utf8')) as { ok: boolean; error?: string };
        rmSync(out, { force: true });
        if (!answer.ok) throw new Error(`the dashboard seam refused ${String(command.cmd)}: ${answer.error}`);
        return answer as T;
      }
      if (Date.now() > deadline) throw new Error(`no answer from the dashboard seam to ${String(command.cmd)} in ${timeoutMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  /** The session's working directory (under the profile, made by the host), where the agent's files are written. */
  async cwd(session: string): Promise<string> {
    return (await this.send<{ cwd: string }>({ cmd: 'cwd', session })).cwd;
  }

  /** Writes `content` as the file `name` in the session's working directory, as the agent's Write leaves it. */
  async write(session: string, name: string, content: string | Uint8Array): Promise<string> {
    writeFileSync(join(await this.cwd(session), name), content);
    return name;
  }

  call<R = Record<string, unknown>>(session: string, tool: string, args: Record<string, unknown>, opts: { toolUseId?: string; timeoutMs?: number } = {}): Promise<AgentCall<R>> {
    return this.send<AgentCall<R>>({ cmd: 'call', session, tool, args, ...(opts.toolUseId && { toolUseId: opts.toolUseId }) }, opts.timeoutMs);
  }

  /** A call that must succeed: its result. */
  async ok<R = Record<string, unknown>>(session: string, tool: string, args: Record<string, unknown>, opts: { toolUseId?: string; timeoutMs?: number } = {}): Promise<R> {
    const answer = await this.call<R>(session, tool, args, opts);
    if (answer.isError) throw new Error(`${tool} as ${session} was refused: ${answer.text}`);
    return answer.result!;
  }

  release(session: string): Promise<unknown> {
    return this.send({ cmd: 'release', session });
  }

  /** Whether the host holds the artifact's document in memory (M6: a cold open is proved unloaded first). */
  loaded(artifactId: string): Promise<{ loaded: boolean }> {
    return this.send({ cmd: 'loaded', artifactId });
  }
}

/** A live dashboard's revision, as A's store answers it. */
export const revisionOf = async (page: Page, artifactId: string): Promise<number> => (await ok<{ artifact: { revision: number } }>(page, 'artifacts.get', { artifactId })).artifact.revision;

/**
 * The editor's selection over time (M6's last-block investigation, the tracker's row for it): from now on every
 * transaction of the editor under `scope` is recorded with its selection, whether it changed the document, its steps and
 * meta keys (a binding's remote change, a pointer selection, an appended one), and every DOM selectionchange with where
 * the DOM selection is and whether the editor has the focus; `log()` answers them, so a selection that does not hold
 * says what moved it.
 */
export async function watchSelection(scope: Locator): Promise<{ log(): Promise<string[]> }> {
  const editor = scope.locator('.ds-doc .ProseMirror').first();
  await editor.evaluate((el) => {
    type Tr = { selection: { toJSON(): unknown }; docChanged: boolean; steps: { toJSON(): unknown }[]; meta?: Record<string, unknown> };
    const host = el as HTMLElement & { selectionLog?: string[]; editor: { on(event: 'transaction', fn: (props: { transaction: Tr }) => void): void } };
    if (host.selectionLog) return;
    const log: string[] = [];
    host.selectionLog = log;
    const start = performance.now();
    const at = () => `${(performance.now() - start).toFixed(0)}ms`;
    host.editor.on('transaction', ({ transaction }) => {
      const meta = Object.keys(transaction.meta ?? {}).join(',');
      const steps = transaction.steps.map((step) => JSON.stringify(step.toJSON()).slice(0, 160));
      log.push(`${at()} tr sel=${JSON.stringify(transaction.selection.toJSON())} doc=${transaction.docChanged} meta=[${meta}] steps=${JSON.stringify(steps)}`);
    });
    const where = (node: Node | null) => (node ? `${node.nodeName}${node instanceof Element && node.className ? `.${String(node.className).split(' ')[0]}` : ''}` : 'none');
    el.ownerDocument.addEventListener('selectionchange', () => {
      const sel = el.ownerDocument.getSelection();
      log.push(`${at()} dom sel ${where(sel?.anchorNode ?? null)}:${sel?.anchorOffset} → ${where(sel?.focusNode ?? null)}:${sel?.focusOffset} focused=${el.contains(el.ownerDocument.activeElement)}`);
    });
  });
  return { log: () => editor.evaluate((el) => [...((el as HTMLElement & { selectionLog?: string[] }).selectionLog ?? [])]) };
}

/** Comments on the selected chart through the toolbar; when Comment is not offered, the failure carries the selection's log. */
export async function commentSelectedChart(record: Locator, watched: { log(): Promise<string[]> }): Promise<void> {
  const button = record.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Add comment', exact: true });
  const offered = await expect(button)
    .toBeEnabled({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  expect(offered, `Comment is offered on the selected chart; the selection since it was watched:\n${(await watched.log()).join('\n')}`).toBe(true);
  await button.click();
}
