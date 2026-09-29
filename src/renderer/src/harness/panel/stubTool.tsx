// Harness-only panel tools (C8a, M1): `stubTool(id, opts)` stands in for a sibling's tool until it registers, and the
// probe tool `harness-stub` is one. The body prints what the host hands it (`<id> · <instanceId> · <session> · pinned ·
// visible · focus <n>`), counts `+1` clicks in its state, can refuse one close and then confirm it inline, and is
// taller than the panel, keeping its scroll offset in its state so it returns where it was after the host unmounts it.
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { Icon } from '../../app/IconButton';
import type { PanelTool, PanelToolContext, PanelToolInit } from '../../panel/tool';

// The body renders from `view`, an immutable snapshot replaced on every change: the React Compiler memoises a render on
// its inputs, so a body reading the mutable state object itself would keep showing the first values it saw.
export class StubState {
  view = { counter: 0, vetoed: false }; // vetoed: the last close was refused; the body offers "Close anyway"
  scrollTop = 0;
  confirmed = false; // the next close passes
  private readonly listeners = new Set<() => void>();

  constructor(readonly init: PanelToolInit<unknown>) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  snapshot = () => this.view;
  private update(patch: Partial<StubState['view']>) {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  increment() {
    this.update({ counter: this.view.counter + 1 });
  }
  refuse() {
    this.update({ vetoed: true });
  }
  confirm() {
    this.confirmed = true;
  }
  remember(scrollTop: number) {
    this.scrollTop = scrollTop;
  }
}

interface StubProbe {
  instances: Map<string, StubState>; // live instances by tab id, in creation order
  opens: number;
  vetoNext: boolean;
}

const probes = new Map<string, StubProbe>();

const probeOf = (toolId: string): StubProbe => {
  let probe = probes.get(toolId);
  if (!probe) {
    probe = { instances: new Map(), opens: 0, vetoNext: false };
    probes.set(toolId, probe);
  }
  return probe;
};

export interface StubOptions {
  title: string;
  pinnable?: boolean;
  multiInstance?: boolean;
  menu?: boolean;
}

export function stubTool(id: string, opts: StubOptions): PanelTool<StubState, unknown> {
  const probe = probeOf(id);
  return {
    id,
    title: opts.title,
    icon: StubIcon,
    pinnable: opts.pinnable ?? true,
    multiInstance: opts.multiInstance ?? true,
    menu: opts.menu,
    createState(init) {
      const state = new StubState(init);
      probe.instances.set(init.instanceId, state);
      return state;
    },
    open() {
      probe.opens += 1;
    },
    async beforeClose(state) {
      if (state.confirmed) return true;
      if (!probe.vetoNext) return true;
      probe.vetoNext = false;
      state.refuse();
      return false;
    },
    dispose(state) {
      probe.instances.delete(state.init.instanceId);
    },
    render: StubBody,
  };
}

// What `window.__maws_harness.panel.stub(id)` reads.
export function stubProbe(toolId: string, unregister: () => void) {
  const probe = probeOf(toolId);
  return {
    counter: () => [...probe.instances.values()].at(-1)?.view.counter ?? 0,
    vetoNextClose: () => void (probe.vetoNext = true),
    instances: () => [...probe.instances.keys()],
    opens: () => probe.opens,
    unregister,
  };
}

function StubBody({ state, ctx }: { state: StubState; ctx: PanelToolContext }) {
  const view = useSyncExternalStore(state.subscribe, state.snapshot);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = state.scrollTop;
  }, [state]);
  const line = [
    state.init.instanceId.split(':')[0],
    state.init.instanceId,
    ctx.appSessionId ?? 'no session',
    ctx.pinned ? 'pinned' : 'unpinned',
    ctx.visible ? 'visible' : 'hidden',
    `focus ${ctx.focusRequest}`,
  ].join(' · ');

  return (
    <div ref={scroller} data-testid="stub-scroller" onScroll={(e) => state.remember(e.currentTarget.scrollTop)} className="h-full overflow-auto p-3 text-ui text-fg">
      <p data-testid="stub-line" className="font-mono text-ui-sm text-fg-muted">
        {line}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={() => state.increment()} className="rounded-sm border border-border px-2 py-0.5 hover:bg-bg-hover">
          +1
        </button>
        <span data-testid="stub-counter">{view.counter}</span>
      </div>
      {view.vetoed && (
        <p role="status" className="mt-2 flex items-center gap-2 text-fg-muted">
          This tab asked to stay open.
          <button
            type="button"
            onClick={() => {
              state.confirm();
              ctx.close();
            }}
            className="rounded-sm border border-border px-2 py-0.5 text-fg hover:bg-bg-hover"
          >
            Close anyway
          </button>
        </p>
      )}
      {/* Taller than the panel at every width, so scroll restoration is observable. */}
      <div aria-hidden className="mt-3 h-[1600px] rounded-sm border border-dashed border-border" />
    </div>
  );
}

function StubIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="3" y="3" width="10" height="10" rx="2" />
    </Icon>
  );
}
