// Who asked (P5 O1 M2). A handler learns its asker through a `ClientRef`: a small value that names the asking client and
// says when it is gone. In main the client is an app page instance (`src/main/ipc/clients.ts`); in a daemon it will be a
// connection's page. Per-client state is keyed by `id` and released on `onGone`. Zod-free and Electron-free, so the same
// handler code runs in either root.
import type { MemberId } from 'org-protocol';

export type ClientId = string & { readonly __brand: 'ClientId' };

export interface ClientRef {
  readonly id: ClientId;
  // Runs `listener` once when the client ends, or at once if it already has; returns the unsubscribe.
  onGone(listener: () => void): () => void;
}

export interface HandlerContext {
  readonly client: ClientRef;
  // P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §O): the claim a remote act runs under,
  // set by `machine.op` for the run it claimed (the member and device the endpoint verified, the action's fingerprint, and
  // the sealed action when the endpoint sent it); absent for a local client's own command.
  readonly op?: HandlerOp;
  // 2026-11-06 (the home-root rule): the request came from another machine, through the endpoint (set by `mawsd`'s
  // services front for the endpoint's dispatch alone, never from a request's args); a service narrows what it reaches for
  // it (src/shared/machine/machine-home.ts). Absent for this machine's own clients.
  readonly remote?: true;
  // P5 O8 M6a (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §P): whose reader state (pinned, last
  // seen, unread) and draft the request reads and writes, named by the endpoint for its dispatch and written here by
  // `mawsd`'s services front alone, never from a request's args, so a caller can't name another member's rows. Absent
  // (this machine's own clients) is 'owner'.
  readonly reader?: Reader;
}

// 'owner': the machine's owners', the session row's own state (local access, and a remote member who owns the machine,
// so one person's devices share their reading); a member id: that member's own rows (P5 Decision Log 36).
export type Reader = 'owner' | MemberId;

export interface HandlerOp {
  readonly opId: string;
  readonly opCreated: string;
  readonly member: string;
  readonly device: string;
  readonly fingerprint: string;
  readonly action?: unknown;
}

// A ClientRef its owner ends (P5 O1 M5): main's page instances (src/main/ipc/clients.ts) and a host's remote clients
// (src/shared/host/client-refs.ts) alike. `end` runs every listener once, each isolated from the others' failures; a
// listener added after the end runs at once.
export interface EndableClientRef extends ClientRef {
  end(): void;
}

export function endableClientRef(id: string): EndableClientRef {
  let listeners: Set<() => void> | null = new Set();
  return {
    id: id as ClientId,
    onGone(listener) {
      if (!listeners) {
        listener();
        return () => {};
      }
      const entry = () => listener(); // its own identity, so one function added twice unsubscribes each
      listeners.add(entry);
      return () => void listeners?.delete(entry);
    },
    end() {
      if (!listeners) return;
      const ending = [...listeners];
      listeners = null;
      for (const listener of ending) {
        try {
          listener();
        } catch (error) {
          console.error(`[client] a gone listener of ${id} failed`, error); // the others still release
        }
      }
    },
  };
}
