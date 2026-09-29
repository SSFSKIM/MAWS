// Compile-time suite: the intent's draft is C4's `Draft`, restated in intent.ts to keep the X2 module out of a cycle.
import { describe, expectTypeOf, it } from 'vitest';
import type * as z from 'zod';
import type { Draft } from '../ipc/schema/session';
import type { SetupDraftSchema, SetupIntent } from './intent';

describe('the setup intent draft', () => {
  it("is C4's Draft", () => {
    expectTypeOf<z.infer<typeof SetupDraftSchema>>().toEqualTypeOf<Draft>();
    expectTypeOf<SetupIntent['draft']>().toEqualTypeOf<Draft | null>();
  });
});
