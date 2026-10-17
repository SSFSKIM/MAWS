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

import { ExporterRegistry, startExportService, type Exporter, type ExportServiceDeps } from './export';

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
    answer: async (input) => void answered.push(input),
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
