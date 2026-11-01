// X2 `browserEngine.*` (P5 O17; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §E, §F; D8): the tab
// engines' machine-local wire to `mawsd`. A tab engine (the render host serving cua from offscreen tabs, M4) is a
// `machine.sock` client; what it sends `mawsd` are commands of this namespace, owned by `machine` (the services front's,
// as `render.answer` is), main-only and graded `internal` whole, never a window's or a remote caller's. Every message is
// bound to the connection it arrives on and the session it names (§F's rules).
//
// M3: `browserEngine.work`, the engine's report of browser work for a session (every tab it holds for the session plus a
// creation in flight). `held: true` is taken from the session's selected engine connection alone and answers only once
// the engine host has acknowledged a `host.browserWork` snapshot naming the session (the fence, §E), or fails with the
// reason, so the engine makes no tab; `held: false` is taken from any connection holding the session and answers at
// once. M4 and M6 add the rest of §F.
import * as z from 'zod';
import { AppSessionIdSchema } from '../../graph/ids';
import type { CommandSpec } from './common';

export const commands = {
  'browserEngine.work': { input: z.strictObject({ appSessionId: AppSessionIdSchema, held: z.boolean() }), output: z.void(), owner: 'machine' }, // main-only: from an engine's connection alone
} as const satisfies Record<`browserEngine.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {} as const satisfies Record<`browserEngine.${string}`, z.ZodType>;
