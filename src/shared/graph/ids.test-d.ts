// Compile-time suite: the twelve X1 identifier brands never collapse into each other or into `string`.
import { describe, expectTypeOf, it } from 'vitest';
import type * as z from 'zod';
import {
  toolUseOf,
  type AgentId,
  type ApiMessageId,
  type AppSessionId,
  type AttentionId,
  type EventId,
  type MessageUuid,
  type ParentToolUseId,
  type ProjectId,
  type RequestId,
  type SessionId,
  type TaskId,
  type ToolUseId,
} from './ids';

type IdMap = {
  SessionId: SessionId; AppSessionId: AppSessionId; MessageUuid: MessageUuid; ApiMessageId: ApiMessageId; ToolUseId: ToolUseId;
  ParentToolUseId: ParentToolUseId; TaskId: TaskId; AgentId: AgentId; RequestId: RequestId; ProjectId: ProjectId; AttentionId: AttentionId; EventId: EventId;
};
// Every ordered pair (A, B) of distinct brands where A is assignable to B, named 'A->B'; the contract is that there are none.
type Flattened = {
  [A in keyof IdMap]: { [B in keyof IdMap]: A extends B ? never : IdMap[A] extends IdMap[B] ? `${A}->${B}` : never }[keyof IdMap];
}[keyof IdMap];

describe('identifiers are not interchangeable', () => {
  it('no brand is assignable to another', () => {
    expectTypeOf<Flattened>().toEqualTypeOf<never>();
  });

  it('a plain string is none of them', () => {
    expectTypeOf<string>().not.toMatchTypeOf<ToolUseId>();
    expectTypeOf<string>().not.toMatchTypeOf<SessionId>();
    expectTypeOf<string>().not.toMatchTypeOf<EventId>();
  });

  it('a parent tool use is not the child tool use, in either direction', () => {
    expectTypeOf<ToolUseId>().not.toMatchTypeOf<ParentToolUseId>();
    expectTypeOf<ParentToolUseId>().not.toMatchTypeOf<ToolUseId>();
  });

  it('every brand is a branded string and is usable where a string is', () => {
    expectTypeOf<SessionId>().toEqualTypeOf<string & z.$brand<'SessionId'>>();
    expectTypeOf<ParentToolUseId>().toEqualTypeOf<string & z.$brand<'ParentToolUseId'>>();
    expectTypeOf<ToolUseId>().toMatchTypeOf<string>();
  });

  it('toolUseOf is the one sanctioned crossing', () => {
    expectTypeOf(toolUseOf).parameter(0).toEqualTypeOf<ParentToolUseId>();
    expectTypeOf(toolUseOf).returns.toEqualTypeOf<ToolUseId>();
  });
});
