// X2 `clientPort.*` (P5 O3-D, docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §E; OX4, O3X6): the client
// port over `mawsd`'s services front. A service asks the client a request came from (a pick, a save, a confirm, a reveal,
// an external open, a notification, the badge, focus) with `clientPort.request`, an event posted to that client alone (to
// the attached app when `client` is null), and the client answers with `clientPort.answer`, a notification's further
// events (a click, its close) as further answers of the same id. An event and a command, since a reverse request kind
// would be a new envelope kind, breaking within the major (src/shared/ipc/wire.ts; D15).
import * as z from 'zod';
import type { CommandSpec } from './common';

export const CLIENT_PORT_KINDS = ['pick', 'save', 'confirm', 'reveal', 'openExternal', 'notify', 'badge', 'focus', 'notifyClose'] as const;

export const commands = {
  'clientPort.answer': { input: z.strictObject({ id: z.string().min(1), answer: z.unknown() }), output: z.void(), owner: 'machine' }, // main-only
} as const satisfies Record<`clientPort.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  // `client`: the asking client's ClientRef id, null for the attached app
  'clientPort.request': z.strictObject({ id: z.string().min(1), client: z.string().nullable(), kind: z.enum(CLIENT_PORT_KINDS), request: z.unknown() }),
} as const satisfies Record<`clientPort.${string}`, z.ZodType>;
