// A session's scheduled jobs (E7 execution document, Design §7; G5; Decision Log 23): the session-only jobs folded from
// the transcript's activity over M0's recorded `e7-cron` run and its resume (two launches' turns in one activity), and
// hand-built pairs for expiry and the edges; the durable file as the engine loads it, over M0's
// `e7-cron-durable/scheduled_tasks.json` and the engine's rewrite of it on resume; and the rows with an injected clock.
// Every time a cron names is the machine's local time, so each expectation is computed through `nextCronMatch`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextCronMatch, parseCron, RECURRING_MAX_AGE_MS } from '@shared/engine/cron';
import type { SessionEvent } from '@shared/graph/events';
import { replayed } from '../../../../../../test/support/agents-events';
import { turnActivity } from '../../../transcript/model/activity';
import { applyEvents, createState } from '../../../transcript/model/reduce';
import { builder } from '../../../transcript/model/test-events';
import { createdCrons, parseScheduledFile, projectRootOf, promptLine, scheduledRows, sessionCrons, type CronJob, type DurableJob, type ScheduledInput } from './scheduled';

const activityOf = (events: SessionEvent[]) => turnActivity(applyEvents(createState(null, null), events));
const DURABLE_DIR = join(__dirname, '../../../../../../spikes/protocol-probe/fixtures/pass3/e7-cron-durable');
const durableText = (name: string) => readFileSync(join(DURABLE_DIR, name), 'utf8');

const CRON = replayed('pass3', 'e7-cron');
const RESUME = replayed('pass3', 'e7-cron-resume');
const atOf = (events: SessionEvent[], toolName: string, nth = 0) => Date.parse(events.filter((e) => e.kind === 'tool.use' && e.toolName === toolName)[nth]!.at);
const match = (cron: string, from: number) => nextCronMatch(parseCron(cron)!, from)!;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe('createdCrons and sessionCrons over e7-cron', () => {
  it('folds the creates and the delete in order across the resume: the deleted recurring job gone, the durable one kept as created', () => {
    const activity = activityOf([...CRON, ...RESUME]);
    expect(createdCrons(activity).map(({ id, cron, prompt, recurring, durable, humanSchedule }) => ({ id, cron, prompt, recurring, durable, humanSchedule }))).toEqual([
      { id: '8d1a2582', cron: '15 4 6 10 *', prompt: 'E7 one-shot', recurring: false, durable: false, humanSchedule: '15 4 6 10 *' },
      { id: '598b1690', cron: '0 9 * * 1', prompt: 'E7 durable weekly', recurring: true, durable: true, humanSchedule: 'Every Monday at 9:00 AM' },
      { id: '1040f3a5', cron: '0 3 * * *', prompt: 'E7 nightly', recurring: true, durable: false, humanSchedule: 'Every day at 3:00 AM' },
    ]);
    const nightly = createdCrons(activity).find((job) => job.id === '1040f3a5')!;
    const call = CRON.find((e) => e.kind === 'tool.use' && e.toolName === 'CronCreate' && (e.input as { prompt?: string }).prompt === 'E7 nightly')!;
    expect(nightly).toMatchObject({ createdAt: Date.parse(call.at), toolUseId: (call as { toolUseId: string }).toolUseId, lastFiredAt: null });
    expect(activity.some((turn) => turn.turnId === nightly.turnId && turn.crons.some((c) => c.toolUseId === nightly.toolUseId))).toBe(true);
  });

  it('lists the session-only jobs the engine resurrected on resume: the one-shot only until its fire, never the durable one', () => {
    const activity = activityOf([...CRON, ...RESUME]);
    const resumedAt = Date.parse(RESUME.at(-1)!.at);
    const oneShotFire = match('15 4 6 10 *', atOf(CRON, 'CronCreate', 1));
    expect(sessionCrons(activity, oneShotFire - MINUTE).map((job) => job.id)).toEqual(['8d1a2582', '1040f3a5']);
    expect(sessionCrons(activity, oneShotFire + 1).map((job) => job.id)).toEqual(['1040f3a5']); // fired (seq 215), or missed: gone either way
    // the recorded resume's CronList (e7-cron-resume seq 44) names the nightly job and the durable one, no one-shot
    if (oneShotFire < resumedAt) expect(sessionCrons(activity, resumedAt).map((job) => job.id)).toEqual(['1040f3a5']);
  });

  it('before the delete, the first launch alone holds the recurring tick and the one-shot', () => {
    const first = CRON.filter((e) => (e.seq ?? 0) <= 166);
    const created = atOf(CRON, 'CronCreate', 1);
    expect(sessionCrons(activityOf(first), created + 1).map((job) => [job.id, job.recurring])).toEqual([['481abb0a', true], ['8d1a2582', false]]);
  });
});

describe('sessionCrons, the edges', () => {
  const T = '2026-10-01T10:00:00.000Z';
  const create = (b: ReturnType<typeof builder>, id: string, jobId: string, input: Record<string, unknown>, result: string | null) => {
    b.toolUse(id, 'CronCreate', input);
    if (result !== null) b.result(id, result);
  };
  const recurring = (jobId: string) => `Scheduled recurring job ${jobId} (Every hour). Session-only (not written to disk, dies when Claude exits). Auto-expires after 7 days.`;

  it('drops a recurring job seven days after its creation, as the engine does on resume', () => {
    const b = builder(T);
    b.turn('u1');
    create(b, 'c1', 'aaaa0001', { cron: '0 * * * *', prompt: 'hourly' }, recurring('aaaa0001'));
    const at = atOf(b.events, 'CronCreate');
    const activity = activityOf(b.events);
    expect(sessionCrons(activity, at + RECURRING_MAX_AGE_MS - 1).map((j) => j.id)).toEqual(['aaaa0001']);
    expect(sessionCrons(activity, at + RECURRING_MAX_AGE_MS + 1)).toEqual([]);
  });

  it('keeps a job whose delete has not answered, skips a refused create and a delete that failed, and lists a re-used id where it was made last', () => {
    const b = builder(T);
    b.turn('u1');
    create(b, 'c1', 'aaaa0001', { cron: '0 * * * *', prompt: 'first' }, recurring('aaaa0001'));
    b.toolUse('c2', 'CronCreate', { cron: '* *', prompt: 'bad' });
    b.result('c2', "<tool_use_error>Invalid cron expression '* *'.</tool_use_error>", { isError: true });
    create(b, 'c3', 'aaaa0002', { cron: '30 * * * *', prompt: 'second' }, recurring('aaaa0002'));
    b.toolUse('d1', 'CronDelete', { id: 'aaaa0002' });
    b.result('d1', 'No job with id aaaa0002', { isError: true });
    b.toolUse('d2', 'CronDelete', { id: 'aaaa0001' }); // no result yet
    create(b, 'c4', 'aaaa0002', { cron: '45 * * * *', prompt: 'second again' }, recurring('aaaa0002'));
    const now = atOf(b.events, 'CronCreate') + DAY;
    expect(sessionCrons(activityOf(b.events), now).map((j) => [j.id, j.prompt])).toEqual([['aaaa0001', 'first'], ['aaaa0002', 'second again']]);
    b.result('d2', 'Cancelled job aaaa0001.');
    expect(sessionCrons(activityOf(b.events), now).map((j) => j.id)).toEqual(['aaaa0002']);
  });

  it('reads a create whose result is still pending as no job yet', () => {
    const b = builder(T);
    b.turn('u1');
    create(b, 'c1', 'aaaa0001', { cron: '0 * * * *', prompt: 'pending' }, null);
    expect(createdCrons(activityOf(b.events))).toEqual([]);
  });
});

describe('parseScheduledFile', () => {
  it('reads e7-cron-durable as the engine loads it, the creator fields it does not need dropped', () => {
    expect(parseScheduledFile(durableText('scheduled_tasks.json'))).toEqual({
      ok: true,
      jobs: [{ id: '598b1690', cron: '0 9 * * 1', prompt: 'E7 durable weekly', createdAt: 1791285408190, lastFiredAt: null, recurring: true, permanent: false, createdBySessionId: '5e8ddabd-603d-4ffb-9edd-d937c627f55d' }],
    });
  });

  it('reads the engine’s rewrite on resume (only the creator’s pid and start changed) as the same jobs', () => {
    expect(parseScheduledFile(durableText('scheduled_tasks.after-resume.json'))).toEqual(parseScheduledFile(durableText('scheduled_tasks.json')));
  });

  it('skips a malformed entry, keeps the optional fields only with their type, and reads no tasks array as no jobs', () => {
    const text = JSON.stringify({
      tasks: [
        { id: 'a', cron: '0 9 * * *', prompt: 'ok', createdAt: 1, lastFiredAt: 5, permanent: true, recurring: true, createdBySessionId: 7 },
        { id: 'b', cron: '0 9 * * *', prompt: 'no createdAt' },
        { id: 3, cron: '0 9 * * *', prompt: 'numeric id', createdAt: 1 },
        'not an object',
        { id: '', cron: 'nonsense', prompt: 'kept: the row says next run unknown', createdAt: 2, recurring: 'yes' },
      ],
    });
    expect(parseScheduledFile(text)).toEqual({
      ok: true,
      jobs: [
        { id: 'a', cron: '0 9 * * *', prompt: 'ok', createdAt: 1, lastFiredAt: 5, recurring: true, permanent: true, createdBySessionId: null },
        { id: '', cron: 'nonsense', prompt: 'kept: the row says next run unknown', createdAt: 2, lastFiredAt: null, recurring: false, permanent: false, createdBySessionId: null },
      ],
    });
    expect(parseScheduledFile('{}')).toEqual({ ok: true, jobs: [] });
    expect(parseScheduledFile('[]')).toEqual({ ok: true, jobs: [] });
    expect(parseScheduledFile('{"tasks": {}}')).toEqual({ ok: true, jobs: [] });
  });

  it('is an error with the parser’s message for text that is not JSON', () => {
    const answer = parseScheduledFile('{"tasks": [');
    expect(answer.ok).toBe(false);
    expect(!answer.ok && answer.message.length).toBeGreaterThan(0);
  });
});

describe('scheduledRows', () => {
  const NOW = Date.parse('2026-10-06T12:00:00.000Z');
  const durable = (over: Partial<DurableJob> = {}): DurableJob => ({
    id: 'd1', cron: '0 9 * * 1', prompt: 'weekly', createdAt: NOW - DAY, lastFiredAt: null, recurring: true, permanent: false, createdBySessionId: 'eng-A', ...over,
  });
  const job = (over: Partial<CronJob> = {}): CronJob =>
    ({ id: 's1', cron: '0 3 * * *', prompt: 'nightly', recurring: true, durable: false, humanSchedule: 'Every day at 3:00 AM', createdAt: NOW - DAY, toolUseId: 'tu-s1', turnId: 'turn:u1', lastFiredAt: null, ...over }) as CronJob;
  const input = (over: Partial<ScheduledInput>): ScheduledInput => ({ created: [], session: [], durable: [], engineSessionId: 'eng-A', live: true, now: NOW, ...over });

  it('lists the durable jobs first, then the session-only ones, each with its next match from now and its expiry', () => {
    const session = job();
    const rows = scheduledRows(input({ created: [session], session: [session], durable: [durable(), durable({ id: 'd2', createdBySessionId: 'eng-B', permanent: true, lastFiredAt: NOW - MINUTE })] }));
    expect(rows).toEqual([
      { id: 'd1', schedule: '0 9 * * 1', recurring: true, store: 'durable-this', prompt: 'weekly', next: match('0 9 * * 1', NOW), expiresAt: NOW - DAY + RECURRING_MAX_AGE_MS, lastFiredAt: null, link: null, dormant: false },
      { id: 'd2', schedule: '0 9 * * 1', recurring: true, store: 'durable-other', prompt: 'weekly', next: match('0 9 * * 1', NOW), expiresAt: null, lastFiredAt: NOW - MINUTE, link: null, dormant: false },
      { id: 's1', schedule: 'Every day at 3:00 AM', recurring: true, store: 'session', prompt: 'nightly', next: match('0 3 * * *', NOW), expiresAt: NOW - DAY + RECURRING_MAX_AGE_MS, lastFiredAt: null, link: { toolUseId: 'tu-s1', turnId: 'turn:u1' }, dormant: false },
    ]);
  });

  it('names a durable job this transcript created by its words and links its creating call; another session’s is the cron', () => {
    const made = job({ id: 'd1', durable: true, humanSchedule: 'Every Monday at 9:00 AM', toolUseId: 'tu-d1' as CronJob['toolUseId'] });
    const [row] = scheduledRows(input({ created: [made], durable: [durable()] }));
    expect(row).toMatchObject({ schedule: 'Every Monday at 9:00 AM', link: { toolUseId: 'tu-d1', turnId: 'turn:u1' } });
    // a session-only create that shares the id is not the durable job's creation
    expect(scheduledRows(input({ created: [job({ id: 'd1' })], durable: [durable()] }))[0]).toMatchObject({ schedule: '0 9 * * 1', link: null });
    expect(scheduledRows(input({ durable: [durable()], engineSessionId: null }))[0]!.store).toBe('durable-other');
  });

  it('reads a one-shot’s next as its one fire after creation, and leaves out a durable one-shot past it', () => {
    const createdAt = NOW - 10 * MINUTE;
    const fire = match('*/30 * * * *', createdAt);
    const oneShot = durable({ id: 'o1', cron: '*/30 * * * *', recurring: false, createdAt });
    const rows = scheduledRows(input({ durable: [oneShot], now: fire - 1 }));
    expect(rows.map((r) => [r.id, r.next, r.expiresAt])).toEqual([['o1', fire, null]]);
    expect(scheduledRows(input({ durable: [oneShot], now: fire + 1 }))).toEqual([]);
  });

  it('marks session-only jobs dormant on a session not running here, says nothing for an unparsable cron, and lists no durable rows while the file is unread', () => {
    const session = job();
    expect(scheduledRows(input({ session: [session], live: false, durable: null })).map((r) => [r.id, r.dormant])).toEqual([['s1', true]]);
    expect(scheduledRows(input({ durable: [durable({ cron: 'nonsense' })] }))[0]!.next).toBeNull();
  });
});

describe('promptLine and projectRootOf', () => {
  it('keeps the first line, cut to 80 columns with an ellipsis', () => {
    expect(promptLine('check the deploy\nthen report')).toBe('check the deploy');
    expect(promptLine('x'.repeat(80))).toBe('x'.repeat(80));
    expect(promptLine('x'.repeat(81))).toBe(`${'x'.repeat(79)}…`);
  });

  it('is the launch directory, also inside a worktree (the engine’s projectRoot is its launch cwd)', () => {
    expect(projectRootOf({ directory: '/repo' })).toBe('/repo');
    expect(projectRootOf({ directory: '/repo/.claude/worktrees/w1/pkg' })).toBe('/repo/.claude/worktrees/w1/pkg');
  });
});
