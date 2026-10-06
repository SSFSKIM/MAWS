// The engine's cron grammar and next-match search restated (SPEC 22 §22.3; 2.1.287 cli.pretty.js 540467-540543), in
// the machine's local time as the engine runs them.
import { describe, expect, it } from 'vitest';
import { cronExpiry, nextCronMatch, parseCron, RECURRING_MAX_AGE_MS } from './cron';

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const next = (cron: string, from: number) => {
  const parsed = parseCron(cron);
  if (parsed === null) throw new Error(`unparsed: ${cron}`);
  return nextCronMatch(parsed, from);
};
const fields = (ms: number | null) => {
  if (ms === null) return null;
  const d = new Date(ms);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
};

describe('parseCron', () => {
  it('reads the five fields in order, each a sorted set without duplicates', () => {
    expect(parseCron('*/5 * * * *')).toEqual({
      minute: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55], hour: Array.from({ length: 24 }, (_, i) => i),
      dayOfMonth: Array.from({ length: 31 }, (_, i) => i + 1), month: Array.from({ length: 12 }, (_, i) => i + 1), dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(parseCron('  30 14 28 2 *  ')).toMatchObject({ minute: [30], hour: [14], dayOfMonth: [28], month: [2] });
    expect(parseCron('0 9 * * 1-5')).toMatchObject({ minute: [0], hour: [9], dayOfWeek: [1, 2, 3, 4, 5] });
    expect(parseCron('15,5,15 1-10/3 * * *')).toMatchObject({ minute: [5, 15], hour: [1, 4, 7, 10] });
  });

  it('folds day-of-week 7 to Sunday per produced value: 7 alone is Sunday, 0-7 is every day', () => {
    expect(parseCron('0 0 * * 7')?.dayOfWeek).toEqual([0]);
    expect(parseCron('0 0 * * 7-7')?.dayOfWeek).toEqual([0]);
    expect(parseCron('0 0 * * 5-7')?.dayOfWeek).toEqual([0, 5, 6]);
    expect(parseCron('0 0 * * 0-7')?.dayOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(parseCron('7 0 * * *')?.minute).toEqual([7]); // only day-of-week folds
  });

  it('is null on any failure: field count, bounds, empty steps, reversed ranges, names and macros', () => {
    for (const bad of ['* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * 32 * *', '* * * 13 *', '* * * * 8', '* * * * 6-8',
      '*/0 * * * *', '5-1 * * * *', '1-5/0 * * * *', '* * * JAN *', '* * * * MON', '@hourly', '? * * * *', '1,,2 * * * *', '-1 * * * *', '', '*/ * * * *']) {
      expect(parseCron(bad), bad).toBeNull();
    }
  });
});

describe('nextCronMatch', () => {
  it('is the first matching minute strictly after the given one, seconds zeroed', () => {
    expect(fields(next('*/5 * * * *', local(2027, 3, 10, 10, 2) + 42_000))).toEqual([2027, 3, 10, 10, 5, 0]);
    expect(fields(next('*/5 * * * *', local(2027, 3, 10, 10, 5)))).toEqual([2027, 3, 10, 10, 10, 0]); // strictly after
    expect(fields(next('0 9 * * 1-5', local(2027, 3, 12, 9, 30)))).toEqual([2027, 3, 15, 9, 0, 0]); // Friday after nine: Monday
  });

  it('skips February 29 in a year without it, and finds it in a leap year', () => {
    expect(fields(next('30 14 28 2 *', local(2027, 3, 1)))).toEqual([2028, 2, 28, 14, 30, 0]);
    expect(fields(next('0 0 29 2 *', local(2027, 3, 1)))).toEqual([2028, 2, 29, 0, 0, 0]);
  });

  it('matches either restricted day field (Vixie OR), and an unrestricted one by its length', () => {
    // 2027-05-01 is a Saturday; the first Sunday after is the 2nd, before June 1.
    expect(fields(next('0 0 1 * 0', local(2027, 4, 30, 12)))).toEqual([2027, 5, 1, 0, 0, 0]);
    expect(fields(next('0 0 1 * 0', local(2027, 5, 1, 12)))).toEqual([2027, 5, 2, 0, 0, 0]);
    expect(fields(next('0 0 1-31 * 0', local(2027, 5, 1, 12)))).toEqual([2027, 5, 2, 0, 0, 0]); // 1-31 is unrestricted: day-of-week alone
    expect(fields(next('0 0 13 * 0-6', local(2027, 5, 1, 12)))).toEqual([2027, 5, 13, 0, 0, 0]); // 0-6 is unrestricted: day-of-month alone
  });

  it('is null when no date matches within the bound', () => {
    expect(next('0 0 31 2 *', local(2027, 1, 1))).toBeNull();
  });

  // The engine steps a local-time Date: an hour the clock skips at a spring-forward never matches that day. Found in the
  // machine's own zone; a zone without DST checks the plain daily match instead.
  it('steps local time across a DST day of the machine zone as Date does', () => {
    let jump: number | null = null;
    for (let t = local(2027, 1, 1); t < local(2028, 1, 1); t += 3_600_000) {
      if (new Date(t + 3_600_000).getTimezoneOffset() < new Date(t).getTimezoneOffset()) {
        jump = t + 3_600_000;
        break;
      }
    }
    if (jump === null) {
      expect(fields(next('30 2 * * *', local(2027, 3, 14)))).toEqual([2027, 3, 14, 2, 30, 0]);
      return;
    }
    const after = new Date(jump);
    const skipped = after.getHours() - 1; // the local hour that does not exist that day
    const day = local(after.getFullYear(), after.getMonth() + 1, after.getDate());
    const following = new Date(day);
    following.setDate(following.getDate() + 1);
    expect(fields(next(`30 ${skipped} * * *`, day))).toEqual([following.getFullYear(), following.getMonth() + 1, following.getDate(), skipped, 30, 0]);
    expect(fields(next(`30 ${after.getHours()} * * *`, day))).toEqual([after.getFullYear(), after.getMonth() + 1, after.getDate(), after.getHours(), 30, 0]);
  });
});

describe('cronExpiry', () => {
  it('is seven days after creation, the engine\'s recurring max age', () => {
    expect(RECURRING_MAX_AGE_MS).toBe(7 * 24 * 3_600_000);
    expect(cronExpiry(1_000)).toBe(1_000 + RECURRING_MAX_AGE_MS);
  });
});
