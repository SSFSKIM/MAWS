// The trust notice rule (C10 execution document, Interfaces "X6 extensions", the trust notice): the engine's stderr
// line `Ignoring N permissions.allow entries … this workspace has not been trusted` is printed at settings load, before
// `initialize` is read, so it appears on attested launches too; it becomes `notice.posted { key: 'trust:ignored' }` only
// when the correlated initialize response did not record trust, or when the process exits before answering.
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { loadJournal, type FixturePass } from '../../test/support/fixtures';
import { Normalizer } from './normalizer';

const normalise = (rows: JournalRow[]): SessionEvent[] => {
  const n = new Normalizer({ appSessionId: 'app-trust' as AppSessionId, launchId: 'L1', sessionId: null });
  return rows.flatMap((row) => n.push(row));
};
const notices = (events: SessionEvent[]) => events.filter((e): e is Extract<SessionEvent, { kind: 'notice.posted' }> => e.kind === 'notice.posted' && e.key === 'trust:ignored');
const stderrOf = (pass: FixturePass, name: string) => String((loadJournal(pass, name).find((r) => r.direction === 'stderr')!.frame as { text: string }).text).trim();

const NOTICE = 'Ignoring 2 permissions.allow entries from .claude/settings.json: this workspace has not been trusted. Run Claude Code interactively here once and accept the trust dialog.';
const row = (seq: number, direction: JournalRow['direction'], frame: unknown): JournalRow => ({ seq, direction, at: '2026-09-29T00:00:00.000Z', frame });
const init = (seq: number, id = 'L1-1') => row(seq, 'out', { type: 'control_request', request_id: id, request: { subtype: 'initialize', supportedDialogKinds: [] } });
const initResponse = (seq: number, extra: Record<string, unknown> = {}, id = 'L1-1') =>
  row(seq, 'in', { type: 'control_response', response: { subtype: 'success', request_id: id, response: { commands: [], current_permission_mode: 'default', ...extra } } });

describe('trust notice from stderr and the initialize response', () => {
  it('posts one warning at the unattested launch’s initialize response (pass2/trust-no-attestation seq 6)', () => {
    const found = notices(normalise(loadJournal('pass2', 'trust-no-attestation')));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ seq: 6, level: 'warning', key: 'trust:ignored', text: stderrOf('pass2', 'trust-no-attestation') });
  });

  it('posts nothing when the attestation recorded trust (pass2/trust-attested, pass3/fork-worktree-fork, pass3/trust-bootstrap-recorded)', () => {
    expect(notices(normalise(loadJournal('pass2', 'trust-attested')))).toEqual([]);
    expect(notices(normalise(loadJournal('pass3', 'fork-worktree-fork')))).toEqual([]);
    expect(notices(normalise(loadJournal('pass3', 'trust-bootstrap-recorded')))).toEqual([]);
  });

  it('posts it for the exact-key check, where only an ancestor was accepted (pass3/trust-exact-key seq 6)', () => {
    expect(notices(normalise(loadJournal('pass3', 'trust-exact-key')))).toMatchObject([{ seq: 6, key: 'trust:ignored' }]);
  });

  it('fires over a host journal alike: stderr before the request, the meta initialize row, then the correlated response', () => {
    const events = normalise([
      row(1, 'meta', { event: 'spawn' }),
      row(2, 'stderr', { text: `${NOTICE}\n` }),
      init(3),
      row(4, 'meta', { event: 'initialize', current_permission_mode: 'default', workspace_trust_recorded: null }),
      initResponse(5),
    ]);
    expect(notices(events)).toMatchObject([{ seq: 5, level: 'warning', text: NOTICE }]);
    const recorded = normalise([row(1, 'stderr', { text: NOTICE }), init(2), initResponse(3, { workspace_trust_recorded: true })]);
    expect(notices(recorded)).toEqual([]);
  });

  it('answers only the launch’s initialize: another response leaves the line held', () => {
    const events = normalise([
      row(1, 'stderr', { text: NOTICE }),
      row(2, 'out', { type: 'control_request', request_id: 'L1-9', request: { subtype: 'get_status' } }),
      row(3, 'in', { type: 'control_response', response: { subtype: 'success', request_id: 'L1-9', response: { sections: [] } } }),
    ]);
    expect(notices(events)).toEqual([]);
  });

  it('releases the held line at the exit row when the process exits before answering, ahead of process.exited', () => {
    const events = normalise([row(1, 'stderr', { text: NOTICE }), init(2), row(3, 'meta', { event: 'exit', code: 1, signal: null, reason: 'crash', lostAttentionCount: 0 })]);
    expect(notices(events)).toMatchObject([{ seq: 3, text: NOTICE }]);
    expect(events.filter((e) => e.seq === 3).map((e) => e.kind)).toEqual(['notice.posted', 'process.exited']);
  });

  it('holds nothing once the initialize response settled it: a later line and the exit post nothing', () => {
    const events = normalise([init(1), initResponse(2, { workspace_trust_recorded: true }), row(3, 'stderr', { text: NOTICE }), row(4, 'meta', { event: 'exit', code: 0, signal: null })]);
    expect(notices(events)).toEqual([]);
  });

  it('ignores other stderr lines', () => {
    expect(notices(normalise([row(1, 'stderr', { text: 'Warning: something else' }), init(2), initResponse(3)]))).toEqual([]);
  });
});
