// A fixture served as a long session's disk history (the long-transcript window, docs/doperpowers/plans/
// 2026-10-30-long-transcript-window.md): the product's `ipcSource` over a stand-in for main and the engine host that
// answers `session.events` one window at a time by the host's own rule (`historyWindowStart`, here with a small budget so
// a fixture of a few hundred turns has many pages), with the `earlier` cursor and the `sought` a jump into history asks
// for, each older page after `delayMs` as a host's round trip would be. The transcript's store, pager, jumps and bar are
// all the product's; only the wire is this.
import type { SessionEvent } from '@shared/graph/events';
import { eventBytes, historyWindowStart, soughtIn, type WindowBudget } from '@shared/graph/history-window';
import type { AppSessionId, EventId, MessageUuid } from '@shared/graph/ids';
import type { CommandName, MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { ipcSourceOver } from '../transcript/source/ipc';
import type { TranscriptSource } from '../transcript/source/types';

const BUDGET: WindowBudget = { soft: 384 * 1024, hard: 4 * 1024 * 1024 }; // about ten of synthetic/N's turns a page

export function pagedSource(key: string, fixture: readonly SessionEvent[], delayMs: number): TranscriptSource {
  const events = fixture.map((event) => ({ ...event, seq: null }) as SessionEvent); // the disk form: no live seq
  const sizes: number[] = [];
  const sizeOf = (i: number) => (sizes[i] ??= eventBytes(events[i]!));
  const positions = new Map(events.map((event, i) => [event.id, i]));
  const page = (input: { before?: EventId; seek?: MessageUuid }) => {
    const end = input.before === undefined ? events.length : positions.get(input.before);
    if (end === undefined) return { ok: false, error: { code: 'invalid_input', message: `unknown history cursor: ${input.before}` } };
    const start = historyWindowStart(events, end, sizeOf, BUDGET);
    return {
      ok: true,
      value: { events: events.slice(start, end), lastSeq: 0, complete: true, ...(start > 0 && { earlier: events[start]!.id }), ...(input.seek !== undefined && { sought: soughtIn(events, input.seek, start, end) }) },
    };
  };
  const client: MawsBridge = {
    localMachine: ipc.localMachine,
    invoke: (async (name: CommandName, input: { before?: EventId; seek?: MessageUuid }) => {
      if (name === 'session.appEvents') return { ok: true, value: { events: [] } };
      if (name !== 'session.events') return { ok: false, error: { code: 'internal', message: `the paged harness has no ${name}` } };
      if (input.before !== undefined) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return page(input);
    }) as never as MawsBridge['invoke'],
    on: (() => () => {}) as MawsBridge['on'],
    pathForFile: () => '',
  };
  return ipcSourceOver(client, key as AppSessionId);
}

// The first text block of the fixture's `n`-th turn (1-based, reading order), as an attention item's mark names it.
export function textOfTurn(fixture: readonly SessionEvent[], n: number): { messageUuid: MessageUuid; blockIndex: number } {
  let turns = 0;
  for (const event of fixture) {
    if (event.kind === 'turn.started' && event.agentId === null) turns += 1;
    if (turns === n && event.kind === 'assistant.block.complete' && event.agentId === null && event.block.type === 'text' && event.messageUuid !== null) {
      return { messageUuid: event.messageUuid, blockIndex: event.blockIndex };
    }
    if (turns > n) break;
  }
  throw new Error(`turn ${n} has no text`);
}
