// The window report per RL2 machine (P5 O7 M5c, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "O4's
// surfaces: leases, the window, delivery on the machine"): the connectors' window veto for a remote dashboard. Over RL2
// every page of this device is one lease owner on the machine (the channel's one `ClientRef`), so one report stands for
// the device there: `client.windowShown {shown}`, the endpoint's own call, `shown` being whether any followed page holding
// a lease on that machine is shown. The local path's report per page (../connectors/windows.ts, the router's seam) runs on
// this Mac's machine alone.
//
// - A page is followed on a machine from its first lease command there, while it holds a lease on it or opens one (an
//   open in flight counts, so a page's first open runs under a report that counts it), until it holds none, it ends, or
//   the machine's channel changed (`relinked`: the channel's end ended its ref, and with it every lease there). Its
//   window is read when followed, on its show, hide, minimize and restore, and every WINDOW_RECHECK_MS.
// - A report is made before each lease command whose machine doesn't hold the latest (`before`), and at every change.
//   The machine holds a report per channel: one taken on the current channel, or, on a channel no report was sent on,
//   hidden (the broker's fail-closed default), so a machine no page follows is reported nothing. A report that failed on
//   a channel still current leaves what the machine holds unknown until one is taken; one that failed with its channel
//   is moot. Reports go one at a time per machine, on the channel current when each was made (`oneChannel`).
// - A lease command waits for its machine to hold the latest report, at most two reports' worth: then it is refused here
//   (`false`), never sent under an older one. An endpoint that offers no `client.windowShown` (`not-offered`) predates
//   leases over RL2, and its refusal of the lease command is the answer: the command goes.
// - A command's window bookkeeping is its channel's (a `WindowTicket`): a wait that saw its channel end answers false; a
//   lease is recorded only while the channel it was opened on is current, with that channel.
// - A page's end closes every lease it holds, on the channel that opened it (a lease of a channel that ended was closed by
//   the machine with its ref); an open answered after its page ended is closed at once.
import type { ClientRef } from '@shared/ipc/client';
import type { MachineRef } from '@shared/machine/ref';
import type { ClientWindowShown } from '../client/window-shown';
import { WINDOW_RECHECK_MS } from '../connectors/windows';
import type { RemoteLink } from '../machines/remote/link';

export type WindowReport = 'taken' | 'not-offered' | 'failed';

export interface RemoteWindowsDeps {
  /** The window that shows a page (electronWindowShown), or null when none does. */
  windowShown(client: ClientRef): ClientWindowShown | null;
  /** `client.windowShown {shown}` on the link's current channel. */
  report(link: RemoteLink, shown: boolean): Promise<WindowReport>;
  /** `connectors.close {leaseId}` on the link's current channel, answered to no one. */
  close(link: RemoteLink, leaseId: string): void;
  recheckMs?: number;
  log(line: string): void;
}

export interface RemoteWindows {
  /**
   * Before a lease command of `client` on `link`'s machine, made on channel `on`: whether the machine holds the latest
   * report there (false once `on` ended), and the command's ticket for `after`.
   */
  before(link: RemoteLink, client: ClientRef, name: string, on: readonly string[]): Promise<{ ok: boolean; ticket: WindowTicket }>;
  /** After it, on every path: a lease opened (`leaseId`, from the open's answer) or closed (the close's input). */
  after(ticket: WindowTicket, name: string, leaseId: string | null): void;
  /** The machine's channel changed: its pages hold no lease there. Resolves once the new channel holds the latest report, or can't. */
  relinked(link: RemoteLink): Promise<boolean>;
  /** The machine left the roster. */
  forget(machine: MachineRef): void;
  /** What a machine holds (tests): the pages followed there, and the report the current channel took. */
  followed(machine: MachineRef): { pages: string[]; held: boolean | null };
  stop(): void;
}

/** A page's leases there, each with the channel (its peer list) that opened it; `ended` once the page did. */
type Page = { client: ClientRef; window: ClientWindowShown | null; leases: Map<string, readonly string[]>; opening: number; ended: boolean; unfollow(): void };
/** A lease command's own: its machine, its page (null: gone before it was followed) and the channel it was made on. */
export type WindowTicket = { readonly m: unknown; readonly page: unknown; readonly on: readonly string[] };
type Ticket = { m: Machine; page: Page | null; on: readonly string[] };
type Machine = {
  link: RemoteLink;
  pages: Map<string, Page>;
  /** The last report taken, and the channel (its peer list) it was taken on. */
  taken: { shown: boolean; on: readonly string[] } | null;
  /** A report failed on this channel while it stayed current: what the machine holds is unknown until one is taken. */
  unsure: readonly string[] | null;
  /** The channel whose endpoint offers no report. */
  unoffered: readonly string[] | null;
  /** The report out, if any: they go one at a time. */
  out: Promise<void> | null;
};

export function createRemoteWindows(deps: RemoteWindowsDeps): RemoteWindows {
  const recheckMs = deps.recheckMs ?? WINDOW_RECHECK_MS;
  const machines = new Map<MachineRef, Machine>();
  let stopped = false;

  function machineOf(link: RemoteLink): Machine {
    const held = machines.get(link.machine);
    if (held !== undefined && held.link === link) return held;
    if (held !== undefined) clear(held);
    const machine: Machine = { link, pages: new Map(), taken: null, unsure: null, unoffered: null, out: null };
    machines.set(link.machine, machine);
    return machine;
  }

  const live = (m: Machine) => !stopped && machines.get(m.link.machine) === m;
  /** Whether any followed page holding a lease there is shown. */
  const wanted = (m: Machine) => [...m.pages.values()].some((page) => (page.leases.size > 0 || page.opening > 0) && page.window !== null && page.window.shown());
  /** What the machine holds for its current channel: its report taken there, else hidden; null while unknown. */
  const held = (m: Machine, on: readonly string[]): boolean | null => (m.unsure === on ? null : m.taken?.on === on ? m.taken.shown : false);
  /** The machine holds the latest report on its current channel (or offers none there). */
  const current = (m: Machine): boolean => {
    const on = m.link.peerCapabilities();
    return on !== null && m.out === null && (m.unoffered === on || held(m, on) === wanted(m));
  };

  function send(m: Machine): void {
    const on = m.link.peerCapabilities();
    if (on === null || m.out !== null) return;
    const shown = wanted(m);
    m.out = deps.report(m.link, shown).then(
      (answer) => {
        m.out = null;
        if (answer === 'taken') {
          m.taken = { shown, on };
          if (m.unsure === on) m.unsure = null;
        } else if (answer === 'not-offered') m.unoffered = on;
        else if (m.link.peerCapabilities() === on) m.unsure = on;
        if (answer !== 'failed') changed(m); // a change while it was out; a failure is made again by the next wait or re-read
      },
      () => {
        m.out = null;
      },
    );
  }

  /** A change of what the machine should hold: reported now, or once the report out has answered. */
  function changed(m: Machine): void {
    if (live(m) && !current(m)) send(m);
  }

  /** Until the machine holds the latest report on its current channel, at most two reports' worth; false once `on` ended. */
  async function reported(m: Machine, on?: readonly string[]): Promise<boolean> {
    let sent = 0;
    const moved = () => on !== undefined && m.link.peerCapabilities() !== on;
    while (live(m) && !current(m)) {
      if (m.link.peerCapabilities() === null || moved()) return false;
      if (m.out === null) {
        if (sent >= 2) break;
        sent += 1;
        send(m);
      }
      await m.out;
    }
    if (moved()) return false;
    if (current(m)) return true;
    if (live(m)) deps.log(`lane B: ${m.link.name} has not taken this device’s window report; its lease commands are refused until it does`);
    return false;
  }

  function follow(m: Machine, client: ClientRef): Page | null {
    const known = m.pages.get(client.id);
    if (known !== undefined) return known;
    let page: Page | null = null;
    let gone = false;
    const offGone = client.onGone(() => {
      gone = true;
      if (page === null || m.pages.get(client.id) !== page) return;
      page.ended = true;
      const on = m.link.peerCapabilities();
      for (const [leaseId, openedOn] of page.leases) if (openedOn === on) deps.close(m.link, leaseId);
      page.leases.clear();
      unfollow(m, page);
      changed(m);
    });
    if (gone) return null; // already gone: nothing to follow
    const window = deps.windowShown(client);
    if (window === null) deps.log(`lane B: no window shows client ${client.id}; its dashboards on ${m.link.name} stay paused`);
    const offChange = window?.onChange(() => changed(m));
    const recheck = window === null ? undefined : setInterval(() => (window.closed() ? clearInterval(recheck) : changed(m)), recheckMs);
    const own: Page = {
      client,
      window,
      leases: new Map(),
      opening: 0,
      ended: false,
      unfollow: () => {
        clearInterval(recheck);
        offChange?.();
        offGone();
      },
    };
    page = own;
    m.pages.set(client.id, own);
    return own;
  }

  function unfollow(m: Machine, page: Page): void {
    if (m.pages.get(page.client.id) === page) m.pages.delete(page.client.id);
    page.unfollow();
  }

  function clear(m: Machine): void {
    for (const page of [...m.pages.values()]) unfollow(m, page);
  }

  return {
    async before(link, client, name, on) {
      const m = machineOf(link);
      const page = stopped ? null : follow(m, client);
      if (page !== null && name === 'connectors.open') page.opening += 1;
      const ticket: Ticket = { m, page, on };
      return { ok: !stopped && (await reported(m, on)), ticket };
    },
    after(given, name, leaseId) {
      const { m, page, on } = given as Ticket;
      const here = m.link.peerCapabilities() === on; // the command's channel is still current
      if (page === null || page.ended) {
        // the page ended before its open answered: the lease it was given is closed at once, on its own channel
        if (name === 'connectors.open' && leaseId !== null && here && !stopped) deps.close(m.link, leaseId);
        return;
      }
      if (name === 'connectors.open') {
        page.opening = Math.max(0, page.opening - 1);
        if (leaseId !== null && here && m.pages.get(page.client.id) === page) page.leases.set(leaseId, on);
      } else if (name === 'connectors.close' && leaseId !== null) page.leases.delete(leaseId);
      if (m.pages.get(page.client.id) !== page) return; // let go meanwhile (a relink)
      if (page.leases.size === 0 && page.opening === 0) unfollow(m, page);
      changed(m);
    },
    relinked(link) {
      const m = machineOf(link);
      clear(m);
      return reported(m);
    },
    forget(machine) {
      const m = machines.get(machine);
      if (m === undefined) return;
      clear(m);
      machines.delete(machine);
    },
    followed(machine) {
      const m = machines.get(machine);
      const on = m?.link.peerCapabilities() ?? null;
      return { pages: [...(m?.pages.keys() ?? [])], held: m === undefined || on === null ? null : held(m, on) };
    },
    stop() {
      stopped = true;
      for (const m of machines.values()) clear(m);
      machines.clear();
    },
  };
}
