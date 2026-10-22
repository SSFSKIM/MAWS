// The latency readout (`latency.ts`), drawn only while it is on: a small fixed panel listing each path measured so far
// with its n, p50, p95 and max in ms (a path with no sample yet takes no row, so the panel stays small enough to read a
// phone around it), and the reconnect counts. It reads the recorder at most twice a second, so a burst of samples (a
// response streaming) costs one render, not one per sample.
import { useEffect, useState } from 'react';
import { COUNTS, latency, PATHS, type LatencyCount, type LatencyPath, type LatencyReport } from './latency';

const EVERY_MS = 500;

export function LatencyOverlay() {
  const [report, setReport] = useState<LatencyReport>(() => latency.report());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = latency.subscribe(() => {
      timer ??= setTimeout(() => {
        timer = null;
        setReport(latency.report());
      }, EVERY_MS);
    });
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
  const ms = (value: number) => (Number.isFinite(value) ? String(Math.round(value)) : '–');
  return (
    <aside
      className="pointer-events-none fixed bottom-2 left-2 z-50 rounded-md border border-border bg-bg-overlay px-2 py-1.5 font-mono text-ui-sm text-fg shadow-lg"
      aria-label="Latency readout"
      data-testid="latency-overlay"
    >
      <table className="border-separate border-spacing-x-2">
        <thead className="text-fg-muted">
          <tr>
            <th className="text-left font-normal">path (ms)</th>
            <th className="text-right font-normal">n</th>
            <th className="text-right font-normal">p50</th>
            <th className="text-right font-normal">p95</th>
            <th className="text-right font-normal">max</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(PATHS) as LatencyPath[]).map((path) => {
            const stats = report.paths[path];
            if (!stats) return null;
            return (
              <tr key={path} title={PATHS[path]}>
                <td>{path}</td>
                <td className="text-right">{stats.n}</td>
                <td className="text-right">{ms(stats.p50)}</td>
                <td className="text-right">{ms(stats.p95)}</td>
                <td className="text-right">{ms(stats.max)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="m-0 mt-1 text-fg-muted">{(Object.keys(COUNTS) as LatencyCount[]).map((name) => `${name} ${report.counts[name] ?? 0}`).join(' · ')}</p>
    </aside>
  );
}
