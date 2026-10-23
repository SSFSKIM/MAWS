// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b; E's Decision Log 48 (3)): a dashboard's export
// captures its state and a hold over every snapshot that state names in one host read (`artifacts.captureDatasetState`,
// the live state or a version's), never `artifacts.state` then a later read, and releases the hold when the run ends,
// whether it wrote its file or failed. Other kinds keep their reads.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { MawsArtifactExport } from '@shared/ipc/schema/maws';
import type { AppSessionId, RequestId } from '@shared/graph/ids';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

import { existsSync } from 'node:fs';
import { EXPORT_BUDGET_MS, ExporterRegistry, startExportService, type Exporter, type ExportServiceDeps } from './export';

const BOARD = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const HOLD = '00000000-0000-4000-8000-0000000000a1';
const bytes = (text: string) => new TextEncoder().encode(text);
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maws-export-hold-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function world(run: Exporter['run']) {
  const log: string[] = [];
  const answered: unknown[] = [];
  const listeners: ((request: MawsArtifactExport) => void)[] = [];
  const call = async (name: CommandName, input: unknown): Promise<CommandResult<CommandName>> => {
    const answer = (value: unknown) => ({ ok: true, value }) as CommandResult<CommandName>;
    log.push(name);
    switch (name) {
      case 'artifacts.get':
        return answer({ artifact: { id: BOARD, kind: 'dashboard', title: 'Board', revision: 7 } });
      case 'artifacts.captureDatasetState': {
        const { versionId } = input as { versionId?: number };
        return answer({ revision: versionId === undefined ? 7 : 5, bytes: bytes(versionId === undefined ? 'live@7' : `version ${versionId}`), assetHoldId: HOLD });
      }
      case 'artifacts.releaseAssets':
        expect(input).toEqual({ assetHoldId: HOLD });
        return answer({ released: true });
      default:
        throw new Error(`unexpected ${name}`);
    }
  };
  const registry = new ExporterRegistry();
  registry.register({ kind: 'dashboard', format: 'md', run });
  const deps: ExportServiceDeps = {
    registry,
    root,
    call: call as ExportServiceDeps['call'],
    onEvent: (_name, listener) => {
      listeners.push(listener);
      return () => {};
    },
    answer: async (input) => {
      answered.push(input);
      return { ok: true, value: { outcome: 'delivered' } };
    },
    print: async () => bytes('%PDF'),
  };
  return { deps, log, answered, emit: (request: MawsArtifactExport) => listeners.forEach((listener) => listener(request)) };
}
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(check()).toBe(true);
};

describe('a dashboard export’s capture (E3)', () => {
  it('captures the live state with its hold in one read, and releases the hold after the run', async () => {
    const seen: string[] = [];
    const w = world(async (request, context) => {
      seen.push(new TextDecoder().decode(await context.state()));
      w.log.push('run');
      await context.writeFile(request.path, '# Board');
    });
    const service = startExportService(w.deps);
    const { revision } = await service.exportForLibrary({ artifactId: BOARD, format: 'md' });
    expect(revision).toBe(7);
    expect(seen).toEqual(['live@7']);
    expect(w.log).toEqual(['artifacts.get', 'artifacts.get', 'artifacts.captureDatasetState', 'run', 'artifacts.releaseAssets']);
    expect(w.log).not.toContain('artifacts.state');
    service.stop();
  });

  it('captures a version’s state the same way, and releases the hold when the run fails', async () => {
    const w = world(async (_request, context) => {
      await context.state();
      throw new Error('the exporter failed');
    });
    const service = startExportService(w.deps);
    w.emit({ appSessionId: 'App-A' as AppSessionId, requestId: 'r1' as RequestId, artifactId: BOARD, kind: 'dashboard', format: 'md', revision: 5, versionId: 3, path: join(root, BOARD, 'exports', '5-md.md') });
    await until(() => w.answered.length === 1);
    expect(w.answered[0]).toMatchObject({ answer: { ok: false } });
    expect(w.log).toContain('artifacts.captureDatasetState');
    expect(w.log).not.toContain('artifacts.versionState');
    expect(w.log.at(-1)).toBe('artifacts.releaseAssets');
    service.stop();
  });
});

// E3 M1 fix wave (task review finding 6; the architect's restart ruling): a host restart between a dashboard export's
// capture and the end of its run leaves its hold's ownership stale, whether the run failed or not. The export then
// captures once more (a live export the latest state, a versioned one the same version, else it is unavailable) and runs
// once more; a second restart answers a failure, never a third run.
function restarting(run: Exporter['run'], options: { versionGone?: boolean } = {}) {
  let generation = 0;
  let captures = 0;
  const log: string[] = [];
  const call = async (name: CommandName, input: unknown): Promise<CommandResult<CommandName>> => {
    const answer = (value: unknown) => ({ ok: true, value }) as CommandResult<CommandName>;
    log.push(name);
    if (name === 'artifacts.get') return answer({ artifact: { id: BOARD, kind: 'dashboard', title: 'Board', revision: 7 } });
    if (name === 'artifacts.captureDatasetState') {
      captures += 1;
      const { versionId } = input as { versionId?: number };
      if (versionId !== undefined && options.versionGone && captures > 1) return { ok: false, error: { code: 'invalid_input', message: `no version ${versionId} of ${BOARD}`, issues: { reason: 'notFound', data: {} } } } as CommandResult<CommandName>;
      return answer({ revision: versionId === undefined ? 6 + captures : 5, bytes: bytes(versionId === undefined ? `live@${6 + captures}` : `version ${versionId}`), assetHoldId: `00000000-0000-4000-8000-00000000000${captures}` });
    }
    if (name === 'artifacts.releaseAssets') return answer({ released: true });
    if (name === 'artifacts.versions') return answer({ versions: [{ id: 3, seq: 5 }] });
    throw new Error(`unexpected ${name}`);
  };
  const registry = new ExporterRegistry();
  registry.register({ kind: 'dashboard', format: 'md', run });
  const deps: ExportServiceDeps = { registry, root, call: call as ExportServiceDeps['call'], onEvent: () => () => {}, answer: async () => ({ ok: true, value: { outcome: 'delivered' } }), print: async () => bytes('%PDF'), hostGeneration: () => generation };
  return { deps, log, restart: () => void (generation += 1), captures: () => captures };
}

describe('a dashboard export across a host restart (E3)', () => {
  it('a live export whose run succeeded across a restart captures the latest once more and answers that run', async () => {
    const seen: string[] = [];
    const w = restarting(async (request, context) => {
      seen.push(new TextDecoder().decode(await context.state()));
      if (seen.length === 1) w.restart(); // between the capture and the run's last read
      await context.writeFile(request.path, '# Board');
    });
    const service = startExportService(w.deps);
    const { revision } = await service.exportForLibrary({ artifactId: BOARD, format: 'md' });
    expect(seen).toEqual(['live@7', 'live@8']);
    expect(revision).toBe(8);
    expect(w.log.filter((name) => name === 'artifacts.releaseAssets')).toHaveLength(2);
    service.stop();
  });

  it('a versioned export recaptures the same version, and answers it unavailable when the version is gone', async () => {
    const w = restarting(async (_request, context) => {
      await context.state();
      w.restart();
      throw new Error('the snapshot assets/q1.json could not be read: the engine host is restarting');
    }, { versionGone: true });
    const service = startExportService(w.deps);
    await expect(service.exportForLibrary({ artifactId: BOARD, format: 'md', versionId: 3 })).rejects.toThrow(/no version 3/);
    expect(w.captures()).toBe(2);
    service.stop();
  });

  it('a second restart during the one retry answers a failure, never a third run', async () => {
    let runs = 0;
    const w = restarting(async (request, context) => {
      runs += 1;
      await context.state();
      w.restart();
      await context.writeFile(request.path, '# Board');
    });
    const service = startExportService(w.deps);
    await expect(service.exportForLibrary({ artifactId: BOARD, format: 'md' })).rejects.toThrow(/restarted/);
    expect(runs).toBe(2);
    service.stop();
  });
});

// E3 M1 residual correction (re-review): the retry across a host restart lives inside the export's one budget, counted
// from its receipt (queue, capture and both runs): what is left of it is the retry's, never a fresh budget. A retry with
// nothing left is answered, by name, without a second capture; one that runs out publishes nothing.
describe('a dashboard export’s retry within its one budget (E3)', () => {
  it('a retry gets only what is left of the budget, and one that overruns it publishes nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      let runs = 0;
      const w = restarting(async (request, context) => {
        runs += 1;
        await context.state();
        if (runs === 1) {
          w.restart();
          vi.advanceTimersByTime(EXPORT_BUDGET_MS - 500); // the first run took nearly all of the budget
        } else vi.advanceTimersByTime(1_000); // the retry overruns what was left
        await context.writeFile(request.path, '# Board');
      });
      const service = startExportService(w.deps);
      await expect(service.exportForLibrary({ artifactId: BOARD, format: 'md' })).rejects.toThrow(/did not finish within/);
      expect(runs).toBe(2);
      expect(existsSync(join(root, BOARD, 'exports', '8-md.md'))).toBe(false); // the retry's file: never published late
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a restart that leaves no budget is answered by name, without a second capture', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const w = restarting(async (request, context) => {
        await context.state();
        w.restart();
        vi.advanceTimersByTime(EXPORT_BUDGET_MS); // the whole budget, spent in the first run
        await context.writeFile(request.path, '# Board');
      });
      const service = startExportService(w.deps);
      await expect(service.exportForLibrary({ artifactId: BOARD, format: 'md' })).rejects.toThrow(/restarted.*no time was left/);
      expect(w.captures()).toBe(1);
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
