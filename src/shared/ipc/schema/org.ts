// X2 `org.*` (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §B; OX9): this app's place
// in the person's org: the sign-in from a pairing code, the device's registration, the held org state and the hub's
// credential (src/main/org/org-session.ts). Owned by main and graded `client`: the local app answers it, no machine.
// Main-to-renderer only, so outside the wire manifest. Nothing here carries a token, a key, a nonce or a pairing secret:
// the code goes in with `org.register` and `org.reanchor` and is never echoed back. The one exception is M4a's
// `org.pair.start`, whose answer carries the code this Mac made for another device, once, to show; no status does.
import * as z from 'zod';
import { ProjectIdSchema } from '../../graph/ids';
import { OrgKeySchema } from '../../machine/org-key';
import { MachineRefSchema } from '../../machine/ref';
import type { CommandSpec } from './common';
import { RecordAccessSchema, RecordPolicyEntrySchema } from './endpoint';

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
    // M4c: `delegation`, the delegation the slot holds (its unsent marker's, else the one its state adds to the head), so
    // a Delegations row offers Discard only for its own slot
    // M4c's fix wave 2: `held`, the slot's unsent marker stands (held for its create's publish, never sent): the
    // authority for a Delegations row's unsent actions, which `delegation` alone isn't (it stays once published)
    pending: z
      .strictObject({
        version: z.number().int().positive(),
        hash: z.string(),
        fork: z.boolean(),
        exposed: z.boolean(),
        refused: z.string().nullable(),
        delegation: z.string().nullable(),
        held: z.boolean(),
      })
      .nullable(),
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

/**
 * M4b (Interfaces §R): an enrollment this Mac runs (src/main/org/enroll.ts), as `deployment admin enroll` makes one.
 * `generation` counts enrollments in this run; `replace`, the ref of the machine a re-enrollment replaces; `candidate`,
 * the first key posted under it whose MAC is under the code's secret and whose name is this enrollment's, frozen, with
 * its key id to compare with `mawsd keys --json` on the machine and the digest `org.enroll.approve` names. Never the code,
 * its token or its secret: those are in `org.enroll.start`'s answer alone. `problem`: why it ended (`expired`, the hub's
 * `not-yours` and `unknown-enrollment`, `key-changed`: another key posted after the one shown, `machine-names`: the
 * name is bound to another ref for the life of the org).
 */
export const ENROLL_PROBLEMS = ['expired', 'not-yours', 'unknown-enrollment', 'key-changed', 'machine-names'] as const;
export const OrgEnrollingStatusSchema = z
  .strictObject({
    generation: z.number().int().positive(),
    name: z.string(),
    replace: z.string().nullable(),
    expires: z.string(),
    candidate: z.strictObject({ name: z.string(), ref: z.string(), keyId: z.string(), digest: z.string() }).nullable(),
    problem: z.enum(ENROLL_PROBLEMS).nullable(),
  })
  .nullable();
export type OrgEnrollingStatus = z.infer<typeof OrgEnrollingStatusSchema>;
/**
 * M4b: machines this run dropped whose hub row the delete didn't take out ("Signed. The hub still lists <name>: Retry");
 * `org.drop.retry` names one.
 */
export const OrgHubRowLeftSchema = z.strictObject({ name: z.string(), ref: z.string() });

/**
 * M4c: the Delegations section's part of the status. `creating`: a create (or "Write the code again") of this Mac's is
 * under way, so another window's Create waits; `rev` advances at every change the section reads through `org.view` and
 * that the status does not otherwise carry (the hub's key list read, a hub half's answer, a create's step, an unsent
 * delegation's problem), so `org.changed` tells the renderer to read the view again.
 */
export const OrgDelegationsStatusSchema = z.strictObject({ creating: z.boolean(), rev: z.number().int().nonnegative() });
export type OrgDelegationsStatus = z.infer<typeof OrgDelegationsStatusSchema>;

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
  enrolling: OrgEnrollingStatusSchema, // M4b: null while this Mac enrolls no machine
  hubRowsLeft: z.array(OrgHubRowLeftSchema), // M4b: dropped, their hub rows still listed
  delegations: OrgDelegationsStatusSchema, // M4c
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
 * M4c, a delegation's create (`org.delegation.create`, `org.delegation.rewrite`): `secret-store`, refused before anything
 * was minted or signed, since the destination, gcloud or the secret isn't ready (`detail` names what's missing);
 * `unsent`, signed and held unsent, its code not stored (`detail` says why, and the delegation's row offers "Write the
 * code again" while this run holds its key pair, else Discard). A create's success carries `secret`: the Secret Manager
 * version its code went to, and that version's `createTime` (ISO millis when gcloud's own reads as an instant).
 */
export const SIGN_REASONS = ['not-root', 'unmarked', 'signing', 'cancelled', 'pending', 'invalid', 'hub', 'busy', 'refused', 'stale', 'secret-store', 'unsent'] as const;
export const SignResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), version: z.number().int().positive(), secret: z.strictObject({ version: z.string(), createTime: z.string() }).optional() }),
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
 * M4c: why a delegation's hub half (renew's `POST …/renew`, drop's or a stray key's `DELETE`) didn't finish:
 * `no-route`, a hub without the renew route (`404 not-found`, the Worker's): "this hub can't renew its key yet";
 * `updating`, `503 hub-updating`, retried; `ended`, `410 key-revoked` or `key-expired`, which ends it (an elapsed key is
 * never revived); `not-renewed`, `409` while the hub's held head lacks the extension (its key list read after shows it
 * still behind); `too-long`, `409 too-long`, which heals with time after a delayed settlement; `hub`, no hub or no
 * answer; `refused`, any other answer of the hub's, in `detail`. `none` (a Retry's answer only): nothing to do, since the
 * head names no such delegation behind the hub, or names it in effect (a revoke).
 */
export const HUB_HALF_REASONS = ['no-route', 'updating', 'ended', 'not-renewed', 'too-long', 'hub', 'refused'] as const;
export const HubHalfResultSchema = z.union([
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), reason: z.enum([...HUB_HALF_REASONS, 'none']), detail: z.string().optional() }),
]);
export type HubHalfResult = z.infer<typeof HubHalfResultSchema>;
/**
 * M4c: a hub key minted in the last this many milliseconds is likely a create still under way (a CLI `delegation
 * create`, another admin's): Revoke's confirmation says so more strongly (the architect's ruling on stray keys).
 */
export const YOUNG_STRAY_KEY_MS = 15 * 60_000;
/**
 * M4c (Interfaces §S): a delegation as the Delegations section lists it (src/main/org/view.ts). Rows join the head's
 * delegations (`in-effect`), the unsent slot's, absent from the head (`unsent`), and the dropped ones whose hub key is
 * still live (`dropped`). `maxUses` is null for no cap. `machines`: the certified machines it made, from the held
 * certificates, live or retired (a revoked key's left out), one per ref. `hub`: its key in the last good read of the
 * hub's list (null: none there, or no read). `unsent`: `rewrite` while this run holds its key pair ("Write the code
 * again"; else Discard only), `writing` while this run is writing its code (a create's or a rewrite's steps 4 to 6: no
 * action until it ends, and no word of a lost key pair), why its code isn't stored, and the create run holding it
 * (`generation`, null for none), which a rewrite names. `hubBehind`, from the comparison alone: `renew`, the head
 * expires later than the hub's unrevoked, unexpired key; `revoke`, a dropped delegation's key still live. `hubProblem`:
 * the last hub half this sign-in ran for it that didn't finish.
 */
export const OrgDelegationRowSchema = z.strictObject({
  id: z.string(),
  prefix: z.string(),
  owners: z.union([z.array(z.string()), z.literal('org')]),
  expires: z.string(),
  maxUses: z.number().int().positive().nullable(),
  machines: z.array(z.strictObject({ ref: z.string(), name: z.string(), live: z.boolean() })),
  hub: z.strictObject({ expires: z.string(), uses: z.number().int().nonnegative(), revoked: z.boolean() }).nullable(),
  state: z.enum(['in-effect', 'unsent', 'dropped']),
  unsent: z.strictObject({ rewrite: z.boolean(), writing: z.boolean(), problem: z.string().nullable(), generation: z.number().int().positive().nullable() }).nullable(),
  hubBehind: z.enum(['renew', 'revoke']).nullable(),
  hubProblem: z.strictObject({ reason: z.enum(HUB_HALF_REASONS), detail: z.string() }).nullable(),
});
export type OrgDelegationRow = z.infer<typeof OrgDelegationRowSchema>;
/**
 * M4c: a hub key unrevoked and unexpired that no head delegation, revoked holder or unsent slot names (a mint whose sign
 * never happened), with Revoke; `young` when minted within `YOUNG_STRAY_KEY_MS` of the view's reading.
 */
export const OrgStrayKeySchema = z.strictObject({ id: z.string(), prefix: z.string(), label: z.string(), created: z.string(), expires: z.string(), young: z.boolean() });

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
  // M4b: `keyId`, the key the machine holds (to compare with `mawsd keys --json`); `certified`, a delegation's machine
  // through a live certificate, its owners its delegation's (`delegation`, its id); `mayGrant`, this Mac may sign a grant
  // on it (the architect's Fork B: `grantProblems` admits this device's step-up key as its signer, an owner's device or
  // an admin's for `'org'`, while signed in; not `maySign`), so the page shows Grant… there
  machines: z.array(
    z.strictObject({
      name: z.string(),
      ref: z.string(),
      owners: z.union([z.array(z.string()), z.literal('org')]),
      keyId: z.string(),
      certified: z.boolean(),
      delegation: z.string().nullable(),
      mayGrant: z.boolean(),
    }),
  ),
  roots: z.array(z.union([z.strictObject({ kid: z.string(), member: z.string(), device: z.string() }), z.strictObject({ kid: z.string(), unlisted: z.literal(true) })])),
  // M4c: the delegations and the stray hub keys; `hubKeys`, the hub's key list behind them: `at`, its last good read
  // (null: none yet this sign-in), and `failed`, the latest read failed (shown as such, never as "no keys")
  delegations: z.array(OrgDelegationRowSchema),
  strayKeys: z.array(OrgStrayKeySchema),
  hubKeys: z.strictObject({ at: z.string().nullable(), failed: z.boolean() }),
});
export type OrgView = z.infer<typeof OrgViewSchema>;

const MemberIdSchema = z.string().min(1).max(64);
const DeviceIdSchema = z.string().min(1).max(128);
const EmailSchema = z.string().min(1).max(320);
/** M4b: a machine as the org state names it; the package's grammar (`isMachineName`, `isMachineRef`) is the composers'. */
const MachineNameSchema = z.string().min(1).max(64);
const OrgMachineRefSchema = z.string().min(1).max(64);
const PubSchema = z.string().min(1).max(256);
/** A machine's owners: member ids, or `'org'` (its admins). An empty list is the package's `shape`, refused before Touch ID. */
const OwnersSchema = z.union([z.array(MemberIdSchema).max(256), z.literal('org')]);
/** M4c: a delegation as the org state names it: its id is the hub's provisioning key's (32 lowercase hex). */
const DelegationIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
/** An instant as the org state writes one (ISO 8601 UTC with milliseconds, the package's `isIsoMillis`). */
const IsoMillisSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
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
  // M4b: `machine.add` and `machine.replace` are an enrollment's (org.enroll.*), composed from the key it checked
  z.strictObject({ kind: z.literal('machine.add'), name: MachineNameSchema, ref: OrgMachineRefSchema, pub: PubSchema, owners: OwnersSchema }),
  z.strictObject({ kind: z.literal('machine.replace'), ref: OrgMachineRefSchema, pub: PubSchema }),
  z.strictObject({ kind: z.literal('machine.owners'), ref: OrgMachineRefSchema, owners: OwnersSchema }),
  z.strictObject({ kind: z.literal('machine.drop'), ref: OrgMachineRefSchema, revoke: z.boolean() }),
  // M4c: `delegation.add` is the create transaction's alone (org.delegation.create), composed from the key it minted and
  // the key pair it made; org.change and its preview refuse it, so a delegation is never signed outside its custody
  z.strictObject({
    kind: z.literal('delegation.add'),
    id: DelegationIdSchema,
    pub: PubSchema,
    prefix: MachineNameSchema,
    expires: IsoMillisSchema,
    maxUses: z.number().int().positive(),
    offlineRevokeS: z.number().int().nonnegative(),
    owners: OwnersSchema,
  }),
  z.strictObject({ kind: z.literal('delegation.renew'), id: DelegationIdSchema, expires: IsoMillisSchema }),
  z.strictObject({ kind: z.literal('delegation.drop'), id: DelegationIdSchema }),
]);
export type OrgChange = z.infer<typeof OrgChangeSchema>;

/**
 * M4c ("The destination"): where a new delegation's provisioning code goes, as a new version of a Secret Manager secret,
 * through this machine's gcloud (src/main/org/secret-store.ts). Main keeps it in a file of its own
 * (src/main/org/provisioning-secret-store.ts), never in the settings files, which an older build strict-parses (O7 M9).
 * Each value reaches gcloud's argv, so each is held to its grammar here and none can start with `-`: a GCP project id (6
 * to 30 lowercase letters, digits and hyphens, from a letter, not ending in a hyphen), a Secret Manager secret id (up to
 * 255 letters, digits, `_` and `-`), and the gcloud account, an email.
 */
export const ProvisioningSecretSchema = z.strictObject({
  project: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/),
  secret: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,254}$/),
  account: z
    .string()
    .max(254)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/),
});
export type ProvisioningSecret = z.infer<typeof ProvisioningSecretSchema>;
/**
 * M4c: `org.provisioningSecret.get`: the destination as main's file holds it, null when unset (no file), or `damaged`
 * (a file this build can't own, never read as unset: `org.provisioningSecret.reset` is the way out).
 */
export const ProvisioningSecretReadingSchema = z.union([ProvisioningSecretSchema, z.null(), z.strictObject({ damaged: z.string() })]);
export type ProvisioningSecretReading = z.infer<typeof ProvisioningSecretReadingSchema>;
/** M4c: `org.provisioningSecret.set` (`value` null clears it) and `.reset`: written, or why not (`invalid`, `damaged`: never written over, `io`). */
export const ProvisioningSecretWriteSchema = z.union([z.strictObject({ ok: z.literal(true) }), z.strictObject({ ok: z.literal(false), reason: z.enum(['invalid', 'damaged', 'io']), detail: z.string() })]);
export type ProvisioningSecretWrite = z.infer<typeof ProvisioningSecretWriteSchema>;

/**
 * M4c: the sheet's bounds of a new delegation, org-protocol's (src/main/org/delegations.test.ts pins them): its key's life
 * in whole days (`MIN_PROVISIONING_KEY_TTL_S` to `MAX_PROVISIONING_KEY_TTL_S`), and a use cap up to
 * `MAX_PROVISIONING_KEY_USES` (null: no cap).
 */
export const DELEGATION_TTL_DAYS = { min: 1, max: 365 } as const;
export const DELEGATION_MAX_USES = 10_000;
/**
 * M4c: `org.delegation.create`, the create transaction (src/main/org/delegations.ts): `label` the hub key's (1 to 100
 * characters), `prefix` the machine names it provisions, `ttlDays` its life, `maxUses` its cap (null: none), `owners`
 * its machines' owners.
 */
export const DelegationCreateInputSchema = z.strictObject({
  label: z.string().min(1).max(100),
  prefix: MachineNameSchema,
  ttlDays: z.number().int().min(DELEGATION_TTL_DAYS.min).max(DELEGATION_TTL_DAYS.max),
  maxUses: z.number().int().min(1).max(DELEGATION_MAX_USES).nullable(),
  owners: OwnersSchema,
});
export type DelegationCreateInput = z.infer<typeof DelegationCreateInputSchema>;
/**
 * M4c (Task 5's fix wave): the create run an answer belongs to, as main issued it: its `generation`, the delegation `id`
 * it minted (null before), and the held slot's `hash` (null before the sign). A sheet acts only on the row and the slot
 * these name; `org.delegation.rewrite` names all three, and anything else answers `stale`.
 */
export const DelegationRunSchema = z.strictObject({ generation: z.number().int().positive(), id: DelegationIdSchema.nullable(), hash: z.string().min(1).max(128).nullable() });
export type DelegationRun = z.infer<typeof DelegationRunSchema>;
/**
 * M4c: where a create (or a rewrite) stopped, whatever its reason: `refused` before anything was minted; `minted`, its
 * key minted (or perhaps, its answer lost) and nothing signed, the key revoked or left a stray; `held`, signed into the
 * slot and held unsent (`stored`: its code is in the secret, the publish refused); `published`, this run's publish
 * cleared the slot's marker (the signer's own word, never inferred from a slot gone), owned by settlement as any pending
 * state, though the post's answer failed; `discarded` (fix wave 2), the held slot was discarded or replaced before its
 * publish, so nothing was published. `version`: the signed state's, once signed.
 */
export const DELEGATION_PHASES = ['refused', 'minted', 'held', 'published', 'discarded'] as const;
export type DelegationPhase = (typeof DELEGATION_PHASES)[number];
/**
 * `rev`: the status's `delegations.rev` published once the answer's final slot was in place, so a status at or past it
 * shows that slot (or a later one), and an older status may not (events and answers reach the renderer on separate
 * pipes, unordered).
 */
export const DelegationResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    version: z.number().int().positive(),
    secret: z.strictObject({ version: z.string(), createTime: z.string() }).optional(),
    run: DelegationRunSchema,
    rev: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum(SIGN_REASONS),
    detail: z.string().optional(),
    phase: z.enum(DELEGATION_PHASES),
    stored: z.boolean(),
    version: z.number().int().positive().optional(),
    run: DelegationRunSchema.nullable(),
    rev: z.number().int().nonnegative(),
  }),
]);
export type DelegationResult = z.infer<typeof DelegationResultSchema>;
/** M4c: `org.delegation.rewrite`, naming the run, the delegation and the held slot the sheet or the row was shown. */
export const DelegationRewriteInputSchema = z.strictObject({ generation: z.number().int().positive(), id: DelegationIdSchema, hash: z.string().min(1).max(128) });
export type DelegationRewriteInput = z.infer<typeof DelegationRewriteInputSchema>;
/** M4c: the hub's key list behind the view, as `OrgView.hubKeys` carries it (`org.delegation.readKeys`' answer). */
export const HubKeysReadSchema = z.strictObject({ at: z.string().nullable(), failed: z.boolean() });
export type HubKeysRead = z.infer<typeof HubKeysReadSchema>;

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
 * M4b: an enrollment started. `code` is the v2 enrollment code (its token and secret within), shown once: in this answer
 * alone, never in a status. Refused before anything is minted: this Mac can't sign (`not-root`), its member isn't an
 * admin (`not-admin`), an enrollment, a pairing or another attempt running (`busy`), no hub (`hub`), a name outside the
 * grammar (`shape`), a name listed (`machine-name-taken`) or under a delegation's prefix (`prefix-names-machine`), a
 * re-enrollment of a certified machine (`certified-machine`) or of no listed machine (`no-machine`); after it, the hub's
 * refusal of the mint (`refused`, its status and code in `detail`), or a cancel while it was minted (`cancelled`).
 */
export const ENROLL_REFUSALS = ['not-root', 'not-admin', 'busy', 'hub', 'shape', 'machine-name-taken', 'prefix-names-machine', 'certified-machine', 'no-machine', 'refused', 'cancelled'] as const;
export const EnrollStartResultSchema = z.union([
  // `generation`: the run this start made, so the sheet that sent it owns exactly that run (fix wave 4)
  z.strictObject({ ok: z.literal(true), code: z.string(), expires: z.string(), generation: z.number().int().positive() }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(ENROLL_REFUSALS), detail: z.string().optional() }),
]);
export type EnrollStartResult = z.infer<typeof EnrollStartResultSchema>;
/**
 * M4b fix wave: a window cancels the enrollment it owns, never another's. `generation` names its run; null, the start
 * this window sent whose run it hasn't been shown: main ends that start's mint, or the run it made while still the
 * current one, judged by the asking client (fix wave 3), never another window's. `not-current`: that isn't the run or
 * the start under way, so nothing was cancelled.
 */
export const EnrollCancelInputSchema = z.strictObject({ generation: z.number().int().positive().nullable() });
export const EnrollCancelResultSchema = z.union([z.strictObject({ ok: z.literal(true) }), z.strictObject({ ok: z.literal(false), reason: z.literal('not-current'), detail: z.string() })]);
export type EnrollCancelResult = z.infer<typeof EnrollCancelResultSchema>;
/** M4b: a dropped machine's hub row deleted again. `none`: no drop of that name awaits its row's delete; `hub`: not reached. */
export const DropRetryResultSchema = z.union([z.strictObject({ ok: z.literal(true) }), z.strictObject({ ok: z.literal(false), reason: z.enum(['none', 'hub', 'refused']), detail: z.string().optional() })]);
export type DropRetryResult = z.infer<typeof DropRetryResultSchema>;

/** M4b: a machine's rights a grant gives, in RL7's order (`spawn`, `shell`, `machine-admin`); owners hold every one. */
export const GRANT_RIGHTS = ['spawn', 'shell', 'machine-admin'] as const;
const GrantRightSchema = z.enum(GRANT_RIGHTS);
const GrantVersionSchema = z.number().int().positive();
/**
 * M4b: how a grant this Mac signed stands at its machine: `pending` (kept, not yet on the machine: sent again when its
 * link comes up), `done` (its ledger holds it), or `{refused}`, the machine's word (`not-newer`: another device changed
 * this grant since its ledger was read; the page offers "Another device changed this grant: sign again", one more
 * confirmation; `not-held`: its ledger holds no such machine key).
 */
export const GrantDeliveredSchema = z.union([z.literal('pending'), z.literal('done'), z.strictObject({ refused: z.string() })]);
export type GrantDelivered = z.infer<typeof GrantDeliveredSchema>;
/**
 * M4b: `org.grants.view`, a machine's grants (src/main/org/grants.ts). `grants`: each member holding rights, from the
 * machine's own ledger (`on-machine`), or from this Mac's issued record while its ledger lacks it (`pending`: "Not yet on
 * <machine>"; `refused`, with the machine's `reason`); with no answer yet, the issued record's delivered grants read
 * `on-machine`. `live`: this read answered now; else the view is the last answer's, `asOf` its time (null: none this
 * sign-in). `missing`: the delivered grants this Mac issued that the ledger no longer holds (a machine enrolled again with
 * a new key), each with the rights it gave, which Re-grant… shows and `org.grants.regrant` signs again for the machine's
 * current key; never a withdrawal; empty while the machine's key isn't one uncontested key. `digest` names `missing` as
 * shown (null: none). Refused: `signed-out`, `damaged` (grants.json doesn't read: no grant is signed until it does).
 */
export const GrantsViewSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    ref: z.string(),
    live: z.boolean(),
    asOf: z.string().nullable(),
    grants: z.array(
      z.strictObject({
        member: z.string(),
        rights: z.array(GrantRightSchema),
        version: GrantVersionSchema,
        state: z.enum(['on-machine', 'pending', 'refused']),
        reason: z.string().optional(),
      }),
    ),
    missing: z.array(z.strictObject({ member: z.string(), rights: z.array(GrantRightSchema), version: GrantVersionSchema })),
    digest: z.string().nullable(),
  }),
  z.strictObject({ ok: z.literal(false), ref: z.string(), reason: z.enum(['signed-out', 'damaged']) }),
]);
export type GrantsView = z.infer<typeof GrantsViewSchema>;
/**
 * M4b: why a grant was not signed. `signed-out`; `damaged` (grants.json); `busy` (another grant is being signed);
 * `invalid` (rights named twice); `no-change` (the rights it holds or is being given already); `ineligible` (before
 * Touch ID, `grantProblems`' codes in `problems`: this Mac's key is no owner's, or an admin's for `'org'`; the member or
 * the machine unlisted; its key not one uncontested key); `ledger-unread` (the machine's grant ledger can't be read now,
 * so no version is guessed); `cancelled`; `refused` (signed, then it doesn't verify against the org state held now, its
 * verdict in `detail`: nothing kept or sent); `stale` (the org state moved between the grant's verification and its
 * keep, or, for `org.grants.regrant`, the missing grants are no longer the ones shown: nothing kept or sent, sign
 * again); `storage` (grants.json could not be written: nothing sent); `none` (nothing missing to re-grant).
 */
export const GRANT_REFUSALS = ['signed-out', 'damaged', 'storage', 'busy', 'invalid', 'no-change', 'ineligible', 'ledger-unread', 'cancelled', 'refused', 'stale', 'none'] as const;
const GrantRefusedSchema = z.strictObject({ ok: z.literal(false), reason: z.enum(GRANT_REFUSALS), detail: z.string().optional(), problems: z.array(z.string()).optional() });
/** M4b: `org.grants.set`: the grant signed, kept and sent, at `version`, and how its delivery stands. */
export const GrantSetResultSchema = z.union([z.strictObject({ ok: z.literal(true), version: GrantVersionSchema, delivered: GrantDeliveredSchema }), GrantRefusedSchema]);
export type GrantSetResult = z.infer<typeof GrantSetResultSchema>;
/** M4b: `org.grants.regrant`: every missing grant signed under one confirmation, kept and sent, each as it stands. */
export const GrantRegrantResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), results: z.array(z.strictObject({ member: z.string(), version: GrantVersionSchema, delivered: GrantDeliveredSchema })) }),
  GrantRefusedSchema,
]);
export type GrantRegrantResult = z.infer<typeof GrantRegrantResultSchema>;

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
  // M6b: a private session's channel listing names who it reaches (its owners and shares) and its policy revision
  audience: z.array(z.string()).optional(),
  policyRev: z.number().int().nonnegative().optional(),
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

/**
 * The project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §I; design §6, §11): the org's
 * projects as main holds them for the signed-in member, assembled from the machines' verified projects records
 * (src/main/org/project-registry.ts). A location is one machine's declared folder of the project, named by the machine's
 * own row id (`pid`); `key` is the folder's label on its machine and joins nothing. `remoteProject` (M11, additive): the
 * project the observed `remote` derives in the org, which the page cannot compute. `acts`: the member owns the machine,
 * so the location's actions are theirs. A project the member sees only through a session of it has no locations.
 */
export const OrgProjectLocationSchema = z.strictObject({
  machine: MachineRefSchema,
  pid: z.string().min(1),
  path: z.string(),
  key: OrgKeySchema,
  name: z.string(),
  source: z.enum(['smns', 'remote', 'repository', 'folder']),
  stated: z.enum(['minted', 'linked']).optional(),
  state: z.enum(['missing', 'replaced']).optional(),
  remote: z.string().optional(),
  remoteProject: z.string().optional(), // M11, additive: the project `remote` derives in the org (design §8's uuid5), with `remote` alone
  acts: z.boolean(),
});
export type OrgProjectLocation = z.infer<typeof OrgProjectLocationSchema>;
export const OrgProjectSchema = z.strictObject({ id: z.string().min(1), name: z.string(), hub: z.boolean(), renamable: z.boolean(), locations: z.array(OrgProjectLocationSchema) });
export type OrgProject = z.infer<typeof OrgProjectSchema>;
/** A removal held for a machine that is off, bound to the location as it was when asked (`project` and `path`). */
export const HeldRemovalSchema = z.strictObject({ id: z.string().min(1), project: z.string(), machine: MachineRefSchema, pid: z.string().min(1), path: z.string(), askedAt: z.string() });
export type HeldRemoval = z.infer<typeof HeldRemovalSchema>;
export const OrgProjectsSchema = z.strictObject({
  projects: z.array(OrgProjectSchema), // ordered by id; a held removal's location left out
  keys: z.record(z.string(), OrgKeySchema), // project id → this device's row key, one to one, never changed
  moved: z.record(z.string(), OrgKeySchema), // a key no project has any more → the key its tabs belong under now
  removals: z.array(HeldRemovalSchema), // the signed-in member's, waiting for their machine
  seen: z.record(z.string(), z.string()), // machine ref → when it was last seen (ISO), for "offline since"
  // panel scalpel-2#1, additive: this Mac's row → the project id main computed for it where the row carries none (a
  // `remote:` label on a Mac signed in and not enrolled, as `joinIds` did), which the page groups it by, having no uuid5
  // to compute it; absent when no row needs one. The key is a ProjectId, so the page reads it as the row's address.
  ownIds: z.record(ProjectIdSchema, z.string()).optional(),
});
export type OrgProjects = z.infer<typeof OrgProjectsSchema>;

/**
 * The project registry's M12 (Interfaces §K, the page's half; Decision Log 20): a terminal's `maws project …` aimed at
 * another machine, which `mawsd` asked this app (`projects.act.request`) and main holds until the person decides in the
 * page's sheet. `machine` is the ref the request's machine name names in the held org state; `into` a project id (null:
 * unlink), `intoName` its name in the registry when it has one; `askedAt` when main took it.
 */
export const ProjectActAskSchema = z.strictObject({
  id: z.string().min(1),
  verb: z.enum(['add', 'remove', 'link']),
  machine: MachineRefSchema,
  machineName: z.string(),
  path: z.string(),
  into: z.string().nullable().optional(),
  intoName: z.string().optional(),
  own: z.literal(true).optional(),
  name: z.string().optional(),
  askedAt: z.string(),
});
export type ProjectActAsk = z.infer<typeof ProjectActAskSchema>;
export const ProjectActAsksSchema = z.strictObject({ asks: z.array(ProjectActAskSchema) });
export type ProjectActAsks = z.infer<typeof ProjectActAsksSchema>;

/**
 * M7a (Interfaces §N, with the pre-flight's ruling in the Decision Log, "M7a is built as three tasks"): a project's
 * channel, the app's one reader of the log plane. Main reads the hub's Project socket and verifies every event against
 * the held head (src/main/org/channel/); the renderer folds what it is sent into the stream (`channel/project.ts`), so
 * these carry main's verdicts, never a folded entry.
 *
 * `ChannelEvent`: one event of the log that verified, as stored at `offset` (its `mac` and `sig` left out: nothing past
 * main checks them). `label`: `verified` (a v2 signature main checked), `migrated` (a DX1 event a machine's history
 * attestation covers; `by` names that machine) or `legacy` (a DX1 event nothing covers, drawn faint). `author`: a
 * device's `human`, its member as the held head names them; `owners`: a machine's v2 event whose owner attestation (RL9)
 * verified, named from the held head, never from the event. Withheld tombstones and events that don't verify are not
 * sent; `unverified` counts the latter. `session`: the session a machine's writer is (`<machine>/<session>`, or its
 * audience stream `<machine>/<session>~<digest>`, read by the protocol's `streamOf`); absent for a `hub/` or `legacy/`
 * writer.
 */
export const CHANNEL_LABELS = ['verified', 'migrated', 'legacy'] as const;
export const ChannelEventSchema = z.strictObject({
  offset: z.number().int().nonnegative(),
  writer: z.string(),
  seq: z.number().int().positive(),
  session: z.string().optional(),
  event: z.record(z.string(), z.unknown()),
  label: z.enum(CHANNEL_LABELS),
  by: z.string().optional(),
  author: OrgMemberSchema.optional(),
  owners: z.array(OrgMemberSchema).optional(),
});
export type ChannelEvent = z.infer<typeof ChannelEventSchema>;
/**
 * A session of the project as its log's lifecycle names it (each session's latest `joined`, `retired`, `renamed` and
 * `titled`, kept past the cache's bound): its alias, machine and title, and whether it is a member now. Its authenticated
 * lifecycle (`verified` or `migrated`) alone, when it has any (`authenticated`); a session with only a `legacy` one is
 * named by it but is never a member, and its names stand only on `legacy` entries. Addressing reads these (members
 * only), and the stream's titles.
 */
export const ChannelSessionSchema = z.strictObject({ session: z.string(), alias: z.string(), machine: z.string(), title: z.string().nullable(), member: z.boolean(), authenticated: z.boolean() });
export type ChannelSession = z.infer<typeof ChannelSessionSchema>;
/** Whom words go to: everyone, or the sessions a leading `@alias` named. */
export const ChannelRecipientsSchema = z.union([z.literal('*'), z.array(z.strictObject({ session: z.string(), alias: z.string() }))]);
export type ChannelRecipients = z.infer<typeof ChannelRecipientsSchema>;
/**
 * The signed-in member's words on this device that the log doesn't hold yet, and only theirs: `sending` until the hub's
 * `human-ack`, then `sent` until the log holds the word, or the hub's refusal (`not-reachable` for a session hidden from
 * you, P5 Decision Log 224). `not-sent`: a word the project's last channel let go unacknowledged, shown for this
 * channel's life and never sent again. Kept in main's memory only, nothing on disk.
 */
export const ChannelWordSchema = z.strictObject({
  nonce: z.string(),
  text: z.string(),
  to: ChannelRecipientsSchema,
  state: z.union([z.literal('sending'), z.literal('sent'), z.literal('not-sent'), z.strictObject({ refused: z.string() })]),
});
export type ChannelWord = z.infer<typeof ChannelWordSchema>;
/**
 * M7b (Interfaces §O; the Decision Log's "M7b's channel feed" and Task 2's shapes): a session's to-human entry, as the
 * spine of the machine it ran on journals it (a message, a question with its choices, an answer), read by main from this
 * Mac's spine and over each roster machine's link (src/main/org/channel/machines.ts) and merged into the channel beside
 * the log's events; the renderer places them by time (`channel/project.ts`). `id` is the machine's (this Mac's journal
 * id, another's opaque cursor), never compared across machines, so `key` (the machine and the id) names an entry in
 * the channel. Its `session` is a plain string, as a RemoteRow's is, so the codec lifts nothing in it: the renderer
 * forms an address with `addressOf(machine, session)`. `src` is the journal's origin (§O), which pairs an answer with its question.
 */
export const ChannelHostSchema = z.strictObject({
  key: z.string(),
  machine: MachineRefSchema,
  id: z.string(),
  lane: z.enum(['A', 'B']),
  session: z.string().nullable(), // lane A: the engine session id; lane B: the appSessionId, as a RemoteRow's `session`
  kind: z.enum(['message', 'question', 'answered']),
  text: z.string(),
  choices: z.array(z.string()).optional(),
  at: z.string(),
  src: z.string(),
  // among one machine's entries said at the same time, its place in that machine's journal (lower first), fixed when main
  // first holds the entry: the renderer's order after `at` and the machine, across changes
  order: z.number().int(),
});
export type ChannelHost = z.infer<typeof ChannelHostSchema>;
/**
 * M7b: where a machine's to-human entries stand. `live`: its feed (this Mac's spine, or another's `channel` feed) is
 * open and caught up; `read`: an endpoint older than the feed (no `rl2.channel`), read once by `channel.history` when the
 * tab opened, with no live updates; `offline`: not live now, its entries as of `asOf`, the last time they were; and
 * `unavailable`: an endpoint older still, which answers neither, drawn greyed. `asOf` is null only while nothing was
 * ever read from it.
 */
export const CHANNEL_MACHINE_STATES = ['live', 'read', 'offline', 'unavailable'] as const;
export const ChannelMachineSchema = z.strictObject({ machine: MachineRefSchema, name: z.string(), state: z.enum(CHANNEL_MACHINE_STATES), asOf: z.string().nullable() });
export type ChannelMachine = z.infer<typeof ChannelMachineSchema>;
/**
 * Why a channel has nothing to draw: signed out, or signed in with no hub, with no cache of the project either; or a
 * project the hub doesn't hold (`unknown-project`, also any id that isn't a project's). With a cache, a channel opened
 * offline answers it, `live: false` and `asOf` its last `caught-up`.
 */
export const CHANNEL_CLOSED_REASONS = ['signed-out', 'no-hub', 'unknown-project'] as const;
/**
 * `rev`: main's count of the changes it has told, across every channel of this run, never going back. An open answer
 * carries the count as it stands and each change the count it took, so a tab applies only the changes numbered past its
 * answer: one told before it describes an older state than the answer does.
 */
const RevSchema = z.number().int().nonnegative();
/**
 * UX wave U11a M4 (S-09; docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md, Interfaces §F): the
 * channel's own reach while it is not live, and the hub's refusal of it while that stands, told with every open answer
 * and as a change whenever either moves. `reach` turns `unreachable` at an attestation read or a socket that fails before
 * its welcome, and stays so through every retry until the channel is live. `refused` is apart from it: the hub ended the
 * channel's socket for good (`credentials`: the hub sign-in has ended; `removed`: the hub no longer admits the member),
 * nothing is retried, and it stands until the session's next change.
 */
const ChannelOpenSchema = z.strictObject({
  ok: z.literal(true),
  rev: RevSchema,
  events: z.array(ChannelEventSchema), // oldest first, by offset
  sessions: z.array(ChannelSessionSchema),
  pending: z.array(ChannelWordSchema),
  unverified: z.number().int().nonnegative(),
  asOf: z.string().nullable(), // the last `caught-up`'s time; null until one
  live: z.boolean(), // the socket is open and caught up
  reach: z.enum(['connecting', 'unreachable']).optional(), // present exactly while the answer is open and `live` is false
  refused: z.enum(['credentials', 'removed']).optional(), // present while the hub has ended this channel's socket for good and the channel waits for the session's next change
  hosts: z.array(ChannelHostSchema).optional(), // M7b: every machine's to-human entries, oldest first
  machines: z.array(ChannelMachineSchema).optional(), // M7b: each machine whose entries the channel reads
});
const ChannelClosedSchema = z.strictObject({ ok: z.literal(false), reason: z.enum(CHANNEL_CLOSED_REASONS), rev: RevSchema });
export const ChannelAnswerSchema = z.union([ChannelOpenSchema, ChannelClosedSchema]);
export type ChannelAnswer = z.infer<typeof ChannelAnswerSchema>;
/** The project's sminos id (its `smnsId`); any other string answers `unknown-project`. */
const ChannelProjectSchema = z.string().min(1).max(64);
/**
 * Why words weren't sent: no session or no hub, a channel not open or one whose project the hub refused (`unreadable`:
 * the app sends nothing to a project it can't read), nothing to say, or a leading `@alias` that names no session of the
 * project (`no-member`) or more than one (`ambiguous`), or another org, member or device signed in while the words were
 * being signed (`context-changed`).
 */
export const CHANNEL_SEND_REFUSALS = ['signed-out', 'no-hub', 'not-open', 'unreadable', 'empty', 'no-member', 'ambiguous', 'context-changed'] as const;
export const ChannelSendResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), nonce: z.string() }),
  z.strictObject({ ok: z.literal(false), reason: z.enum(CHANNEL_SEND_REFUSALS), detail: z.string().optional() }),
]);
export type ChannelSendResult = z.infer<typeof ChannelSendResultSchema>;
/** The most text one word carries; the hub's frame (1 MiB) holds it in any script. */
export const CHANNEL_TEXT_MAX = 100_000;
/**
 * A change since the last: `upserts` are the events new or judged again since, by offset, each replacing what a tab holds
 * at its offset; `removed` the offsets main no longer draws (let go by its bound, or failing now), so a tab holds exactly
 * main's set; the sessions, the pending words, `unverified`, `asOf`, `live`, `reach` and `refused` are whole. `reset`
 * replaces every event a tab holds with `upserts`: told when a judgment at a new head or certificate set changed
 * verdicts, when another reader's log was dropped, and for the first change after a closed one.
 */
/**
 * M7b: the to-human entries' change since the last, by `key`, beside the log's: `upserts` are new (an entry's content
 * never changes), `removed` the keys main no longer draws (a machine gone from the roster, a bound, an entry its machine
 * no longer shows the member); `reset` replaces every entry a tab holds with `upserts`, told with the log's `reset` and
 * whenever main replaced them whole (another reader's cache dropped).
 */
const ChannelHostsDeltaSchema = z.strictObject({ reset: z.literal(true).optional(), upserts: z.array(ChannelHostSchema), removed: z.array(z.string()) });
const ChannelDeltaSchema = z.strictObject({
  project: z.string(),
  ok: z.literal(true),
  rev: RevSchema,
  upserts: z.array(ChannelEventSchema), // oldest first, by offset
  removed: z.array(z.number().int().nonnegative()), // offsets; empty with `reset`
  sessions: z.array(ChannelSessionSchema), // whole
  pending: z.array(ChannelWordSchema),
  unverified: z.number().int().nonnegative(),
  asOf: z.string().nullable(),
  live: z.boolean(),
  reach: z.enum(['connecting', 'unreachable']).optional(), // U11a M4: whole, as on the open answer
  refused: z.enum(['credentials', 'removed']).optional(),
  reset: z.literal(true).optional(),
  hosts: ChannelHostsDeltaSchema.optional(), // M7b
  machines: z.array(ChannelMachineSchema).optional(), // M7b: whole
});
export const ChannelChangedSchema = z.union([ChannelDeltaSchema, ChannelClosedSchema.extend({ project: z.string() })]);
export type ChannelChanged = z.infer<typeof ChannelChangedSchema>;

/**
 * M6b (Interfaces §Q): a session's reach, as its machine's `record.policy` reads it (src/main/org/policy.ts): the
 * machine's own sessions' policies (`{machine}`), or one session's (`{address}`, `<ref>/<listing id>`: lane A's engine
 * session id, lane B's appSessionId). `supported: false`: the machine's sminos can't keep a session's reach yet. Refused
 * (`ok: false`): `signed-out`, `offline` (no link to the machine), `malformed`, or the read's own code (`unavailable`,
 * `not-offered`, …). A whole machine's read is also told as `org.policies.changed`.
 */
export const OrgPolicySchema = z.union([
  z.strictObject({ ok: z.literal(true), machine: MachineRefSchema, supported: z.literal(false) }),
  z.strictObject({ ok: z.literal(true), machine: MachineRefSchema, supported: z.literal(true), policies: z.array(RecordPolicyEntrySchema) }),
  z.strictObject({ ok: z.literal(false), machine: MachineRefSchema, reason: z.string() }),
]);
export type OrgPolicy = z.infer<typeof OrgPolicySchema>;
/** A session by its address, `<ref>/<listing id>`: a plain string, so O6's codec lifts nothing in it. */
const PolicyAddressSchema = z.string().min(1).max(600);
const ShareGradeSchema = z.enum(['list', 'view', 'converse', 'approve']);
/** One line of a save, as the sheet showed it: the access, a share (`grade: null` removes it), or M5b's owner added. */
export const OrgPolicyLineSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('access'), access: RecordAccessSchema }),
  z.strictObject({ kind: z.literal('share'), member: MemberIdSchema, grade: ShareGradeSchema.nullable() }),
  z.strictObject({ kind: z.literal('owner'), member: MemberIdSchema }),
]);
export type OrgPolicyLine = z.infer<typeof OrgPolicyLineSchema>;
/**
 * A line's outcome. `done`: it ran; `changed: false` is a no-op that bumped nothing; `policyRev`, the revision it left;
 * `elsewhere`, its revision skipped one, so the policy also changed elsewhere. `refused`: nothing ran, in its refuser's
 * words: sminos's (`no-session`, `unsupported`, `bad-shape`, `read-only`), the endpoint's (`not-offered`, `no-session`),
 * the ledger's (`stale`, `expired`, `tombstoned`), step-up's (`cancelled`), the link's (`offline`, `closed`, …).
 * `unknown`: it may have run (`malformed`: it said `done` without its change and revision). `failed`: it was tried and
 * failed. `not-sent`: an earlier line's failure stopped the save first.
 */
export const OrgPolicyOutcomeSchema = z.union([
  z.strictObject({ line: OrgPolicyLineSchema, state: z.literal('done'), changed: z.boolean(), policyRev: z.number().int().nonnegative(), elsewhere: z.boolean() }),
  z.strictObject({ line: OrgPolicyLineSchema, state: z.enum(['refused', 'unknown', 'failed']), reason: z.string() }),
  z.strictObject({ line: OrgPolicyLineSchema, state: z.literal('not-sent') }),
]);
export type OrgPolicyOutcome = z.infer<typeof OrgPolicyOutcomeSchema>;
/**
 * Why a save sent nothing (`OrgPolicySetResult`'s `reason`): `signed-out`, `malformed`, `empty` (nothing to change),
 * `no-session` (no row places the session), `offline`, `not-supported` (the machine's sminos can't keep its reach),
 * `unavailable` (its reach can't be read now), `changed-elsewhere` (its revision moved before or after Touch ID:
 * reload), `cancelled`; or a read's, a link's or the step-up's own code (`not-offered`, `closed`, `too-large`, …).
 */
export const POLICY_REFUSALS = ['signed-out', 'malformed', 'empty', 'no-session', 'offline', 'not-supported', 'unavailable', 'changed-elsewhere', 'cancelled'] as const;
/** A save's answer: each line's outcome in order, and the session's policy read after it as it stands (null unread). */
export const OrgPolicySetResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), results: z.array(OrgPolicyOutcomeSchema), policy: RecordPolicyEntrySchema.nullable() }),
  z.strictObject({ ok: z.literal(false), reason: z.string() }),
]);
export type OrgPolicySetResult = z.infer<typeof OrgPolicySetResultSchema>;
/** The most shares one save changes. */
export const POLICY_SHARES_MAX = 64;
export const OrgPolicyGetInputSchema = z.union([z.strictObject({ machine: MachineRefSchema }), z.strictObject({ address: PolicyAddressSchema })]);
/**
 * A save: the access if it changed, and each share added, changed or removed (`grade: null`), in the sheet's order, at
 * the `policyRev` the sheet opened on.
 */
export const OrgPolicySetInputSchema = z.strictObject({
  address: PolicyAddressSchema,
  access: RecordAccessSchema.optional(),
  shares: z.array(z.strictObject({ member: MemberIdSchema, grade: ShareGradeSchema.nullable() })).max(POLICY_SHARES_MAX).optional(),
  policyRev: z.number().int().nonnegative(),
});
export type OrgPolicySetInput = z.infer<typeof OrgPolicySetInputSchema>;
/** M5b's: an owner added to a session. */
export const OrgOwnersAddInputSchema = z.strictObject({ address: PolicyAddressSchema, member: MemberIdSchema });

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
  'org.enroll.start': { input: z.strictObject({ name: MachineNameSchema, replace: OrgMachineRefSchema.optional() }), output: EnrollStartResultSchema, owner: 'main' }, // M4b
  'org.enroll.approve': { input: z.strictObject({ generation: z.number().int().positive(), digest: z.string().min(1).max(128) }), output: SignResultSchema, owner: 'main' }, // M4b
  'org.enroll.cancel': { input: EnrollCancelInputSchema, output: EnrollCancelResultSchema, owner: 'main' }, // M4b; scoped to its run in the fix wave
  'org.drop.retry': { input: z.strictObject({ name: MachineNameSchema }), output: DropRetryResultSchema, owner: 'main' }, // M4b: the hub row's DELETE alone
  'org.delegation.create': { input: DelegationCreateInputSchema, output: DelegationResultSchema, owner: 'main' }, // M4c: the one Touch ID; the code never leaves main
  'org.delegation.rewrite': { input: DelegationRewriteInputSchema, output: DelegationResultSchema, owner: 'main' }, // M4c: "Write the code again" (steps 4-6), for the run named
  'org.delegation.readKeys': { input: z.void(), output: HubKeysReadSchema, owner: 'main' }, // M4c: the hub's key list read now (Retry after a failed read), under this sign-in
  'org.delegation.renewHub': { input: z.strictObject({ id: DelegationIdSchema }), output: HubHalfResultSchema, owner: 'main' }, // M4c: Retry, the route alone
  'org.delegation.revokeHub': { input: z.strictObject({ id: DelegationIdSchema }), output: HubHalfResultSchema, owner: 'main' }, // M4c: Retry, or a stray key's Revoke
  'org.provisioningSecret.get': { input: z.void(), output: ProvisioningSecretReadingSchema, owner: 'main' }, // M4c: the destination
  'org.provisioningSecret.set': { input: z.strictObject({ value: ProvisioningSecretSchema.nullable() }), output: ProvisioningSecretWriteSchema, owner: 'main' }, // M4c
  'org.provisioningSecret.reset': { input: ConfirmedInputSchema, output: ProvisioningSecretWriteSchema, owner: 'main' }, // M4c: removes the file, confirmed
  'org.grants.view': { input: z.strictObject({ ref: OrgMachineRefSchema }), output: GrantsViewSchema, owner: 'main' }, // M4b: read again at org.grants.changed
  // M4b: grant, change or withdraw (`rights: []`) a member's rights on a machine, behind one confirmation that shows the grant
  'org.grants.set': { input: z.strictObject({ ref: OrgMachineRefSchema, member: MemberIdSchema, rights: z.array(GrantRightSchema).max(GRANT_RIGHTS.length) }), output: GrantSetResultSchema, owner: 'main' },
  'org.grants.regrant': { input: z.strictObject({ ref: OrgMachineRefSchema, digest: z.string().min(1).max(128) }), output: GrantRegrantResultSchema, owner: 'main' }, // M4b: stale on another digest
  'org.channel.open': { input: z.strictObject({ project: ChannelProjectSchema }), output: ChannelAnswerSchema, owner: 'main' }, // M7a: one per open tab
  'org.channel.close': { input: z.strictObject({ project: ChannelProjectSchema }), output: z.void(), owner: 'main' }, // M7a: released 30 s after the last
  'org.channel.send': { input: z.strictObject({ project: ChannelProjectSchema, text: z.string().max(CHANNEL_TEXT_MAX) }), output: ChannelSendResultSchema, owner: 'main' }, // M7a
  'org.policy.get': { input: OrgPolicyGetInputSchema, output: OrgPolicySchema, owner: 'main' }, // M6b
  'org.policy.set': { input: OrgPolicySetInputSchema, output: OrgPolicySetResultSchema, owner: 'main' }, // M6b: one Touch ID per save
  'org.owners.add': { input: OrgOwnersAddInputSchema, output: OrgPolicySetResultSchema, owner: 'main' }, // M5b's, built here
  'org.projects': { input: z.void(), output: OrgProjectsSchema, owner: 'main' }, // the project registry (§I)
  'org.removals.hold': { input: z.strictObject({ machine: MachineRefSchema, pid: z.string().min(1) }), output: z.void(), owner: 'main' }, // §I: a location on a machine that is off
  'org.removals.cancel': { input: z.strictObject({ id: z.string().min(1) }), output: z.void(), owner: 'main' }, // §I
  'org.projectActs': { input: z.void(), output: ProjectActAsksSchema, owner: 'main' }, // M12 (§K): the requests waiting for the person
  'org.projectActs.decide': { input: z.strictObject({ id: z.string().min(1), confirm: z.boolean() }), output: z.void(), owner: 'main' }, // M12: the sheet's Confirm or dismissal
} as const satisfies Record<`org.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'org.changed': OrgStatusSchema, // at every change of the status, the whole status
  'org.rows.changed': OrgRowsSchema, // M2: coalesced, the whole list
  'org.channel.changed': ChannelChangedSchema, // M7a: an open channel's change since the last, coalesced
  'org.policies.changed': OrgPolicySchema, // M6b: a machine's policies, at each whole read (at a sheet's save, and when asked)
  'org.grants.changed': z.strictObject({ ref: z.string() }), // M4b: a machine's grants moved (a delivery's outcome, a ledger read): read org.grants.view again
  'org.projects.changed': OrgProjectsSchema, // the project registry (§I): coalesced, the whole value
  'org.projectActs.changed': ProjectActAsksSchema, // M12 (§K): the whole list, at each request taken or decided
} as const satisfies Record<`org.${string}`, z.ZodType>;
