// Compile-time suite: the event types consumers import are shaped as Interfaces states them.
import { describe, expectTypeOf, it } from 'vitest';
import type { SafeguardVerdict } from './enums';
import type { EventBase, EventKind, EventPayload, SessionEvent } from './events';
import type { ToolUseId } from './ids';

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
});
