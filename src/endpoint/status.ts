// `status()` (O10 M2): what `daemon.status` reports as `endpoint.detail`, to the local app whole and to a remote caller as
// it stands. So it holds no path, no address, no key material and no credential: the enrollment's name and org, the
// head's version and its public hash, and the module's links. Why the state is refused is a reason word; the log line
// names the path.
import type { EndpointState } from './state/store';

export type EndpointStatus = {
  enrollment: 'none' | 'hub-confirmed' | 'org-listed';
  name?: string;
  org?: string;
  stateVersion?: number;
  headHash?: string;
  hub: { connected: boolean; generation?: number };
  channels: { relayed: number; direct: number };
  rl10: { connected: boolean };
  listener: { bound: boolean };
  /** The DX1 org key is in use (dual-coding). */
  legacyKey: boolean;
  /** The org state retired it (O14 M5a): `legacy.json` is its tombstone. */
  legacyRetired: boolean;
  /** The machine holds a delegation (O14 M1): it provisioned itself under one, and `retire` is its departure. */
  delegated: boolean;
  refusing?: string;
  /** The operation ledgers closed (op-ledger.ts): why, as its word; each answers every remote action `unavailable` until
   * its process restarts (mawsd for the endpoint's, the engine host for its own). Absent while both answer. */
  opLedgers?: { endpoint?: ClosedLedger; engineHost?: ClosedLedger };
};

export type ClosedLedger = { closed: string; clears: 'restart' };

/** What the endpoint knows of the ledgers: its own's state, and the engine host's as its last ledger answer said. */
export type LedgerStates = { endpoint: string | null; engineHost: string | null };

/** The module's links, which M3 (the hub), M4 (channels and the listener) and M6 (RL10) keep current. */
export type EndpointLinks = Pick<EndpointStatus, 'hub' | 'channels' | 'rl10' | 'listener'> & { refusing?: string };

export const NO_LINKS: EndpointLinks = { hub: { connected: false }, channels: { relayed: 0, direct: 0 }, rl10: { connected: false }, listener: { bound: false } };

export function endpointStatus(state: EndpointState | null, headHash: string | null, links: EndpointLinks, ledgers: LedgerStates = { endpoint: null, engineHost: null }): EndpointStatus {
  const opLedgers: NonNullable<EndpointStatus['opLedgers']> = {};
  if (ledgers.endpoint !== null) opLedgers.endpoint = { closed: ledgers.endpoint, clears: 'restart' };
  if (ledgers.engineHost !== null) opLedgers.engineHost = { closed: ledgers.engineHost, clears: 'restart' };
  const enrollment = state?.enrolled ? state.enrollment : null;
  // A redemption whose set is not yet whole is the hub's already (O14 M1): a departure must see it to retire it.
  const pending = enrollment === null ? (state?.provisioning?.redeemed ?? null) : null;
  const head = enrollment !== null ? (state?.org?.head ?? null) : null;
  const refusing = state?.refusing ?? (state?.stale && !state.enrolled ? 'stale-state' : links.refusing);
  return {
    enrollment: enrollment?.state ?? (pending === null ? 'none' : 'hub-confirmed'),
    ...(enrollment !== null ? { name: enrollment.name, org: enrollment.org } : pending !== null ? { name: pending.machine, org: pending.org } : {}),
    ...(head === null ? {} : { stateVersion: head.state.version, ...(headHash === null ? {} : { headHash }) }),
    hub: { ...links.hub },
    channels: { ...links.channels },
    rl10: { ...links.rl10 },
    listener: { ...links.listener },
    legacyKey: state?.legacy ?? false,
    legacyRetired: state?.legacyRetired ?? false,
    delegated: (state?.delegation ?? null) !== null,
    ...(refusing === undefined ? {} : { refusing }),
    ...(Object.keys(opLedgers).length === 0 ? {} : { opLedgers }),
  };
}
