// The org session (P5 O7 M1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §B): what the app's
// RL2 links need of the person's org, read at every attempt. It carries this device's identity (its channel key from
// loadDeviceKeys), the held and verified org view, the step-up signer, and the hub's address with the headers an
// authenticated member's request carries. O8's sign-in (P5 Decision Log 38) implements it for production; until then
// production holds `signedOut()`, a development build may hold dev-session.ts's, and the suites hold `heldOrgSession`.
//
// Electron-free: it runs under vitest's node project, and step-up.ts is imported for its types only.
import type { DeviceIdentity, OrgView } from '../../../apps/org-protocol/src/index.ts';
import type { StepUpRequest, StepUpResult } from '../device/step-up';

export interface OrgSession {
  /** null: signed out, or this profile's device not listed in the held state. */
  current(): SignedIn | null;
  /**
   * Sign-in, sign-out, a new head adopted by any path (a link's handshake `advance` included), the hub's address or
   * credentials changed.
   */
  onChanged(listener: () => void): () => void;
}

export interface SignedIn {
  /** clientClass 'native-mac'; channelKey from loadDeviceKeys; build: main's build string; capabilities DEVICE_CAPABILITIES (P5 O7 M2). */
  identity: DeviceIdentity;
  /** Verified; its provider persists what `advance` adopts, and fires `onChanged` when it adopts a head. */
  view: OrgView;
  /** createStepUp over the same keys file's step-up key. */
  stepUp: { sign(request: StepUpRequest): Promise<StepUpResult> };
  /** null: no hub; the direct carrier only. */
  hub: HubAccess | null;
}

export interface HubAccess {
  /** https://… in production; http://127.0.0.1:<port> in tests and dev runs. */
  url: string;
  /** What an authenticated member's request to the hub carries (Access, or the local stand-in's). */
  headers(): Promise<Record<string, string>>;
}

/** Production's session until O8's sign-in: never signed in, so no link is made. */
export function signedOut(): OrgSession {
  return { current: () => null, onChanged: () => () => {} };
}

/** A session a caller holds and changes (the suites'): `set` replaces it, `changed` says the held view moved. */
export function heldOrgSession(initial: SignedIn | null = null): OrgSession & { set(next: SignedIn | null): void; changed(): void } {
  let held = initial;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    current: () => held,
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(next) {
      held = next;
      changed();
    },
    changed,
  };
}

/**
 * `view` with `onAdopted` told after each `advance` that moved its head: the hook by which a session's provider keeps its
 * promise that `onChanged` fires on every adopted head, a link's handshake included.
 */
export function watchedView(view: OrgView, onAdopted: () => void): OrgView {
  return {
    head: () => view.head(),
    certificates: () => view.certificates(),
    since: (version) => view.since(version),
    async advance(states, transitions) {
      const before = view.head();
      try {
        await view.advance(states, transitions);
      } finally {
        if (view.head() !== before) onAdopted();
      }
    },
  };
}
