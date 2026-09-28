// The transcript harness page (`#transcript`): plays a fixture into the transcript list at an adjustable speed, with
// a fixture picker, playback controls, "expand all old work", a theme toggle and a metrics overlay, and assigns
// `window.__maws_harness` for Playwright. M1 renders the spike's prototype rows; M3 switches to the real Transcript.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Row } from '../transcript/model/rows';
import { TranscriptList, type TranscriptListHandle } from '../transcript/view/Transcript';
import type { HarnessApi, HarnessMetrics } from './api';
import { FIXTURES, loadFixture } from './fixtures';
import { FrameMetrics, percentile } from './metrics';
import { HarnessSession } from './player';
import { renderPrototypeRow } from './prototype-rows';

declare global {
  interface Window {
    __maws_harness?: HarnessApi;
  }
}

const SPEEDS = [0, 1, 4, 16];
const NO_ROWS: Row[] = [];
const noSubscription = () => () => {};
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
  const sessionRef = useRef<HarnessSession | null>(null);
  const listRef = useRef<TranscriptListHandle>(null);
  const frames = useRef(new FrameMetrics());

  const rows = useSyncExternalStore(session?.model.subscribe ?? noSubscription, session?.model.rows ?? (() => NO_ROWS));

  useEffect(() => {
    const theme = params.get('theme');
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;

    const load = async (name: string) => {
      const started = performance.now();
      sessionRef.current?.dispose();
      frames.current.stop();
      const next = new HarnessSession(loadFixture(name), speedRef.current);
      sessionRef.current = next;
      setFixture(name);
      setSession(next);
      setError(null);
      await painted();
      return { ms: performance.now() - started, rows: next.model.rows().length, events: next.eventCount };
    };
    const current = () => {
      if (!sessionRef.current) throw new Error('no fixture loaded');
      return sessionRef.current;
    };
    const api: HarnessApi = {
      load,
      play: (playSpeed) => {
        const { source } = current();
        if (playSpeed !== undefined) {
          source.speed = playSpeed;
          setSpeed(playSpeed);
        }
        frames.current.start();
        source.play();
      },
      pause: () => current().source.pause(),
      step: () => current().source.step(),
      expandAll: async () => {
        current().model.expandAll();
        await painted();
      },
      expandTurn: async (n) => {
        const { model } = current();
        const id = model.turnId(n);
        if (!model.isExpanded(id)) model.toggleTurn(id);
        await painted();
      },
      scrollToTurn: async (n) => {
        const { model } = current();
        const id = model.turnId(n);
        listRef.current?.scrollToIndex(model.rows().findIndex((row) => row.turnId === id), 'start');
        await painted();
      },
      metrics: (): HarnessMetrics => {
        const { model, lastBatchMs, batches } = current();
        return {
          frameIntervals: [...frames.current.frameIntervals],
          longTasks: [...frames.current.longTasks],
          rows: model.rows().length,
          domRows: listRef.current?.scrollElement?.querySelectorAll('[data-index]').length ?? 0,
          deriveMs: model.deriveMs,
          lastBatchMs,
          batches,
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

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-raised px-4 py-2 pl-20 text-ui">
        <select aria-label="Fixture" className="rounded-sm border border-border bg-bg px-2 py-1" value={fixture} onChange={(event) => setFixture(event.target.value)}>
          {FIXTURES.map((entry) => (
            <option key={entry.name} value={entry.name} disabled={!entry.playable}>
              {entry.name}
              {entry.playable ? '' : ' (M2)'}
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
        <TranscriptList
          key={session.id}
          rows={rows}
          renderRow={(row) => renderPrototypeRow(session.model, row)}
          handle={listRef}
          className="flex-1"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-fg-muted">Choose a fixture and load it.</div>
      )}
      {session && <MetricsOverlay />}
    </div>
  );
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
