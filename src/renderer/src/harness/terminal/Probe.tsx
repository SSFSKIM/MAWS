// The `#probe` page (C9 M1, Interfaces *Harness*, kept as the performance harness): one pane per renderer candidate,
// each a `TerminalRenderer` on its own pty (xterm.js since the M1 verdict), a workload bar, a metrics readout, a theme
// toggle and a paste field; since M3 the right region, which held ghostty-web during the spike, is the registry's
// shell pane (`RegistryPane.tsx`). Exposes `window.__maws_harness.probe` for Playwright and
// `spikes/terminal-probe/run.mjs`, and `.terminals` for the registry pane. Tokens only (X7): every colour here is a
// token utility; the terminals read the `--term-*` tokens through `theme.ts`.
import { useEffect, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';
import {
  CLAUDE_BIN_DEFAULT,
  CODEX_BIN_DEFAULT,
  resolveProgram,
  workloads,
  type Bins,
  type Phase,
  type ProgramWorkload,
} from '../../../../../spikes/terminal-probe/workloads.mjs';
import type { EventPayload } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { useSettings } from '../../stores/settings';
import { terminals } from '../../terminal/registry';
import type { RendererKind, TerminalFont } from '../../terminal/renderer';
import { readDocumentTheme } from '../../terminal/theme';
import type { Metrics } from './metrics';
import { Pane, type PaneDebug, type ProbeSnapshot } from './pane';
import { RegistryPane, terminalsApi } from './RegistryPane';

// The candidates on the page; a second entry mounts a second pane on the right.
const KINDS: RendererKind[] = ['xterm'];

export interface ProbeApi {
  ready(): Promise<Partial<Record<RendererKind, PaneDebug>>>;
  run(workloadId: string, renderer: RendererKind, phase?: Phase): Promise<Metrics>;
  spawn(renderer: RendererKind, workloadId: string, phase?: Phase): Promise<{ ptyId: string; pid: number }>;
  type(renderer: RendererKind, data: string): Promise<void>;
  kill(renderer: RendererKind): Promise<void>;
  idle(renderer: RendererKind, quietMs?: number, maxMs?: number): Promise<boolean>;
  snapshot(renderer: RendererKind, from?: number, to?: number): ProbeSnapshot;
  state(renderer: RendererKind): PaneDebug;
  focus(renderer: RendererKind): void;
  selection(renderer: RendererKind): string;
  simulateContextLoss(renderer: RendererKind): void;
  geometry(renderer: RendererKind): { x: number; y: number; width: number; height: number; cols: number; rows: number } | null;
  setSplit(fraction: number): void;
  setVisible(renderer: RendererKind, visible: boolean): void;
  setBins(next: Partial<Bins>): void;
  capture(renderer: RendererKind, enabled: boolean): void;
  foreignCharacters(renderer: RendererKind, allowed: string): { position: number; text: string; context: string }[];
  sequenceCounts(renderer: RendererKind): Record<string, number>;
  screenshotReady(): Promise<void>;
}

// The binaries the TUI workloads run: the owner's paths (acceptance item 9) unless the query string overrides them,
// which is how run.mjs passes MAWS_CLAUDE_BIN and MAWS_CODEX_BIN into the sandboxed page.
const query = new URLSearchParams(location.search);
const bins: Bins = { claude: query.get('claude') ?? CLAUDE_BIN_DEFAULT, codex: query.get('codex') ?? CODEX_BIN_DEFAULT };

function readFont(): TerminalFont {
  const style = getComputedStyle(document.documentElement);
  return { family: style.getPropertyValue('--font-mono').trim(), size: parseFloat(style.getPropertyValue('--text-code')) || 13, lineHeight: 1.2 };
}

// One set of panes per page, outside React: the emulators must survive re-renders and StrictMode's double mount.
const panes = Object.fromEntries(KINDS.map((kind) => [kind, new Pane(kind, bins)])) as Partial<Record<RendererKind, Pane>>;
const pane = (kind: RendererKind): Pane => {
  const found = panes[kind];
  if (!found) throw new Error(`${kind} is not a candidate on this page`);
  return found;
};
const byPty = new Map<string, Pane>();
// The registry pane's ptys are the registry's: the page's own listener neither delivers nor holds their events.
const registryPtys = new Set<string>();
// Events for a pty whose spawn reply has not reached the page yet (the reply and the events travel on different
// channels): held until the pane claims the id, so a fast program's first bytes and its exit are never dropped.
const unclaimed = new Map<string, (EventPayload<'pty.data'> | EventPayload<'pty.exit'>)[]>();
let readyPromise: Promise<void> | null = null;

const deliver = (pane: Pane, event: EventPayload<'pty.data'> | EventPayload<'pty.exit'>) => {
  if ('data' in event) pane.onChunk(event.data, event.offset);
  else {
    byPty.delete(event.ptyId);
    pane.onExit(event);
  }
};

function receive(event: EventPayload<'pty.data'> | EventPayload<'pty.exit'>) {
  if (registryPtys.has(event.ptyId)) return;
  const pane = byPty.get(event.ptyId);
  if (pane) return deliver(pane, event);
  const held = unclaimed.get(event.ptyId) ?? [];
  if (held.length < 1024) held.push(event);
  unclaimed.set(event.ptyId, held);
}

function start(): Promise<void> {
  if (readyPromise) return readyPromise;
  ipc.on('pty.data', receive);
  ipc.on('pty.exit', receive);
  terminals.subscribe((infos) => {
    for (const { ptyId } of infos) {
      if (!ptyId || registryPtys.has(ptyId)) continue;
      registryPtys.add(ptyId);
      unclaimed.delete(ptyId); // its first events, held before the registry's spawn reply named it
    }
  });
  // The terminals recolour when the document's theme attribute changes (the settings store sets it).
  new MutationObserver(() => {
    const theme = readDocumentTheme();
    for (const p of Object.values(panes)) p?.setTheme(theme);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const theme = readDocumentTheme();
  const font = readFont();
  readyPromise = Promise.all(KINDS.map((kind) => pane(kind).create(theme, font))).then(() => {});
  return readyPromise;
}

const claim = (pane: Pane) => (ptyId: string) => {
  byPty.set(ptyId, pane);
  const held = unclaimed.get(ptyId) ?? [];
  unclaimed.delete(ptyId);
  for (const event of held) deliver(pane, event);
};

const programWorkload = (id: string): ProgramWorkload => {
  const workload = workloads[id];
  if (!workload || workload.kind !== 'program') throw new Error(`${id} is not a program workload`);
  return workload;
};

const api: ProbeApi = {
  ready: () => start().then(() => Object.fromEntries(KINDS.map((kind) => [kind, pane(kind).debug]))),
  run: (id, renderer, phase = 'm1') => pane(renderer).run(programWorkload(id), phase, claim(pane(renderer))),
  spawn: (renderer, id, phase = 'm1') => pane(renderer).spawn(resolveProgram(programWorkload(id), phase, bins), claim(pane(renderer))),
  type: (renderer, data) => pane(renderer).write(data),
  kill: (renderer) => pane(renderer).kill(),
  idle: (renderer, quietMs, maxMs) => pane(renderer).idle(quietMs, maxMs),
  snapshot: (renderer, from, to) => pane(renderer).snapshot(from, to),
  state: (renderer) => pane(renderer).debug,
  focus: (renderer) => pane(renderer).focus(),
  selection: (renderer) => pane(renderer).renderer?.getSelection() ?? '',
  simulateContextLoss: (renderer) => pane(renderer).renderer?.simulateContextLoss?.(),
  // The drawn grid's box: the renderer's canvas when it has one (it need not fill the container), else the container.
  geometry(renderer) {
    const element = pane(renderer).renderer?.element;
    if (!element) return null;
    const { x, y, width, height } = (element.querySelector('canvas') ?? element).getBoundingClientRect();
    const { cols, rows } = pane(renderer).debug;
    return { x, y, width, height, cols, rows };
  },
  setSplit: (fraction) => useProbeStore.getState().setSplit(fraction),
  setVisible: (renderer, visible) => pane(renderer).renderer?.setVisible(visible),
  setBins: (next) => Object.assign(bins, next),
  capture: (renderer, enabled) => pane(renderer).capture(enabled),
  foreignCharacters: (renderer, allowed) => pane(renderer).foreignCharacters(new RegExp(allowed)),
  sequenceCounts: (renderer) => pane(renderer).sequenceCounts(),
  screenshotReady: () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
};

interface ProbeStore {
  target: RendererKind | 'both';
  split: number; // the left pane's share of the width
  setTarget(target: RendererKind | 'both'): void;
  setSplit(fraction: number): void;
}
const useProbeStore = create<ProbeStore>()((set) => ({
  target: 'both',
  split: 0.5,
  setTarget: (target) => set({ target }),
  setSplit: (fraction) => set({ split: Math.min(0.9, Math.max(0.1, fraction)) }),
}));

function usePaneDebug(kind: RendererKind): PaneDebug {
  const p = pane(kind);
  return useSyncExternalStore(
    (cb) => p.subscribe(cb),
    () => p.debug,
  );
}

export function Probe() {
  const target = useProbeStore((s) => s.target);
  const split = useProbeStore((s) => s.split);
  const setTarget = useProbeStore((s) => s.setTarget);
  const setSplit = useProbeStore((s) => s.setSplit);
  const resolvedTheme = useSettings((s) => s.state?.resolvedTheme);
  const setTheme = useSettings((s) => s.setTheme);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.__maws_harness = { page: 'probe', probe: api, terminals: terminalsApi };
    void start();
  }, []);

  const targets = (): RendererKind[] => (target === 'both' ? KINDS : KINDS.filter((kind) => kind === target));
  const runWorkload = async (id: string) => {
    const workload = workloads[id]!;
    for (const kind of targets()) {
      const p = pane(kind);
      if (workload.kind === 'typed') {
        await p.write(workload.command).catch((error) => console.warn(`[probe] ${kind}: ${String(error)}`));
      } else if (workload.measure) {
        void p.run(workload, 'm1', claim(p)).catch((error) => console.error(`[probe] ${kind} ${id} failed`, error));
      } else {
        void p.spawn(resolveProgram(workload, 'm1', bins), claim(p)).catch((error) => console.error(`[probe] ${kind} ${id} failed`, error));
      }
    }
  };

  const onDividerDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    const row = rowRef.current;
    if (!row) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const move = (e: PointerEvent) => {
      const box = row.getBoundingClientRect();
      setSplit((e.clientX - box.left) / box.width);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-bg-raised px-3 py-2 text-ui-sm">
        <span className="font-mono text-fg-faint">#probe</span>
        <div role="group" aria-label="target" className="flex gap-1 [app-region:no-drag]">
          {(['both', ...KINDS] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={target === value}
              onClick={() => setTarget(value)}
              className="rounded-sm px-2 py-0.5 text-fg-muted hover:bg-bg-hover aria-pressed:bg-bg-active aria-pressed:text-fg"
            >
              {value}
            </button>
          ))}
        </div>
        <div role="group" aria-label="workloads" className="flex flex-wrap gap-1 [app-region:no-drag]">
          {Object.entries(workloads).map(([id, workload]) => (
            <button
              key={id}
              type="button"
              onClick={() => void runWorkload(id)}
              className="rounded-sm border border-border px-2 py-0.5 text-fg hover:bg-bg-hover"
              title={workload.title}
            >
              {id}
            </button>
          ))}
          <button
            type="button"
            onClick={() => targets().forEach((kind) => void pane(kind).kill())}
            className="rounded-sm border border-border px-2 py-0.5 text-danger hover:bg-bg-hover"
          >
            kill
          </button>
        </div>
        <button
          type="button"
          onClick={() => void setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className="rounded-sm border border-border px-2 py-0.5 text-fg hover:bg-bg-hover [app-region:no-drag]"
        >
          theme: {resolvedTheme ?? '…'}
        </button>
        <input
          aria-label="paste target"
          placeholder="paste here"
          className="rounded-sm border border-border bg-bg px-2 py-0.5 font-mono text-fg [app-region:no-drag]"
        />
      </header>
      <div ref={rowRef} className="flex min-h-0 flex-1">
        <PaneView kind={KINDS[0]!} style={{ flexBasis: `${split * 100}%` }} />
        <div role="separator" aria-orientation="vertical" onPointerDown={onDividerDown} className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-border-strong" />
        {KINDS[1] ? <PaneView kind={KINDS[1]} style={{ flex: 1 }} /> : <RegistryPane />}
      </div>
    </div>
  );
}

function PaneView({ kind, style }: { kind: RendererKind; style: React.CSSProperties }) {
  const debug = usePaneDebug(kind);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current!;
    pane(kind).mount(host);
    return () => pane(kind).unmount();
  }, [kind]);

  return (
    <section aria-label={`${kind} pane`} data-pane={kind} style={style} className="flex min-w-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-3 border-b border-border px-2 font-mono text-ui-sm text-fg-muted">
        <span className="text-fg">{kind}</span>
        <span>{debug.acceleration ?? '—'}</span>
        <span>{debug.status}</span>
        <span>{debug.pid === null ? '' : `pid ${debug.pid}`}</span>
        <span>
          {debug.cols}×{debug.rows}
        </span>
        {debug.exit ? <span>exit {debug.exit.exitCode ?? 'null'}/{debug.exit.signal ?? 'null'}</span> : null}
        {debug.error ? <span className="text-danger">{debug.error}</span> : null}
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden bg-bg-raised p-1" />
      <DebugStrip debug={debug} />
    </section>
  );
}

function DebugStrip({ debug }: { debug: PaneDebug }) {
  const flags = [
    `bytes ${debug.bytes}`,
    `parsed ${debug.parsed}`,
    `sync ${debug.syncFrames}`,
    `kitty ${debug.kittyQueried ? 'queried' : '-'}/${debug.kittyAnswered ? 'answered' : '-'}`,
    `xtversion ${debug.xtversionQueried ? 'queried' : '-'}/${debug.xtversionAnswered ? 'answered' : '-'}`,
    `dsr ${debug.dsrReplies.length}`,
  ];
  return (
    <output aria-label={`${debug.kind} debug`} className="flex shrink-0 flex-col gap-0.5 border-t border-border px-2 py-1 font-mono text-ui-sm text-fg-muted">
      <div className="flex flex-wrap gap-x-3">
        {flags.map((flag) => (
          <span key={flag.split(' ')[0]}>{flag}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3">
        <span>title {debug.title ?? '—'}</span>
        <span>link {debug.lastLink ?? '—'}</span>
        <span>open {debug.lastOpen ?? '—'}</span>
        <span>acked {debug.acked}</span>
        <span className="truncate">input {debug.lastInput || '—'}</span>
      </div>
      {debug.metrics ? <div className="truncate text-fg">{JSON.stringify(debug.metrics)}</div> : null}
    </output>
  );
}
