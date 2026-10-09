// The browser tabs' memory (E4a execution document, Design §2 and §12; Decision Log 5 and 6). Each loaded tab is a
// renderer process of the app's own, outside the engine host's budget (which sums engine process trees and would release
// an engine session to make room for a web page). Main samples `app.getAppMetrics()` every 15 s while any tab is loaded,
// matches each tab's renderer by pid, and writes its working set into the tab (`memoryKiB`), from which the renderer's
// Session info reports the tabs' weight beside the budget.
//
// The same sample enforces the soft cap: while the loaded tabs' renderers together exceed BROWSER_TABS_MEMORY_MAX_MIB,
// the least recently shown eligible tab (the count cap's own rule, `TabStore.capVictim`: unplaced, idle, not loading, not
// downloading) is suspended (cua #90: an internal tab closed, `TabStore.evict`) and its session told, one notice per
// suspension. A notice from this cap carries no `count`,
// which is how the chrome tells it from the count cap's. With nothing eligible, nothing is suspended; nothing is ever
// force-closed. Two tabs that share a renderer are one process: counted once.
import type { ProcessMetric } from 'electron';
import { BROWSER_TABS_MEMORY_MAX_MIB } from '@shared/browser/tab';
import type { BrowserEmit, TabEntry, TabStore } from './tabs';

export const MEMORY_SAMPLE_MS = 15_000;
const MEMORY_MAX_KIB = BROWSER_TABS_MEMORY_MAX_MIB * 1024;

export interface MemorySamplerDeps {
  store: Pick<TabStore, 'all' | 'update' | 'evict' | 'capVictim' | 'onViewCreated'>;
  emit: BrowserEmit;
  metrics(): { pid: ProcessMetric['pid']; memory: { workingSetSize: number } }[]; // app.getAppMetrics; KiB
}

export class MemorySampler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly unhook: () => void;

  constructor(private readonly deps: MemorySamplerDeps) {
    this.unhook = deps.store.onViewCreated(() => this.start());
  }

  // One sample: every loaded tab's working set written, then the soft cap applied.
  sample(): void {
    const { store } = this.deps;
    const loaded = store.all().filter((entry) => entry.view !== null);
    if (loaded.length === 0) return;
    const workingSets = new Map(this.deps.metrics().map((metric) => [metric.pid, Math.round(metric.memory.workingSetSize)]));
    const pids = new Map<TabEntry, number>();
    for (const entry of loaded) {
      const pid = rendererPid(entry);
      const memoryKiB = pid === null ? null : (workingSets.get(pid) ?? null);
      if (pid !== null && memoryKiB !== null) pids.set(entry, pid);
      if (entry.tab.memoryKiB !== memoryKiB) store.update(entry.tab.tabId, { memoryKiB });
    }
    this.enforceCap(pids);
  }

  stop(): void {
    this.unhook();
    this.pause();
  }

  // ---- internals ------------------------------------------------------------------------------------------------------

  private start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), MEMORY_SAMPLE_MS);
  }

  private pause(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    if (this.deps.store.all().every((entry) => entry.view === null)) return this.pause();
    this.sample();
  }

  // `sampled`: the loaded tabs whose renderer was measured, by pid.
  private enforceCap(sampled: Map<TabEntry, number>): void {
    const { store, emit } = this.deps;
    while (total(sampled) > MEMORY_MAX_KIB) {
      const victim = store.capVictim();
      if (!victim) return;
      const { tabId, appSessionId } = victim.tab;
      sampled.delete(victim);
      // cua #90: an internal tab is closed instead, and its session told without the tab that is gone
      const closed = store.evict(tabId) === 'closed';
      emit('browser.notice', { appSessionId, tabId: closed ? null : tabId, kind: 'tabsCap' });
    }
  }
}

// The sum over distinct renderers (two same-site tabs may share one).
function total(sampled: Map<TabEntry, number>): number {
  const seen = new Set<number>();
  let sum = 0;
  for (const [entry, pid] of sampled) {
    if (seen.has(pid)) continue;
    seen.add(pid);
    sum += entry.tab.memoryKiB ?? 0;
  }
  return sum;
}

function rendererPid(entry: TabEntry): number | null {
  const wc = entry.view?.webContents;
  if (!wc || wc.isDestroyed()) return null;
  const pid = wc.getOSProcessId();
  return pid > 0 ? pid : null;
}
