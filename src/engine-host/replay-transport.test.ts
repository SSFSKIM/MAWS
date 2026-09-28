import { describe, expect, it } from 'vitest';
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalRow } from '@shared/wire/journal';
import { loadEngineJournal, loadJournal } from '../../test/support/fixtures';
import { replayEngine } from './replay-transport';
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
    const write = transport.write({ type: 'control_request', request_id: 'M-1', request: { subtype: 'get_usage' } });
    const item = (await it.next()).value as TransportItem;
    expect(item.frame).toBeNull();
    expect(item.error).toMatchObject({ kind: 'replay_mismatch', replay: { expected: 'seq 2 user', got: 'control_request/get_usage' } });
    await expect(write).rejects.toThrow(/replay mismatch/);
    expect((await it.next()).done).toBe(true);
    await expect(transport.exited).resolves.toEqual({ code: null, signal: null });
    await expect(transport.write({ type: 'control_request', request_id: 'M-2', request: { subtype: 'get_usage' } })).rejects.toThrow();
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
    const write = transport.write({ type: 'control_request', request_id: 'M-1', request: { subtype: 'get_usage' } });
    const item = (await it.next()).value as TransportItem;
    expect(item.error).toMatchObject({ kind: 'replay_mismatch', replay: { expected: 'end of journal', got: 'control_request/get_usage' } });
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
