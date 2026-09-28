// The transcript harness page (`#transcript`): plays a fixture into the real Transcript at an adjustable speed, with a
// fixture picker, playback controls, "expand all old work", a theme toggle, a metrics overlay, and toasts naming every
// action the transcript calls (C7 and C8 are absent here), and assigns `window.__maws_harness` for Playwright.
import { useEffect, useRef, useState } from 'react';
import { useTranscriptStore } from '../stores/transcript';
import { rowId } from '../transcript/model/keys';
import type { TranscriptActions, RewindInterface } from '../transcript/view/context';
import { Transcript, type TranscriptListHandle } from '../transcript/view/Transcript';
import type { HarnessApi, HarnessMetrics } from './api';
import { FIXTURES, loadFixture } from './fixtures';
import { FrameMetrics, percentile } from './metrics';
import { HarnessSession } from './player';

declare global {
  interface Window {
    __maws_harness?: HarnessApi;
  }
}

const SPEEDS = [0, 1, 4, 16];
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const painted = async () => {
  await nextFrame();
  await nextFrame();
};

export function Harness() {
  const params = new URLSearchParams(location.search);
  const [session, setSession] = useState<HarnessSession | null>(null);
  const [fixture, setFixture] = useState(params.get('fixture') ?? 'synthetic/500');
  const [speed, setSpeedState] = useState(Number(params.get('speed') ?? 1));
  const speedRef = useRef(speed);
  const setSpeed = (value: number) => {
    speedRef.current = value;
    setSpeedState(value);
  };
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const sessionRef = useRef<HarnessSession | null>(null);
  const listRef = useRef<TranscriptListHandle>(null);
  const frames = useRef(new FrameMetrics());

  useEffect(() => {
    const theme = params.get('theme');
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;

    const load = async (name: string) => {
      const started = performance.now();
      const loaded = await loadFixture(name);
      sessionRef.current?.dispose();
      frames.current.stop();
      const next = new HarnessSession(loaded, speedRef.current);
      sessionRef.current = next;
      setFixture(name);
      setSession(next);
      setError(null);
      await painted();
      return { ms: performance.now() - started, rows: next.rows().length, events: next.eventCount };
    };
    const current = () => {
      if (!sessionRef.current) throw new Error('no fixture loaded');
      return sessionRef.current;
    };
    const api: HarnessApi = {
      load,
      play: (playSpeed) => {
        const { player } = current();
        if (playSpeed !== undefined) {
          player.speed = playSpeed;
          setSpeed(playSpeed);
        }
        frames.current.start();
        player.play();
      },
      pause: () => current().player.pause(),
      step: () => current().player.step(),
      turnId: (n) => current().turnId(n),
      expandAll: async () => {
        useTranscriptStore.getState().expandAll(current().key);
        await painted();
      },
      expandTurn: async (n) => {
        const session = current();
        const turn = session.turnId(n);
        const divider = session.rows().find((row) => row.id === rowId.divider(turn));
        if (divider?.kind === 'divider' && !divider.expanded) useTranscriptStore.getState().toggleTurn(session.key, turn);
        await painted();
      },
      scrollToTurn: async (n) => {
        const session = current();
        const turn = session.turnId(n);
        listRef.current?.scrollToIndex(session.rows().findIndex((row) => row.turnId === turn), 'start');
        await painted();
      },
      metrics: (): HarnessMetrics => {
        const session = current();
        return {
          frameIntervals: [...frames.current.frameIntervals],
          longTasks: [...frames.current.longTasks],
          rows: session.rows().length,
          domRows: listRef.current?.scrollElement?.querySelectorAll('[data-index]').length ?? 0,
          deriveMs: session.deriveMs,
          lastBatchMs: session.lastBatchMs,
          batches: session.batches,
          following: listRef.current?.following ?? true,
        };
      },
    };
    const frameMetrics = frames.current;
    window.__maws_harness = api;
    const initial = params.get('fixture');
    if (initial) {
      void api.load(initial).then(() => {
        if (params.has('speed')) api.play(Number(params.get('speed')));
      }, (reason: unknown) => setError(String(reason)));
    }
    return () => {
      delete window.__maws_harness;
      sessionRef.current?.dispose();
      frameMetrics.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the API is assigned once per mounted page
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  const run = (action: () => unknown) => {
    try {
      const result = action();
      if (result instanceof Promise) result.catch((reason: unknown) => setError(String(reason)));
    } catch (reason) {
      setError(String(reason));
    }
  };
  const api = () => window.__maws_harness!;
  const toggleTheme = () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  };

  // Every callback the transcript makes shows as a toast naming it (stable, so the transcript's context never changes).
  const [{ actions, rewind }] = useState(() => toastCallbacks((text) => setToast((previous) => ({ text, n: (previous?.n ?? 0) + 1 }))));

  return (
    <div className="relative flex h-full flex-col bg-bg text-fg">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-raised px-4 py-2 pl-20 text-ui">
        <select aria-label="Fixture" className="rounded-sm border border-border bg-bg px-2 py-1" value={fixture} onChange={(event) => setFixture(event.target.value)}>
          {FIXTURES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select aria-label="Speed" className="rounded-sm border border-border bg-bg px-2 py-1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
          {SPEEDS.map((value) => (
            <option key={value} value={value}>
              {value === 0 ? 'instant' : `${value}×`}
            </option>
          ))}
        </select>
        <HarnessButton onClick={() => run(() => api().load(fixture))}>Load</HarnessButton>
        <HarnessButton onClick={() => run(() => api().play(speed))}>Play</HarnessButton>
        <HarnessButton onClick={() => run(() => api().pause())}>Pause</HarnessButton>
        <HarnessButton onClick={() => run(() => api().step())}>Step</HarnessButton>
        <HarnessButton onClick={() => run(() => api().expandAll())}>Expand all old work</HarnessButton>
        <HarnessButton onClick={toggleTheme}>Theme</HarnessButton>
        {error && <span className="text-danger">{error}</span>}
      </div>
      {session ? (
        <Transcript key={session.id} source={session.source} variant="session" actions={actions} rewind={rewind} handle={listRef} className="flex-1" />
      ) : (
        <div className="flex flex-1 items-center justify-center text-fg-muted">Choose a fixture and load it.</div>
      )}
      {session && <MetricsOverlay />}
      {toast && (
        <div key={toast.n} role="status" className="pointer-events-none absolute bottom-16 right-4 rounded-md border border-border-strong bg-bg-overlay px-3 py-2 font-mono text-ui-sm text-fg">
          {toast.text}
        </div>
      )}
    </div>
  );
}

function toastCallbacks(say: (text: string) => void): { actions: TranscriptActions; rewind: RewindInterface } {
  return {
    actions: {
      openSubagent: (ref) => say(`openSubagent ${ref.agentId ?? ref.taskId}`),
      openFullLog: (cell) => say(`openFullLog ${cell.id}`),
      reviewChanges: (turn, path) => say(`reviewChanges ${turn}${path ? ` ${path}` : ''}`),
      openFile: (path, line) => say(`openFile ${path}${line ? `:${line}` : ''}`),
      openExternal: (url) => say(`openExternal ${url}`),
      editAndResubmit: (row) => say(`editAndResubmit ${row.id}`),
      loadSpill: (spill) => {
        say(`loadSpill ${spill.path}`);
        return Promise.resolve(`(the harness has no spill content for ${spill.path})`);
      },
    },
    rewind: {
      canUndo: () => Promise.resolve({ ok: true, reason: null }),
      undo: (turn) => {
        say(`rewind.undo ${turn}`);
        return Promise.resolve();
      },
      reapply: (turn) => {
        say(`rewind.reapply ${turn}`);
        return Promise.resolve();
      },
    },
  };
}

function HarnessButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="rounded-sm border border-border bg-bg px-2 py-1 text-fg hover:bg-bg-hover" onClick={onClick}>
      {children}
    </button>
  );
}

function MetricsOverlay() {
  const [metrics, setMetrics] = useState<HarnessMetrics | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setMetrics(window.__maws_harness?.metrics() ?? null), 500);
    return () => clearInterval(timer);
  }, []);
  if (!metrics) return null;
  const recent = metrics.frameIntervals.slice(-120);
  return (
    <div className="pointer-events-none absolute right-4 top-14 rounded-md border border-border bg-bg-overlay px-3 py-2 font-mono text-ui-sm text-fg-muted">
      <div>frames p95 {percentile(recent, 95).toFixed(1)} ms · max {Math.max(0, ...recent).toFixed(1)} ms</div>
      <div>rows {metrics.rows} · dom {metrics.domRows} · batches {metrics.batches}</div>
      <div>derive {metrics.deriveMs.toFixed(1)} ms · batch {metrics.lastBatchMs.toFixed(2)} ms</div>
      <div>{metrics.following ? 'following' : 'reading'}</div>
    </div>
  );
}
