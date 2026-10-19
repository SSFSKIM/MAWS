// P3-HD M4: the fixture server for route D's built-app disconnect scene (e2e/connectors-direct.spec.ts, "disconnect"). The
// scene's engine and MAWS's own connection both start the entry below from the scratch config home, through a wrapper
// that stands in for npx: a shell that stays the server's parent and leaves an EOF-ignoring grandchild beside it, each
// recording its pid, so the scene can tell the members of MAWS's instance from the engine's and prove none outlives
// main. The grandchild's command line names the scene's root, so a leak is caught and cleaned by the scene's own
// survivor check. Every value is a scratch fake; nothing of the owner's is read.
//
// P3-HD M4b: the integrated scenes' stdio support beside it: the plain entry with a hold file (the lifecycle scene) or a
// `${…}` reference (the engine-only scene), the owner's pages in one Space, the page's refreshes counted against the
// submissions they made, the Servers rows of the sheet, and the scratch sessions' journals (launches, model traffic and
// the owner-only modes), read only from the scene's own profile.
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { CommandResult } from '@shared/ipc/schema';
import { FIXTURE_SERVER } from './connector-engine';
import { invoke, pageState, TOOL, value, type ConnectorScene } from './connector-scene';
import { wrapperPids, type WrapperPids } from './connector-direct-transport';
import { blankResumeStartupRejection, boundedMetaRows, forbiddenFrames, journalFilesOf, journalTurns, readJournalRows, shellQuoted, type JournalTurns } from './connector-direct-checks'; // P3-F (sweep#1): shellQuoted

// The fixture server answers no tools/call while this file exists (support/connector-mcp-server.mjs `--hold`), and
// answers the held ones once it is removed (P3-HD M4b).
export function holdFileOf(scene: ConnectorScene): string {
  return join(scene.root, 'hold');
}

export function wrapperLogOf(scene: ConnectorScene): string {
  return join(scene.root, 'wrapper.log');
}

// The fixture server's `mcpServers` entry: literal, the wrapper by absolute path, the call log the scene reads.
export function wrappedServer(scene: ConnectorScene): Record<string, unknown> {
  const bin = join(scene.root, 'bin');
  mkdirSync(bin, { recursive: true });
  const path = join(bin, 'npx-standin');
  writeFileSync(
    path,
    `#!/bin/sh\nprintf 'wrapper %s\\n' "$$" >> "$MAWS_PROBE_WRAPPER_LOG"\n/bin/sh -c 'while :; do /bin/sleep 1; done' "$MAWS_PROBE_SCENE_ROOT" </dev/null >/dev/null 2>&1 &\nprintf 'sleeper %s\\n' "$!" >> "$MAWS_PROBE_WRAPPER_LOG"\n${shellQuoted(process.execPath)} "$@"\n`, // P3-F (sweep#1): the interpreter one literal word, never expanded
  );
  chmodSync(path, 0o755);
  return {
    type: 'stdio',
    command: path,
    args: [FIXTURE_SERVER, '--id', 'series', '--log', scene.log, '--tools', JSON.stringify([TOOL]), '--hold', holdFileOf(scene)],
    env: { MAWS_PROBE_WRAPPER_LOG: wrapperLogOf(scene), MAWS_PROBE_SCENE_ROOT: scene.root },
  };
}

// The wrappers and grandchildren started after `before` was read.
export function newMembers(scene: ConnectorScene, before: WrapperPids): WrapperPids {
  const now = wrapperPids(wrapperLogOf(scene));
  return { wrappers: now.wrappers.filter((pid) => !before.wrappers.includes(pid)), sleepers: now.sleepers.filter((pid) => !before.sleepers.includes(pid)) };
}

// P3-HD M4b start
// H's plain fixture entry (support/connector-scene.ts), with more arguments.
export function plainServer(scene: ConnectorScene, extra: readonly string[] = []): Record<string, unknown> {
  return { type: 'stdio', command: process.execPath, args: [FIXTURE_SERVER, '--id', 'series', '--log', scene.log, '--tools', JSON.stringify([TOOL]), ...extra] };
}
export const heldServer = (scene: ConnectorScene) => plainServer(scene, ['--hold', holdFileOf(scene)]);
// A `${…}` reference (with a default, so the engine runs it): route D's literal-only policy keeps the entry the session's.
export const referencingServer = (scene: ConnectorScene) => plainServer(scene, ['--note', '${MAWS_SCENE_NOTE:-literal}']);

// The owner's HTML page in a Space linked to the project (a new one unless `spaceId` names it), as H's createPage makes it.
export async function createPageIn(page: Page, scene: ConnectorScene, options: { html: string; title: string; spaceId?: string }): Promise<{ artifactId: string; spaceId: string }> {
  const spaceId = options.spaceId ?? value(await invoke(page, 'spaces.create', { name: 'Live data', linkedDir: scene.project })).space.id;
  const created = await page.evaluate(
    ([html, title, space]) => window.maws.invoke('artifacts.create', { kind: 'html', title, spaceId: space, content: { bytes: new TextEncoder().encode(html), name: 'index.html' } }),
    [options.html, options.title, spaceId] as const,
  );
  const artifactId = value<'artifacts.create'>(created as CommandResult<'artifacts.create'>).artifact.id;
  scene.note('artifact', { id: artifactId, title: options.title });
  return { artifactId, spaceId };
}

export interface Refresh {
  last: string; // the page's `#last`
  updates: number; // its `#updates`
  submitted: number; // tools/call submissions the fixture saw since the previous refresh
}

// A page's refreshes, each with the submissions it made: the fixture's count read when the page's `#updates` moves.
// The page writes its outcome after the call's answer, so a refresh's submission is in the count by then, and the next
// is an interval away.
export class Refreshes {
  readonly seen: Refresh[] = [];
  private updates = 0;
  private calls = 0;

  constructor(private frame: FrameLocator, private readonly submissions: () => number) {}

  // From the page as it is now.
  async mark(): Promise<void> {
    this.updates = (await pageState(this.frame)).updates;
    this.calls = this.submissions();
  }
  // A new load of the page (its count starts again), `callsBefore` read before it was opened.
  remounted(frame: FrameLocator, callsBefore: number): void {
    this.frame = frame;
    this.updates = 0;
    this.calls = callsBefore;
  }

  async next(timeout: number): Promise<Refresh> {
    await expect.poll(async () => (await pageState(this.frame)).updates, { timeout, intervals: [100], message: 'the page’s next refresh arrived' }).toBeGreaterThan(this.updates);
    const state = await pageState(this.frame);
    const calls = this.submissions();
    expect(state.updates, 'one refresh arrived, not two').toBe(this.updates + 1);
    const refresh = { last: state.last, updates: state.updates, submitted: calls - this.calls };
    this.updates = state.updates;
    this.calls = calls;
    this.seen.push(refresh);
    return refresh;
  }

  // Refreshes until one reads through `route` (at most `most`), each submitting at most one call and a read exactly one.
  async until(route: 'engine' | 'direct', timeout: number, most = 3): Promise<Refresh> {
    for (let i = 0; i < most; i += 1) {
      const refresh = await this.next(timeout);
      expect(refresh.submitted, `refresh ${refresh.updates} (${refresh.last}) submitted at most one call`).toBeLessThanOrEqual(1);
      if (refresh.last.startsWith('ok ')) expect(refresh.submitted, `read ${refresh.updates} submitted exactly one call`).toBe(1);
      if (refresh.last.endsWith(` via=${route}`) && refresh.last.startsWith('ok ')) return refresh;
    }
    throw new Error(`no refresh read through route ${route}: ${JSON.stringify(this.seen.slice(-most))}`);
  }

  // What arrived and was submitted since the last refresh (nothing, for a silent page).
  async since(): Promise<{ updates: number; submitted: number }> {
    return { updates: (await pageState(this.frame)).updates - this.updates, submitted: this.submissions() - this.calls };
  }
}

// The connectors sheet's row for one of MAWS's servers (P3-HD M3c2), optionally of one kind.
export function serverRow(sheet: Locator, name: string, kind?: 'source' | 'engineOnly' | 'saved' | 'unreadable' | 'retiring'): Locator {
  return sheet.locator(`[data-connector-server="${name}"]${kind === undefined ? '' : `[data-kind="${kind}"]`}`);
}

// Until the engine host reports the session's fixture server connected.
export async function serverConnected(page: Page, appSessionId: string, server: string): Promise<void> {
  await expect
    .poll(async () => {
      const status = await invoke(page, 'session.mcpStatus', { appSessionId: appSessionId as LaunchSpec['appSessionId'] });
      return status.ok ? status.value.mcpServers.find((entry) => entry.name === server)?.status : 'unanswered';
    }, { timeout: 60_000, message: `${server} is connected` })
    .toBe('connected');
}

export interface SessionJournal {
  appSessionId: string;
  turns: JournalTurns;
  rows: readonly { direction: string; frame: unknown }[]; // in the host's launch order (JournalReader)
  dirMode: number;
  fileModes: number[];
}

// Every session journal of the scene's profile (<userData>/engine-host/journal/<session>/*.jsonl): launches, model
// traffic, and the owner-only modes of its directory and files. Complete lines only: a live engine's row being appended
// is left for a later read.
export function sessionJournals(scene: ConnectorScene): SessionJournal[] {
  const root = join(scene.userData, 'engine-host', 'journal');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(root, entry.name);
      const files = journalFilesOf(dir);
      const rows = readJournalRows(dir);
      return { appSessionId: entry.name, turns: journalTurns(rows), rows, dirMode: statSync(dir).mode & 0o777, fileModes: files.map((file) => statSync(file).mode & 0o777) };
    });
}

// P3-HD Decision Log 39: the scene's session journals' meta rows (spawn, init_failed, reconnect, exit …) as bounded,
// scrubbed fields, for a failure to be diagnosed from the run's evidence. At most 8 journals; scratch only.
export function sessionMeta(scene: ConnectorScene): { appSessionId: string; rows: Record<string, unknown>[]; omitted: number }[] {
  const root = join(scene.userData, 'engine-host', 'journal');
  if (!existsSync(root)) return [];
  const roots = [scene.root, scene.userData];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .slice(0, 8)
    .map((entry) => ({ appSessionId: entry.name, ...boundedMetaRows(readJournalRows(join(root, entry.name)), roots) }));
}

// The transition scene only: no session, the fresh one included, has an assistant, stream or user frame in either
// direction (the global rule counts outbound user messages and inbound model frames; this adds the other directions).
export function expectNoForbiddenFrames(journals: readonly SessionJournal[]): void {
  for (const journal of journals) expect(forbiddenFrames(journal.rows), `${journal.appSessionId}: no assistant, stream or user frame in either direction`).toEqual({ assistant: 0, streamEvent: 0, user: 0 });
}

// No session ran a model turn or saw a needs-auth report, and every journal is owner-only. `blankResumeOf` (Decision Log
// 42, one scene only): the one session whose refused resume may have left a single inbound error result, accepted only
// when blankResumeStartupRejection classifies it; every other journal keeps the rule above.
export function expectQuietJournals(journals: readonly SessionJournal[], blankResumeOf?: string): void {
  expect(journals.length, 'the scene’s sessions kept journals').toBeGreaterThan(0);
  for (const journal of journals) {
    if (journal.appSessionId === blankResumeOf) {
      const verdict = blankResumeStartupRejection(journal.rows);
      expect(verdict.failures, `${journal.appSessionId}: the refused resume’s only inbound frame is a zero-turn, zero-cost, zero-usage error result in its second launch`).toEqual([]);
      expect(journal.turns, `${journal.appSessionId}: no user message, that one result alone as a model frame`).toMatchObject({ userFrames: 0, modelFrames: 1, needsAuth: 0 });
    } else expect(journal.turns, `${journal.appSessionId}: no user message and no model frame`).toMatchObject({ userFrames: 0, modelFrames: 0, needsAuth: 0 });
    expect(journal.dirMode, `${journal.appSessionId}: its journal directory is 0700`).toBe(0o700);
    for (const mode of journal.fileModes) expect(mode, `${journal.appSessionId}: its journal files are 0600`).toBe(0o600);
  }
}
// P3-HD M4b end
