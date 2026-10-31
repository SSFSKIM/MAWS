// The app's report of the window that shows each page, for the connectors' window veto (P3-H H4, P3 Decision Log 80 and
// 89; P5 O4 M2, docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §F, D8, D24, D28). The connectors run
// with the spine (`mawsd`'s on the daemon shape, main's embedded root's on the embedded one), where no Electron window
// can be read, so the app reads it and reports it as `connectors.windowShown {shown}` under the page's own client; the
// broker holds the latest report, and a page never reported is hidden (fail closed).
//
// - Through the router's seam before the owner switch (`beforeCommand`), on both shapes: a page's first lease command
//   follows its window and waits for the first report to land before it continues, so no lease command reaches the
//   broker ahead of the window it runs under.
// - The window is read, never an event's name trusted: when first followed, on its show, hide, minimize and restore, and
//   every WINDOW_RECHECK_MS while followed, shown or hidden (P3-H re-read only a hidden one; the machine can no longer
//   re-read before work starts, so a hide no event announced is reported within the re-read: D8's stated residual). On
//   macOS a window's show and hide events follow its occlusion, not the calls (Electron 44's ElectronNSWindowDelegate
//   windowDidChangeOcclusionState is their one source). Only a change is reported, each after the one before it.
// - A page is followed from its first lease command until it ends; a reloaded page is a new client, read afresh. No
//   window showing the page: it is reported hidden, and main says so.
// - A report the machine did not take (an unreachable host) is made again at the page's next lease command, which goes
//   on regardless, hidden there. `reportAgain` (at each streaming of the machine host after the first, D28: a restarted
//   `mawsd` holds no report) marks every followed page unreported, so the rebuilt lease's first command reports first.
import type { ClientRef } from '@shared/ipc/client';
import type { CommandName } from '@shared/ipc/schema';
import type { ClientWindowShown } from '../client/window-shown';
import type { BeforeHook } from '../ipc/router';

// A page's lease commands: each runs under the page's window, as the machine last heard of it.
export const LEASE_COMMANDS = [
  'connectors.open',
  'connectors.declare',
  'connectors.call',
  'connectors.watch',
  'connectors.unwatch',
  'connectors.refresh',
  'connectors.visibility',
  'connectors.close',
] as const satisfies readonly CommandName[];

// How often a followed window is re-read for a change no event announced (a read only; a report only on a change).
export const WINDOW_RECHECK_MS = 1_000;

export interface WindowReporterDeps {
  windowShown(client: ClientRef): ClientWindowShown | null; // the window that shows the page, or null when none does
  report(client: ClientRef, shown: boolean): Promise<boolean>; // `connectors.windowShown` under the page's client: whether the machine took it
  before(names: readonly CommandName[], hook: BeforeHook): () => void; // the router's seam (beforeCommand)
  log?: (line: string) => void;
}

export interface WindowReporter {
  reportAgain(): void; // the machine holds no report any more: each page reports before its next lease command
  stop(): void;
}

interface Followed {
  readonly client: ClientRef;
  readonly window: ClientWindowShown | null;
  sent: boolean | null; // the last state reported
  landed: number; // the connection (an `epoch`) that took the last report, or -1
  chain: Promise<void>; // the reports, in order
  pending: Promise<void> | null; // the report a lease command waits for
  unfollow(): void;
}

export function startWindowReporter({ windowShown, report, before, log = (line) => console.warn(`[connectors] ${line}`) }: WindowReporterDeps): WindowReporter {
  const followed = new Map<string, Followed>(); // by the page's client id
  let epoch = 0; // the machine host's connection, as far as reports go
  let stopped = false;

  const live = (entry: Followed) => !stopped && followed.get(entry.client.id) === entry;
  const read = (entry: Followed) => entry.window !== null && entry.window.shown();
  const send = (entry: Followed, shown: boolean): Promise<void> => {
    entry.sent = shown;
    const at = epoch;
    entry.chain = entry.chain.then(async () => {
      const took = await report(entry.client, shown).catch(() => false);
      entry.landed = took ? at : -1;
    });
    return entry.chain;
  };
  const changed = (entry: Followed) => {
    if (!live(entry)) return;
    const shown = read(entry);
    if (shown !== entry.sent) void send(entry, shown);
  };
  // Until the machine holds this connection's report of the window (a stale one in flight is waited for, then made
  // again once); then the command goes, taken or not.
  const reported = async (entry: Followed) => {
    for (let tries = 0; tries < 2 && entry.landed !== epoch && live(entry); tries += 1) {
      entry.pending ??= send(entry, read(entry)).finally(() => {
        entry.pending = null;
      });
      await entry.pending;
    }
    if (entry.landed !== epoch && live(entry)) log(`the window of client ${entry.client.id} was not taken by the machine; its pages read hidden there until reported`);
  };

  const follow = (client: ClientRef): Followed | null => {
    let entry: Followed | null = null;
    let ended = false;
    const offGone = client.onGone(() => {
      ended = true;
      if (entry === null || followed.get(client.id) !== entry) return;
      followed.delete(client.id);
      entry.unfollow();
    });
    if (ended) return null; // already gone: nothing to follow
    const window = windowShown(client);
    if (window === null) log(`no window shows client ${client.id}; its pages stay paused`);
    const own: Followed = {
      client,
      window,
      sent: null,
      landed: -1,
      chain: Promise.resolve(),
      pending: null,
      unfollow: () => {
        clearInterval(recheck);
        off?.();
        offGone();
      },
    };
    entry = own;
    const off = window?.onChange(() => changed(own));
    const recheck = window
      ? setInterval(() => {
          if (window.closed()) clearInterval(recheck);
          else changed(own);
        }, WINDOW_RECHECK_MS)
      : undefined;
    followed.set(client.id, own);
    return own;
  };

  const offBefore = before(LEASE_COMMANDS, async (_name, _input, client) => {
    if (stopped) return undefined;
    const entry = followed.get(client.id) ?? follow(client);
    if (entry) await reported(entry);
    return undefined;
  });

  return {
    reportAgain: () => {
      epoch += 1;
    },
    stop: () => {
      stopped = true;
      offBefore();
      for (const entry of followed.values()) entry.unfollow();
      followed.clear();
    },
  };
}
