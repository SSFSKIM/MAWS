import { describe, expect, it } from 'vitest';
import { loadJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { dividerCopy } from './copy';
import { rowsOf, withAllExpanded } from './derive';
import { turnId } from './keys';
import { applyEvents, createState } from './reduce';
import { builder, uuid } from './test-events';

const stopped = { result: 'error_during_execution', isError: true, terminalReason: 'aborted_streaming', resultText: null };
const reduce = (events: ReturnType<typeof builder>['events']) => applyEvents(createState(null, null), events);

describe('l2-transcript-15: stopping closes the turn at the engine evidence', () => {
  it.each([false, true])('keeps a stopped divider without tool work (partial text: %s), with elapsed wall time rather than a zero duration', (partial) => {
    const b = builder();
    b.turn('u1');
    if (partial) b.text('m1', 0, '<message>\nAn invoice makes a promise, the am', { aborted: true });
    b.tick(9_000);
    b.end(['u1'], { ...stopped, durationMs: 0 });
    const list = rowsOf(withAllExpanded(reduce(b.events)));
    const divider = list.find((row) => row.kind === 'divider');
    expect(divider).toMatchObject({ state: 'stopped', startedAt: b.events[0].at, endedAt: b.events.at(-1)!.at });
    if (divider?.kind !== 'divider') throw new Error('missing stopped divider');
    expect(dividerCopy({ ...divider, durationMs: Date.parse(divider.endedAt!) - Date.parse(divider.startedAt) })).toBe('You stopped after 9s');
    expect(list.filter((row) => row.kind === 'assistant_text').map((row) => row.markdown)).toEqual(partial ? ['<message>\nAn invoice makes a promise, the am'] : []);
  });

  it.each(['[Request interrupted by user]', '[Request interrupted by user for tool use]'])('closes immediately at %s, without waiting for a result, next prompt or process exit', (marker) => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'The partial answer');
    b.tick(9_000);
    const interrupted = b.emit('user.message', { messageUuid: uuid('marker'), content: [{ type: 'text', text: marker }], isReplay: false, isSynthetic: false, origin: 'interrupt-marker', bash: null });
    const state = reduce(b.events);
    expect(state.current).toBeNull();
    expect(state.turns.get(turnId.ofMessage(uuid('u1')))).toMatchObject({ state: 'closed', closedBy: 'stopped', endedAt: interrupted.at });
    const list = rowsOf(state);
    expect(list.find((row) => row.kind === 'divider')).toMatchObject({ state: 'stopped', endedAt: interrupted.at });
    expect(list.filter((row) => row.kind === 'user').map((row) => row.text)).toEqual(['prompt u1']);
  });

  it('keeps a human’s marker-word prompt open and visible rather than treating its text as engine evidence', () => {
    const b = builder();
    b.turn('typed', '[Request interrupted by user]');
    const state = reduce(b.events);
    expect(state.current).toBe(turnId.ofMessage(uuid('typed')));
    expect(state.turns.get(state.current!)!).toMatchObject({ state: 'open', closedBy: null });
    expect(rowsOf(state).filter((row) => row.kind === 'user').map((row) => row.text)).toEqual(['[Request interrupted by user]']);
    b.turn('next');
    const next = applyEvents(state, b.events.slice(2));
    expect(next.turns.get(turnId.ofMessage(uuid('typed')))).toMatchObject({ state: 'closed', closedBy: 'completed' });
  });

  it.each(['[Request interrupted by user]', '[Request interrupted by user for tool use]'])('normalizes a host-written prompt and its same-UUID human replay of %s without stopping or duplicating its turn', (text) => {
    // Recorded order: write 16, started 19, same-UUID human replay 22, assistant 232, result 239.
    const wire = loadJournal('pass3', 'steer-next').filter((row) => [16, 19, 22, 232, 239].includes(row.seq)).map((row) => {
      if (row.seq !== 16 && row.seq !== 22) return row;
      const frame = row.frame as { message: { role: string; content: string } };
      return { ...row, frame: { ...frame, message: { ...frame.message, content: text } } };
    });
    const events = journalToEvents(wire);
    expect(events.filter((event) => event.kind === 'user.message')).toHaveLength(1);
    expect(events.some((event) => event.kind === 'user.message' && event.origin === 'interrupt-marker')).toBe(false);
    let state = reduce(events.filter((event) => event.seq !== null && event.seq <= 22));
    expect(state.turns.get(state.current!)!).toMatchObject({ state: 'open', closedBy: null });
    state = applyEvents(state, events.filter((event) => event.seq !== null && event.seq > 22));
    expect(state.order).toHaveLength(1);
    expect(state.turns.get(state.order[0])).toMatchObject({ state: 'closed', closedBy: null, ended: { terminalReason: 'completed' } });
    const rows = rowsOf(state);
    expect(rows.filter((row) => row.kind === 'user').map((row) => row.text)).toEqual([text]);
    expect(rows.filter((row) => row.kind === 'assistant_text').map((row) => row.markdown)).toEqual(['COUNTED']);
  });

  it.each(['[Request interrupted by user]', '[Request interrupted by user for tool use]'])('normalizes an explicitly human inbound %s as a prompt even without a pending host echo', (text) => {
    const wire = loadJournal('pass3', 'steer-next').filter((row) => [22, 232, 239].includes(row.seq)).map((row) => {
      if (row.seq !== 22) return row;
      const frame = row.frame as { message: { role: string; content: string } };
      return { ...row, frame: { ...frame, message: { ...frame.message, content: text } } };
    });
    const events = journalToEvents(wire);
    expect(events.filter((event) => event.kind === 'user.message')).toMatchObject([{ origin: 'human', content: text }]);
    const state = reduce(events);
    expect(state.order).toHaveLength(1);
    expect(state.turns.get(state.order[0])).toMatchObject({ state: 'closed', closedBy: null, ended: { terminalReason: 'completed' } });
    expect(rowsOf(state).filter((row) => row.kind === 'user').map((row) => row.text)).toEqual([text]);
  });

  it('attaches the result after a marker to the stopped turn, never to a newer running turn', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Partial');
    b.emit('user.message', { messageUuid: uuid('marker'), content: '[Request interrupted by user]', isReplay: false, isSynthetic: false, origin: 'interrupt-marker', bash: null });
    let state = reduce(b.events);
    const through = b.events.length;
    b.turn('u2');
    b.end(['u1'], stopped);
    state = applyEvents(state, b.events.slice(through));
    expect(state.turns.get(turnId.ofMessage(uuid('u1')))).toMatchObject({ state: 'closed', ended: { terminalReason: 'aborted_streaming' } });
    expect(state.turns.get(turnId.ofMessage(uuid('u2')))).toMatchObject({ state: 'open', ended: null });
    expect(state.current).toBe(turnId.ofMessage(uuid('u2')));
  });

  it('does not give a newer running turn’s unnamed result to an older marker-stopped turn', () => {
    const b = builder();
    b.turn('u1');
    b.emit('user.message', { messageUuid: uuid('marker'), content: '[Request interrupted by user]', isReplay: false, isSynthetic: false, origin: 'interrupt-marker', bash: null });
    b.turn('u2');
    b.text('m2', 0, 'New answer');
    b.end([]);
    const state = reduce(b.events);
    expect(state.turns.get(turnId.ofMessage(uuid('u1')))).toMatchObject({ closedBy: 'stopped', ended: null });
    expect(state.turns.get(turnId.ofMessage(uuid('u2')))).toMatchObject({ state: 'closed', ended: { terminalReason: 'completed' } });
  });

  it('retains the real engine-initiated interrupt result without user UUIDs after its marker closed the turn', () => {
    const events = journalToEvents(loadJournal('pass3', 'p2-c3-subagent-ask'));
    const marker = events.findIndex((event) => event.kind === 'user.message' && event.origin === 'interrupt-marker');
    const result = events.find((event) => event.kind === 'turn.ended' && event.terminalReason === 'aborted_streaming');
    expect(result).toMatchObject({ userMessageUuids: [], origin: 'task-notification' });
    let state = reduce(events.slice(0, marker + 1));
    expect(state.current).toBeNull();
    const id = state.order.at(-1)!;
    expect(state.turns.get(id)).toMatchObject({ closedBy: 'stopped', endedAt: '2026-10-14T08:54:40.526Z', ended: null });
    state = applyEvents(state, events.slice(marker + 1));
    expect(state.turns.get(id)!.ended).toBe(result);
    expect(rowsOf(state).filter((row) => row.kind === 'divider').at(-1)).toMatchObject({
      state: 'stopped', endedAt: '2026-10-14T08:54:40.528Z',
      summary: { costUsd: 0.005708365, durationMs: 2509, terminalReason: 'aborted_streaming', usage: { cacheCreationInputTokens: 0, cacheReadInputTokens: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0 } },
    });
  });

  it('closes on the real interrupt-text marker before its result, then retains the real result accounting', () => {
    // pass3/interrupt-text: seq 97 is the marker; seq 98 is the aborted_streaming result.
    const journal = loadJournal('pass3', 'interrupt-text');
    const events = journalToEvents(journal.filter((row) => row.seq <= 98));
    const marker = events.findIndex((event) => event.kind === 'user.message' && event.origin === 'interrupt-marker');
    let state = reduce(events.slice(0, marker + 1));
    expect(state.current).toBeNull();
    expect(state.turns.get(state.order[0])!).toMatchObject({ state: 'closed', closedBy: 'stopped', endedAt: '2026-09-29T19:09:51.644Z' });
    state = applyEvents(state, events.slice(marker + 1));
    expect(state.turns.get(state.order[0])!.ended).toMatchObject({ terminalReason: 'aborted_streaming', costUsd: 0.000977 });
    expect(rowsOf(state).filter((row) => row.kind === 'divider')).toMatchObject([{ state: 'stopped', startedAt: '2026-09-29T19:09:49.912Z', endedAt: '2026-09-29T19:09:51.645Z' }]);
  });
});
