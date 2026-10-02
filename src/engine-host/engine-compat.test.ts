// W13 (charter D-1 as amended 2026-10-01): a Claude Code newer than MAWS's tested version is never refused; a session
// that meets a frame MAWS does not understand while running one says so once, after what raised it.
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { JournalRow } from '@shared/wire/journal';
import { replayedSession } from './conformance/session-harness';
import { compareVersions, ENGINE_COMPAT_NOTICE_KEY, engineCompatNotice, EngineCompatWatch, newerThanTested, TESTED_ENGINE_VERSION } from './engine-compat';

const event = (kind: 'frame.unknown' | 'error.raised' | 'turn.started', extra: Record<string, unknown> = {}) => ({ kind, ...extra }) as unknown as SessionEvent;

describe('versions against the tested one', () => {
  it('orders by the three numbers, ignoring a suffix, and reads anything else as no version', () => {
    expect(compareVersions('2.1.287', '2.1.283')).toBeGreaterThan(0);
    expect(compareVersions('2.1.283', '2.1.283')).toBe(0);
    expect(compareVersions('2.1.9', '2.1.283')).toBeLessThan(0);
    expect(compareVersions('2.10.0', '2.9.999')).toBeGreaterThan(0);
    expect(compareVersions('2.1.290-dev', '2.1.290')).toBe(0);
    expect(compareVersions('dev', '2.1.283')).toBeNull();
  });

  it('only a version above the tested one is newer; none, an older one and nonsense are not', () => {
    expect(TESTED_ENGINE_VERSION).toBe('2.1.283');
    expect(newerThanTested('2.1.287')).toBe(true);
    expect(newerThanTested('3.0.0')).toBe(true);
    expect(newerThanTested('2.1.283')).toBe(false);
    expect(newerThanTested('2.1.200')).toBe(false);
    expect(newerThanTested(null)).toBe(false);
    expect(newerThanTested('unknown')).toBe(false);
  });

  it('words the notice with both versions', () => {
    expect(engineCompatNotice('2.1.287')).toBe('Claude Code 2.1.287 is newer than the version MAWS was verified against (2.1.283); some events were not understood');
  });
});

describe('the watch', () => {
  it('answers once, for an unknown frame or an invalid one, only while the version is newer than tested', () => {
    const watch = new EngineCompatWatch();
    expect(watch.observe([event('turn.started')], '2.1.287')).toBeNull(); // understood
    expect(watch.observe([event('frame.unknown')], '2.1.283')).toBeNull(); // the tested version: no notice
    expect(watch.observe([event('frame.unknown')], null)).toBeNull();
    expect(watch.observe([event('error.raised', { code: 'exited' })], '2.1.287')).toBeNull(); // not a frame MAWS could not read
    expect(watch.observe([event('error.raised', { code: 'invalid_frame' })], '2.1.287')).toBe(engineCompatNotice('2.1.287'));
    expect(watch.observe([event('frame.unknown')], '2.1.287')).toBeNull(); // once per session
    expect(new EngineCompatWatch().observe([event('frame.unknown')], '2.1.288')).toBe(engineCompatNotice('2.1.288'));
  });
});

// The probe's pass2/rewind recording through a session, with two frames of a type no recording has, after the first
// system/init; and that init's `claude_code_version` set to a newer version, or left at the tested one.
describe('a fixture replay meeting a frame of an unknown type', () => {
  const UNKNOWN = { type: 'brand_new_frame_type', payload: 1 };
  const withUnknownFrames = (version: string | null) => (rows: JournalRow[]): JournalRow[] => {
    const init = rows.find((r) => r.direction === 'in' && (r.frame as { subtype?: string }).subtype === 'init')!;
    const out = rows.map((r) => (r === init && version !== null ? { ...r, frame: { ...(r.frame as object), claude_code_version: version } } : r));
    const at = out.findIndex((r) => r.seq === init.seq) + 1;
    const unknown = (seq: number): JournalRow => ({ seq, direction: 'in', at: init.at, frame: UNKNOWN });
    return [...out.slice(0, at), unknown(9_001), unknown(9_002), ...out.slice(at)];
  };
  const replay = (version: string | null) =>
    replayedSession('pass2', 'rewind', (row, { session, transport, ready, fixture }) => {
      const frame = row.frame as { type: string };
      if (frame.type === 'user') void ready().then(() => session.send((fixture.find((r) => r.seq === row.seq)!.frame as { message: { content: string } }).message.content));
      else transport.kill('SIGTERM'); // the rewind controls: this case ends at the first one
    }, { edit: withUnknownFrames(version) });
  const notices = (events: SessionEvent[]) => events.filter((e): e is Extract<SessionEvent, { kind: 'notice.posted' }> => e.kind === 'notice.posted' && e.key === ENGINE_COMPAT_NOTICE_KEY);

  it('under a newer version: one notice, journaled, after the first unknown frame, and nothing refused', async () => {
    const run = await replay('2.1.287');
    expect(run.events.filter((e) => e.kind === 'frame.unknown')).toHaveLength(2);
    expect(notices(run.events)).toMatchObject([{ level: 'warning', text: engineCompatNotice('2.1.287') }]);
    const firstUnknown = run.events.findIndex((e) => e.kind === 'frame.unknown');
    expect(run.events.findIndex((e) => e.kind === 'notice.posted' && e.key === ENGINE_COMPAT_NOTICE_KEY)).toBe(firstUnknown + 1);
    expect(run.journal.rows.filter((r) => r.direction === 'meta' && (r.frame as { key?: string }).key === ENGINE_COMPAT_NOTICE_KEY)).toHaveLength(1);
    expect(run.events.some((e) => e.kind === 'turn.ended')).toBe(true); // the turn went on
    expect(run.rebuilt()).toEqual(run.events); // the journal re-reads into the same events, the notice included
  });

  it('under the tested version: the same frames raise no notice', async () => {
    const run = await replay(null);
    expect(run.events.filter((e) => e.kind === 'frame.unknown')).toHaveLength(2);
    expect(notices(run.events)).toEqual([]);
  });
});
