// The relay's last ten minutes from `gateway-requests.jsonl` (W6, E1) over the committed fixture's synthetic requests:
// ClaudeUsage's activity and health at the fixture's clock, and the file followed as the relay appends to it, rolls it
// at a UTC day, or a write is caught halfway.
import { appendFileSync, cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEST_FIXTURE_DIR } from '../../../test/support/fixtures';
import { FIRST_TAIL_BYTES, RequestLedger } from './request-ledger';

const FIXTURE = join(TEST_FIXTURE_DIR, 'claude-usage', 'gateway-requests.jsonl');
const NOW = Date.parse('2026-09-29T07:36:17Z');
const A3 = '2aca3c4b-1e77-4091-908b-d183f6b0f092';
const A1 = '477e393c-5c1a-4413-a3e6-7f5d1ed72cc3';
const C6 = 'c0de0001-0000-4000-8000-000000000006';

let scratch: string;
let file: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-requests-'));
  file = join(scratch, 'gateway-requests.jsonl');
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const line = (startedAt: string, account: string | null, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ startedAt, account, outcome: 'served', totalSeconds: 2, firstByteSeconds: 1, usage: { input: 100, cacheRead: 900, cacheWrite: 0 }, ...extra })}\n`;

describe('the request ledger', () => {
  it("summarises the fixture's last ten minutes as ClaudeUsage's panel does", async () => {
    const activity = await new RequestLedger(FIXTURE).read(NOW);
    expect(activity!.accounts).toEqual([
      { account: A3, requests: 5, cacheHitRatio: 257_000 / 264_000, lastServed: '2026-09-29T07:35:33.000Z' },
      { account: A1, requests: 1, cacheHitRatio: 20_000 / 32_000, lastServed: '2026-09-29T07:32:19.000Z' },
      { account: C6, requests: 1, cacheHitRatio: 0.75, lastServed: '2026-09-29T07:34:10.000Z' },
    ].sort((a, b) => (a.account < b.account ? -1 : 1)));
    // 07:20's request ended before the window; 07:33:10's was refused
    expect(activity!.health).toEqual({ requests: 8, served: 7, firstByteP50: 1, firstByteP95: 3.2, stalls: 1, transportFailures: 1, refused: 1, unreachable: 0, held: 1 });
  });

  it('is null without the file, and empty once the window has passed', async () => {
    expect(await new RequestLedger(join(scratch, 'none.jsonl')).read(NOW)).toBeNull();
    const ledger = new RequestLedger(FIXTURE);
    await ledger.read(NOW);
    expect(await ledger.read(NOW + 11 * 60_000)).toEqual({ accounts: [], health: { requests: 0, served: 0, firstByteP50: null, firstByteP95: null, stalls: 0, transportFailures: 0, refused: 0, unreachable: 0, held: 0 } });
  });

  it('reads only what was appended, and a torn last line once it is whole', async () => {
    writeFileSync(file, line('2026-09-29T07:30:00Z', A3));
    const ledger = new RequestLedger(file);
    expect((await ledger.read(NOW))!.health.requests).toBe(1);
    const next = line('2026-09-29T07:31:00Z', A1);
    appendFileSync(file, next.slice(0, 20)); // a write caught halfway
    expect((await ledger.read(NOW))!.health.requests).toBe(1);
    appendFileSync(file, next.slice(20));
    expect((await ledger.read(NOW))!.accounts.map((a) => [a.account, a.requests])).toEqual([[A3, 1], [A1, 1]]); // by account id
    expect((await ledger.read(NOW))!.health.requests).toBe(2); // nothing appended: nothing read twice
  });

  it('follows a rolled file from its start and keeps what the old one held; a file cut short is read afresh', async () => {
    writeFileSync(file, line('2026-09-29T07:30:00Z', A3) + line('2026-09-29T07:31:00Z', A3));
    const ledger = new RequestLedger(file);
    await ledger.read(NOW);
    renameSync(file, join(scratch, 'gateway-requests.2026-09-28.jsonl')); // ClaudeUsage's roll at the UTC day
    writeFileSync(file, line('2026-09-29T07:32:00Z', A1));
    expect((await ledger.read(NOW))!.health.requests).toBe(3);
    // the same file rewritten shorter in place: what it held is forgotten
    writeFileSync(file, `${JSON.stringify({ startedAt: '2026-09-29T07:33:00Z', account: A1, outcome: 'served', totalSeconds: 2 })}\n`);
    expect((await ledger.read(NOW))!.accounts).toEqual([{ account: A1, requests: 1, cacheHitRatio: null, lastServed: '2026-09-29T07:33:02.000Z' }]);
  });

  // Debt wave 7: lines appended after the last read and before the roll are read from the rolled file first.
  it('reads the rolled file’s unread lines before it follows the new one', async () => {
    writeFileSync(file, line('2026-09-29T07:30:00Z', A3));
    const ledger = new RequestLedger(file);
    expect((await ledger.read(NOW))!.health.requests).toBe(1);
    appendFileSync(file, line('2026-09-29T07:31:00Z', A3) + line('2026-09-29T07:31:30Z', A1)); // unread when the roll comes
    renameSync(file, join(scratch, 'gateway-requests.2026-09-29.jsonl'));
    writeFileSync(file, line('2026-09-29T07:32:00Z', A1));
    const activity = (await ledger.read(NOW))!;
    expect(activity.health.requests).toBe(4);
    expect(activity.accounts.map((a) => [a.account, a.requests])).toEqual([[A3, 2], [A1, 2]]); // by account id
    appendFileSync(file, line('2026-09-29T07:33:00Z', A1));
    expect((await ledger.read(NOW))!.health.requests).toBe(5); // the new file followed, nothing read twice
    await ledger.close();
  });

  it(`starts from the last ${FIRST_TAIL_BYTES / 1024 / 1024} MiB of a long file, dropping the line the tail cuts`, async () => {
    const old = line('2026-09-29T07:27:00Z', A1, { pad: 'x'.repeat(FIRST_TAIL_BYTES) });
    writeFileSync(file, old + readFileSync(FIXTURE, 'utf8'));
    const activity = await new RequestLedger(file).read(NOW);
    expect(activity!.health.requests).toBe(8); // the padded 1@ request lies before the tail
  });

  it('skips a line that is not a request', async () => {
    cpSync(FIXTURE, file);
    appendFileSync(file, '{"startedAt":"2026-09-29T07:35:00Z"}\nnot json\n');
    expect((await new RequestLedger(file).read(NOW))!.health.requests).toBe(8);
  });
});
