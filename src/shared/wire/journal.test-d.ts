// Compile-time suite: the journal row and the loose wire shapes read as Interfaces states them.
import { describe, expectTypeOf, it } from 'vitest';
import type { CanUseToolRequest } from './control';
import type { ControlRequestFrame, UnknownFrame } from './frames';
import type { JournalDirection, JournalRow } from './journal';

describe('journal rows and wire frames are typed as written', () => {
  it('a journal row has exactly seq, direction, at and an opaque frame', () => {
    expectTypeOf<JournalRow>().toEqualTypeOf<{ seq: number; direction: JournalDirection; at: string; frame: unknown }>();
    expectTypeOf<JournalDirection>().toEqualTypeOf<'in' | 'out' | 'meta' | 'stderr'>();
  });

  it('wire frames retain unknown keys and keep required fields required', () => {
    expectTypeOf<UnknownFrame>().toEqualTypeOf<{ type: string; [k: string]: unknown }>();
    expectTypeOf<ControlRequestFrame['request_id']>().toEqualTypeOf<string>();
    expectTypeOf<CanUseToolRequest['input']>().toEqualTypeOf<unknown>();
    expectTypeOf<CanUseToolRequest['tool_use_id']>().toEqualTypeOf<string>();
  });
});
