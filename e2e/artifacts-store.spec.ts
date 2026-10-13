// The artifact store's acceptance in utility mode (docs/doperpowers/plans/2026-10-12-p3-a-store.md, M4 Proves; `pnpm
// e2e:artifacts`): a document the host's test writer made syncs to replicas in two windows over the product's port
// route (main's channel, the sandboxed preload, the renderer's ArtifactHost), an edit in one reaches the other and the
// writer's reaches both; a repeated op id is a no-op; versions list their actors; restore lands whole in both windows;
// `artifacts.changed` arrives for each change; the store reopens after a relaunch on the same profile; and a SIGKILL of
// the host while a renderer types loses no acknowledged edit, every replica re-opening by itself.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { documents, seamReady } from './support/documents';
import { launchMaws, type MawsLaunch } from './support/launch';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; issues?: unknown } };
interface Changed {
  artifactId: string;
  kind: string;
  revision: number;
  change: string;
}

// A command through the page's own bridge (window.maws), as the renderer sends it.
async function invoke<T>(page: Page, name: string, input?: unknown): Promise<Result<T>> {
  return page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const) as Promise<Result<T>>;
}
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = await invoke<T>(page, name, input);
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

async function hostReady(page: Page): Promise<{ pid: number }> {
  let state: { state: string; pid: number | null } = { state: 'starting', pid: null };
  await expect.poll(async () => (state = await ok(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  return { pid: state.pid! };
}

// A second app window through main's seam, with its page.
async function secondWindow(app: ElectronApplication): Promise<Page> {
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    app.evaluate(() => (globalThis as unknown as { __maws_documents: { openWindow(): number } }).__maws_documents.openWindow()),
  ]);
  await seamReady(page);
  return page;
}

// The `artifacts.changed` events a page has heard since it started listening.
async function listen(page: Page): Promise<() => Promise<Changed[]>> {
  await page.evaluate(() => {
    const w = window as unknown as { __changes: unknown[]; maws: { on(name: string, l: (p: unknown) => void): void } };
    w.__changes = [];
    w.maws.on('artifacts.changed', (payload) => w.__changes.push(payload));
  });
  return () => page.evaluate(() => (window as unknown as { __changes: Changed[] }).__changes);
}

const AGENT = 'app-e2e-agent';
let profile: string | null = null;
let launch: MawsLaunch | null = null;

test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  if (profile) rmSync(profile, { recursive: true, force: true });
  profile = null;
});

test('a document syncs across two windows and the test writer, versions and restores whole, and reopens after a relaunch', async () => {
  profile = mkdtempSync(join(tmpdir(), 'maws-e2e-artifacts-'));
  launch = await launchMaws({ userData: profile });
  const { app, page } = launch;
  await seamReady(page);
  await hostReady(page);
  const changes = await listen(page);
  const forThis = async (id: string) => (await changes()).filter((c) => c.artifactId === id);

  const { artifact } = await ok<{ artifact: { id: string; revision: number } }>(page, 'artifacts.create', { kind: 'document', title: 'Plan' });
  await expect.poll(async () => (await forThis(artifact.id)).map((c) => c.change), { message: 'created is announced' }).toEqual(['created']);
  const first = await ok<{ revision: number }>(page, 'artifacts.testWrite', {
    artifactId: artifact.id, opId: 'w1', appSessionId: AGENT,
    ops: [{ op: 'setAttr', key: 'title', value: 'one' }, { op: 'insertText', index: 0, text: 'hello' }],
  });
  await expect.poll(async () => (await forThis(artifact.id)).some((c) => c.change === 'updated' && c.revision >= first.revision), { message: 'the write is announced' }).toBe(true);

  // Two windows' replicas of the one host doc.
  const pageB = await secondWindow(app);
  const [a, b] = [documents(page), documents(pageB)];
  const [ha, hb] = [await a.open(artifact.id), await b.open(artifact.id)];
  for (const [seam, id] of [[a, ha], [b, hb]] as const) expect(await seam.json(id)).toEqual({ attrs: { title: 'one' }, text: 'hello' });
  expect(await a.state(ha)).toMatchObject({ phase: 'live', synced: true, readOnly: false });

  // An edit in one window reaches the other, and is acknowledged durable.
  await a.insertText(ha, 5, ' world');
  await expect.poll(async () => (await b.json(hb)).text, { message: 'window A’s edit reaches window B' }).toBe('hello world');
  await expect.poll(async () => (await a.state(ha)).unsaved, { message: 'window A’s edit is acknowledged' }).toBe(0);

  // The writer's edit reaches both; a repeated op id answers the first result and writes nothing.
  const w2 = { artifactId: artifact.id, opId: 'w2', appSessionId: AGENT, ops: [{ op: 'insertText', index: 0, text: '>' }] };
  const second = await ok<{ revision: number }>(page, 'artifacts.testWrite', w2);
  for (const [seam, id] of [[a, ha], [b, hb]] as const) await expect.poll(async () => (await seam.json(id)).text, { message: 'the writer’s edit reaches both windows' }).toBe('>hello world');
  expect(await ok(page, 'artifacts.testWrite', w2)).toEqual(second);
  await expect.poll(async () => (await b.json(hb)).text).toBe('>hello world');
  expect(await ok<{ artifact: { revision: number } }>(page, 'artifacts.get', { artifactId: artifact.id })).toMatchObject({ artifact: { revision: second.revision } });

  // Versions with their actors: the human's named version; the view-time auto version credited to the agent that wrote last.
  const { versionId: before } = await ok<{ versionId: number }>(page, 'artifacts.saveVersion', { artifactId: artifact.id, label: 'Before' });
  const third = await ok<{ revision: number }>(page, 'artifacts.testWrite', { artifactId: artifact.id, opId: 'w3', appSessionId: AGENT, ops: [{ op: 'setAttr', key: 'title', value: 'two' }, { op: 'deleteText', index: 0, length: 1 }] });
  await ok(page, 'artifacts.markViewed', { artifactId: artifact.id });
  const { versions } = await ok<{ versions: { id: number; seq: number; kind: string; label?: string; actor: unknown }[] }>(page, 'artifacts.versions', { artifactId: artifact.id });
  expect(versions).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: before, kind: 'named', label: 'Before', actor: { kind: 'human' } }),
    expect.objectContaining({ kind: 'auto', seq: third.revision, actor: { kind: 'session', appSessionId: AGENT } }),
  ]));
  for (const [seam, id] of [[a, ha], [b, hb]] as const) await expect.poll(async () => seam.json(id)).toEqual({ attrs: { title: 'two' }, text: 'hello world' });

  // Restore lands whole in both windows, each told of the restore it did not make.
  const restored = await ok<{ revision: number; versionId: number }>(page, 'artifacts.restore', { artifactId: artifact.id, versionId: before });
  for (const [seam, id] of [[a, ha], [b, hb]] as const) {
    await expect.poll(async () => seam.json(id), { message: 'the restore reaches every window' }).toEqual({ attrs: { title: 'one' }, text: '>hello world' });
    await expect.poll(async () => seam.restores(id)).toEqual([restored.versionId]);
  }
  await expect.poll(async () => (await forThis(artifact.id)).some((c) => c.revision >= restored.revision), { message: 'the restore is announced' }).toBe(true);
  const revisions = (await forThis(artifact.id)).map((c) => c.revision);
  expect(revisions, 'announced revisions only rise').toEqual([...revisions].sort((x, y) => x - y));

  // Quit and relaunch on the same profile: the store reopens with the document as it was.
  await launch.app.close();
  launch = await launchMaws({ userData: profile });
  const relaunched = launch.page;
  await seamReady(relaunched);
  await hostReady(relaunched);
  const c = documents(relaunched);
  const hc = await c.open(artifact.id);
  expect(await c.json(hc)).toEqual({ attrs: { title: 'one' }, text: '>hello world' });
  const after = await ok<{ versions: { id: number }[] }>(relaunched, 'artifacts.versions', { artifactId: artifact.id });
  expect(after.versions.map((v) => v.id)).toEqual(expect.arrayContaining([before, restored.versionId]));
});

test('a SIGKILL of the host while a window types loses no acknowledged edit, and every replica re-opens by itself', async () => {
  profile = mkdtempSync(join(tmpdir(), 'maws-e2e-artifacts-'));
  launch = await launchMaws({ userData: profile });
  const { page } = launch;
  await seamReady(page);
  const { pid } = await hostReady(page);
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title: 'Typing' });
  const seam = documents(page);
  const typer = await seam.open(artifact.id);
  const watcher = await seam.open(artifact.id);

  const start = (await seam.state(typer)).revision;
  await seam.startTyping(typer, 'k', 5);
  await expect.poll(async () => (await seam.state(typer)).revision, { message: 'the typing is being acknowledged' }).toBeGreaterThan(start + 20);
  process.kill(pid, 'SIGKILL');
  // What the typer was told is durable, and nothing more: it is closed at once, so it re-sends nothing after the restart.
  const { typed, acked } = await seam.stopTyping(typer);
  await seam.close(typer);
  expect(acked).toBeGreaterThan(0);
  expect(typed).toBeGreaterThanOrEqual(acked);

  // The watcher edits while the host is down; the edit rides in its next step 2.
  await seam.insertText(watcher, 0, 'offline!');
  await expect.poll(async () => (await ok<{ state: string; pid: number | null }>(page, 'engine.hostState')).pid, { timeout: 20_000, message: 'the host restarts' }).not.toBe(pid);
  await hostReady(page);
  await expect.poll(async () => seam.state(watcher), { timeout: 20_000, message: 'the watcher re-opens by itself and saves its edit' }).toMatchObject({ phase: 'live', synced: true, unsaved: 0 });

  const text = (await seam.json(watcher)).text;
  expect(text.startsWith('offline!')).toBe(true);
  const lost = Array.from({ length: acked }, (_, i) => `k${i};`).filter((token) => !text.includes(token));
  expect(lost, 'every acknowledged keystroke survived the kill').toEqual([]);
  // A fresh replica reads the same from the restarted host.
  const fresh = await seam.open(artifact.id);
  expect((await seam.json(fresh)).text).toBe(text);
});
