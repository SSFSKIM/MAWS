// The scale gate's host seam (M9 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; Acceptance 6): requested only
// under MAWS_E2E=1 and MAWS_DOCUMENT_PERF=1; it seeds a document over the host's first tab, runs agent sessions' document
// tools through their real `call` (the read, then batches from the revision the session last saw), measures the host's
// event loop around each call, answers the heap after a collection, and ends a session's replicas; commands arrive as
// files in `<userData>/document-perf/in` and are answered in `out`.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedDoc, TAB } from '@artifacts/document/writer.fixture';
import { listTabs } from '@artifacts/document/tabs';
import { DocIndex } from '@artifacts/document/block-index';
import { stateV2 } from '@artifacts/yjs';
import { HUMAN, openDocumentWorld, type DocumentWorld } from './document-world.fixture';
import { DocumentPerfSeam, documentPerfSeamRequested, startDocumentPerfSeam, type CallAnswer } from './document-perf';

let world: DocumentWorld;
beforeEach(() => {
  world = openDocumentWorld();
});
afterEach(() => world.close());

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** An owner-made document once the host wrote its first tab (the kind's `created` listener). */
async function emptyDocument(): Promise<string> {
  const { id } = await world.store.create({ kind: 'document', title: 'Scale' }, HUMAN);
  for (let k = 0; k < 50 && listTabs(world.service.live(id)).length === 0; k++) await settle();
  expect(listTabs(world.service.live(id))).toHaveLength(1);
  return id;
}

describe('documentPerfSeamRequested', () => {
  it('is requested only under both the e2e mark and the scale flag', () => {
    expect(documentPerfSeamRequested({ MAWS_E2E: '1', MAWS_DOCUMENT_PERF: '1' })).toBe(true);
    expect(documentPerfSeamRequested({ MAWS_E2E: '1' })).toBe(false);
    expect(documentPerfSeamRequested({ MAWS_DOCUMENT_PERF: '1' })).toBe(false);
    expect(documentPerfSeamRequested({ MAWS_E2E: '0', MAWS_DOCUMENT_PERF: '1' })).toBe(false);
  });
});

describe('the seam’s commands', () => {
  it('seeds a document over its first tab: the seed’s tabs only, as the human', async () => {
    const id = await emptyDocument();
    const seam = new DocumentPerfSeam(world.store);
    const answer = await seam.run({ cmd: 'seed', artifactId: id, state: Buffer.from(stateV2(seedDoc())).toString('base64') });
    expect(answer).toMatchObject({ ok: true });
    expect(listTabs(world.service.live(id)).map((tab) => tab.id)).toEqual([TAB]);
    expect((answer as { revision: number }).revision).toBe(world.store.revision(id));
  });

  it('runs a session’s read and a batch from the revision it last saw, measuring the host’s loop around each call', async () => {
    const id = await emptyDocument();
    const seam = new DocumentPerfSeam(world.store);
    await seam.run({ cmd: 'seed', artifactId: id, state: Buffer.from(stateV2(seedDoc())).toString('base64') });
    const read = (await seam.run({ cmd: 'call', session: 'perf-agent-1', tool: 'artifact_read', args: { artifact: id } })) as CallAnswer & { result: { revision: number; markdown: string } };
    expect(read).toMatchObject({ ok: true, isError: false });
    expect(read.result.markdown).toContain('^');
    expect(read.wallMs).toBeGreaterThan(0);
    expect(read.loop.max).toBeGreaterThanOrEqual(0);
    expect(DocIndex.of(world.service.live(id)).find('p1')).toBeTruthy(); // the seed's paragraph the batch inserts after
    const edit = (await seam.run({ cmd: 'call', session: 'perf-agent-1', tool: 'artifact_edit', args: { artifact: id, baseRevision: 'last', ops: [{ op: 'insert', after: 'p1', markdown: 'Inserted by the seam.' }] } })) as CallAnswer & { result: { revision: number } };
    expect(edit).toMatchObject({ ok: true, isError: false });
    expect(edit.result.revision).toBeGreaterThan(read.result.revision);
    expect(world.store.revision(id)).toBe(edit.result.revision);
    // the batch was the session's: its replica exists until the session is released
    const released = await seam.run({ cmd: 'release', session: 'perf-agent-1' });
    expect(released).toMatchObject({ ok: true });
  });

  it('answers a refusal as the tool’s error text, not a seam failure', async () => {
    const id = await emptyDocument();
    const seam = new DocumentPerfSeam(world.store);
    const answer = (await seam.run({ cmd: 'call', session: 'perf-agent-1', tool: 'artifact_edit', args: { artifact: id, baseRevision: 0, ops: [{ op: 'delete', id: 'nope' }] } })) as CallAnswer;
    expect(answer).toMatchObject({ ok: true, isError: true });
    expect(answer.text).toContain('nope');
  });

  it('answers the heap after a collection', async () => {
    const seam = new DocumentPerfSeam(world.store);
    const answer = (await seam.run({ cmd: 'heap' })) as { ok: true; heapUsed: number; rss: number; collected: boolean };
    expect(answer.ok).toBe(true);
    expect(answer.heapUsed).toBeGreaterThan(0);
    expect(answer.rss).toBeGreaterThan(answer.heapUsed);
    expect(answer.collected).toBe(true);
  });

  it('answers an unknown command as a failure naming it', async () => {
    const seam = new DocumentPerfSeam(world.store);
    expect(await seam.run({ cmd: 'nope' } as never)).toEqual({ ok: false, error: 'unknown command "nope"' });
  });
});

describe('the file channel', () => {
  it('answers each command file in `out` under the same name, in arrival order', async () => {
    const dir = join(world.dir, 'document-perf');
    const seam = startDocumentPerfSeam(world.store, dir);
    try {
      const send = (name: string, command: unknown) => {
        writeFileSync(join(dir, 'in', `${name}.tmp`), JSON.stringify(command));
        renameSync(join(dir, 'in', `${name}.tmp`), join(dir, 'in', `${name}.json`));
      };
      expect(existsSync(join(dir, 'in'))).toBe(true);
      mkdirSync(join(dir, 'out'), { recursive: true });
      send('000001', { cmd: 'heap' });
      send('000002', { cmd: 'nope' });
      const answerOf = async (name: string) => {
        for (let k = 0; k < 200; k++) {
          const path = join(dir, 'out', `${name}.json`);
          if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
          await settle();
        }
        throw new Error(`no answer ${name}`);
      };
      expect(await answerOf('000001')).toMatchObject({ ok: true });
      expect(await answerOf('000002')).toEqual({ ok: false, error: 'unknown command "nope"' });
      expect(existsSync(join(dir, 'in', '000001.json'))).toBe(false);
    } finally {
      seam.close();
    }
  });
});
