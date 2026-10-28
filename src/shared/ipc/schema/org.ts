// X2 `org.*` (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §B; OX9): this app's place
// in the person's org: the sign-in from a pairing code, the device's registration, the held org state and the hub's
// credential (src/main/org/org-session.ts). Owned by main and graded `client`: the local app answers it, no machine.
// Main-to-renderer only, so outside the wire manifest. Nothing here carries a token, a key, a nonce or a pairing secret:
// the code goes in with `org.register` and `org.reanchor` and is never echoed back.
import * as z from 'zod';
import { OrgKeySchema } from '../../machine/org-key';
import { MachineRefSchema } from '../../machine/ref';
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

/**
 * M2 (Interfaces §G): another machine's session as its signed listing says it, verified against the held org state. Not a
 * record: a listing has no directory, model, mode, holder or lineage. `session` is a plain string, never an
 * `AppSessionId`, so O6's codec lifts nothing in a row; the renderer forms the address with `addressOf(machine, session)`.
 */
export const RemoteRowSchema = z.strictObject({
  machine: MachineRefSchema, // the listing's ref
  session: z.string().min(1), // lane A: the engine session id; lane B: the appSessionId (O9's R1)
  lane: z.enum(['A', 'B']), // R2
  state: z.string(), // sminos's word (R4)
  title: z.string(), // R4
  owners: z.array(z.string()), // member ids (R5)
  project: z.string().nullable(), // sminos's project id, the smnsId (R5)
  orgKey: OrgKeySchema.nullable(), // the local org key it joins, by the signed-in org (R5)
  availability: z.literal('foreign_held').nullable(), // lane A: held on its machine (R3); lane B: null
  revision: z.number().int().nonnegative(),
  issued: z.string(),
  mine: z.boolean(), // the signed-in member is an owner
});
export type RemoteRow = z.infer<typeof RemoteRowSchema>;
/**
 * M5 (Interfaces §L): an owner a row names, as the held head lists them. `name` is `memberName`'s, widened where two
 * members collide (`src/shared/org/member-name.ts`); an id the head doesn't list has a null email and reads "former member".
 */
export const OrgMemberSchema = z.strictObject({ id: z.string(), email: z.string().nullable(), name: z.string() });
export type OrgMember = z.infer<typeof OrgMemberSchema>;
export const FORMER_MEMBER = 'former member';
export const OrgRowsSchema = z.strictObject({
  machines: z.array(MachineRefSchema), // the RL2 roster: these take no record snapshot
  rows: z.array(RemoteRowSchema),
  complete: z.boolean(), // this run's hub snapshot applied, the announced head adopted
  pending: z.array(MachineRefSchema), // roster machines with records awaiting verification
  members: z.array(OrgMemberSchema), // M5: every member id some row's owners name
  member: z.string().nullable(), // M5: the signed-in member the rows were computed for ("you"); null signed out
});
export type OrgRows = z.infer<typeof OrgRowsSchema>;

export const commands = {
  'org.status': { input: z.void(), output: OrgStatusSchema, owner: 'main' },
  'org.register': { input: CodeInputSchema, output: OrgAttemptSchema, owner: 'main' },
  'org.signIn': { input: z.void(), output: OrgAttemptSchema, owner: 'main' },
  'org.reanchor': { input: CodeInputSchema, output: OrgAttemptSchema, owner: 'main' },
  'org.cancel': { input: z.void(), output: z.void(), owner: 'main' },
  'org.signOut': { input: z.void(), output: z.void(), owner: 'main' },
  'org.rows': { input: z.void(), output: OrgRowsSchema, owner: 'main' }, // M2
} as const satisfies Record<`org.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'org.changed': OrgStatusSchema, // at every change of the status, the whole status
  'org.rows.changed': OrgRowsSchema, // M2: coalesced, the whole list
} as const satisfies Record<`org.${string}`, z.ZodType>;
