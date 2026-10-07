// The cookies category (E4b Design §7; Decision Log 10, 11, 25, 36, 37): every row decoded with the Safe Storage key
// first and classified after, then the plain rows set through the partition's `cookies.set` and the partitioned ones
// through the CHIPS route (chips-import.ts), each counted once. The key is used by `planCookies` only, so the caller
// zeroes it as soon as the plan exists. The decoded values live in the plan and the loops; nothing here logs a row.
import type { CookiesSetDetails, Session } from 'electron';
import { COOKIE_SKIP_REASONS, type CookieSkipReason, type ImportReport } from '@shared/browser/import';
import { decodeCookieRow, type ChromeCookieRow, type CookieDecodeSkipReason } from './chrome/cookies';
import type { PartitionedCookie, PartitionedResult } from './chips-import';
import { SkipTally } from './report';

export type CookiesBlock = NonNullable<ImportReport['cookies']>;

export interface CookiePlan {
  plain: { details: CookiesSetDetails; host: string }[];
  partitioned: PartitionedCookie[];
  skips: { reason: CookieDecodeSkipReason; host: string }[];
  // The wrong-key verdict: at least one decrypt failed on the key and none succeeded (rows with a plain value were never
  // attempts). Then nothing is set.
  wrongKey: boolean;
}

export function planCookies(rows: readonly ChromeCookieRow[], key: Buffer, storeVersion: number, nowMs: number = Date.now()): CookiePlan {
  const decodes = rows.map((row) => decodeCookieRow(row, key, storeVersion, nowMs));
  const wrongKey = decodes.some((decode) => decode.kind === 'skipped' && decode.reason === 'wrongKey') && !decodes.some((decode) => decode.decrypted);
  const plan: CookiePlan = { plain: [], partitioned: [], skips: [], wrongKey };
  for (const decode of decodes) {
    if (decode.kind === 'skipped') {
      // The key is one key: a few rows it cannot open among many it can are unreadable rows, not a wrong key.
      plan.skips.push({ reason: decode.reason === 'wrongKey' && !wrongKey ? 'corruptRow' : decode.reason, host: decode.host });
    } else if (wrongKey) {
      plan.skips.push({ reason: 'wrongKey', host: decode.host }); // under the verdict nothing is set, a plain-value row included
    } else if (decode.kind === 'plain') {
      plan.plain.push({ details: decode.details, host: decode.host });
    } else {
      plan.partitioned.push({ cdp: decode.cdp, host: decode.host });
    }
  }
  return plan;
}

export type ImportPartitioned = (input: {
  partition: string;
  cookies: readonly PartitionedCookie[];
  signal: AbortSignal;
  progress: (phase: 'cookies' | 'verifying', done: number, total: number) => void;
}) => Promise<PartitionedResult>;

// Sets the plan into the partition's session and answers the report's cookies block. A row Chromium refuses is
// `rejected`; on abort every row not yet set is `cancelled`. `flushStore` runs after the plain loop and again after the
// partitioned rows, so persistent cookies reach the disk before the report.
export async function importCookies({
  plan,
  ses,
  partition,
  signal,
  progress,
  importPartitioned,
  onSkip,
}: {
  plan: CookiePlan;
  ses: Pick<Session, 'cookies'>;
  partition: string;
  signal: AbortSignal;
  progress: (phase: 'cookies' | 'verifying', done: number, total: number) => void;
  importPartitioned: ImportPartitioned;
  onSkip: (reason: CookieSkipReason, host: string) => void;
}): Promise<CookiesBlock> {
  const tally = new SkipTally(COOKIE_SKIP_REASONS, onSkip);
  for (const skip of plan.skips) tally.add(skip.reason, skip.host);
  let imported = 0;
  let error: string | null = null;
  const partitioned = { imported: 0, verified: 0 };
  const block = (): CookiesBlock => ({
    imported,
    partitioned: { ...partitioned },
    skipped: tally.skipped,
    hosts: tally.hosts,
    keychain: plan.wrongKey ? 'wrongKey' : 'allowed',
    error,
  });
  const total = plan.plain.length + plan.partitioned.length;
  if (plan.wrongKey) return block();

  progress('cookies', 0, total);
  let attempted = 0;
  for (const cookie of plan.plain) {
    if (signal.aborted) break;
    attempted++;
    try {
      await ses.cookies.set(cookie.details);
      imported++;
    } catch {
      tally.add('rejected', cookie.host); // Chromium's own exclusions; its message is not kept (it could quote the row)
    }
    progress('cookies', attempted, total);
  }
  await ses.cookies.flushStore();
  if (signal.aborted) {
    tally.add('cancelled', null, total - attempted);
    return block();
  }

  if (plan.partitioned.length > 0) {
    const result = await importPartitioned({
      partition,
      cookies: plan.partitioned,
      signal,
      progress: (phase, done, of) => (phase === 'cookies' ? progress('cookies', plan.plain.length + done, total) : progress(phase, done, of)),
    });
    partitioned.imported = result.imported;
    partitioned.verified = result.verified;
    for (const host of result.rejected) tally.add('rejected', host);
    for (const host of result.notVerified) tally.add('notVerified', host); // DL36: imported - verified of them
    tally.add('cancelled', null, result.cancelled);
    error = result.error;
    await ses.cookies.flushStore();
  }
  return block();
}
