import { afterEach, describe, expect, it, vi } from 'vitest';
import { RewindFilesResponseSchema } from '@shared/wire/control';
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalRow } from '@shared/wire/journal';
import { loadEngineJournal, loadJournal } from '../../test/support/fixtures';
import { replayEngine, replayRowDelayMs } from './replay-transport';
import type { TransportItem } from './transport';

const at = '2026-09-28T00:00:00.000Z';
const row = (seq: number, direction: JournalRow['direction'], frame: unknown): JournalRow => ({ seq, direction, at, frame });
const prelude = loadEngineJournal('replay-handshake');

// Pulls items until the stream ends or `count` items arrived, without awaiting past a hold.
async function take(iterable: AsyncIterable<TransportItem>, count: number): Promise<TransportItem[]> {
  const out: TransportItem[] = [];
  const it = iterable[Symbol.asyncIterator]();
  while (out.length < count) {
    const next = await it.next();
    if (next.done) break;
    out.push(next.value);
  }
  return out;
}

const frameOf = (item: TransportItem) => item.frame as Record<string, unknown>;

describe('replay transport plays a fixture and advances on the adapter\'s writes', () => {
  it('yields in rows in order, holds at an out row, and matches the write by type and subtype', async () => {
    const journal = [
      row(1, 'meta', { event: 'spawn' }),
      row(2, 'in', { type: 'system', subtype: 'status', status: null }),
      row(3, 'out', { type: 'control_request', request_id: 'rec-1', request: { subtype: 'get_usage' } }),
      row(4, 'in', { type: 'control_response', response: { subtype: 'success', request_id: 'rec-1', response: { ok: true } } }),
      row(5, 'meta', { event: 'exit', code: 0, signal: null }),
    ];
    const transport = replayEngine(journal, { prelude });
    const it = transport.frames[Symbol.asyncIterator]();
    expect(frameOf((await it.next()).value as TransportItem)).toMatchObject({ subtype: 'status' });
    expect(transport.holding?.seq).toBe(3);
    let matched = false;
    const write = transport.write({ type: 'control_request', request_id: 'MINT-1', request: { subtype: 'get_usage' } }).then(() => (matched = true));
    const response = (await it.next()).value as TransportItem;
    await write;
    expect(matched).toBe(true);
    // the recorded response id is rewritten to the minted one
    expect(frameOf(response)).toEqual({ type: 'control_response', response: { subtype: 'success', request_id: 'MINT-1', response: { ok: true } } });
    expect((await it.next()).done).toBe(true);
    await expect(transport.exited).resolves.toEqual({ code: 0, signal: null });
  });

  it.each([
    [{ type: 'control_request', request_id: 'recorded', request: { subtype: 'set_model', model: 'sonnet' } }, { type: 'control_request', request_id: 'minted', request: { subtype: 'set_model', model: 'opus' } }],
    [{ type: 'control_request', request_id: 'recorded', request: { subtype: 'initialize', hooks: { changed: false } } }, { type: 'control_request', request_id: 'minted', request: { subtype: 'initialize', hooks: { changed: true } } }],
    [{ type: 'control_request', request_id: 'recorded', request: { subtype: 'get_context_usage', detail: 'summary' } }, { type: 'control_request', request_id: 'minted', request: { subtype: 'get_context_usage', detail: 'full' } }],
  ])('rejects a changed recorded control payload rather than advancing or substituting an unrecorded read', async (recorded, written) => {
    const transport = replayEngine([row(1, 'out', recorded), row(2, 'meta', { event: 'exit', code: 0, signal: null })], { prelude });
    const write = transport.write(written as StdinFrame);
    const items = await take(transport.frames, 1);
    expect(items[0]?.error?.kind).toBe('replay_mismatch');
    await expect(write).rejects.toThrow('replay mismatch');
  });

  it('matches id references structurally without replacing substrings inside payload text', async () => {
    const transport = replayEngine([
      row(1, 'out', { type: 'user', uuid: 'rec-u', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null }),
      row(2, 'out', { type: 'control_request', request_id: 'rec-r', request: { subtype: 'rewind_conversation', user_message_uuid: 'rec-u' } }),
      row(3, 'in', { type: 'control_response', response: { subtype: 'success', request_id: 'rec-r', response: { text: 'literal rec-u suffix', user_message_uuid: 'rec-u' } } }),
    ], { prelude });
    const user = transport.write({ type: 'user', uuid: 'mint-u', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null });
    const control = transport.write({ type: 'control_request', request_id: 'mint-r', request: { subtype: 'rewind_conversation', user_message_uuid: 'mint-u' } } as StdinFrame);
    const items = await take(transport.frames, 1);
    await Promise.all([user, control]);
    expect(items[0]?.frame).toEqual({ type: 'control_response', response: { subtype: 'success', request_id: 'mint-r', response: { text: 'literal rec-u suffix', user_message_uuid: 'mint-u' } } });
    transport.kill('SIGTERM');
  });

  it('maps a user write\'s minted uuid onto the recorded uuid in every following in row', async () => {
    const journal = [
      row(1, 'out', { type: 'user', uuid: 'rec-u', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null }),
      row(2, 'in', { type: 'command_lifecycle', command_uuid: 'rec-u', state: 'queued' }),
      row(3, 'in', { type: 'user', uuid: 'rec-u', isReplay: true, message: { role: 'user', content: 'hi' } }),
      row(4, 'in', { type: 'result', user_message_uuids: ['rec-u'], user_message_uuid: 'rec-u' }),
      row(5, 'meta', { event: 'exit', code: 0, signal: null }),
    ];
    const transport = replayEngine(journal, { prelude });
    void transport.write({ type: 'user', uuid: 'MINT-U', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null });
    const items = await take(transport.frames, 3);
    expect(frameOf(items[0]!)).toMatchObject({ command_uuid: 'MINT-U' });
    expect(frameOf(items[1]!)).toMatchObject({ uuid: 'MINT-U' });
    expect(frameOf(items[2]!)).toMatchObject({ user_message_uuids: ['MINT-U'], user_message_uuid: 'MINT-U' });
  });

  it('matches a recorded control_cancel_request for a host-minted request by the id this run minted for it, and still refuses a cancel of another id', async () => {
    // a journal the host wrote under launch AAAAAAAA, replayed under launch BBBBBBBB
    const journal = [
      row(1, 'out', { type: 'control_request', request_id: 'AAAAAAAA-3', request: { subtype: 'get_usage' } }),
      row(2, 'out', { type: 'control_cancel_request', request_id: 'AAAAAAAA-3' }),
      row(3, 'meta', { event: 'exit', code: 0, signal: null }),
    ];
    const transport = replayEngine(journal, { prelude });
    const request = transport.write({ type: 'control_request', request_id: 'BBBBBBBB-3', request: { subtype: 'get_usage' } });
    const cancel = transport.write({ type: 'control_cancel_request', request_id: 'BBBBBBBB-3' } as StdinFrame);
    expect(await take(transport.frames, 1)).toEqual([]); // no replay_mismatch: both writes matched, then the exit
    await expect(Promise.all([request, cancel])).resolves.toBeDefined();
    await expect(transport.exited).resolves.toEqual({ code: 0, signal: null });

    const other = replayEngine(journal, { prelude });
    void other.write({ type: 'control_request', request_id: 'BBBBBBBB-3', request: { subtype: 'get_usage' } });
    const wrong = other.write({ type: 'control_cancel_request', request_id: 'BBBBBBBB-4' } as StdinFrame);
    const [item] = await take(other.frames, 1);
    expect(item!.error).toMatchObject({ kind: 'replay_mismatch' });
    await expect(wrong).rejects.toThrow('replay mismatch');
  });

  it('answers initialize and get_status from the prelude when the fixture\'s next out row is not that request', async () => {
    const journal = [
      row(1, 'out', { type: 'user', uuid: 'u', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null }),
      row(2, 'in', { type: 'command_lifecycle', command_uuid: 'u', state: 'queued' }),
      row(3, 'meta', { event: 'exit', code: 0, signal: null }),
    ];
    const transport = replayEngine(journal, { prelude });
    await transport.write({ type: 'control_request', request_id: 'M-1', request: { subtype: 'initialize' } });
    await transport.write({ type: 'control_request', request_id: 'M-2', request: { subtype: 'get_status' } });
    const it = transport.frames[Symbol.asyncIterator]();
    const first = frameOf((await it.next()).value as TransportItem);
    const second = frameOf((await it.next()).value as TransportItem);
    expect(first).toMatchObject({ type: 'control_response', response: { subtype: 'success', request_id: 'M-1', response: { current_permission_mode: 'auto' } } });
    expect(second).toMatchObject({ type: 'control_response', response: { subtype: 'success', request_id: 'M-2' } });
    const sections = (second.response as { response: { sections: { title: string; rows: { label?: string; value: string }[] }[] } }).response.sections;
    expect(sections.find((s) => s.title === 'Session')?.rows.find((r) => r.label === 'Anthropic base URL')?.value).toBe('http://127.0.0.1:8641');
    // the held user row is still waiting
    expect(transport.holding?.seq).toBe(1);
    void transport.write({ type: 'user', uuid: 'u2', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null });
    expect(frameOf((await it.next()).value as TransportItem)).toMatchObject({ type: 'command_lifecycle' });
  });

  it('ends the replay as a mismatch on an unrecorded write', async () => {
    const journal = [
      row(1, 'in', { type: 'system', subtype: 'status', status: null }),
      row(2, 'out', { type: 'user', uuid: 'u', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null }),
      row(3, 'in', { type: 'command_lifecycle', command_uuid: 'u', state: 'queued' }),
      row(4, 'meta', { event: 'exit', code: 0, signal: null }),
    ];
    const transport = replayEngine(journal, { prelude });
    const it = transport.frames[Symbol.asyncIterator]();
    await it.next();
    const write = transport.write({ type: 'control_request', request_id: 'M-1', request: { subtype: 'set_model', model: 'opus' } });
    const item = (await it.next()).value as TransportItem;
    expect(item.frame).toBeNull();
    expect(item.error).toMatchObject({ kind: 'replay_mismatch', replay: { expected: 'seq 2 user', got: 'control_request/set_model' } });
    await expect(write).rejects.toThrow(/replay mismatch/);
    expect((await it.next()).done).toBe(true);
    await expect(transport.exited).resolves.toEqual({ code: null, signal: null });
    await expect(transport.write({ type: 'control_request', request_id: 'M-2', request: { subtype: 'get_usage' } })).rejects.toThrow();
  });

  it('answers a read the fixture never recorded with an empty success, announced first, and keeps holding at the recorded row', async () => {
    const journal = [
      row(1, 'in', { type: 'system', subtype: 'status', status: null }),
      row(2, 'out', { type: 'user', uuid: 'rec-u', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null }),
      row(3, 'in', { type: 'command_lifecycle', command_uuid: 'rec-u', state: 'queued' }),
      row(4, 'meta', { event: 'exit', code: 0, signal: null }),
    ];
    const transport = replayEngine(journal, { prelude });
    const it = transport.frames[Symbol.asyncIterator]();
    await it.next();
    for (const subtype of ['get_usage', 'list_models', 'list_permission_rules', 'get_context_usage']) {
      await expect(transport.write({ type: 'control_request', request_id: `M-${subtype}`, request: { subtype } })).resolves.toBeUndefined();
      const note = (await it.next()).value as TransportItem;
      expect(note.frame).toBeNull();
      expect(note.error).toMatchObject({ kind: 'replay_unrecorded_read', read: { subtype, requestId: `M-${subtype}` } });
      expect(frameOf((await it.next()).value as TransportItem)).toEqual({ type: 'control_response', response: { subtype: 'success', request_id: `M-${subtype}`, response: {} } });
    }
    expect(transport.holding?.seq).toBe(2);
    void transport.write({ type: 'user', uuid: 'MINT-U', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null });
    expect(frameOf((await it.next()).value as TransportItem)).toMatchObject({ type: 'command_lifecycle', command_uuid: 'MINT-U' });
    expect((await it.next()).done).toBe(true);
    await expect(transport.exited).resolves.toEqual({ code: 0, signal: null });
  });

  // E1 M5: the transcript's file-change receipt asks a dry run as soon as it draws (canUndo), which a fixture recorded
  // without a window (LiveHost) never holds; a dry run mutates nothing, so it is answered as an unrecorded read, with a
  // well-formed refusal (`canRewind: false`, RewindFilesResponseSchema) so the receipt's Undo reads "not rewindable"
  // rather than an unexpected shape (M5 fix)
  it('answers an unrecorded rewind_files dry run as a read refusing the rewind, while a real rewind stays a mismatch', async () => {
    const journal = [
      row(1, 'out', { type: 'user', uuid: 'rec-u', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null }),
      row(2, 'meta', { event: 'exit', code: 0, signal: null }),
    ];
    const transport = replayEngine(journal, { prelude });
    const it = transport.frames[Symbol.asyncIterator]();
    await expect(transport.write({ type: 'control_request', request_id: 'M-dry', request: { subtype: 'rewind_files', user_message_id: 'u1', dry_run: true } })).resolves.toBeUndefined();
    expect(((await it.next()).value as TransportItem).error).toMatchObject({ kind: 'replay_unrecorded_read', read: { subtype: 'rewind_files', requestId: 'M-dry' } });
    const answer = frameOf((await it.next()).value as TransportItem) as { response: { response: unknown } };
    expect(answer).toEqual({ type: 'control_response', response: { subtype: 'success', request_id: 'M-dry', response: { canRewind: false, error: 'not recorded in this replay' } } });
    expect(RewindFilesResponseSchema.safeParse(answer.response.response).success).toBe(true);
    const write = transport.write({ type: 'control_request', request_id: 'M-real', request: { subtype: 'rewind_files', user_message_id: 'u1' } });
    expect(((await it.next()).value as TransportItem).error?.kind).toBe('replay_mismatch');
    await expect(write).rejects.toThrow(/replay mismatch/);
  });

  it('a recorded read is matched and replayed, never answered empty', async () => {
    const journal = [
      row(1, 'out', { type: 'control_request', request_id: 'rec-1', request: { subtype: 'get_usage' } }),
      row(2, 'in', { type: 'control_response', response: { subtype: 'success', request_id: 'rec-1', response: { recorded: true } } }),
      row(3, 'meta', { event: 'exit', code: 0, signal: null }),
    ];
    const transport = replayEngine(journal, { prelude });
    void transport.write({ type: 'control_request', request_id: 'M-1', request: { subtype: 'get_usage' } });
    const items = await take(transport.frames, 5);
    expect(items.map((i) => i.error)).toEqual([null]);
    expect(frameOf(items[0]!)).toMatchObject({ response: { request_id: 'M-1', response: { recorded: true } } });
  });

  it('replays stderr rows, reports the exit row\'s code and signal, and ends a row-less tail on kill', async () => {
    const withExit = replayEngine([row(1, 'stderr', { text: 'warning line' }), row(2, 'meta', { event: 'exit', code: 1, signal: null })], { prelude });
    const errs: string[] = [];
    const reading = (async () => {
      for await (const line of withExit.stderr) errs.push(line);
    })();
    expect(await take(withExit.frames, 5)).toEqual([]);
    await reading;
    expect(errs).toEqual(['warning line']);
    await expect(withExit.exited).resolves.toEqual({ code: 1, signal: null });

    const noExit = replayEngine([row(1, 'in', { type: 'system', subtype: 'status', status: null })], { prelude });
    const items: TransportItem[] = [];
    const drained = (async () => {
      for await (const item of noExit.frames) items.push(item);
    })();
    await new Promise((r) => setTimeout(r, 5));
    expect(items).toHaveLength(1);
    noExit.endInput();
    noExit.kill('SIGTERM');
    await drained;
    await expect(noExit.exited).resolves.toEqual({ code: null, signal: 'SIGTERM' });
    expect(noExit.pid).toBeNull();
  });

  it('an unrecorded write at a row-less tail ends the replay as a mismatch, never a hang', async () => {
    const transport = replayEngine([row(1, 'in', { type: 'system', subtype: 'status', status: null })], { prelude });
    const it = transport.frames[Symbol.asyncIterator]();
    await it.next();
    const write = transport.write({ type: 'control_request', request_id: 'M-1', request: { subtype: 'set_model', model: 'opus' } });
    const item = (await it.next()).value as TransportItem;
    expect(item.error).toMatchObject({ kind: 'replay_mismatch', replay: { expected: 'end of journal', got: 'control_request/set_model' } });
    await expect(write).rejects.toThrow(/replay mismatch/);
    expect((await it.next()).done).toBe(true);
    await expect(transport.exited).resolves.toEqual({ code: null, signal: null });
  });

  it('an unrecorded write before the exit row ends the replay as a mismatch, not a plain close', async () => {
    const journal = [row(1, 'in', { type: 'system', subtype: 'status', status: null }), row(2, 'meta', { event: 'exit', code: 0, signal: null })];
    const transport = replayEngine(journal, { prelude });
    const it = transport.frames[Symbol.asyncIterator]();
    await it.next();
    const write = transport.write({ type: 'user', uuid: 'u', message: { role: 'user', content: 'hi' }, parent_tool_use_id: null });
    const item = (await it.next()).value as TransportItem;
    expect(item.error).toMatchObject({ kind: 'replay_mismatch', replay: { expected: 'seq 2 exit', got: 'user' } });
    await expect(write).rejects.toThrow(/replay mismatch/);
    expect((await it.next()).done).toBe(true);
    await expect(transport.exited).resolves.toEqual({ code: null, signal: null });
  });

  it('matches a can_use_tool response by request id and behavior, and a bash_command by type', async () => {
    const journal = [
      row(1, 'in', { type: 'control_request', request_id: 'eng-1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {}, tool_use_id: 't' } }),
      row(2, 'out', { type: 'control_response', response: { subtype: 'success', request_id: 'eng-1', response: { behavior: 'allow', updatedInput: {} } } }),
      row(3, 'out', { type: 'bash_command', command: 'ls', uuid: 'rec-b' }),
      row(4, 'in', { type: 'command_lifecycle', command_uuid: 'rec-b', state: 'completed' }),
      row(5, 'meta', { event: 'exit', code: 0, signal: null }),
    ];
    const transport = replayEngine(journal, { prelude });
    const it = transport.frames[Symbol.asyncIterator]();
    await it.next();
    const deny: StdinFrame = { type: 'control_response', response: { subtype: 'success', request_id: 'eng-1', response: { behavior: 'deny', message: 'no' } } };
    const rejected = transport.write(deny);
    const mismatch = (await it.next()).value as TransportItem;
    expect(mismatch.error).toMatchObject({ kind: 'replay_mismatch', replay: { got: 'control_response/eng-1/deny' } });
    await expect(rejected).rejects.toThrow();

    const again = replayEngine(journal, { prelude });
    const it2 = again.frames[Symbol.asyncIterator]();
    await it2.next();
    void again.write({ type: 'control_response', response: { subtype: 'success', request_id: 'eng-1', response: { behavior: 'allow', updatedInput: {} } } });
    void again.write({ type: 'bash_command', command: 'ls', uuid: 'MINT-B' });
    expect(frameOf((await it2.next()).value as TransportItem)).toMatchObject({ command_uuid: 'MINT-B' });
  });

  it('an unrecorded end_session ends the replay as the engine would, by exiting 0: the write resolves and no mismatch is reported', async () => {
    for (const tail of [[row(3, 'out', { type: 'user', uuid: 'rec-u', message: { role: 'user', content: 'next' }, parent_tool_use_id: null })], [], [row(3, 'meta', { event: 'exit', code: 0, signal: null })]]) {
      const journal = [row(1, 'in', { type: 'system', subtype: 'status', status: null }), row(2, 'in', { type: 'system', subtype: 'status', status: null }), ...tail];
      const transport = replayEngine(journal, { prelude });
      const it = transport.frames[Symbol.asyncIterator]();
      await it.next();
      await expect(transport.write({ type: 'control_request', request_id: 'MINT-9', request: { subtype: 'end_session', reason: 'stop' } })).resolves.toBeUndefined();
      const rest: TransportItem[] = [];
      for (let next = await it.next(); !next.done; next = await it.next()) rest.push(next.value);
      expect(rest.filter((i) => i.error)).toEqual([]);
      await expect(transport.exited).resolves.toEqual({ code: 0, signal: null });
    }
  });

  // E11 (tracker row E2 · C3 "quit after a replay writes replay_mismatch"): a recording that ended with its own
  // `end_session` (reason `stop`) meets the app's quit (`end_session` reason `quit`): the engine's answer is to exit
  // either way, so the replay ends with exit 0, no write fails and nothing is a mismatch
  it('an end_session whose reason differs from the recorded one ends the replay with exit 0, no mismatch', async () => {
    const journal = [
      row(1, 'in', { type: 'system', subtype: 'status', status: null }),
      row(2, 'out', { type: 'control_request', request_id: 'rec-9', request: { subtype: 'end_session', reason: 'stop' } }),
      row(3, 'in', { type: 'control_response', response: { subtype: 'success', request_id: 'rec-9' } }),
      row(4, 'meta', { event: 'exit', code: 0, signal: null }),
    ];
    const transport = replayEngine(journal, { prelude });
    const it = transport.frames[Symbol.asyncIterator]();
    await it.next();
    await expect(transport.write({ type: 'control_request', request_id: 'MINT-9', request: { subtype: 'end_session', reason: 'quit' } })).resolves.toBeUndefined();
    const rest: TransportItem[] = [];
    for (let next = await it.next(); !next.done; next = await it.next()) rest.push(next.value);
    expect(rest.filter((i) => i.error)).toEqual([]);
    await expect(transport.exited).resolves.toEqual({ code: 0, signal: null });
  });

  it('onHold fires once per held out row, after every earlier row was consumed, so adjacent out rows drive themselves', async () => {
    const journal = [
      row(1, 'in', { type: 'system', subtype: 'status', status: null }),
      row(2, 'out', { type: 'control_request', request_id: 'r-1', request: { subtype: 'get_usage' } }),
      row(3, 'out', { type: 'control_request', request_id: 'r-2', request: { subtype: 'get_settings' } }),
      row(4, 'in', { type: 'control_response', response: { subtype: 'success', request_id: 'r-2', response: {} } }),
      row(5, 'meta', { event: 'exit', code: 0, signal: null }),
    ];
    const consumed: number[] = [];
    const holds: { seq: number; consumedSoFar: number }[] = [];
    const transport: ReturnType<typeof replayEngine> = replayEngine(journal, {
      prelude,
      onHold: (held) => {
        holds.push({ seq: held.seq, consumedSoFar: consumed.length });
        void transport.write(held.frame as StdinFrame);
      },
    });
    for await (const item of transport.frames) consumed.push((item.frame as { type: string }).type === 'system' ? 1 : 4);
    expect(holds).toEqual([{ seq: 2, consumedSoFar: 1 }, { seq: 3, consumedSoFar: 1 }]);
    expect(consumed).toEqual([1, 4]);
  });

  it('a kill from inside onHold ends the stream instead of leaving the iterator waiting', async () => {
    const journal = [
      row(1, 'in', { type: 'system', subtype: 'status', status: null }),
      row(2, 'out', { type: 'control_request', request_id: 'r-1', request: { subtype: 'list_permission_rules' } }),
      row(3, 'in', { type: 'control_response', response: { subtype: 'success', request_id: 'r-1', response: {} } }),
    ];
    const transport: ReturnType<typeof replayEngine> = replayEngine(journal, { prelude, onHold: () => transport.kill('SIGTERM') });
    const items: TransportItem[] = [];
    for await (const item of transport.frames) items.push(item);
    expect(items).toHaveLength(1);
    await expect(transport.exited).resolves.toEqual({ code: null, signal: 'SIGTERM' });
  });

  it('plays a whole probe fixture when the writes follow its out rows', async () => {
    const journal = loadJournal('pass2', 'bash-context-echoed');
    const transport = replayEngine(journal, { prelude });
    let seen = 0;
    const issue = () => {
      const held = transport.holding;
      if (held) void transport.write(held.frame as StdinFrame);
    };
    issue();
    for await (const item of transport.frames) {
      expect(item.error).toBeNull();
      seen += 1;
      issue();
    }
    expect(seen).toBe(journal.filter((r) => r.direction === 'in').length);
    await expect(transport.exited).resolves.toEqual({ code: 0, signal: null });
  });
});

it.each([{ plugin: 'wrong-plugin' }, { handle: 999 }, { key: 'nonexistent' }])('refuses a mis-addressed recorded press %j without releasing effects', async (wrong) => {
  const journal = loadJournal('pass3', 'mods-surface-invalidate');
  const press = journal.findIndex((r) => r.direction === 'out' && (r.frame as { request?: { subtype: string } }).request?.subtype === 'ui_press');
  expect(press).toBeGreaterThan(-1);
  const recorded = journal[press].frame as Extract<StdinFrame, { type: 'control_request' }>;
  const transport = replayEngine(journal.slice(press), { prelude, surfaceReads: true });
  const write = transport.write({ ...recorded, request_id: 'new-press', request: { ...recorded.request, ...wrong } });
  const items = await take(transport.frames, 1);
  await expect(write).rejects.toThrow('replay mismatch');
  expect(items).toHaveLength(1);
  expect(items[0].error?.kind).toBe('replay_mismatch');
  await expect(transport.exited).resolves.toEqual({ code: null, signal: null });
});

it('matches the complete surface control payload regardless of property order and ignores its minted envelope id', async () => {
  const transport = replayEngine([
    row(1, 'out', { type: 'control_request', request_id: 'recorded', request: { subtype: 'ui_press', plugin: 'mod', handle: 7, key: 'go' } }),
    row(2, 'in', { type: 'control_response', response: { subtype: 'success', request_id: 'recorded', response: { handled: true } } }),
    row(3, 'meta', { event: 'exit', code: 0, signal: null }),
  ], { prelude });
  const write = transport.write({ type: 'control_request', request_id: 'minted', request: { key: 'go', handle: 7, plugin: 'mod', subtype: 'ui_press' } });
  const items = await take(transport.frames, 10);
  await write;
  expect(items.map(frameOf)).toEqual([{ type: 'control_response', response: { subtype: 'success', request_id: 'minted', response: { handled: true } } }]);
});

it.each([
  { subtype: 'ui_render', component: 'AssistantMessage', instance_id: 'message-1', props: { text: 'hello' } },
  { subtype: 'ui_input', plugin: 'mod', handle: 2, key: 'field', value: 'hello' },
  { subtype: 'ui_select', plugin: 'mod', handle: 3, key: 'choice', value: 'one' },
])('does not substitute another surface payload for $subtype', async (request) => {
  for (const key of Object.keys(request).filter((key) => key !== 'subtype')) {
    const transport = replayEngine([
      row(1, 'out', { type: 'control_request', request_id: 'recorded', request }),
      row(2, 'in', { type: 'system', subtype: 'plugin_notification', text: 'must not release' }),
    ], { prelude });
    const write = transport.write({ type: 'control_request', request_id: 'minted', request: { ...request, [key]: 'wrong' } });
    const items = await take(transport.frames, 2);
    if (request.subtype === 'ui_render') {
      // Unrecorded reads are answered empty, without consuming the recorded ask or its effects.
      await write;
      expect(items[0].error?.kind).toBe('replay_unrecorded_read');
      expect(items[1].frame).toMatchObject({ response: { request_id: 'minted', response: {} } });
      expect(transport.holding?.seq).toBe(1);
      transport.kill('SIGTERM');
    } else {
      await expect(write).rejects.toThrow('replay mismatch');
      expect(items).toHaveLength(1);
      expect(items[0].error?.kind).toBe('replay_mismatch');
    }
  }
});

// E10 (Design 12): the e2e seam that paces a replay, so a kept session goes on streaming while the app is away.
describe('replay pacing (MAWS_E2E_REPLAY_ROW_MS)', () => {
  afterEach(() => vi.useRealTimers());
  const journal = [
    row(1, 'in', { type: 'system', subtype: 'status', status: null }),
    row(2, 'out', { type: 'control_request', request_id: 'rec-1', request: { subtype: 'get_usage' } }),
    row(3, 'in', { type: 'control_response', response: { subtype: 'success', request_id: 'rec-1', response: { ok: true } } }),
    row(4, 'meta', { event: 'exit', code: 0, signal: null }),
  ];

  it('is read only under MAWS_E2E=1, as a whole number of milliseconds', () => {
    expect(replayRowDelayMs({ MAWS_E2E: '1', MAWS_E2E_REPLAY_ROW_MS: '250' })).toBe(250);
    expect(replayRowDelayMs({ MAWS_E2E_REPLAY_ROW_MS: '250' })).toBe(0);
    expect(replayRowDelayMs({ MAWS_E2E: '0', MAWS_E2E_REPLAY_ROW_MS: '250' })).toBe(0);
    expect(replayRowDelayMs({ MAWS_E2E: '1' })).toBe(0);
    for (const junk of ['', 'soon', '-5', '1.5', '1e3']) expect(replayRowDelayMs({ MAWS_E2E: '1', MAWS_E2E_REPLAY_ROW_MS: junk })).toBe(0);
  });

  it('waits the delay before each in row it plays, the one after a matched write included', async () => {
    vi.useFakeTimers();
    const transport = replayEngine(journal, { prelude, rowDelayMs: 1_000 });
    const it = transport.frames[Symbol.asyncIterator]();
    let first: IteratorResult<TransportItem> | null = null;
    void it.next().then((r) => (first = r));
    await vi.advanceTimersByTimeAsync(999);
    expect(first).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(frameOf(first!.value as TransportItem)).toMatchObject({ subtype: 'status' });

    let second: IteratorResult<TransportItem> | null = null;
    void it.next().then((r) => (second = r));
    await transport.write({ type: 'control_request', request_id: 'minted', request: { subtype: 'get_usage' } } as unknown as StdinFrame);
    await vi.advanceTimersByTimeAsync(999);
    expect(second).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(frameOf(second!.value as TransportItem)).toMatchObject({ type: 'control_response' });
    expect(await it.next()).toMatchObject({ done: true });
  });

  it('a kill during the wait ends the stream at once, without playing the row', async () => {
    vi.useFakeTimers();
    const transport = replayEngine(journal, { prelude, rowDelayMs: 1_000 });
    const it = transport.frames[Symbol.asyncIterator]();
    let first: IteratorResult<TransportItem> | null = null;
    void it.next().then((r) => (first = r));
    await vi.advanceTimersByTimeAsync(10); // the iterator is in the row's wait
    transport.kill('SIGTERM');
    await vi.advanceTimersByTimeAsync(0); // no time passes: the kill wakes the wait
    expect(first).toMatchObject({ done: true });
    expect(vi.getTimerCount()).toBe(0); // the wait's timer is cleared
    expect(await transport.exited).toEqual({ code: null, signal: 'SIGTERM' });
  });

  it('plays at once without a delay', async () => {
    vi.useFakeTimers();
    const transport = replayEngine(journal, { prelude });
    const items = take(transport.frames, 1);
    expect((await items).map(frameOf)).toMatchObject([{ subtype: 'status' }]);
    expect(vi.getTimerCount()).toBe(0);
    transport.kill('SIGTERM');
  });
});
