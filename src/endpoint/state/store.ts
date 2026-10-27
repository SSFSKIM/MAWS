// The endpoint's state directory, `<profile>/mawsd/endpoint/` (Interfaces §E): one owner, this module, which loads it
// whole at start and writes each file through `writeAtomic`. At start it refuses (`refusing`, said by `status()`;
// nothing remote is served) a directory or file that is a symlink, owned by another uid or more open than 0700 / 0600, or
// a file that doesn't hold its shape. The machine key and the grant ledger are present together or not at all (the remote
// layer's Decision Log 24): either alone means unenrolled, and it is moved aside to `stale-<time>/` with the enrollment
// record whose key it was, which `stale` reports once.
import * as fs from 'node:fs';
import { join } from 'node:path';
import {
  isCertificates,
  isGrant,
  isMachineCert,
  isRootTransition,
  isSigned,
  isSignedOrgState,
  type Certificates,
  type Grant,
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

export type MachineKeyFile = z.infer<typeof MachineKeySchema>;
export type LedgerFile = z.infer<typeof LedgerSchema>;
export type EnrollmentFile = z.infer<typeof EnrollmentSchema>;
export type OrgFile = z.infer<typeof OrgSchema>;
export type PolicyFile = z.infer<typeof PolicySchema>;
export type ChainEntry = z.infer<typeof ChainEntrySchema>;

const FILES = {
  machineKey: 'machine-key.json',
  ledger: 'grants.json',
  enrollment: 'enrollment.json',
  org: 'org.json',
  policy: 'policy.json',
  legacy: 'legacy.json',
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
  #legacy = false;

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
      const legacy = checkPrivateFile(join(dir, FILES.legacy), options.uid);

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
      state.#legacy = legacy;
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
  get legacy(): boolean {
    return this.#legacy;
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
  /** Deletes the DX1 org key (`mawsd endpoint legacy retire`, O14's final brief). */
  removeLegacy(): void {
    this.#refuseWrites();
    removeFile(this.dir, FILES.legacy);
    this.#legacy = false;
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
