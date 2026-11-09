// The delegations this Mac creates, renews and drops (P5 O8 M4c, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// M4c's "The create transaction", "Renew", "Drop"; the refresh's items 7, 8, 13 and 14; Interfaces §S), a part of the
// org session as the enrollment is (enroll.ts). A thin facade over the part's two state owners, whose endings differ:
//
// - delegation-create.ts owns a create's run and its custody (the minted token, the key pair, the code), which end with
//   the run: at a sign-out, the slot's Discard, `close`, or a run replacing it.
// - delegation-hub.ts owns the hub halves' queue, the hub's key list, its clock and the problems, which end with the
//   sign-in that asked for them.
//
// The facade joins them where they meet: a create's minted-key revoke goes through the hub's owner under the run's
// sign-in, a Revoke and the stray keys spare the key a create under way holds (`reservation`), and a Discard ends the
// run before its delegation's hub key is revoked.
//
// Electron-free: the session injects the signer, the hub, gcloud's custody and the destination's file.
import type { Certificates, OrgState, SignedOrgState } from '../../../apps/org-protocol/src/index.ts';
import type { DelegationCreateInput, DelegationResult, DelegationRewriteInput, HubHalfResult, OrgChange, OrgDelegationsStatus, SignResult } from '@shared/ipc/schema/org';
import { createDelegationCreate, reservedBy, type Reservation } from './delegation-create';
import { createDelegationHub } from './delegation-hub';
import type { EditSelf } from './edits';
import type { Pending, Unsent } from './files';
import type { ProvisioningKey, ProvisioningKeyRoutes } from './hub-client';
import type { ProvisioningSecretStore } from './provisioning-secret-store';
import type { SecretStore } from './secret-store';
import type { OrgSigner } from './signer';
import type { OrgTiming } from './timing';

/** The provisioning-key routes the delegations use, as the session's hub client reaches them now. */
export type DelegationsHub = Pick<ProvisioningKeyRoutes, 'mintProvisioningKey' | 'renewProvisioningKey' | 'revokeProvisioningKey' | 'provisioningKeys'>;

/** What the part reads of the session at each step: null once this Mac is not signed in to an org it holds. */
export type DelegationsContext = {
  /** The registration's hub origin, which the code names. */
  hub: string;
  self: EditSelf;
  head: SignedOrgState;
  certificates: Certificates;
  /** Null while no hub credential lives. */
  client: DelegationsHub | null;
  /** The sign-in this is (the session's `signIns`, which only a sign-out advances). */
  signIn: number;
};

export type DelegationsDeps = {
  context(): DelegationsContext | null;
  /** Why no change is signed now (not signed in, not a root, keys unmarked, signing.json damaged), or null. */
  standing(): SignResult | null;
  /** Another of the session's attempts runs (a sign-in, a re-anchor, a rekey, a sign-out). */
  busy(): boolean;
  signer(): Pick<OrgSigner, 'sign' | 'publishHeld' | 'pending'> | null;
  /** The pending slot's signed state (held unsent or not), whose delegations no Revoke may take: null with no slot. */
  slotState(): OrgState | null;
  /** `change` composed on a fresh draft of the head and checked as the signer will check it: its refusal, or null. */
  check(change: OrgChange): Promise<SignResult | null>;
  /** The held chain's state at `version` (a settled state's parent), or null. */
  stateAt(version: number): OrgState | null;
  /** Task 3's gcloud custody; null in a build that composes none (every create refuses `secret-store`). */
  secrets: SecretStore | null;
  /** The destination's file (`<profile>/provisioning-secret.json`). */
  destination: ProvisioningSecretStore | null;
  /** What the status or the view reads changed. */
  changed(): void;
  timing?: Partial<OrgTiming>;
  now?(): number;
  log(line: string): void;
};

/** The last hub half this sign-in ran for a delegation (or a stray key) that didn't finish. */
export type HubProblem = { reason: Exclude<Extract<HubHalfResult, { ok: false }>['reason'], 'none'>; detail: string };

/** What the view joins of the part (view.ts's `DelegationSources`). */
export type DelegationViewInputs = {
  keys: { list: readonly ProvisioningKey[]; at: string } | null;
  keysFailed: boolean;
  /**
   * This run's unsent delegation: `rewrite` while it holds the key pair and writes nothing, `writing` while it writes
   * the code (the branch fix wave, R5), why its code isn't stored, and the run.
   */
  unsent: { id: string; rewrite: boolean; writing: boolean; problem: string | null; generation: number } | null;
  hubProblems: ReadonlyMap<string, HubProblem>;
  /** The key a create under way holds before its slot names it: no stray, and no Revoke takes it. */
  reserved: Reservation | null;
};

export interface Delegations {
  /** The status's `delegations` part. */
  status(): OrgDelegationsStatus;
  create(input: DelegationCreateInput): Promise<DelegationResult>;
  /** "Write the code again": steps 4 to 6 for the run, delegation and slot named, while they are this run's. */
  rewrite(input: DelegationRewriteInput): Promise<DelegationResult>;
  /** Retry of renew's hub half: the route alone. */
  renewHub(id: string): Promise<HubHalfResult>;
  /** Retry of drop's hub half, or a stray key's Revoke: the route alone. */
  revokeHub(id: string): Promise<HubHalfResult>;
  /** The signer's settlement callback: a settled state's hub halves, against its parent. */
  settled(slot: Pending): void;
  /** A Discard's marker: an unsent delegation's hub key revoked (a failure leaves it a stray). */
  discarded(marker: Unsent | null): Promise<void>;
  /** The hub's key list read again (now, unless `ifStale`: only once the last ask is older than `KEYS_FRESH_MS`), under this sign-in. */
  readKeys(options?: { ifStale?: boolean }): Promise<void>;
  viewInputs(): DelegationViewInputs;
  /** Resolves once the hub halves queued so far have ended. */
  idle(): Promise<void>;
  /** The session's sign-out: the run ends and its custody is dropped; this sign-in's hub reads and problems go. */
  fence(): void;
  /** As `fence`, for good. */
  close(): Promise<void>;
}

export function createDelegations(deps: DelegationsDeps): Delegations {
  const now = deps.now ?? Date.now;
  const log = (line: string) => deps.log(`delegations: ${line}`);
  let rev = 0;
  const changed = () => {
    rev++;
    deps.changed();
  };
  const hub = createDelegationHub({
    context: deps.context,
    slotState: deps.slotState,
    stateAt: deps.stateAt,
    reserves: (id, key) => reservedBy(creates.reservation(), id, key),
    changed,
    timing: deps.timing,
    now,
    log,
  });
  const creates = createDelegationCreate({
    context: deps.context,
    standing: deps.standing,
    busy: deps.busy,
    signer: deps.signer,
    check: deps.check,
    secrets: deps.secrets,
    destination: deps.destination,
    hub,
    changed,
    rev: () => rev,
    now,
    log,
  });

  return {
    status: () => ({ creating: creates.creating(), rev }),
    create: creates.create,
    rewrite: creates.rewrite,
    renewHub: hub.renewHub,
    revokeHub: hub.revokeHub,
    settled: hub.settled,
    async discarded(marker) {
      if (marker === null || marker.kind !== 'delegation') return;
      creates.discarded(marker);
      await hub.revokeDiscarded(marker.id);
    },
    readKeys: hub.readKeys,
    viewInputs: () => ({ ...hub.viewInputs(), unsent: creates.unsent(), reserved: creates.reservation() }),
    idle: hub.idle,
    fence() {
      creates.fence();
      hub.fence();
    },
    close() {
      creates.close();
      hub.close();
      return Promise.resolve();
    },
  };
}
