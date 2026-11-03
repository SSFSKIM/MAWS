// P5 O17 M10 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M10's Decisions; the Decision Log's "the remote
// Browser view's shape"): the agent's tabs on another machine's session in the Browser tool, as a live picture. One tab
// strip keeps the person's own tabs on this Mac (O7 M3's forwarded tabs) and, after them, a group labelled "Agent on
// <machine>" (`AgentGroup`), as the local panel sets the agent's tabs beside the person's; picking an agent tab shows its
// screencast in place of the pane (`RemoteCanvas`), under a row of its own (`RemoteNav`): the page's address as text,
// who has it, and Take control or Give back. Nothing that needs a local preload (find, comments, import, profiles) is
// offered on a screencast tab.
//
// - States are honest and worded by main's view kind (copy.ts's `remote`): connecting, no agent tabs, the machine's
//   reason when it says the browser is unavailable, connection lost, an older MAWS there, a view that ended (with
//   Reconnect). A picture that is not live is dimmed under what is wrong, never presented as live.
// - The canvas has a labelled focus target (a visually hidden text area, so an IME composes into it), which says whether
//   the page is view only or under the person's control; the frame is fitted with letterboxing and pointer points are
//   mapped through the image (./input.ts), a point in the letterbox refused. Escape gives the keyboard back to the
//   window; a Command chord stays the app's; an IME's commit goes once, as text.
// - In a narrow panel the image keeps the width and the agent's tabs collapse to a picker.
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useSyncExternalStore, type ClipboardEvent, type CompositionEvent, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react';
import type { BrowserFrame, BrowserInventory, BrowserTabSummary } from '@shared/browser/screencast';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { RemoteViewState } from '@shared/ipc/schema/browser';
import { machineOf } from '@shared/machine/address';
import { ipc } from '../../../ipc/client';
import { useMachines } from '../../../stores/machines';
import { machineName } from '../../../stores/org-projects';
import { BROWSER_COPY } from '../copy';
import { BrowserIcon, PersonIcon } from '../icons';
import { RemoteBrowserClient, type RemoteBrowserState } from './client';
import { buttonOf, ClickCounter, fitImage, keyInputs, pointAt, pointerInput, textInputs, wheelInput, type PointerButton } from './input';

const C = BROWSER_COPY.remote;

export interface RemoteBrowser {
  client: RemoteBrowserClient;
  state: RemoteBrowserState;
}

/** The session's remote view while `enabled` (the Browser tool shown, its panel open); null otherwise. */
export function useRemoteBrowser(appSessionId: AppSessionId, enabled: boolean, bridge: MawsBridge = ipc): RemoteBrowser | null {
  const client = useMemo(() => (enabled ? new RemoteBrowserClient(appSessionId, bridge) : null), [appSessionId, enabled, bridge]);
  useEffect(() => {
    if (!client) return;
    client.open();
    return () => client.close();
  }, [client]);
  const subscribe = useCallback((listener: () => void) => client?.subscribe(listener) ?? (() => {}), [client]);
  const state = useSyncExternalStore(subscribe, () => client?.getState() ?? null);
  return client && state ? { client, state } : null;
}

/** The machine's name as the roster gives it. */
export function useMachineName(appSessionId: AppSessionId): string {
  const machine = machineOf(appSessionId);
  return useMachines((s) => machineName(s.machines, machine, ipc.localMachine));
}

/** What the agent's browser reads when it has no tab to list; null while it lists tabs. */
export function remoteStatus(view: RemoteViewState, inventory: BrowserInventory | null, machine: string): string | null {
  switch (view.kind) {
    case 'live':
      return inventory !== null && inventory.state === 'ready' && inventory.tabs.length > 0 ? null : C.noTabs;
    case 'connecting':
      return C.connecting(machine);
    case 'lost':
      return C.lost;
    case 'unavailable':
      return C.unavailable(inventory?.reason ?? null);
    case 'unsupported':
      return C.unsupported(machine);
    case 'ended':
      return view.end === 'removed' ? C.ended.removed : view.end === 'class' ? C.ended.class : view.end === 'closed' ? C.ended.closed(machine) : view.end === 'no-link' ? C.ended.noLink(machine) : view.end === 'window' ? C.ended.window : C.ended.failed(machine);
  }
}

const listedTabs = (state: RemoteBrowserState): BrowserTabSummary[] => (state.view.kind === 'live' && state.inventory?.state === 'ready' ? state.inventory.tabs : []);
const shownTab = (state: RemoteBrowserState): BrowserTabSummary | null => listedTabs(state).find((tab) => tab.tabId === state.shown?.tabId) ?? null;
const titleOf = (tab: BrowserTabSummary) => tab.title || tab.url || BROWSER_COPY.newTab;

// ---- the strip's group ----------------------------------------------------------------------------------------------

export function AgentGroup({ remote, machine, onShow }: { remote: RemoteBrowser; machine: string; onShow(tabId: string): void }) {
  const { state, client } = remote;
  const tabs = listedTabs(state);
  const shownId = state.showing ? (state.shown?.tabId ?? null) : null;
  const status = remoteStatus(state.view, state.inventory, machine);
  const label = C.group(machine);
  return (
    <div role="group" aria-label={label} data-browser-agent-group="" className="flex min-w-0 shrink items-center gap-0.5 border-l border-border pl-1">
      <span className="shrink-0 px-1 text-ui-sm font-medium text-fg-muted">{label}</span>
      {status !== null ? (
        <span role="status" data-browser-agent-status={state.view.kind} className="flex min-w-0 items-center gap-1 text-ui-sm text-fg-faint">
          <span className="min-w-0 truncate" title={status}>
            {status}
          </span>
          {state.view.kind === 'ended' && (
            <button type="button" onClick={() => client.reopen()} className="h-5 shrink-0 rounded-sm border border-border px-1.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2">
              {C.reconnect}
            </button>
          )}
        </span>
      ) : (
        <>
          <div role="tablist" aria-label={label} className="hidden min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] @[26rem]:flex">
            {tabs.map((tab) => (
              <AgentChip key={tab.tabId} tab={tab} selected={tab.tabId === shownId} onSelect={() => onShow(tab.tabId)} />
            ))}
          </div>
          <select
            aria-label={C.pick(machine)}
            data-browser-agent-picker=""
            value={shownId ?? ''}
            onChange={(event) => event.target.value !== '' && onShow(event.target.value)}
            className="h-6 max-w-40 min-w-0 rounded-sm border border-border bg-bg px-1 text-ui-sm text-fg outline-accent focus-visible:outline-2 @[26rem]:hidden"
          >
            {shownId === null && <option value="">{label}</option>}
            {tabs.map((tab) => (
              <option key={tab.tabId} value={tab.tabId}>
                {titleOf(tab)}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

function AgentChip({ tab, selected, onSelect }: { tab: BrowserTabSummary; selected: boolean; onSelect(): void }) {
  const title = titleOf(tab);
  const tone = selected ? 'bg-bg text-fg' : 'text-fg-muted hover:bg-bg-hover hover:text-fg';
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-browser-agent-chip={tab.tabId}
      title={tab.url === '' ? title : `${title}\n${tab.url}`}
      onClick={onSelect}
      className={`flex h-6 w-40 min-w-16 shrink items-center gap-1.5 rounded-sm px-2 text-ui-sm outline-accent focus-visible:outline-2 ${tone}`}
    >
      <BrowserIcon className="size-3.5" />
      {tab.control === 'agent' && <span data-browser-acting role="img" aria-label={BROWSER_COPY.acting} title={BROWSER_COPY.acting} className="size-1.5 shrink-0 rounded-full bg-accent" />}
      <span className="min-w-0 truncate">{title}</span>
    </button>
  );
}

// ---- the row under the strip ----------------------------------------------------------------------------------------

export function RemoteNav({ remote }: { remote: RemoteBrowser }) {
  const { state, client } = remote;
  const tab = shownTab(state);
  const held = state.control === 'held';
  const notice = state.notice === null ? null : state.notice.kind === 'revoked' ? C.controlRevoked : C.controlRefused(state.notice.reason);
  return (
    <>
      <div data-browser-nav="remote" className="flex h-9 shrink-0 items-center gap-2 px-2">
        <span data-browser-remote-url="" className="min-w-0 flex-1 truncate text-ui text-fg-muted" title={tab?.url}>
          {tab?.url ?? ''}
        </span>
        {tab?.control === 'agent' && !held && (
          <span data-browser-control="agent" className="flex shrink-0 items-center gap-1.5 text-ui-sm text-fg-muted">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
            {BROWSER_COPY.control.agentBrowsing}
          </span>
        )}
        {held ? (
          <>
            <span role="status" data-remote-control-state="held" className="flex shrink-0 items-center gap-1.5 rounded-sm border-l-2 border-accent bg-accent-soft px-2 py-0.5 text-ui-sm font-medium text-fg">
              <PersonIcon className="size-3.5 shrink-0" />
              {C.youControl}
            </span>
            <button type="button" onClick={() => client.releaseControl()} className="h-6 shrink-0 rounded-sm border border-accent px-2 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2">
              {C.giveBack}
            </button>
          </>
        ) : (
          <>
            <span role="status" data-remote-control-state="view" className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-ui-sm text-fg-muted">
              {C.viewOnly}
            </span>
            <button
              type="button"
              disabled={tab === null || state.control === 'taking'}
              onClick={() => void client.takeControl()}
              className="h-6 shrink-0 rounded-sm border border-border px-2 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:opacity-50"
            >
              {state.control === 'taking' ? C.taking : C.takeControl}
            </button>
          </>
        )}
      </div>
      {notice !== null && (
        <p role="status" data-remote-control-notice="" className="m-0 flex shrink-0 items-center gap-2 border-t border-border px-3 py-1 text-ui-sm text-fg-muted">
          <span className="min-w-0 flex-1 truncate" title={notice}>
            {notice}
          </span>
          <button type="button" onClick={() => client.dismissNotice()} className="shrink-0 rounded-sm px-1 text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
            {BROWSER_COPY.dismiss}
          </button>
        </p>
      )}
    </>
  );
}

// ---- the canvas -----------------------------------------------------------------------------------------------------

/** A frame's JPEG decoded and drawn on `canvas`, at its own pixels (the element fits it with letterboxing). */
export async function drawJpeg(canvas: HTMLCanvasElement, frame: BrowserFrame): Promise<void> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(frame.jpeg)], { type: 'image/jpeg' }));
  try {
    if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
    if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close();
  }
}

export interface RemoteCanvasProps {
  remote: RemoteBrowser;
  machine: string;
  draw?: (canvas: HTMLCanvasElement, frame: BrowserFrame) => Promise<void>; // tests stand in for the JPEG decoder
}

export function RemoteCanvas({ remote, machine, draw = drawJpeg }: RemoteCanvasProps) {
  const { state, client } = remote;
  const canvas = useRef<HTMLCanvasElement>(null);
  const target = useRef<HTMLTextAreaElement>(null);
  const pressed = useRef(new Set<PointerButton>());
  const clicks = useMemo(() => new ClickCounter(), []);
  const held = state.control === 'held';
  const frame = state.frame;
  const tab = shownTab(state);

  useEffect(() => {
    client.setDrawer((next) => (canvas.current ? draw(canvas.current, next) : Promise.reject(new Error('no canvas'))));
    return () => client.setDrawer(null);
  }, [client, draw]);
  // a new tab starts on a blank picture, never the last tab's
  const tabId = state.shown?.tabId ?? null;
  useEffect(() => {
    const element = canvas.current;
    if (element && frame === null) element.getContext('2d')?.clearRect(0, 0, element.width, element.height);
  }, [tabId, frame]);
  // control given up: anything held down is let go on the page's side, and the keyboard returns to this window
  useEffect(() => {
    if (!held) pressed.current.clear();
  }, [held]);

  const pointOf = (event: { clientX: number; clientY: number }, clamp: boolean) => {
    const element = canvas.current;
    if (!element || !frame) return null;
    const box = element.getBoundingClientRect();
    const image = fitImage({ left: box.left, top: box.top, width: box.width, height: box.height }, frame);
    return image === null ? null : pointAt(image, frame.viewport, event.clientX, event.clientY, clamp);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault(); // the focus target keeps the keyboard
    target.current?.focus({ preventScroll: true });
    if (!held) return;
    const button = buttonOf(event.button);
    const at = pointOf(event, false);
    if (button === null || at === null) return; // in the letterbox, or a button §G does not carry
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pressed.current.add(button);
    const input = pointerInput('down', event, at, clicks.down(button, at));
    if (input) client.input(input);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!held) return;
    const at = pointOf(event, pressed.current.size > 0);
    const input = at && pointerInput('move', event, at, 0);
    if (input) client.input(input);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const button = buttonOf(event.button);
    if (!held || button === null || !pressed.current.delete(button)) return;
    const at = pointOf(event, true);
    const input = at && pointerInput('up', event, at, clicks.up(button));
    if (input) client.input(input);
  };

  // the wheel's listener is not passive, so a scroll over a controlled page scrolls the page, not the panel
  const surface = useRef<HTMLDivElement>(null);
  const onWheel = useEffectEvent((event: WheelEvent) => {
    if (!held || !frame) return;
    const at = pointOf(event, false);
    if (at === null) return;
    event.preventDefault();
    client.input(wheelInput(event, at, frame.viewport));
  });
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const listener = (event: WheelEvent) => onWheel(event);
    element.addEventListener('wheel', listener, { passive: false });
    return () => element.removeEventListener('wheel', listener);
  }, []);

  const onKey = (type: 'down' | 'up', event: KeyboardEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent;
    const inputs = keyInputs(type, { key: event.key, code: event.code, repeat: event.repeat, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, isComposing: native.isComposing, keyCode: native.keyCode });
    if (inputs === 'pass') return; // the app's shortcut
    if (inputs === 'release') {
      event.preventDefault();
      return event.currentTarget.blur();
    }
    if (!held) return;
    if (inputs.length === 0) return; // the IME composes: its commit is the text
    event.preventDefault();
    for (const input of inputs) client.input(input);
  };
  const onCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    if (held) for (const input of textInputs(event.data ?? '')) client.input(input);
    event.currentTarget.value = '';
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!held) return;
    event.preventDefault();
    for (const input of textInputs(event.clipboardData.getData('text/plain'))) client.input(input);
  };
  // the target holds no text of its own: whatever reached it outside a composition was sent as keys or text already
  const onInput = (event: FormEvent<HTMLTextAreaElement>) => {
    if (!(event.nativeEvent as InputEvent).isComposing) event.currentTarget.value = '';
  };
  const onBlur = () => {
    if (held) client.input({ kind: 'blur' });
  };

  const status = remoteStatus(state.view, state.inventory, machine);
  const stale = frame !== null && state.stream !== 'live';
  const overlay = status ?? (state.stream === 'stopped' ? C.stopped : frame === null ? C.loading : stale && state.stream === 'waiting' ? C.lost : null);
  const label = `${tab ? C.page(titleOf(tab), machine) : C.group(machine)}. ${held ? C.youControlHint : C.viewOnlyHint}`;
  return (
    <div
      ref={surface}
      data-remote-browser=""
      data-remote-stream={state.stream}
      data-remote-seq={frame?.seq ?? 0}
      data-remote-control={state.control}
      data-remote-tab={state.shown?.tabId ?? ''}
      data-remote-viewport={frame ? `${frame.viewport.width}x${frame.viewport.height}` : ''}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(event) => held && event.preventDefault()}
      className={`relative h-full w-full touch-none overflow-hidden bg-bg-raised outline-accent has-[textarea:focus]:outline-2 has-[textarea:focus]:-outline-offset-2 ${held ? 'cursor-default' : 'cursor-not-allowed'}`}
    >
      <canvas ref={canvas} aria-hidden className={`absolute inset-0 size-full object-contain ${stale || status !== null ? 'opacity-40' : ''}`} />
      <textarea
        ref={target}
        aria-label={label}
        data-remote-focus=""
        rows={1}
        onKeyDown={(event) => onKey('down', event)}
        onKeyUp={(event) => onKey('up', event)}
        onCompositionEnd={onCompositionEnd}
        onPaste={onPaste}
        onBlur={onBlur}
        onInput={onInput}
        className="sr-only"
      />
      {overlay !== null && (
        <div role="status" data-remote-overlay="" className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center">
          <span className="pointer-events-auto flex max-w-full flex-col items-center gap-2 rounded-md bg-bg/90 px-3 py-2 text-ui text-fg-muted">
            {overlay}
            {state.stream === 'stopped' && status === null && (
              <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => client.retry()} className="h-6 rounded-sm border border-border px-2 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2">
                {C.retry}
              </button>
            )}
            {state.view.kind === 'ended' && (
              <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => client.reopen()} className="h-6 rounded-sm border border-border px-2 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2">
                {C.reconnect}
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
