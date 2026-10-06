// Compile-time suite: the event types consumers import are shaped as Interfaces states them.
import { describe, expectTypeOf, it } from 'vitest';
import type { SafeguardVerdict } from './enums';
import type { EventBase, EventKind, EventPayload, SessionEvent } from './events';
import type { ToolUseId } from './ids';
// E1 start
import type { Pane } from '../maws/panes';
import type { AskAnswer, AskQuestion, ShowPaneOpened } from '../maws/tools';
// E1 end
import type { MessageUuid } from './ids'; // E7

describe('session events are EventBase & EventPayload', () => {
  it('every event carries the base fields and a kind from EVENT_KINDS', () => {
    expectTypeOf<SessionEvent>().toMatchTypeOf<EventBase>();
    expectTypeOf<SessionEvent['kind']>().toEqualTypeOf<EventKind>();
    expectTypeOf<EventPayload['kind']>().toEqualTypeOf<EventKind>();
    expectTypeOf<EventBase & EventPayload>().toMatchTypeOf<SessionEvent>();
  });

  it('payload fields keep their branded ids and enums', () => {
    type ToolResult = Extract<SessionEvent, { kind: 'tool.result' }>;
    expectTypeOf<ToolResult['toolUseId']>().toEqualTypeOf<ToolUseId>();
    expectTypeOf<ToolResult['safeguard']>().toEqualTypeOf<SafeguardVerdict>();
    expectTypeOf<ToolResult>().not.toHaveProperty('taskId');
    type Reconnect = Extract<SessionEvent, { kind: 'session.reconnect' }>;
    expectTypeOf<Reconnect['phase']>().toEqualTypeOf<'attempting' | 'reconnected' | 'failed'>();
  });

  // C12 start
  it("process.exited carries MAWS's budget reason and the release's budget and sum", () => {
    type Exited = Extract<SessionEvent, { kind: 'process.exited' }>;
    expectTypeOf<Exited['reason']>().toEqualTypeOf<'quit' | 'stop' | 'archive' | 'crash' | 'unknown' | 'budget'>();
    expectTypeOf<Exited['budget']>().toEqualTypeOf<{ limitKiB: number; totalKiB: number } | null>();
  });
  // C12 end

  // E1 start
  it('the maws.* events carry the X9 shapes: the pane enum, the shared ask and result types, branded correlators', () => {
    type PaneShown = Extract<SessionEvent, { kind: 'maws.pane.shown' }>;
    expectTypeOf<PaneShown['pane']>().toEqualTypeOf<Pane>();
    expectTypeOf<PaneShown['opened']>().toEqualTypeOf<ShowPaneOpened | null>();
    type Answered = Extract<SessionEvent, { kind: 'maws.ask.answered' }>;
    expectTypeOf<Answered['answers']>().toEqualTypeOf<AskAnswer[]>();
    expectTypeOf<Answered['delivery']>().toEqualTypeOf<'result' | 'steer'>();
    expectTypeOf<Extract<SessionEvent, { kind: 'maws.ask.opened' }>['questions']>().toEqualTypeOf<AskQuestion[]>();
    expectTypeOf<Extract<SessionEvent, { kind: 'maws.delivery.file' }>['toolUseId']>().toEqualTypeOf<ToolUseId | null>();
  });
  // E1 end

  // E7 start
  it('peer.message carries the parsed envelope with a branded message uuid', () => {
    type Peer = Extract<SessionEvent, { kind: 'peer.message' }>;
    expectTypeOf<Peer['messageUuid']>().toEqualTypeOf<MessageUuid | null>();
    expectTypeOf<Peer['lineage']>().toEqualTypeOf<'peer' | 'descendant'>();
    expectTypeOf<Peer['hopChain']>().toEqualTypeOf<string[]>();
  });
  // E7 end
});
