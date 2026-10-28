// X2 `org.*` (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §B; OX9): this app's place
// in the person's org: the sign-in from a pairing code, the device's registration, the held org state and the hub's
// credential (src/main/org/org-session.ts). Owned by main and graded `client`: the local app answers it, no machine.
// Main-to-renderer only, so outside the wire manifest. Nothing here carries a token, a key, a nonce or a pairing secret:
// the code goes in with `org.register` and `org.reanchor` and is never echoed back.
import * as z from 'zod';
import type { CommandSpec } from './common';

/**
 * Why an attempt ended without signing in; `detail` names a verdict, a status or the email Access signed in.
 * `directory`: `<userData>/org/` failed its checks, so nothing can be written there (beyond §B's list: the document's
 * Decision Log).
 */
export const ORG_REFUSALS = ['bad-code', 'other-org', 'access', 'not-member', 'keys', 'chain', 'removed', 'expired', 'hub', 'busy', 'directory'] as const;
export const OrgRefusalSchema = z.strictObject({ code: z.enum(ORG_REFUSALS), detail: z.string().optional() });
export type OrgRefusal = z.infer<typeof OrgRefusalSchema>;

/** The Org section's warning tone from this age of the held head, and the backstop past which machines refuse acts. */
export const ORG_HEAD_WARN_DAYS = 21;
export const ORG_HEAD_BACKSTOP_DAYS = 30;

const NoneSchema = z.strictObject({ state: z.literal('none'), refused: OrgRefusalSchema.optional() });
const DevelopmentSchema = z.strictObject({ state: z.literal('development'), org: z.string(), member: z.string(), device: z.string() });
const RegisteringSchema = z.strictObject({
  state: z.literal('registering'),
  step: z.enum(['browser', 'checking', 'approval']),
  org: z.string(),
  hub: z.string(),
  fingerprint: z.string().nullable(), // at `approval`
  expires: z.string().nullable(), // at `approval`: the pending entry's end (ISO-8601)
});
const RegisteredSchema = z.strictObject({
  state: z.literal('registered'),
  org: z.string(),
  hub: z.string(),
  member: z.strictObject({ id: z.string(), email: z.string() }),
  device: z.string(),
  session: z.enum(['signed-in', 'signed-out', 'removed']),
  hubAccess: z.enum(['connected', 'connecting', 'expired', 'denied', 'unreachable', 'signing-in']),
  head: z.strictObject({ version: z.number().int().positive(), issued: z.string() }).nullable(), // null until a held chain verifies
  // held-chain: closed until a re-anchor; rollback and fork: the hub served one, refused; directory: <userData>/org/ refused
  problem: z.enum(['held-chain', 'rollback', 'fork', 'directory']).nullable(),
  refused: OrgRefusalSchema.optional(),
});
export const OrgStatusSchema = z.discriminatedUnion('state', [NoneSchema, DevelopmentSchema, RegisteringSchema, RegisteredSchema]);
export type OrgStatus = z.infer<typeof OrgStatusSchema>;

export const OrgAttemptSchema = z.union([z.strictObject({ ok: z.literal(true) }), z.strictObject({ ok: z.literal(false), reason: OrgRefusalSchema })]);
export type OrgAttempt = z.infer<typeof OrgAttemptSchema>;

const CodeInputSchema = z.strictObject({ code: z.string().max(4096) });

export const commands = {
  'org.status': { input: z.void(), output: OrgStatusSchema, owner: 'main' },
  'org.register': { input: CodeInputSchema, output: OrgAttemptSchema, owner: 'main' },
  'org.signIn': { input: z.void(), output: OrgAttemptSchema, owner: 'main' },
  'org.reanchor': { input: CodeInputSchema, output: OrgAttemptSchema, owner: 'main' },
  'org.cancel': { input: z.void(), output: z.void(), owner: 'main' },
  'org.signOut': { input: z.void(), output: z.void(), owner: 'main' },
} as const satisfies Record<`org.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'org.changed': OrgStatusSchema, // at every change of the status, the whole status
} as const satisfies Record<`org.${string}`, z.ZodType>;
