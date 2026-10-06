// CronCreate's result text parsed (SPEC 22 §22.9), over E7 M0's recorded results (pass3/e7-cron seq 87, 101, 440).
import { describe, expect, it } from 'vitest';
import { loadJournal } from '../../../../../test/support/fixtures';
import { parseCronResult } from './cron-result';

const CRON = loadJournal('pass3', 'e7-cron');
const resultText = (seq: number) => (CRON.find((row) => row.seq === seq)!.frame as { message: { content: { content: string }[] } }).message.content[0]!.content;

describe('parseCronResult', () => {
  it('reads a recurring session-only job, a one-shot (its schedule the raw cron) and a durable job', () => {
    expect(parseCronResult(resultText(87))).toEqual({ id: '481abb0a', humanSchedule: 'Every 2 minutes', recurring: true, durable: false });
    expect(parseCronResult(resultText(101))).toEqual({ id: '8d1a2582', humanSchedule: '15 4 6 10 *', recurring: false, durable: false });
    expect(parseCronResult(resultText(440))).toEqual({ id: '598b1690', humanSchedule: 'Every Monday at 9:00 AM', recurring: true, durable: true });
  });

  it('is null for any other text: a delete, a list, an error', () => {
    expect(parseCronResult('Cancelled job 481abb0a.')).toBeNull();
    expect(parseCronResult('No scheduled jobs.')).toBeNull();
    expect(parseCronResult("<tool_use_error>Invalid cron expression '* *'. Expected 5 fields: M H DoM Mon DoW.</tool_use_error>")).toBeNull();
  });
});
