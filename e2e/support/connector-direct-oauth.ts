// P3-HD M4b: the OAuth scenes' app-side support (e2e/connectors-oauth.spec.ts), over the toy fixture of
// ./connector-oauth.ts and its fake browser (./connector-oauth-browser.ts). docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md,
// acceptance 4 and 6, Decision Log 23, 25 and 28:
// - `expectScratchCustody` reads, on each launch and before any owner action, that main runs on the mock keychain with
//   the scene's own canonical profile under the OS temporary directory (the product's guard stands before every real
//   safeStorage call; this is the scene's own check of the same facts);
// - `MainOutput` keeps main's stdout and stderr across the scene's launches, for the secret scan;
// - `connectThroughBrowser` is the owner's Connect from the sheet: the callback listener main binds (exactly
//   127.0.0.1, read with lsof), the reviewed fake browser following only the fixture's authorization and that callback,
//   and the listener closed after its one answer. The raw open log carries the authorization URL's state and PKCE
//   challenge: only the reviewed helpers read it, in memory; nothing here prints, attaches or asserts on its text;
// - `sealedRecords` reads `<userData>/connectors/oauth/` (modes, the format line, the ciphertext), never decrypting;
// - `cleanShot` attaches a screenshot only after the live documents scanned clean (the whole-scratch scan is
//   ./connector-direct-checks.ts `scanScratchTree`).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type ElectronApplication, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { ConnectorServerRow } from '@shared/ipc/schema/connectors';
import { SERVERS_COPY as S } from '../../src/renderer/src/tools/artifacts/viewers/connectors/copy';
import { addedListeners, attachIfClean, custodyProblems, loopbackPort, readSealedText } from './connector-direct-checks';
import { followAuthorization, openExternalUrls, type FollowedAuthorization } from './connector-oauth-browser';
import { readOAuthLog, scanForSecrets, type OAuthFixturePaths } from './connector-oauth';
import { onLaunched } from './launch';
import { tcpListeners } from './processes';
import type { ConnectorScene, Run } from './connector-scene';

export const httpEntry = (url: string): Record<string, unknown> => ({ type: 'http', url });
export const openLogOf = (scene: ConnectorScene): string => join(scene.root, 'open.log');

const canonical = (path: string | null): string | null => {
  if (path === null) return null;
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
};

// Main's own facts, compared before the owner touches anything that could reach safeStorage.
export async function expectScratchCustody(run: Run, scene: ConnectorScene): Promise<{ mockKeychain: boolean; profile: 'scene' }> {
  const facts = await run.maws.app.evaluate(({ app }) => ({ mockKeychain: app.commandLine.hasSwitch('use-mock-keychain'), userData: app.getPath('userData'), scratch: process.env.MAWS_USER_DATA ?? null }));
  const problems = custodyProblems({ mockKeychain: facts.mockKeychain, userData: canonical(facts.userData), scratch: canonical(facts.scratch), expected: canonical(scene.userData), tmp: canonical(tmpdir()) });
  expect(problems, 'main runs on the mock keychain with the scene’s own scratch profile').toEqual([]);
  scene.note('custody', { mockKeychain: facts.mockKeychain, profile: 'scene' });
  return { mockKeychain: facts.mockKeychain, profile: 'scene' };
}

// Main's stdout and stderr from each launch (Playwright pipes both), kept across relaunches.
export class MainOutput {
  private readonly chunks: string[] = [];
  launch(scene: ConnectorScene): Promise<Run> {
    return onLaunched((app: ElectronApplication) => {
      const child = app.process();
      child.stdout?.on('data', (data: Buffer) => this.chunks.push(data.toString('utf8')));
      child.stderr?.on('data', (data: Buffer) => this.chunks.push(data.toString('utf8')));
    }, () => scene.launch());
  }
  text(): string {
    return this.chunks.join('');
  }
}

// The pids listening on a TCP port of any address; [] for none.
export function listenersOnPort(port: number): number[] {
  try {
    return execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number);
  } catch {
    return []; // lsof exits 1 when nothing matches
  }
}

// How many browser opens main has written to the scene's open log (read in memory, never kept).
export function browserOpens(openLog: string): number {
  return openExternalUrls(existsSync(openLog) ? readFileSync(openLog, 'utf8') : '').length;
}

export interface Bound {
  address: string; // lsof's spelling: exactly 127.0.0.1:<port>
  port: number;
  followed?: Pick<FollowedAuthorization, 'authorizeStatus' | 'outcome' | 'callbackStatus'> & { callbackPortMatches: boolean };
}

// The owner's Connect (or Reconnect) on a server's row: the listener it binds in main, and unless `follow` is false the
// fake browser through the fixture's consent to that listener, which then closes.
export async function connectThroughBrowser(options: { run: Run; row: Locator; server: string; openLog: string; origin: string; reconnect?: boolean; follow?: boolean }): Promise<Bound> {
  const pid = options.run.child.pid!;
  const before = tcpListeners(pid);
  const afterOpens = browserOpens(options.openLog);
  await options.row.getByRole('button', { name: options.reconnect ? S.reconnectLabel(options.server) : S.connectLabel(options.server) }).click();
  let added: string[] = [];
  await expect.poll(() => (added = addedListeners(before, tcpListeners(pid))).length, { timeout: 20_000, message: 'the Connect bound a callback listener in main' }).toBeGreaterThan(0);
  expect(added, 'one listener').toHaveLength(1);
  const address = added[0]!;
  const port = loopbackPort(address);
  expect(port, `the listener is bound on exactly 127.0.0.1 (lsof: ${address})`).not.toBeNull();
  if (options.follow === false) return { address, port: port! };
  const followed = await followAuthorization({ openLog: options.openLog, afterOpens, origin: options.origin });
  const safe = { authorizeStatus: followed.authorizeStatus, outcome: followed.outcome, callbackStatus: followed.callbackStatus, callbackPortMatches: followed.callbackPort === port };
  expect(safe, 'the fixture consented and MAWS’s listener took the code').toEqual({ authorizeStatus: 302, outcome: 'code', callbackStatus: 200, callbackPortMatches: true });
  await expect.poll(() => tcpListeners(pid).includes(address), { timeout: 10_000, message: 'the listener closed after its one callback' }).toBe(false);
  return { address, port: port!, followed: safe };
}

// The sheet's words for an HTTP source row in a given connection state (copy.ts's own sentence).
export function connectionWords(state: NonNullable<Extract<ConnectorServerRow, { kind: 'source' }>['connection']>['state']): string {
  return S.connection({ kind: 'source', handle: '00000000-0000-4000-8000-000000000000', server: 'x', scope: 'user', path: '/x', transport: 'http', tools: [], needsDiscovery: false, connection: { state } });
}

export interface SealedRecord {
  connectionId: string; // the file's opaque name
  mode: number;
  text: string; // for in-memory scans only; never retained
  ciphertext: Buffer | null; // null: the file is not the sealed format
}
export interface SealedStore {
  dirMode: number | null; // <userData>/connectors/oauth
  parentMode: number | null; // <userData>/connectors
  records: SealedRecord[];
}

export function sealedRecords(scene: ConnectorScene): SealedStore {
  const parent = join(scene.userData, 'connectors');
  const dir = join(parent, 'oauth');
  const mode = (path: string) => (existsSync(path) ? statSync(path).mode & 0o777 : null);
  const records = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.sealed'))
        .sort()
        .map((name) => {
          const path = join(dir, name);
          const text = readFileSync(path, 'utf8');
          const read = readSealedText(text);
          return { connectionId: name.slice(0, -'.sealed'.length), mode: statSync(path).mode & 0o777, text, ciphertext: read.ok ? read.ciphertext : null };
        })
    : [];
  return { dirMode: mode(dir), parentMode: mode(parent), records };
}

// Every frame's document of the app's window, for the secret scans: a frame that cannot be read fails the scan.
export async function documentTexts(page: Page): Promise<string[]> {
  return Promise.all(page.frames().map((frame) => frame.content()));
}

// A screenshot of the live sheet or page, attached only after every document of the app's window, read as it is shown,
// scanned clean against each fixture that has minted secrets (./connector-direct-checks.ts attachIfClean).
export async function cleanShot(info: TestInfo, name: string, target: Locator, page: Page, fixtures: readonly OAuthFixturePaths[]): Promise<void> {
  const minted = fixtures.filter((fixture) => existsSync(fixture.secrets));
  const { documents } = await attachIfClean({
    read: () => documentTexts(page),
    scan: (texts) => {
      const found: Record<string, number> = {};
      for (const fixture of minted) for (const [kind, count] of Object.entries(scanForSecrets(fixture, texts).found)) found[kind] = (found[kind] ?? 0) + (count ?? 0);
      return found;
    },
    capture: () => target.screenshot(),
    attach: (body) => info.attach(name, { body, contentType: 'image/png' }),
  });
  info.annotations.push({ type: 'clean-shot', description: JSON.stringify({ name, documents, fixturesScanned: minted.length }) });
}

// The fixture's MCP requests since `from` (ms).
export const mcpRequestsSince = (fixture: Pick<OAuthFixturePaths, 'id' | 'log'>, from: number) => readOAuthLog(fixture).filter((entry) => entry.route === 'mcp' && Date.parse(entry.at) >= from);
// Its tools/call requests, answered or not: the submissions a refresh made.
export const toolCallAttempts = (fixture: Pick<OAuthFixturePaths, 'id' | 'log'>) => readOAuthLog(fixture).filter((entry) => entry.route === 'mcp' && entry.method === 'tools/call').length;
