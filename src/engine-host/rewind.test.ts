import { withAppRewindGuards } from '../../test/support/app-rewind-fixture';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
import { loadJournal } from '../../test/support/fixtures';
import { handshakeResponder, replayedSession, scriptedSession } from './conformance/session-harness';
import { rewind, rewindFiles } from './rewind';

const fixture = loadJournal('pass2', 'rewind');
const recorded = (seq: number) => (fixture.find((r) => r.seq === seq)!.frame as { response: { response: Record<string, unknown> } }).response.response;
const TARGET = '36a2aa44-9ae9-455e-b52b-e70b27eecde5' as MessageUuid;
const ofKind = <K extends SessionEvent['kind']>(events: SessionEvent[], kind: K) => events.filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);

describe('rewind sends last_seen and derives the boundary from the response', () => {
  it('writes rewind_conversation with last_seen and interrupt_if_running false; the boundary derives from the success response row; no files unless asked', async () => {
    const s = scriptedSession({ responder: handshakeResponder({ rewind_conversation: () => ({ response: recorded(42) }) }) });
    await s.session.start();
    const outcome = await rewind(s.session, { targetMessageUuid: TARGET, lastSeenMessageUuid: TARGET, files: false });
    expect(s.transport.requestsOf('rewind_conversation')[0]!.request).toEqual({ subtype: 'rewind_conversation', target_message_uuid: TARGET, last_seen_user_message_uuid: TARGET, interrupt_if_running: false });
    expect(outcome).toEqual({ rewound: true, reason: null, error: null, prefillText: 'Also remember the word BANANA. Reply OK.', precedingAssistantUuid: 'edf0f954-1b18-4bca-a53f-d3212ef6dbaa', files: null });
    const [boundary] = ofKind(s.events, 'boundary.rewind');
    expect(boundary).toMatchObject({ targetMessageUuid: TARGET, prefillText: 'Also remember the word BANANA. Reply OK.', precedingAssistantUuid: 'edf0f954-1b18-4bca-a53f-d3212ef6dbaa' });
    expect(s.journal.rows.find((r) => r.seq === boundary!.seq)).toMatchObject({ direction: 'in', frame: { type: 'control_response' } });
    expect(s.transport.requestsOf('rewind_files')).toEqual([]);
  });

  it('a refused conversation rewind (stale_target) returns the engine\'s reason, yields no boundary and touches no files', async () => {
    const s = scriptedSession({ responder: handshakeResponder({ rewind_conversation: () => ({ response: recorded(40) }), rewind_files: () => ({ response: { canRewind: true, skippedLinks: 0 } }) }) });
    await s.session.start();
    const outcome = await rewind(s.session, { targetMessageUuid: TARGET, lastSeenMessageUuid: TARGET, files: true });
    expect(outcome).toEqual({ rewound: false, reason: 'stale_target', error: 'stale target', prefillText: null, precedingAssistantUuid: null, files: null });
    expect(ofKind(s.events, 'boundary.rewind')).toEqual([]);
    expect(s.transport.requestsOf('rewind_files')).toEqual([]);
  });

  it('with files, rewind_files restores the target\'s checkpoint after a successful rewind; a restore\'s missing counts are its normal shape', async () => {
    const s = scriptedSession({ responder: handshakeResponder({ rewind_conversation: () => ({ response: recorded(42) }), rewind_files: () => ({ response: { canRewind: true, skippedLinks: 0 } }) }) });
    await s.session.start();
    const outcome = await rewind(s.session, { targetMessageUuid: TARGET, lastSeenMessageUuid: TARGET, files: true });
    expect(s.transport.requestsOf('rewind_files')[0]!.request).toEqual({ subtype: 'rewind_files', user_message_id: TARGET });
    const order = s.transport.writes.filter((w) => w.type === 'control_request').map((w) => (w as { request: { subtype: string } }).request.subtype).slice(-2);
    expect(order).toEqual(['rewind_conversation', 'rewind_files']);
    expect(outcome.files).toEqual({ canRewind: true, skippedLinks: 0, error: null });
  });

  it('a failed restore after a successful rewind is reported on files, not thrown: the conversation rewind already applied', async () => {
    const s = scriptedSession({ responder: handshakeResponder({ rewind_conversation: () => ({ response: recorded(42) }), rewind_files: () => ({ response: { canRewind: false, error: 'Failed to rewind: EACCES' } }) }) });
    await s.session.start();
    expect((await rewind(s.session, { targetMessageUuid: TARGET, lastSeenMessageUuid: TARGET, files: true })).files).toEqual({ canRewind: false, skippedLinks: null, error: 'Failed to rewind: EACCES' });
    const errored = scriptedSession({ responder: handshakeResponder({ rewind_conversation: () => ({ response: recorded(42) }), rewind_files: () => ({ error: 'boom' }) }) });
    await errored.session.start();
    const outcome = await rewind(errored.session, { targetMessageUuid: TARGET, lastSeenMessageUuid: TARGET, files: true });
    expect(outcome).toMatchObject({ rewound: true, files: { canRewind: false, skippedLinks: null, error: 'boom' } });
  });

  it('rewindFiles converts the dry run, the restore and the refusal explicitly', async () => {
    const answers = [recorded(38), { canRewind: true, filesChanged: ['/x/a.txt', '/x/b.txt'], insertions: 3, deletions: 1 }, { canRewind: true, skippedLinks: 0 }];
    const s = scriptedSession({ responder: handshakeResponder({ rewind_files: () => ({ response: answers.shift() }) }) });
    await s.session.start();
    expect(await rewindFiles(s.session, { userMessageUuid: TARGET, dryRun: true })).toEqual({ ok: false, enabled: false, message: 'File rewinding is not enabled.', dryRun: true, changedFiles: null, insertions: null, deletions: null, skippedLinks: null });
    expect(await rewindFiles(s.session, { userMessageUuid: TARGET, dryRun: true })).toEqual({ ok: true, enabled: true, message: null, dryRun: true, changedFiles: ['/x/a.txt', '/x/b.txt'], insertions: 3, deletions: 1, skippedLinks: null });
    expect(await rewindFiles(s.session, { userMessageUuid: TARGET, dryRun: false })).toEqual({ ok: true, enabled: true, message: null, dryRun: false, changedFiles: null, insertions: null, deletions: null, skippedLinks: 0 });
    expect(s.transport.requestsOf('rewind_files').map((r) => r.request)).toEqual([
      { subtype: 'rewind_files', user_message_id: TARGET, dry_run: true },
      { subtype: 'rewind_files', user_message_id: TARGET, dry_run: true },
      { subtype: 'rewind_files', user_message_id: TARGET, dry_run: false },
    ]);
  });

  it('pass2/rewind with app guard fields replayed through a session: two sends, the refused dry run, a stale rewind, the successful rewind with last_seen, and the next turn', async () => {
    const sent: MessageUuid[] = [];
    const outcomes: unknown[] = [];
    let rewinds = 0;
    const run = await replayedSession('pass2', 'rewind', (row, { session, transport, ready }) => {
      const frame = row.frame as { type: string; message?: { content: string }; request?: { subtype: string } };
      if (frame.type === 'user') void ready().then(() => session.send(frame.message!.content)).then((r) => sent.push(r.messageUuid!));
      else if (frame.request?.subtype === 'rewind_files') void rewindFiles(session, { userMessageUuid: sent[1]!, dryRun: true }).then((o) => outcomes.push(o));
      else if (frame.request?.subtype === 'rewind_conversation') {
        rewinds += 1;
        const target = rewinds === 1 ? sent[0]! : sent[1]!;
        void rewind(session, { targetMessageUuid: target, lastSeenMessageUuid: target, files: false }).then((o) => outcomes.push(o));
      } else transport.kill('SIGTERM');
    }, { edit: withAppRewindGuards });
    expect(run.journal.rows.filter((r) => r.direction === 'meta' && (r.frame as { event: string }).event === 'replay_mismatch')).toEqual([]);
    expect(sent).toHaveLength(3);
    expect(outcomes).toEqual([
      { ok: false, enabled: false, message: 'File rewinding is not enabled.', dryRun: true, changedFiles: null, insertions: null, deletions: null, skippedLinks: null },
      { rewound: false, reason: 'stale_target', error: 'stale target', prefillText: null, precedingAssistantUuid: null, files: null },
      { rewound: true, reason: null, error: null, prefillText: 'Also remember the word BANANA. Reply OK.', precedingAssistantUuid: 'edf0f954-1b18-4bca-a53f-d3212ef6dbaa', files: null },
    ]);
    const requests = run.journal.rows.filter((r) => r.direction === 'out' && (r.frame as { request?: { subtype: string } }).request?.subtype === 'rewind_conversation').map((r) => (r.frame as { request: unknown }).request);
    expect(requests).toEqual([
      { subtype: 'rewind_conversation', target_message_uuid: sent[0], last_seen_user_message_uuid: sent[0], interrupt_if_running: false },
      { subtype: 'rewind_conversation', target_message_uuid: sent[1], last_seen_user_message_uuid: sent[1], interrupt_if_running: false },
    ]);
    expect(ofKind(run.events, 'boundary.rewind')).toMatchObject([{ targetMessageUuid: sent[1], prefillText: 'Also remember the word BANANA. Reply OK.' }]);
    expect(ofKind(run.events, 'turn.ended').map((e) => e.userMessageUuids)).toEqual([[sent[0]], [sent[1]], [sent[2]]]);
    expect(run.session.queue.state.entries).toEqual([]);
    expect(run.rebuilt()).toEqual(run.events);
  });
});
