// C12's engine custody, live (C12 execution document, M4, Acceptance item 7 and Concrete Steps "M4 custody"): the built
// app over `out/` (MAWS_ENGINE_SOURCE_DIR is refused when packaged) with custody opted in against a scratch source
// directory holding a copy of the pinned binary, under a scratch config home, through ClaudeUsage's relay. The spec
// relaunches MAWS over one `userData` for each step and starts each session through the product's "+" path in a
// scratch repository:
//   1. a first start copies the binary to <userData>/engine/2.1.283/claude with its manifest and SHA-256; `codesign -v`
//      passes on the copy; a session launches from it (the journal's spawn.bin is the copy);
//   2. with the scratch source deleted, launches still work;
//   3. with one byte of the copy changed, main refuses the next launch when its setup begins, with the `mismatch`
//      message: no new journal, no spawn, no new session record;
//   4. with the copy deleted too, the refusal is `missing` and names reinstalling 2.1.283 or choosing a binary path.
// The installer's directory is only read (`ls -l` of the pin before and after), and the owner's ~/.claude.json gains no
// scratch path. Run on purpose only; it spends usage (the M4 limit is US$1, read from the journals):
//   export S=/private/tmp/maws-c12-custody-$(date +%s) && mkdir -p $S/source $S/userData
//   export CLAUDE_CONFIG_DIR=$S/config && mkdir -p $CLAUDE_CONFIG_DIR && printf '{}\n' > $CLAUDE_CONFIG_DIR/settings.json
//   git init -q $S/repo && git -C $S/repo commit -q --allow-empty -m init
//   cp /Users/new/.local/share/claude/versions/2.1.283 $S/source/2.1.283
//   pnpm build && MAWS_C12_LIVE=1 MAWS_ENGINE_SOURCE_DIR=$S/source MAWS_USER_DATA=$S/userData pnpm exec playwright test e2e/c12-custody.spec.ts
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import { ENGINE_BIN, ENGINE_VERSION } from '../src/engine-host/launch';
import { assertConfigHomeSafe } from '../test/live/support/live';
import { journal } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { c12LiveSkipReason, lsPin, ownerFileCheck, spend } from './support/c12-live';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';

const skip = c12LiveSkipReason() ?? (process.env.MAWS_ENGINE_SOURCE_DIR ? null : 'the custody run needs MAWS_ENGINE_SOURCE_DIR (Concrete Steps, "M4 custody")');
test.skip(skip !== null, skip ?? '');
test.describe.configure({ timeout: 900_000 });

const PIN_SHA256 = 'd8cb1e5c79684cc12a8bfc813e3a2073406921b6245744b3009be3ab5651d21e';
const MAX_USD = 1;
const EVIDENCE = join(REPO_ROOT, 'docs/doperpowers/evidence/c12');
const home = (text: string) => text.replaceAll(homedir(), '~');

interface Scratch { root: string; config: string; userData: string; source: string; repo: string; copy: string }
let s: Scratch;
const run: Record<string, unknown> = {};
function record(key: string, v: unknown): void {
  run[key] = v;
  writeFileSync(join(s.root, 'custody-run.json'), `${JSON.stringify(run, null, 2)}\n`);
}

// The exported scratch, refused unless every path is under one /private/tmp/maws-c12-custody-* root, the config home's
// settings are `{}` and the source holds a byte-identical copy of the pin (never the installer's own directory).
function custodyScratch(): Scratch {
  const config = realpathSync(process.env.CLAUDE_CONFIG_DIR ?? '');
  const userData = realpathSync(process.env.MAWS_USER_DATA ?? '');
  const source = realpathSync(process.env.MAWS_ENGINE_SOURCE_DIR ?? '');
  const root = dirname(config);
  if (!root.startsWith('/private/tmp/maws-c12-custody-') || dirname(userData) !== root || dirname(source) !== root) throw new Error(`export the scratch under one /private/tmp/maws-c12-custody-* root (Concrete Steps, "M4 custody"): ${config}, ${userData}, ${source}`);
  if (JSON.stringify(JSON.parse(readFileSync(join(config, 'settings.json'), 'utf8'))) !== '{}') throw new Error(`${config}/settings.json must hold {}`);
  if (source === dirname(realpathSync(ENGINE_BIN))) throw new Error('the source must be a scratch copy, never the installer’s directory');
  assertConfigHomeSafe({ configHome: config, controls: ['launch:trust'] });
  const repo = join(root, 'repo');
  if (!existsSync(join(repo, '.git'))) throw new Error(`${repo} must be a git repository`);
  return { root, config, userData, source, repo, copy: join(userData, 'engine', ENGINE_VERSION, 'claude') };
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const journals = () => {
  const dir = join(s.userData, 'engine-host', 'journal');
  return existsSync(dir) ? readdirSync(dir).flatMap((id) => readdirSync(join(dir, id)).map((f) => join(dir, id, f))) : [];
};
const spawnBin = (path: string) => (journal(path).find((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === 'spawn')?.frame as { bin?: string } | undefined)?.bin ?? null;

test.beforeAll(() => {
  s = custodyScratch();
  expect(sha256(join(s.source, ENGINE_VERSION)), 'the scratch source is the pin, byte for byte').toBe(PIN_SHA256);
  const before = ownerFileCheck(s.root);
  record('scratch', { root: s.root, source: s.source, copy: s.copy });
  record('ownerFileCheck', { before, after: null });
  record('pinLs', { before: lsPin(), after: null });
  expect(before, 'no scratch path in the owner’s ~/.claude.json before the run').toEqual([]);
});

test.afterAll(() => {
  if (!s) return;
  const after = ownerFileCheck(s.root);
  record('ownerFileCheck', { ...(run.ownerFileCheck as object), after });
  record('pinLs', { ...(run.pinLs as object), after: lsPin() });
  record('spend', spend(s.userData));
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, 'custody-run.json'), `${JSON.stringify(run, null, 2)}\n`);
  expect(after, 'no scratch path in the owner’s ~/.claude.json after the run').toEqual([]);
  expect((run.pinLs as { before: string; after: string }).after, 'the installer’s pin is untouched').toBe((run.pinLs as { before: string }).before);
});

const main = (page: Page) => page.locator('[data-region="main"]');
const sidebar = (page: Page) => page.locator('[data-region="sidebar"]');

async function relaunch(): Promise<MawsLaunch> {
  const maws = await launchMaws({ userData: s.userData, env: { MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: s.config } });
  await expect(main(maws.page)).toBeVisible();
  return maws;
}

// "+" on the scratch project, Haiku for spend, the first message from the unstarted tab's composer, the trust card
// answered where the folder is not yet trusted; answers the new app id.
async function plus(page: Page, first: string): Promise<AppSessionId> {
  const spent = spend(s.userData).upperBoundUsd;
  if (spent >= MAX_USD) throw new Error(`spend limit: the journals show US$${spent} of US$${MAX_USD}`);
  await invoke(page, 'session.projects.add', { directory: s.repo }); // a relaunch finds it already added
  const known = new Set(value(await invoke(page, 'session.intent.list', undefined)).intents.map((i) => i.appSessionId));
  await sidebar(page).getByRole('button', { name: 'New session in repo', exact: true }).click();
  let id: AppSessionId | undefined;
  await expect.poll(async () => (id = value(await invoke(page, 'session.intent.list', undefined)).intents.find((i) => !known.has(i.appSessionId))?.appSessionId)).toBeDefined();
  value(await invoke(page, 'session.intent.patch', { appSessionId: id!, patch: { model: 'haiku' } }));
  await main(page).getByRole('textbox', { name: 'Message' }).click();
  await page.keyboard.insertText(first);
  await page.keyboard.press('Enter');
  return id!;
}

async function launched(page: Page, id: AppSessionId): Promise<void> {
  const card = page.getByRole('group', { name: 'Trust this folder?' });
  const status = async () => {
    const r = await invoke(page, 'session.status', { appSessionId: id });
    return r.ok ? r.value : null;
  };
  await expect.poll(async () => (await card.isVisible()) || (await status()) !== null, { timeout: 60_000 }).toBe(true);
  if (await card.isVisible()) await card.getByRole('button', { name: 'Trust and start' }).click();
  await expect.poll(async () => (await status())?.process ?? null, { timeout: 120_000 }).toBe('ready');
  await expect.poll(async () => { const now = await status(); return now !== null && now.turn === null; }, { timeout: 120_000 }).toBe(true);
}

// A refused start: the setup fails at its first step with custody's message; nothing was spawned, journalled or recorded.
async function refused(page: Page, words: string): Promise<{ message: string }> {
  const journalsBefore = journals();
  const recordsBefore = value(await invoke(page, 'session.list', {})).sessions.length;
  const id = await plus(page, 'Reply with exactly OK.');
  let failure: { message: string } | null = null;
  await expect.poll(async () => (failure = value(await invoke(page, 'session.intent.list', undefined)).intents.find((i) => i.appSessionId === id)?.progress.lastFailure ?? null), { timeout: 30_000 }).not.toBeNull();
  expect(failure!.message).toContain(words);
  await expect(main(page)).toContainText(words);
  expect(journals(), 'no new journal').toEqual(journalsBefore);
  expect(value(await invoke(page, 'engine.sessions', undefined)).filter((x) => x.appSessionId === id), 'no spawn').toEqual([]);
  expect(value(await invoke(page, 'session.list', {})).sessions.length, 'no new session record').toBe(recordsBefore);
  return failure!;
}

test('custody: the copy, launches from it, the source gone, one byte altered, both gone', async () => {
  await test.step('1: a first start copies the pin with its manifest; codesign verifies it; a session launches from it', async () => {
    const started = Date.now();
    const maws = await relaunch();
    try {
      const { page } = maws;
      const custody = value(await invoke(page, 'settings.engineCustody', undefined));
      const answeredMs = Date.now() - started;
      expect(custody).toMatchObject({ state: 'ok', path: s.copy, manifest: { version: ENGINE_VERSION, sha256: PIN_SHA256, source: join(s.source, ENGINE_VERSION) } });
      expect(sha256(s.copy)).toBe(PIN_SHA256);
      const manifest = JSON.parse(readFileSync(join(dirname(s.copy), 'manifest.json'), 'utf8')) as { sha256: string };
      expect(manifest.sha256).toBe(PIN_SHA256);
      // read-only verification of the signature the copy carries (never a signing step)
      const codesignV = spawnSync('/usr/bin/codesign', ['-v', s.copy], { encoding: 'utf8' });
      expect(codesignV.status, `codesign -v: ${codesignV.stderr}`).toBe(0);
      const codesignDv = spawnSync('/usr/bin/codesign', ['-dv', s.copy], { encoding: 'utf8' });
      const df = execFileSync('/bin/df', [s.userData, dirname(ENGINE_BIN)], { encoding: 'utf8' }).trim().split('\n');
      const id = await plus(page, 'Reply with exactly OK.');
      await launched(page, id);
      const bins = journals().map(spawnBin).filter((b): b is string => b !== null);
      expect(bins.length).toBeGreaterThan(0);
      expect(new Set(bins), 'every spawn (the trust bootstrap included) ran the copy').toEqual(new Set([s.copy]));
      record('step1', { custody, answeredMsFromLaunch: answeredMs, sha256: sha256(s.copy), codesignV: { status: codesignV.status, output: codesignV.stderr.trim() }, codesignDv: home(codesignDv.stderr.trim()).split('\n'), df: df.map(home), spawnBins: [...new Set(bins)], appSessionId: id });
    } finally {
      await maws.cleanup();
    }
  });

  await test.step('2: with the scratch source deleted, launches still work', async () => {
    rmSync(join(s.source, ENGINE_VERSION));
    const maws = await relaunch();
    try {
      const { page } = maws;
      expect(value(await invoke(page, 'settings.engineCustody', undefined))).toMatchObject({ state: 'ok', path: s.copy });
      const before = new Set(journals());
      const id = await plus(page, 'Reply with exactly OK.');
      await launched(page, id);
      const fresh = journals().filter((j) => !before.has(j));
      expect(fresh.map(spawnBin)).toEqual(fresh.map(() => s.copy));
      record('step2', { sourceDeleted: true, appSessionId: id, spawnBins: fresh.map(spawnBin) });
    } finally {
      await maws.cleanup();
    }
  });

  await test.step('3: one byte of the copy altered: main refuses the next launch with the mismatch message', async () => {
    const fd = openSync(s.copy, 'r+'); // printf x | dd of=… bs=1 seek=1000 conv=notrunc
    writeSync(fd, 'x', 1000);
    closeSync(fd);
    const maws = await relaunch();
    try {
      const { page } = maws;
      const custody = value(await invoke(page, 'settings.engineCustody', undefined));
      expect(custody).toMatchObject({ state: 'mismatch', path: s.copy });
      const failure = await refused(page, `Claude Code ${ENGINE_VERSION} has been altered in MAWS's copy at ${s.copy}`);
      expect(failure.message).toMatch(/^binary_version: /);
      record('step3', { custody, failure: failure.message });
    } finally {
      await maws.cleanup();
    }
  });

  await test.step('4: the copy deleted too: the refusal is missing and names the fix', async () => {
    rmSync(join(s.userData, 'engine'), { recursive: true });
    const maws = await relaunch();
    try {
      const { page } = maws;
      const custody = value(await invoke(page, 'settings.engineCustody', undefined));
      expect(custody).toMatchObject({ state: 'missing', path: s.copy });
      const failure = await refused(page, `Claude Code ${ENGINE_VERSION} is missing from MAWS's copy at ${s.copy}`);
      expect(failure.message).toMatch(/^binary_missing: /);
      expect(failure.message).toContain(`Reinstall Claude Code ${ENGINE_VERSION}`);
      expect(failure.message).toContain('or choose a binary path in Settings › Engine.');
      record('step4', { custody, failure: failure.message });
    } finally {
      await maws.cleanup();
    }
  });
});
