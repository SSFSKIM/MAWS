// The remote view's bridge (P5 O17 M9b; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §K, "The app's
// bridge"; M9's Decisions): `browser.remote.*`, a window's own viewers of the agent's tabs on another machine's session,
// over that machine's RL2 link. Main-owned, graded `client`, never offered remotely; the router answers them here for any
// machine (router.ts), the session's machine as `ctx.target`.
//
// A view is one window's (its `ClientRef`): no other window can name it, and the window's end closes its feed and its
// streams together; an open answered after its window ended is disposed at once.
// - `open` subscribes to the session's `browser.inventory` feed and answers the view with its first inventory, or at once
//   with an unavailable one saying why the view is not possible (no link reaches the machine, its endpoint offers no
//   feed, no channel is current yet), or after OPEN_ANSWER_MS with what it has: the renderer reads its branch from this
//   answer, since it cannot read the link's capabilities. Each later inventory goes to the window
//   (`browser.remote.inventory`); the link's loss is told as an unavailable one, never a stale picture presented as live.
//   A feed that fell behind is opened again; a feed that ended ends the view (its last inventory unavailable, why).
// - `select` replaces the view's stream: one `browser.screencast` stream per view, for the tab and epoch the window chose,
//   read-only, or controlling while the view holds control (below). Its frames go to the window (`browser.remote.frame`);
//   the window's `ack` of the frame it drew or dropped is the producer's credit for the next (M9's Decisions: neither the
//   endpoint queuing a frame nor this bridge receiving it refunds it), taken only for the frame outstanding. Its end goes
//   to the window as `browser.remote.closed` with the endpoint's word (`tab-closed`, `engine-changed`, `control-revoked`,
//   `carrier`, …); the window selects again to go on. A stream the window replaced or closed tells nothing.
// - `takeControl` is the person's gesture: the `machine.browserControl` act for the session and the selected tab's epoch
//   (a non-owner's step-up is the link's, once per grant), then a controlling stream for the selected tab, opened beside
//   the read-only one, which it replaces once the endpoint admits it; refused, the read-only one goes on and the answer
//   says why. The grant serves the view's later selections in the same epoch; a new epoch, a revocation
//   (`control-revoked`) or `releaseControl` lets control go, and the next take asks a new act. A stream is fixed at its
//   open: control is never added to one in place, and input goes only on a controlling stream that was admitted.
import { ipcError } from '@shared/ipc/errors';
import type { ClientRef } from '@shared/ipc/client';
import type { CommandInput, CommandOutput, EventName, EventPayload } from '@shared/ipc/schema';
import { BrowserInventorySchema } from '@shared/ipc/schema/browser';
import type { BrowserInventory } from '@shared/browser/screencast';
import type { MachineRef } from '@shared/machine/ref';
import { CommandFailure } from '../ipc/router';
import { openBrowserStream, type RemoteBrowserStream } from '../machines/remote/browser-stream';
import type { ActOutcome, RemoteLink } from '../machines/remote/link';

/** The machine's link as the bridge uses it. */
export type RemoteViewLink = Pick<RemoteLink, 'name' | 'carrier' | 'subscribe' | 'openStream' | 'act'>;

export interface RemoteViewsDeps {
  local: MachineRef;
  /** The machine's RL2 link; null for a machine no link reaches. */
  remote(machine: MachineRef): RemoteViewLink | null;
  /** To that window alone (`emitTo(pageOf(client))`). */
  emit<N extends EventName>(client: ClientRef, name: N, payload: EventPayload<N>): void;
  timing?: Partial<RemoteViewsTiming>;
  log(line: string): void;
}

export interface RemoteViewsTiming {
  /** `open` answers by then with what it has (an unavailable inventory), the feed going on. */
  openAnswerMs: number;
  /** A control act unanswered by then (a person's step-up included) answers that control was not taken. */
  controlAnswerMs: number;
}
export const REMOTE_VIEWS_TIMING: RemoteViewsTiming = { openAnswerMs: 10_000, controlAnswerMs: 120_000 };

type Context = { client: ClientRef; target: MachineRef };
type Input<N extends 'browser.remote.open' | 'browser.remote.select' | 'browser.remote.takeControl' | 'browser.remote.releaseControl' | 'browser.remote.input' | 'browser.remote.ack' | 'browser.remote.close'> = CommandInput<N>;

export interface RemoteViews {
  open(input: Input<'browser.remote.open'>, ctx: Context): Promise<CommandOutput<'browser.remote.open'>>;
  select(input: Input<'browser.remote.select'>, ctx: Context): void;
  takeControl(input: Input<'browser.remote.takeControl'>, ctx: Context): Promise<CommandOutput<'browser.remote.takeControl'>>;
  releaseControl(input: Input<'browser.remote.releaseControl'>, ctx: Context): void;
  input(input: Input<'browser.remote.input'>, ctx: Context): void;
  ack(input: Input<'browser.remote.ack'>, ctx: Context): void;
  close(input: Input<'browser.remote.close'>, ctx: Context): void;
  stop(): void;
}

/** One stream of a view: what it views, and the frame the window has not yet acknowledged. */
interface Shown {
  stream: RemoteBrowserStream;
  tabId: string;
  epoch: string;
  control: boolean;
  admitted: boolean;
  lastSeq: number;
  outstanding: boolean;
  /** A controlling stream opening beside the shown one: told whether it was admitted. */
  taking: ((answer: CommandOutput<'browser.remote.takeControl'>) => void) | null;
}

interface View {
  id: string;
  client: ClientRef;
  machine: MachineRef;
  bare: string;
  link: RemoteViewLink | null;
  name: string;
  inventory: BrowserInventory;
  sub: { close(): void } | null;
  ended: boolean;
  selected: { tabId: string; epoch: string } | null;
  shown: Shown | null;
  pending: Shown | null;
  grant: { op: string; epoch: string } | null;
  wantsControl: boolean;
  answer: ((inventory: BrowserInventory) => void) | null; // open's, until it answered
  offGone: () => void;
}

const failure = (message: string) => new CommandFailure(ipcError('invalid_input', message));

export function createRemoteViews(deps: RemoteViewsDeps): RemoteViews {
  const timing = { ...REMOTE_VIEWS_TIMING, ...deps.timing };
  const views = new Map<string, View>();
  let minted = 0;

  const unavailable = (view: Pick<View, 'inventory'> | null, reason: string): BrowserInventory => ({ epoch: view?.inventory.epoch ?? '-', tabs: [], selected: null, state: 'unavailable', reason });
  const why = (name: string, word: string): string => {
    switch (word) {
      case 'not-offered':
        return `the MAWS on ${name} is too old to show the agent’s browser here`;
      case 'removed':
        return `you can no longer view this session on ${name}`;
      case 'class':
        return `this device cannot view the agent’s browser on ${name}`;
      case 'offline':
        return `the connection to ${name} was lost`;
      default:
        return `the agent’s browser on ${name} is unavailable (${word})`;
    }
  };

  const viewOf = (viewId: string, ctx: Context): View => {
    const view = views.get(viewId);
    if (!view || view.client !== ctx.client) throw failure(`no view ${viewId} of this window`);
    return view;
  };
  const live = (view: View) => views.get(view.id) === view;

  // The view's inventory: kept, to the window (or as open's answer while it waits)
  function told(view: View, inventory: BrowserInventory): void {
    if (inventory.state === 'ready' && view.grant !== null && inventory.epoch !== view.grant.epoch) letGoOfControl(view); // the grant died with its epoch
    view.inventory = inventory;
    if (view.answer) {
      const answer = view.answer;
      view.answer = null;
      return answer(inventory);
    }
    deps.emit(view.client, 'browser.remote.inventory', { viewId: view.id, inventory });
  }

  function letGoOfControl(view: View): void {
    view.grant = null;
    view.wantsControl = false;
  }

  // ---- the feed ------------------------------------------------------------------------------------------------------

  function subscribe(view: View, behind = 0): void {
    const link = view.link!;
    let snapshots = 0;
    view.sub = link.subscribe(
      { session: { lane: 'B', id: view.bare }, feed: 'browser.inventory' },
      {
        subbed() {},
        snapshot: (_at, value) => inventoryArrived(value),
        event: (_at, body) => inventoryArrived(body),
        paused: (reason) => live(view) && told(view, unavailable(view, why(view.name, reason))),
        resumed() {},
        ended(reason) {
          if (!live(view)) return;
          // a feed that fell behind opens again (bounded: a feed that keeps falling behind with nothing read ends)
          if (reason === 'behind' && behind < 3) return subscribe(view, snapshots > 0 ? 0 : behind + 1);
          endView(view, reason);
        },
      },
    );
    function inventoryArrived(value: unknown): void {
      if (!live(view)) return;
      const read = BrowserInventorySchema.safeParse(value);
      if (!read.success) return deps.log(`[browser] the agent’s browser inventory from ${view.name} is out of shape: dropped (${read.error.issues[0]?.message ?? ''})`);
      snapshots += 1;
      told(view, read.data);
    }
  }

  function endView(view: View, reason: string): void {
    view.ended = true;
    view.sub = null;
    const shown = view.shown;
    closeStreams(view);
    if (shown) deps.emit(view.client, 'browser.remote.closed', { viewId: view.id, reason });
    told(view, unavailable(view, why(view.name, reason)));
  }

  // ---- the streams ---------------------------------------------------------------------------------------------------

  function openShown(view: View, tabId: string, epoch: string, control: boolean): Shown {
    const shown: Shown = { stream: null as unknown as RemoteBrowserStream, tabId, epoch, control, admitted: false, lastSeq: 0, outstanding: false, taking: null };
    shown.stream = openBrowserStream(view.link!, { appSessionId: view.bare, epoch, tabId, ...(control && view.grant && { control: { op: view.grant.op } }) }, {
      opened(opened) {
        if (!live(view)) return;
        shown.admitted = true;
        shown.control = opened.control;
        if (view.pending !== shown) return;
        view.shown?.stream.close();
        view.shown = shown;
        view.pending = null;
        const taking = shown.taking;
        shown.taking = null;
        taking?.(opened.control ? { control: true } : { control: false, reason: 'the endpoint admitted the stream read-only' });
      },
      frame(frame) {
        if (!live(view) || view.shown !== shown) return;
        shown.lastSeq = frame.seq;
        shown.outstanding = true;
        deps.emit(view.client, 'browser.remote.frame', { viewId: view.id, frame });
      },
      closed(reason) {
        if (!live(view)) return;
        if (view.pending === shown) {
          view.pending = null;
          view.wantsControl = view.shown?.control === true; // the grant stays for its epoch: a later take asks no new act
          return shown.taking?.({ control: false, reason });
        }
        if (view.shown !== shown) return;
        view.shown = null;
        if (reason === 'control-revoked') letGoOfControl(view);
        deps.emit(view.client, 'browser.remote.closed', { viewId: view.id, reason });
      },
    });
    return shown;
  }

  // The view's streams closed telling the window nothing; a take waiting on one answered
  function closeStreams(view: View): void {
    const { shown, pending } = view;
    view.shown = null;
    view.pending = null;
    shown?.stream.close();
    pending?.stream.close();
    pending?.taking?.({ control: false, reason: 'the view’s stream was replaced' });
  }

  const controlFor = (view: View, epoch: string) => view.wantsControl && view.grant?.epoch === epoch;

  // ---- control -------------------------------------------------------------------------------------------------------

  async function granted(view: View, epoch: string): Promise<{ op: string } | { reason: string }> {
    if (view.grant?.epoch === epoch) return view.grant;
    const handle = view.link!.act({ action: 'machine.browserControl', args: { appSessionId: view.bare, epoch }, executor: 'endpoint', sendBy: Date.now() + timing.controlAnswerMs });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([handle.outcome, new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), timing.controlAnswerMs)))]);
    clearTimeout(timer);
    if (outcome === null) return { reason: `${view.name} did not answer` };
    if (outcome.state !== 'done') return { reason: reasonOf(outcome) };
    const result = outcome.result as { appSessionId?: unknown; epoch?: unknown } | null;
    if (result?.appSessionId !== view.bare || result.epoch !== epoch) return { reason: `${view.name} granted another session or epoch` };
    return { op: handle.opId };
  }

  return {
    open({ appSessionId }, ctx) {
      if (ctx.target === deps.local) return Promise.reject(failure('browser.remote.open names a session on another machine: this Mac’s agent tabs are in its own panel'));
      const link = deps.remote(ctx.target);
      const view: View = {
        id: `rv-${++minted}`,
        client: ctx.client,
        machine: ctx.target,
        bare: appSessionId,
        link,
        name: link?.name ?? ctx.target,
        inventory: { epoch: '-', tabs: [], selected: null, state: 'unavailable', reason: 'connecting' },
        sub: null,
        ended: link === null,
        selected: null,
        shown: null,
        pending: null,
        grant: null,
        wantsControl: false,
        answer: null,
        offGone: () => {},
      };
      views.set(view.id, view);
      view.offGone = ctx.client.onGone(() => dispose(view)); // at once for a window already gone
      if (link === null) {
        view.inventory = unavailable(null, `no link reaches ${ctx.target} from here, so its agent’s browser cannot be shown`);
        return Promise.resolve({ viewId: view.id, inventory: view.inventory });
      }
      return new Promise((resolve) => {
        const waiting: { timer?: ReturnType<typeof setTimeout> } = {};
        view.answer = (inventory) => {
          clearTimeout(waiting.timer);
          resolve({ viewId: view.id, inventory });
        };
        if (live(view)) subscribe(view);
        if (!view.answer) return;
        if (!live(view)) return view.answer(view.inventory);
        if (link.carrier() === null) return told(view, unavailable(view, `connecting to ${view.name}`));
        waiting.timer = setTimeout(() => view.answer && told(view, unavailable(view, `${view.name} has not answered yet`)), timing.openAnswerMs);
      });
    },
    select({ viewId, epoch, tabId }, ctx) {
      const view = viewOf(viewId, ctx);
      if (view.ended) throw failure(`view ${viewId} has ended: ${view.inventory.reason ?? ''}`);
      closeStreams(view);
      view.selected = { tabId, epoch };
      view.shown = openShown(view, tabId, epoch, controlFor(view, epoch));
    },
    async takeControl({ viewId }, ctx) {
      const view = viewOf(viewId, ctx);
      if (view.ended) return { control: false, reason: view.inventory.reason ?? 'the view has ended' };
      const selected = view.selected;
      if (!selected) return { control: false, reason: 'no tab is selected' };
      if (view.shown?.control && view.shown.admitted && view.shown.tabId === selected.tabId) return { control: true };
      view.wantsControl = true;
      const grant = await granted(view, selected.epoch);
      if (!live(view) || view.ended) return { control: false, reason: 'the view has ended' };
      if ('reason' in grant) {
        if (view.grant?.epoch !== selected.epoch) letGoOfControl(view);
        return { control: false, reason: grant.reason };
      }
      if (!view.wantsControl) return { control: false, reason: 'control was released' };
      if (view.selected?.epoch !== selected.epoch) return { control: false, reason: 'the agent’s browser changed: select a tab again' };
      view.grant = { op: grant.op, epoch: selected.epoch };
      const { tabId, epoch } = view.selected;
      view.pending?.stream.close();
      view.pending?.taking?.({ control: false, reason: 'another take of control' });
      return new Promise((resolve) => {
        const pending = openShown(view, tabId, epoch, true);
        pending.taking = resolve;
        view.pending = pending;
      });
    },
    releaseControl({ viewId }, ctx) {
      const view = viewOf(viewId, ctx);
      letGoOfControl(view);
      const pending = view.pending;
      view.pending = null;
      pending?.stream.close();
      pending?.taking?.({ control: false, reason: 'control was released' });
      if (!view.shown?.control || view.ended || !view.selected) return;
      view.shown.stream.close(); // input stops at once; the producer releases what is held down
      view.shown = openShown(view, view.selected.tabId, view.selected.epoch, false);
    },
    input({ viewId, seq, event }, ctx) {
      const shown = viewOf(viewId, ctx).shown;
      if (!shown?.control || !shown.admitted) throw failure(`view ${viewId} does not control its tab`);
      shown.stream.input(seq, event);
    },
    ack({ viewId, seq }, ctx) {
      const shown = viewOf(viewId, ctx).shown;
      if (!shown || !shown.outstanding || seq !== shown.lastSeq) return; // a frame of a stream gone, or acknowledged already
      shown.outstanding = false;
      shown.stream.ack(seq);
    },
    close({ viewId }, ctx) {
      const view = views.get(viewId);
      if (view?.client === ctx.client) dispose(view);
    },
    stop() {
      for (const view of [...views.values()]) dispose(view);
    },
  };

  function dispose(view: View): void {
    if (!live(view)) return;
    views.delete(view.id);
    view.offGone();
    view.sub?.close();
    view.sub = null;
    closeStreams(view);
    if (view.answer) {
      const answer = view.answer;
      view.answer = null;
      answer(unavailable(view, 'the window closed'));
    }
  }
}

function reasonOf(outcome: Exclude<ActOutcome, { state: 'done' }>): string {
  if (outcome.state === 'not-sent') return 'not sent';
  if (outcome.state === 'failed') return typeof outcome.error === 'string' ? outcome.error : ((outcome.error as { code?: string; message?: string } | null)?.code ?? 'failed');
  return outcome.reason;
}
