// X2 `org.*` (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §B; OX9): this app's place
// in the person's org: the sign-in from a pairing code, the device's registration, the held org state and the hub's
// credential (src/main/org/org-session.ts). Owned by main and graded `client`: the local app answers it, no machine.
// Main-to-renderer only, so outside the wire manifest. Nothing here carries a token, a key, a nonce or a pairing secret:
// the code goes in with `org.register` and `org.reanchor` and is never echoed back. The one exception is M4a's
// `org.pair.start`, whose answer carries the code this Mac made for another device, once, to show; no status does.
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
/**
 * M4a: the attempt a status's `refused` ended, so the Org page shows it under the control that sent it. A refusal the
 * session makes at load (`keys`: the key file is gone or refused) ended no attempt and names none; an act's own answer
 * (`{ok: false, reason}`) goes back to its caller and names none either.
 */
export const ORG_ATTEMPTS = ['register', 'reanchor', 'signIn', 'rekey'] as const;
export const OrgRefusalSchema = z.strictObject({ code: z.enum(ORG_REFUSALS), detail: z.string().optional(), attempt: z.enum(ORG_ATTEMPTS).optional() });
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
/**
 * M3 (Interfaces §K): this device as the org's signer. `root`: the held head's `root.keys` holds this device's step-up
 * key id; `maySign`: a root, signed in, its keys carrying the backup mark, signing.json readable. `fingerprint` and
 * `stepUpKid` are what `deployment admin root add` confirms. `due` and `ageDays` are the weekly successor's quiet line.
 * `pending`: the state kept and not yet settled (`fork`: another state holds its version; `refused`: the hub's last answer
 * to it this run; `hash`: its state's stateHash, which a discard names). `offer`: the superseded states' revocations, `superseded` the keys a signature would revoke (0: nothing
 * to sign) and `withheld` the ones no offer carries (this device's own, the last root); `lines` each revocation and
 * each consequence a signature carries, and `warnings` the checks' warnings on that successor, which the Org section
 * shows before it signs (Touch ID shows one line); `digest` names those words, and `org.revokeSuperseded` carries it. `owing` and `abandoned`: the
 * direct deliveries. `rekey`: new keys offered for an unmarked key file (a removed device reads `session: 'removed'`);
 * `rekeying`: one under way; `oldDevice`: a rekey's old device, still listed in the held head.
 */
export const OrgSignerStatusSchema = z
  .strictObject({
    root: z.boolean(),
    maySign: z.boolean(),
    fingerprint: z.string(),
    stepUpKid: z.string(),
    due: z.boolean(),
    ageDays: z.number().int().nullable(),
    pending: z.strictObject({ version: z.number().int().positive(), hash: z.string(), fork: z.boolean(), exposed: z.boolean(), refused: z.string().nullable() }).nullable(),
    offer: z
      .strictObject({ superseded: z.number().int().nonnegative(), lines: z.array(z.string()), warnings: z.array(z.string()), withheld: z.array(z.string()), digest: z.string() })
      .nullable(),
    owing: z.array(z.strictObject({ version: z.number().int().positive(), machines: z.array(z.string()), tooLarge: z.array(z.string()) })),
    abandoned: z.array(z.strictObject({ hash: z.string(), version: z.number().int().positive(), hub: z.boolean(), machines: z.array(z.string()) })),
    rekey: z.literal('unmarked').nullable(),
    rekeying: z.strictObject({ step: z.enum(['browser', 'checking', 'approval', 'promoting']), fingerprint: z.string().nullable(), expires: z.string().nullable() }).nullable(),
    oldDevice: z.string().nullable(),
  })
  .nullable();
export type OrgSignerStatus = z.infer<typeof OrgSignerStatusSchema>;

const DeviceClassSchema = z.enum(['native-mac', 'web-cards']);
const RoleSchema = z.enum(['admin', 'member']);

/**
 * M4a (Interfaces §M): a pairing this Mac runs as the approving device (src/main/org/pairing.ts). `generation` counts
 * pairings in this run; `entry` is the frozen candidate, the first entry that answered the code, with its fingerprint to
 * compare and the digest `org.pair.approve` names. Never the code or its secret: those are in `org.pair.start`'s answer
 * alone. `problem`: why it ended (`two-entries`, `entry-changed`, `expired`, and the hub's `not-admin` and `no-member`).
 */
export const PAIRING_PROBLEMS = ['two-entries', 'entry-changed', 'expired', 'not-admin', 'no-member'] as const;
export const OrgPairingStatusSchema = z
  .strictObject({
    generation: z.number().int().positive(),
    member: z.string(),
    class: DeviceClassSchema,
    expires: z.string(),
    entry: z.strictObject({ id: z.string(), class: DeviceClassSchema, keyStorage: z.string(), fingerprint: z.string(), digest: z.string() }).nullable(),
    problem: z.enum(PAIRING_PROBLEMS).nullable(),
  })
  .nullable();
export type OrgPairingStatus = z.infer<typeof OrgPairingStatusSchema>;

const RegisteredSchema = z.strictObject({
  state: z.literal('registered'),
  org: z.string(),
  hub: z.string(),
  member: z.strictObject({ id: z.string(), email: z.string() }),
  device: z.string(),
  session: z.enum(['signed-in', 'signed-out', 'removed']),
  hubAccess: z.enum(['connected', 'connecting', 'expired', 'denied', 'unreachable', 'signing-in']),
  head: z.strictObject({ version: z.number().int().positive(), issued: z.string() }).nullable(), // null until a held chain verifies
  // held-chain: closed until a re-anchor; rollback and fork: the hub served one, refused; directory: <userData>/org/ refused;
  // signing (M3): signing.json is missing or damaged after its first write, so nothing is signed until it is reset
  problem: z.enum(['held-chain', 'rollback', 'fork', 'directory', 'signing']).nullable(),
  refused: OrgRefusalSchema.optional(),
  signer: OrgSignerStatusSchema, // M3: null until a head is held
  pairing: OrgPairingStatusSchema, // M4a: null while this Mac pairs no device
});
export const OrgStatusSchema = z.discriminatedUnion('state', [NoneSchema, DevelopmentSchema, RegisteringSchema, RegisteredSchema]);
export type OrgStatus = z.infer<typeof OrgStatusSchema>;

export const OrgAttemptSchema = z.union([z.strictObject({ ok: z.literal(true) }), z.strictObject({ ok: z.literal(false), reason: OrgRefusalSchema })]);
export type OrgAttempt = z.infer<typeof OrgAttemptSchema>;

const CodeInputSchema = z.strictObject({ code: z.string().max(4096) });
/** M3's acts that drop or replace signing state run only on the owner's confirmation, which the input carries. */
const ConfirmedInputSchema = z.strictObject({ confirmed: z.literal(true) });
/** A discard's confirmation is of one proposal: `hash` names the pending state the owner was shown (its stateHash). */
/** A revocation's confirmation is of the offer the owner was shown: `offer` is its `digest`. */
const RevokeInputSchema = z.strictObject({ offer: z.string().min(1).max(128) });
const DiscardInputSchema = z.strictObject({ confirmed: z.literal(true), hash: z.string().min(1).max(128) });

/**
 * M3: why a sign ended without a new version; `refused` names the checks' refusals in `detail`; `stale`: what would be
 * signed is no longer what the owner was shown (the superseded offer changed), so nothing was asked or signed.
 */
export const SIGN_REASONS = ['not-root', 'unmarked', 'signing', 'cancelled', 'pending', 'invalid', 'hub', 'busy', 'refused', 'stale'] as const;
export const SignResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), version: z.number().int().positive() }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(SIGN_REASONS), detail: z.string().optional() }),
]);
export type SignResult = z.infer<typeof SignResultSchema>;
/**
 * M3: a discard in `abandon-pending`'s words: `unsent` (never posted nor sent to a machine, so nothing can show it as a
 * fork), the hub's head when it was read, and `forkAt` when the hub holds another state at the pending version. Refused:
 * `held` (the hub holds it: it settled), `hub` (the hub can't be read), `none` (nothing pending), `signing` (damaged),
 * `stale` (the slot holds another proposal than the one confirmed).
 */
export const DiscardResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), unsent: z.boolean(), hubVersion: z.number().int().nonnegative(), forkAt: z.number().int().positive().optional() }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(['held', 'hub', 'none', 'signing', 'stale']).optional() }),
]);
export type DiscardResult = z.infer<typeof DiscardResultSchema>;

/**
 * M4a (Interfaces §M): the Org page's reading of the held head (src/main/org/view.ts), null unless a registration holds a
 * verified head. The signed facts only: whether a machine is up is the renderer's `useMachines`, since a link can drop
 * with no new head. `roots` reads each root kid as `rootLines` does, the device holding it or `unlisted`.
 */
export const OrgViewSchema = z.strictObject({
  version: z.number().int().positive(),
  issued: z.string(),
  maySign: z.boolean(),
  recoveryKid: z.string(),
  members: z.array(
    z.strictObject({
      id: z.string(),
      email: z.string(),
      name: z.string(),
      role: RoleSchema,
      you: z.boolean(),
      devices: z.array(z.strictObject({ id: z.string(), class: DeviceClassSchema, keyStorage: z.string(), root: z.boolean(), thisMac: z.boolean(), fingerprint: z.string() })),
    }),
  ),
  machines: z.array(z.strictObject({ name: z.string(), ref: z.string(), owners: z.union([z.array(z.string()), z.literal('org')]) })),
  roots: z.array(z.union([z.strictObject({ kid: z.string(), member: z.string(), device: z.string() }), z.strictObject({ kid: z.string(), unlisted: z.literal(true) })])),
});
export type OrgView = z.infer<typeof OrgViewSchema>;

const MemberIdSchema = z.string().min(1).max(64);
const DeviceIdSchema = z.string().min(1).max(128);
const EmailSchema = z.string().min(1).max(320);
/**
 * M4a: a change the Org page asks for (src/main/org/edits.ts composes each). `member.add`'s `id` is set by the preview,
 * so the id signed is the id shown; a change sent without it reads `stale`.
 */
export const OrgChangeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('member.add'), email: EmailSchema, role: RoleSchema, id: MemberIdSchema.optional() }),
  z.strictObject({ kind: z.literal('member.remove'), member: MemberIdSchema }),
  z.strictObject({ kind: z.literal('member.role'), member: MemberIdSchema, role: RoleSchema }),
  z.strictObject({ kind: z.literal('member.email'), member: MemberIdSchema, email: EmailSchema }),
  z.strictObject({ kind: z.literal('device.remove'), member: MemberIdSchema, device: DeviceIdSchema }),
  z.strictObject({ kind: z.literal('root.add'), member: MemberIdSchema, device: DeviceIdSchema }),
]);
export type OrgChange = z.infer<typeof OrgChangeSchema>;

/** A check's finding (src/main/org/checks.ts): `code` the package's, the checks' or a composer's, as a plain string. */
export const OrgFindingSchema = z.strictObject({ level: z.enum(['refuse', 'warn']), code: z.string(), detail: z.string() });
/**
 * M4a: what a change would sign, before Touch ID: its lines and the checks' warnings, and `digest`, which names
 * `{change, lines, warnings}` so `org.change` signs only what was shown. Refused: the checks' or the composer's own
 * findings (`refused`), a target gone from the head (`stale`), or this Mac can't sign (`not-root`, `unmarked`,
 * `signing`); `invalid` for anything else the composer threw.
 */
export const PreviewResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), change: OrgChangeSchema, lines: z.array(z.string()), warnings: z.array(z.string()), digest: z.string() }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(['refused', 'stale', 'not-root', 'unmarked', 'signing', 'invalid']), detail: z.string().optional(), findings: z.array(OrgFindingSchema) }),
]);
export type PreviewResult = z.infer<typeof PreviewResultSchema>;

/**
 * M4a: a pairing started. `code` is the pairing code, shown once: it is in this answer alone, never in a status. Refused:
 * this Mac can't sign (`not-root`), a later device of a member who isn't you (`later-device`: their own device pairs it,
 * a flow not built yet), a member the head doesn't list (`no-member`), a pairing or another attempt running (`busy`), or
 * no hub to poll (`hub`).
 */
export const PAIR_REFUSALS = ['not-root', 'later-device', 'no-member', 'busy', 'hub'] as const;
export const PairStartResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), code: z.string(), expires: z.string() }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(PAIR_REFUSALS), detail: z.string().optional() }),
]);
export type PairStartResult = z.infer<typeof PairStartResultSchema>;

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
  'org.resign': { input: z.void(), output: SignResultSchema, owner: 'main' }, // M3: "Re-sign now"
  'org.revokeSuperseded': { input: RevokeInputSchema, output: SignResultSchema, owner: 'main' }, // M3: the offer the owner confirmed
  'org.rekey': { input: CodeInputSchema, output: OrgAttemptSchema, owner: 'main' }, // M3: new keys with a fresh pairing code
  'org.discardPending': { input: DiscardInputSchema, output: DiscardResultSchema, owner: 'main' }, // M3
  'org.resetSigning': { input: ConfirmedInputSchema, output: z.void(), owner: 'main' }, // M3
  'org.view': { input: z.void(), output: OrgViewSchema.nullable(), owner: 'main' }, // M4a: read again at each org.changed
  'org.preview': { input: z.strictObject({ change: OrgChangeSchema }), output: PreviewResultSchema, owner: 'main' }, // M4a
  'org.change': { input: z.strictObject({ change: OrgChangeSchema, digest: z.string().min(1).max(128) }), output: SignResultSchema, owner: 'main' }, // M4a: stale on another digest
  'org.pair.start': { input: z.strictObject({ member: MemberIdSchema, class: DeviceClassSchema }), output: PairStartResultSchema, owner: 'main' }, // M4a
  'org.pair.approve': { input: z.strictObject({ generation: z.number().int().positive(), digest: z.string().min(1).max(128) }), output: SignResultSchema, owner: 'main' }, // M4a
  'org.pair.cancel': { input: z.void(), output: z.void(), owner: 'main' }, // M4a
} as const satisfies Record<`org.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'org.changed': OrgStatusSchema, // at every change of the status, the whole status
  'org.rows.changed': OrgRowsSchema, // M2: coalesced, the whole list
} as const satisfies Record<`org.${string}`, z.ZodType>;
