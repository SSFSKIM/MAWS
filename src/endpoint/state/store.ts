// The endpoint's state directory, `<profile>/mawsd/endpoint/` (Interfaces §E): one owner, this module, which loads it
// whole at start and writes each file through `writeAtomic`. At start it refuses (`refusing`, said by `status()`;
// nothing remote is served) a directory or file that is a symlink, owned by another uid or more open than 0700 / 0600, or
// a file that doesn't hold its shape. The machine key and the grant ledger are present together or not at all (the remote
// layer's Decision Log 24): either alone means unenrolled, and it is moved aside to `stale-<time>/` with the enrollment
// record whose key it was, which `stale` reports once.
import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import {
  isCertificates,
  isGrant,
  isListing,
  isMachineCert,
  isRootTransition,
  isSigned,
  isSignedOrgState,
  type Certificates,
  type Grant,
  type Listing,
  type MachineCert,
  type RootTransition,
  type Signed,
  type SignedOrgState,
} from 'org-protocol';
import * as z from 'zod';
import { assertPrivateDirectory, PrivatePathError } from '@shared/host/private-path';
import { checkPrivateFile, removeFile, StateFileError, sweepTemporaries, syncDirectory, writeAtomic } from './files';

export const PERMISSION_MODES = ['plan', 'default', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
/** A spawn's permission-mode ceiling, or `settings`: the machine's own `defaultMode` (sminos's policy, which this mirrors). */
export type Ceiling = PermissionMode | 'settings';

const custom = <T>(check: (value: unknown) => boolean) => z.custom<T>((value) => check(value));
const Iso = z.string().min(1);

const MachineKeySchema = z.strictObject({ version: z.literal(1), keyId: z.string().min(1), jwk: custom<JsonWebKey>((v) => typeof v === 'object' && v !== null), created: Iso });
const LedgerSchema = z.strictObject({
  version: z.literal(1),
  heldKeys: z.array(z.string().min(1)),
  grants: z.record(z.string(), custom<Signed<Grant>>((v) => isSigned(v, isGrant))),
  /** The highest grant version kept per member, whether or not that grant is still in force (grants.ts). */
  highWater: z.record(z.string(), z.number().int().nonnegative()),
});
const EnrollmentSchema = z.strictObject({
  version: z.literal(1),
  state: z.enum(['hub-confirmed', 'org-listed']),
  name: z.string().min(1),
  ref: z.string().min(1),
  org: z.string().min(1),
  hub: z.string().min(1),
  enrollment: z.string().min(1),
  credentials: z.strictObject({ clientId: z.string().min(1), clientSecret: z.string().min(1) }),
  at: Iso,
  /** A delegated machine's certificate (enrollDelegated): it is listed once `verifyMachineCert` accepts it. */
  cert: custom<Signed<MachineCert>>((v) => isSigned(v, isMachineCert)).optional(),
});
const ChainEntrySchema = z.union([
  z.strictObject({ state: custom<SignedOrgState>(isSignedOrgState) }),
  z.strictObject({ transition: custom<Signed<RootTransition>>((v) => isSigned(v, isRootTransition)) }),
]);
const OrgSchema = z.strictObject({
  version: z.literal(1),
  org: z.string().min(1),
  pinned: z.strictObject({ roots: z.array(z.string().min(1)).min(1), recoveryPub: z.string().min(1) }),
  /** Null until the first sync. */
  head: custom<SignedOrgState>(isSignedOrgState).nullable(),
  /**
   * The chain window ending at the head, in chain order (org-sync.ts). It lives in the head's own file so the two are
   * one commit: a rewind replaces states below the head, which a window written apart could show without the head.
   */
  chain: z.array(ChainEntrySchema),
  /**
   * The hash of every state adopted since the first sync, by version (`hashes[v - 1]`), kept past the window: what a
   * rewind's base must hash to once its state has aged out of `chain` (org-sync.ts).
   */
  hashes: z.array(z.string().min(1)),
  certificates: custom<Certificates>(isCertificates),
  acceptedTransitions: z.array(custom<RootTransition>(isRootTransition)),
  highWater: z.number().int().nonnegative(),
});
const PolicySchema = z.strictObject({ read_only: z.boolean(), ceiling: z.enum([...PERMISSION_MODES, 'settings']) });
/**
 * Each listed session's last listing (listings.ts): its revision, when it was issued, the hash of its fields, and the
 * signed record itself, which each welcome sends again byte for byte (the hub takes a resend of what it holds, and
 * refuses a new signature at a revision it holds).
 */
const ListingsSchema = z.record(
  z.string().min(1),
  z.strictObject({ revision: z.number().int().positive(), issued: Iso, hash: z.string().min(1), record: custom<Signed<Listing>>((v) => isSigned(v, isListing)) }),
);

/**
 * The sessions whose pending count the hub was last told above 0 (notify.ts), with their project: after a restart, a
 * pending set that leaves one out is told `settled 0`, which the hub would otherwise never hear. `owed`: the session was
 * withdrawn while no connection was up, and its `settled 0` goes at the next welcome.
 */
const NotifiedSchema = z.record(
  z.string().min(1),
  z.strictObject({ project: z.string().min(1), pending: z.number().int().positive(), owed: z.literal(true).optional() }),
);

/** A web-cards passkey's last signature counter, by credential id (M5): an assertion's must rise where it keeps one. */
const WebAuthnSchema = z.record(z.string().min(1), z.number().int().nonnegative());

/**
 * The DX1 org key sminos handed over on RL10 (M6), for outbound dual-coding and legacy events; or, once the org state
 * retires it (O14 M5a), its tombstone: `retired` the head's mark's time, `key` the bytes kept until `legacy purge`, so a
 * head that drops the mark makes them the key again (rl10/legacy.ts).
 */
const LegacyKeyText = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const LegacySchema = z.union([
  z.strictObject({ org: z.string().min(1), key: LegacyKeyText }),
  z.strictObject({ org: z.string().min(1), retired: Iso, key: LegacyKeyText.optional() }),
]);

/**
 * The host events (sminos's to-human store) taken from RL10 (M6), as each writer's highest `seq` per project: sminos
 * sends each writer's in `seq` order, and every welcome again the last 50, so one at or below the mark was taken before
 * and raises no second `wrote`, a restart of the endpoint's included.
 */
const HostsSchema = z.record(z.string().min(1), z.record(z.string().min(1), z.number().int().nonnegative()));

export type MachineKeyFile = z.infer<typeof MachineKeySchema>;
export type LedgerFile = z.infer<typeof LedgerSchema>;
export type EnrollmentFile = z.infer<typeof EnrollmentSchema>;
export type OrgFile = z.infer<typeof OrgSchema>;
export type PolicyFile = z.infer<typeof PolicySchema>;
export type ListingsFile = z.infer<typeof ListingsSchema>;
export type NotifiedFile = z.infer<typeof NotifiedSchema>;
export type WebAuthnFile = z.infer<typeof WebAuthnSchema>;
export type LegacyFile = z.infer<typeof LegacySchema>;
export type HostsFile = z.infer<typeof HostsSchema>;
export type ChainEntry = z.infer<typeof ChainEntrySchema>;

const FILES = {
  machineKey: 'machine-key.json',
  ledger: 'grants.json',
  enrollment: 'enrollment.json',
  org: 'org.json',
  policy: 'policy.json',
  legacy: 'legacy.json',
  listings: 'listings.json',
  notified: 'notified.json',
  webauthn: 'webauthn.json',
  hosts: 'hosts.json',
} as const;

type Options = { uid?: number; now?: () => number; log?: (line: string) => void };

export class EndpointState {
  /** Why the state is refused (`state-<reason>`), or null. No path: the log line names it. */
  readonly refusing: string | null;
  /** The key or the ledger was found alone at this start and moved aside. */
  readonly stale: boolean;
  #machineKey: MachineKeyFile | null = null;
  #ledger: LedgerFile | null = null;
  #enrollment: EnrollmentFile | null = null;
  #org: OrgFile | null = null;
  #policy: PolicyFile | null = null;
  #listings: ListingsFile = {};
  #notified: NotifiedFile = {};
  #webauthn: WebAuthnFile = {};
  #legacy: LegacyFile | null = null;
  #hosts: HostsFile = {};

  private constructor(
    readonly dir: string,
    refusing: string | null,
    stale: boolean,
  ) {
    this.refusing = refusing;
    this.stale = stale;
  }

  static open(dir: string, options: Options = {}): EndpointState {
    const log = options.log ?? (() => {});
    const refuse = (reason: string, message: string) => {
      log(`endpoint: refusing its state: ${message}`);
      return new EndpointState(dir, `state-${reason.replace(/_/g, '-')}`, false);
    };
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      assertPrivateDirectory(dir, { uid: options.uid });
      sweepTemporaries(dir);
      const read = <T>(name: string, schema: z.ZodType<T>): T | null => {
        if (!checkPrivateFile(join(dir, name), options.uid)) return null;
        const parsed = schema.safeParse(parseJson(fs.readFileSync(join(dir, name), 'utf8')));
        if (!parsed.success) throw new StateFileError(join(dir, name), 'malformed', 'does not hold its shape');
        return parsed.data;
      };
      const machineKey = read(FILES.machineKey, MachineKeySchema);
      const ledger = read(FILES.ledger, LedgerSchema);
      const enrollment = read(FILES.enrollment, EnrollmentSchema);
      const org = read(FILES.org, OrgSchema);
      const policy = read(FILES.policy, PolicySchema);
      const listings = read(FILES.listings, ListingsSchema);
      const notified = read(FILES.notified, NotifiedSchema);
      const webauthn = read(FILES.webauthn, WebAuthnSchema);
      const legacy = read(FILES.legacy, LegacySchema);
      const hosts = read(FILES.hosts, HostsSchema);

      const alone = (machineKey === null) !== (ledger === null);
      const state = new EndpointState(dir, null, alone);
      if (alone) {
        const aside = join(dir, `stale-${new Date(options.now?.() ?? Date.now()).toISOString().replace(/:/g, '-')}`);
        fs.mkdirSync(aside, { mode: 0o700 });
        for (const name of [FILES.machineKey, FILES.ledger, FILES.enrollment]) {
          if (fs.existsSync(join(dir, name))) fs.renameSync(join(dir, name), join(aside, name));
        }
        syncDirectory(dir);
        log(`endpoint: the machine key and the grant ledger were not found together; moved aside to ${aside}, unenrolled`);
      } else {
        state.#machineKey = machineKey;
        state.#ledger = ledger;
        state.#enrollment = enrollment;
      }
      state.#org = org;
      state.#policy = policy;
      state.#listings = listings ?? {};
      state.#notified = notified ?? {};
      state.#webauthn = webauthn ?? {};
      state.#legacy = legacy;
      state.#hosts = hosts ?? {};
      return state;
    } catch (error) {
      if (error instanceof PrivatePathError || error instanceof StateFileError) return refuse(error.reason, error.message);
      throw error;
    }
  }

  /** The key, the ledger and the enrollment record are all held. */
  get enrolled(): boolean {
    return this.#machineKey !== null && this.#ledger !== null && this.#enrollment !== null;
  }
  get machineKey(): MachineKeyFile | null {
    return this.#machineKey;
  }
  get ledger(): LedgerFile | null {
    return this.#ledger;
  }
  get enrollment(): EnrollmentFile | null {
    return this.#enrollment;
  }
  get org(): OrgFile | null {
    return this.#org;
  }
  get policy(): PolicyFile | null {
    return this.#policy;
  }
  /** Whether the DX1 org key is held in use (a tombstone's kept bytes are not). */
  get legacy(): boolean {
    return this.#legacy !== null && !('retired' in this.#legacy);
  }
  /** Whether `legacy.json` is the tombstone of a key the org state retired (O14 M5a). */
  get legacyRetired(): boolean {
    return this.#legacy !== null && 'retired' in this.#legacy;
  }
  /** The DX1 org key in use and its org, or null: none held, or its tombstone (never logged, never sent on). */
  get legacyKey(): { org: string; key: string } | null {
    return this.#legacy === null || 'retired' in this.#legacy ? null : this.#legacy;
  }
  /** `legacy.json` as held: the key and its org, its tombstone, or null (never logged, never sent on). */
  get legacyFile(): LegacyFile | null {
    return this.#legacy;
  }
  /** Each project's host writers' highest taken `seq`; empty when none was taken. */
  get hosts(): HostsFile {
    return this.#hosts;
  }
  /** Each listed session's last listing; empty when none was made. */
  get listings(): ListingsFile {
    return this.#listings;
  }
  /** The sessions whose pending count the hub was last told above 0; empty when none. */
  get notified(): NotifiedFile {
    return this.#notified;
  }
  /** Each web-cards credential's last signature counter; empty when none was seen. */
  get webauthn(): WebAuthnFile {
    return this.#webauthn;
  }

  setMachineKey(value: MachineKeyFile): void {
    this.#write(FILES.machineKey, MachineKeySchema.parse(value));
    this.#machineKey = value;
  }
  setLedger(value: LedgerFile): void {
    this.#write(FILES.ledger, LedgerSchema.parse(value));
    this.#ledger = value;
  }
  setEnrollment(value: EnrollmentFile): void {
    this.#write(FILES.enrollment, EnrollmentSchema.parse(value));
    this.#enrollment = value;
  }
  setOrg(value: OrgFile): void {
    this.#write(FILES.org, OrgSchema.parse(value));
    this.#org = value;
  }
  setPolicy(value: PolicyFile): void {
    this.#write(FILES.policy, PolicySchema.parse(value));
    this.#policy = value;
  }
  setListings(value: ListingsFile): void {
    this.#write(FILES.listings, ListingsSchema.parse(value));
    this.#listings = value;
  }
  setNotified(value: NotifiedFile): void {
    this.#write(FILES.notified, NotifiedSchema.parse(value));
    this.#notified = value;
  }
  setWebAuthn(value: WebAuthnFile): void {
    this.#write(FILES.webauthn, WebAuthnSchema.parse(value));
    this.#webauthn = value;
  }
  setLegacy(value: LegacyFile): void {
    this.#write(FILES.legacy, LegacySchema.parse(value));
    this.#legacy = value;
  }
  setHosts(value: HostsFile): void {
    this.#write(FILES.hosts, HostsSchema.parse(value));
    this.#hosts = value;
  }
  /** Deletes `legacy.json` (a key of another org than the enrollment's; a tombstone without bytes the head no longer marks). */
  removeLegacy(): void {
    this.#refuseWrites();
    removeFile(this.dir, FILES.legacy);
    this.#legacy = null;
  }

  /** The `legacy.json` copies an earlier enrollment left under `stale-<time>/`, by their name under the state directory. */
  staleLegacyCopies(): string[] {
    const copies: string[] = [];
    for (const entry of fs.readdirSync(this.dir, { withFileTypes: true })) {
      // A symlink is no directory of this module's: passed over, never followed.
      if (!entry.isDirectory() || !entry.name.startsWith('stale-')) continue;
      const name = join(entry.name, FILES.legacy);
      if (fs.lstatSync(join(this.dir, name), { throwIfNoEntry: false })?.isFile()) copies.push(name);
    }
    return copies.sort();
  }

  /**
   * Deletes the key's bytes (`mawsd endpoint legacy purge`, O14's final brief; irreversible): from the tombstone, which
   * stays as the mark, and every stale copy, which goes whole. Answers what it deleted, by name under the directory.
   */
  purgeLegacy(): string[] {
    this.#refuseWrites();
    const deleted: string[] = [];
    const held = this.#legacy;
    if (held !== null && 'retired' in held && held.key !== undefined) {
      this.setLegacy({ org: held.org, retired: held.retired });
      deleted.push(FILES.legacy);
    }
    for (const name of this.staleLegacyCopies()) {
      fs.unlinkSync(join(this.dir, name));
      syncDirectory(join(this.dir, dirname(name)));
      deleted.push(name);
    }
    return deleted;
  }

  /**
   * A private subdirectory of the state directory (`signatures/`, `inbound/`), made 0700 when absent; refused (thrown)
   * when it is a symlink, another uid's or more open, as the directory itself is.
   */
  subdirectory(name: string): string {
    this.#refuseWrites();
    const path = join(this.dir, name);
    if (!fs.existsSync(path)) {
      fs.mkdirSync(path, { mode: 0o700 });
      syncDirectory(this.dir);
    }
    assertPrivateDirectory(path);
    return path;
  }

  #write(name: string, value: unknown): void {
    this.#writeText(name, `${JSON.stringify(value, null, 2)}\n`);
  }
  #writeText(name: string, text: string): void {
    this.#refuseWrites();
    writeAtomic(this.dir, name, text);
  }
  #refuseWrites(): void {
    if (this.refusing !== null) throw new Error(`the endpoint's state is refused (${this.refusing}): nothing is written`);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
