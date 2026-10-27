// The endpoint module (O10; Interfaces §F): the one object `mawsd` starts, asks for its status and hands its
// `mawsd endpoint` commands. M2 holds its state, its enrollment, its org state and its policy; M3–M8 add the hub link,
// the channels, authorization, RL10, actions and subscriptions beside them, each fed by the org state's adoptions.
import { importSigningKey, stateHash, type SigningKey } from 'org-protocol';
import { runCli } from './cli';
import { enrollDelegatedInto, promoteIfListed, syncAndPromote, type DelegatedInput, type EnrollContext, type EnrollmentState } from './enroll';
import { dropRevokedGrants } from './grants';
import type { HubDeps } from './hub-http';
import { EndpointOrg, type OrgChange } from './org-sync';
import { EndpointPolicy } from './policy';
import type { EndpointModule, EndpointServices } from './services';
import { EndpointState } from './state/store';
import { endpointStatus, NO_LINKS, type EndpointLinks, type EndpointStatus } from './status';

/** `now` is the module's clock; `fetch` and `sleep` are the suites' seams for faults and fast retries. */
export type EndpointOptions = { now?(): number; fetch?: typeof fetch; sleep?(ms: number): Promise<void> };

/** The org state is read again this often, besides at RL1's welcome and each `state` notice (M3). */
export const SYNC_EVERY_MS = 10 * 60_000;

export class Endpoint implements EndpointModule {
  readonly deps: HubDeps;
  readonly policy = new EndpointPolicy(() => this.#state);
  readonly links: EndpointLinks = structuredClone(NO_LINKS);
  #services: EndpointServices | null = null;
  #state: EndpointState | null = null;
  #org: EndpointOrg | null = null;
  #key: SigningKey | null = null;
  #headHash: string | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #syncing: Promise<unknown> | null = null;

  constructor(options: EndpointOptions = {}) {
    this.deps = {
      fetch: options.fetch ?? ((input, init) => fetch(input, init)),
      sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      now: options.now ?? Date.now,
    };
  }

  async start(services: EndpointServices): Promise<void> {
    this.#services = services;
    const log = (line: string) => services.log(line);
    const state = EndpointState.open(services.machine.stateDir, { log, now: this.deps.now });
    const org = new EndpointOrg(state, { log, now: this.deps.now });
    org.onAdopted((change) => this.#adopted(change));
    this.#state = state;
    this.#org = org;
    if (state.refusing !== null) return;
    if (state.machineKey !== null) {
      try {
        this.#key = await importSigningKey(state.machineKey.jwk);
      } catch (error) {
        log(`endpoint: refusing its state: the machine key in ${services.machine.stateDir} does not import (${(error as Error).message})`);
        this.links.refusing = 'state-malformed';
        return;
      }
    }
    if (org.ready) this.#headHash = await stateHash(org.head().state);
    if (state.enrolled) this.#keepSynced();
  }

  async stop(): Promise<void> {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  status(): EndpointStatus {
    return endpointStatus(this.#state, this.#headHash, this.links);
  }

  cli(command: string, args: readonly string[], secret?: string): Promise<{ code: number; out: string }> {
    return runCli(this, command, args, secret);
  }

  /** The started module's parts, for its commands; null before `start`. */
  get parts(): { services: EndpointServices; state: EndpointState; org: EndpointOrg } | null {
    if (this.#services === null || this.#state === null || this.#org === null) return null;
    return { services: this.#services, state: this.#state, org: this.#org };
  }

  get key(): SigningKey | null {
    return this.#key;
  }

  /** The context an enrollment runs in; after one, the module keeps the org state synced. */
  enrollContext(): EnrollContext {
    const parts = this.parts;
    if (parts === null) throw new Error('the endpoint has not started');
    return {
      state: parts.state,
      org: parts.org,
      ref: parts.services.machine.ref,
      deps: this.deps,
      log: (line) => parts.services.log(line),
      keyChanged: (key) => {
        this.#key = key;
        this.#keepSynced();
      },
    };
  }

  enrollDelegated(input: DelegatedInput): Promise<EnrollmentState> {
    return enrollDelegatedInto(this.enrollContext(), input);
  }

  /** Reads the hub's org state now (one at a time); a failure is logged and waits for the next. */
  syncNow(): Promise<unknown> {
    const parts = this.parts;
    if (parts === null || !parts.state.enrolled) return Promise.resolve();
    this.#syncing ??= syncAndPromote(this.enrollContext()).finally(() => (this.#syncing = null));
    return this.#syncing;
  }

  #keepSynced(): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => void this.syncNow(), SYNC_EVERY_MS);
    this.#timer.unref?.();
    void this.syncNow();
  }

  /** A new head is on disk: end what it took away. Channels, listings and RL10 (M3–M6) subscribe beside this. */
  #adopted(change: OrgChange): void {
    const parts = this.parts;
    if (parts === null) return;
    const log = (line: string) => parts.services.log(line);
    void stateHash(change.head.state).then((hash) => (this.#headHash = hash));
    const { members, devices, keys } = change.removed;
    if (members.length + devices.length + keys.length > 0) {
      log(`endpoint: org state ${change.head.state.version}${change.rewound ? ' (a recovery rewind)' : ''} removed ${members.length} member(s), ${devices.length} device(s), revoked ${keys.length} key(s)`);
    }
    const ended = dropRevokedGrants(parts.state, change.head.state);
    if (ended.length > 0) log(`endpoint: ${ended.length} grant(s) ended with their signer's revoked key`);
    void promoteIfListed({ state: parts.state, org: parts.org, deps: this.deps, log });
  }
}
