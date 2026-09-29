import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsageSnapshotSchema, type UsageSnapshot } from '@shared/usage/types';
import { TEST_FIXTURE_DIR } from '../../../test/support/fixtures';
import { ClaudeUsageReader, claudeUsageDir } from './claude-usage-reader';

// The redacted copy of the owner's ClaudeUsage directory (test/support/redact-claude-usage.ts), read in place: the reader
// only reads. Suites that change files work on a copy in a temporary directory.
const FIXTURE = join(TEST_FIXTURE_DIR, 'claude-usage');
const DRAIN = '2aca3c4b-1e77-4091-908b-d183f6b0f092';
const ACCOUNTS = ['477e393c-5c1a-4413-a3e6-7f5d1ed72cc3', 'fa95bd34-0db9-44ae-be00-4f2b7387054b', DRAIN, 'aa9db20d-af2c-4718-ba6f-5cea946b4974', 'c07e5b82-c428-48ae-b904-9c1a4b26ec25'];
const PINNED_TO_DRAIN = 'ee6392b2-e458-4542-9fe0-8a52cf6dc731';

let scratch: string;
const readers: ClaudeUsageReader[] = [];
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-usage-'));
});
afterEach(() => {
  for (const reader of readers.splice(0)) reader.stop();
  rmSync(scratch, { recursive: true, force: true });
});

function reader(dir: string, emitted: UsageSnapshot[] = []) {
  const r = new ClaudeUsageReader({ dir, emit: (snapshot) => emitted.push(UsageSnapshotSchema.parse(snapshot)), log: () => {} });
  readers.push(r);
  return r;
}
function copy(): string {
  const dir = join(scratch, 'ClaudeUsage');
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, what: string, ms = 2_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await wait(10);
  }
}

describe('claude-usage reader parses the fixture directory', () => {
  it('answers every account with its newest window per key, the drain target and the pins, redacted as committed', async () => {
    const snapshot = UsageSnapshotSchema.parse(await reader(FIXTURE).snapshot([]));
    expect(snapshot).toMatchObject({ available: true, dataDir: FIXTURE, error: null, drainTarget: DRAIN, drainTargetIsManual: false, pinsFor: {} });
    expect(snapshot.accounts.map((a) => a.uuid)).toEqual(ACCOUNTS); // accounts.json order
    expect(snapshot.accounts.map((a) => [a.email, a.displayName])).toEqual(ACCOUNTS.map((_, i) => [`${i + 1}@example.test`, `Account ${i + 1}`]));
    const drain = snapshot.accounts.find((a) => a.uuid === DRAIN)!;
    expect(drain).toEqual({
      uuid: DRAIN, email: '3@example.test', displayName: 'Account 3', planLabel: 'Max', rateLimitTier: 'default_claude_max_20x', needsReauthentication: false,
      lastSeenActive: drain.lastSeenActive, pinnedSessionCount: 8, credentialOwnership: 'appManaged',
      windows: {
        fiveHour: { percent: 53, resetsAt: '2026-09-29T11:20:00Z', recordedAt: '2026-09-29T07:34:17Z' }, // the newest `session` row
        sevenDay: { percent: 63, resetsAt: '2026-09-30T03:59:59Z', recordedAt: '2026-09-29T07:26:14Z' }, // the newest `weekly_all` row
        scoped: [{ model: 'Fable', window: { percent: 82, resetsAt: '2026-09-30T03:59:59Z', recordedAt: '2026-09-29T07:16:14Z' } }],
      },
    });
    expect(snapshot.accounts.map((a) => a.pinnedSessionCount)).toEqual([1, 1, 8, 1, 1]);
    for (const account of snapshot.accounts) expect(account.windows.scoped.map((s) => s.model)).toEqual(['Fable']);
    // a week that reset: the newest weekly_all row wins over the 100 % reading before the reset
    expect(snapshot.accounts[1]!.windows.sevenDay).toEqual({ percent: 0, resetsAt: '2026-10-06T03:00:00Z', recordedAt: '2026-09-29T03:00:07Z' });
  });

  it('answers pinsFor for exactly the ids asked, and reads nothing it is not asked to write', async () => {
    const before = readFileSync(join(FIXTURE, 'pins.json'), 'utf8');
    const r = reader(FIXTURE);
    expect((await r.snapshot([PINNED_TO_DRAIN, 'not-pinned'])).pinsFor).toEqual({ [PINNED_TO_DRAIN]: DRAIN });
    expect((await r.snapshot([])).pinsFor).toEqual({});
    expect(readFileSync(join(FIXTURE, 'pins.json'), 'utf8')).toBe(before);
  });

  it('reads an older file set: no drainTargetIsManual is false, no credentialOwnership is null, legacy passes', async () => {
    const dir = copy();
    const pins = JSON.parse(readFileSync(join(dir, 'pins.json'), 'utf8')) as Record<string, unknown>;
    delete pins.drainTargetIsManual;
    writeFileSync(join(dir, 'pins.json'), JSON.stringify(pins));
    const accounts = JSON.parse(readFileSync(join(dir, 'accounts.json'), 'utf8')) as Record<string, unknown>[];
    delete accounts[0]!.credentialOwnership;
    accounts[1]!.credentialOwnership = 'legacy';
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify(accounts));
    const snapshot = await reader(dir).snapshot([]);
    expect(snapshot.drainTargetIsManual).toBe(false);
    expect(snapshot.accounts.map((a) => a.credentialOwnership).slice(0, 3)).toEqual([null, 'legacy', 'appManaged']);
  });

  it('answers available: false with an error when the directory is absent', async () => {
    const snapshot = UsageSnapshotSchema.parse(await reader(join(scratch, 'nowhere')).snapshot(['x']));
    expect(snapshot).toMatchObject({ available: false, accounts: [], drainTarget: null, drainTargetIsManual: false, pinsFor: {} });
    expect(snapshot.error).toMatch(/not installed|no data/);
  });

  it('keeps the previous pins over a torn pins.json, and a torn last history row costs only that row', async () => {
    const dir = copy();
    const r = reader(dir);
    expect((await r.snapshot([PINNED_TO_DRAIN])).pinsFor).toEqual({ [PINNED_TO_DRAIN]: DRAIN });
    writeFileSync(join(dir, 'pins.json'), '{"drainTarget": "2aca3c4b'); // a write caught halfway
    appendFileSync(join(dir, 'history', `${DRAIN}.jsonl`), '{"limitKey":"session","percent":99,"recor');
    await r.refresh();
    const snapshot = await r.snapshot([PINNED_TO_DRAIN]);
    expect(snapshot.pinsFor).toEqual({ [PINNED_TO_DRAIN]: DRAIN });
    expect(snapshot.drainTarget).toBe(DRAIN);
    expect(snapshot.accounts.find((a) => a.uuid === DRAIN)!.windows.fiveHour!.percent).toBe(53);
  });

  it('reads only the last 64 KiB of a history file', async () => {
    const dir = copy();
    const file = join(dir, 'history', `${DRAIN}.jsonl`);
    const old = `${JSON.stringify({ limitKey: 'weekly_scoped#Haiku', percent: 5, recordedAt: '2026-09-01T00:00:00Z', resetsAt: '2026-09-08T00:00:00Z' })}\n`;
    const filler = `${JSON.stringify({ limitKey: 'session', percent: 1, recordedAt: '2026-09-02T00:00:00Z', resetsAt: '2026-09-02T05:00:00Z' })}\n`.repeat(1_000);
    writeFileSync(file, old + filler + readFileSync(join(FIXTURE, 'history', `${DRAIN}.jsonl`), 'utf8'));
    const drain = (await reader(dir).snapshot([])).accounts.find((a) => a.uuid === DRAIN)!;
    expect(drain.windows.scoped.map((s) => s.model)).toEqual(['Fable']); // the Haiku row lies before the tail
    expect(drain.windows.fiveHour!.percent).toBe(53);
  });

  it('emits settings.usageChanged once within a second of a history rewrite, with pinsFor for the last ids asked; an identical rewrite emits nothing', async () => {
    const dir = copy();
    const emitted: UsageSnapshot[] = [];
    const r = reader(dir, emitted);
    r.start();
    await r.snapshot([PINNED_TO_DRAIN]);
    await wait(100); // the watchers are armed
    const file = join(dir, 'history', `${DRAIN}.jsonl`);
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, `${text}${JSON.stringify({ limitKey: 'session', percent: 60, recordedAt: '2026-09-29T07:40:00Z', resetsAt: '2026-09-29T11:20:00Z' })}\n`);
    const started = Date.now();
    await until(() => emitted.length > 0, 'settings.usageChanged');
    expect(Date.now() - started).toBeLessThan(1_000);
    await wait(700); // the debounce coalesced every event of the rewrite into one
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.accounts.find((a) => a.uuid === DRAIN)!.windows.fiveHour!.percent).toBe(60);
    expect(emitted[0]!.pinsFor).toEqual({ [PINNED_TO_DRAIN]: DRAIN });

    writeFileSync(file, readFileSync(file, 'utf8')); // the same bytes again
    await wait(1_200);
    expect(emitted).toHaveLength(1);
  });
});

describe('the ClaudeUsage directory', () => {
  it('is MAWS_CLAUDE_USAGE_DIR when set, else under the home directory', () => {
    expect(claudeUsageDir({ MAWS_CLAUDE_USAGE_DIR: '/fixture' }, '/Users/x')).toBe('/fixture');
    expect(claudeUsageDir({}, '/Users/x')).toBe('/Users/x/Library/Application Support/ClaudeUsage');
  });
});
