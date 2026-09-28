import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreFixture } from '../../../test/support/store-fixture';
import { readSpill, SPILL_DEFAULT_LENGTH } from './artifacts';

const S1 = '11111111-1111-4111-8111-111111111111';
const OUTSIDE = 'path outside the engine store';

describe('fs.readSpill reads engine artifacts by the path the engine reported', () => {
  let fixture: StoreFixture;
  let spill: string;
  beforeEach(async () => {
    fixture = await StoreFixture.create();
    await fixture.addTranscript('/work/a', S1, ['{"type":"queue-operation"}']);
    spill = await fixture.addSidecar(S1, 'tool-results/b95u0622n.txt', 'x'.repeat(3000));
  });
  afterEach(async () => {
    await fixture.dispose();
  });

  it('reads a spill whole, or a bounded window of it with truncated set and bytes the file size', async () => {
    expect(await readSpill(fixture.paths, { path: spill })).toEqual({ content: 'x'.repeat(3000), bytes: 3000, offset: 0, truncated: false });
    expect(await readSpill(fixture.paths, { path: spill, length: 1000 })).toEqual({ content: 'x'.repeat(1000), bytes: 3000, offset: 0, truncated: true });
    expect(await readSpill(fixture.paths, { path: spill, offset: 2500, length: 1000 })).toEqual({ content: 'x'.repeat(500), bytes: 3000, offset: 2500, truncated: false });
    expect(SPILL_DEFAULT_LENGTH).toBe(1024 * 1024);
  });

  it('reads task outputs and job files, the other two roots', async () => {
    const output = await fixture.addSidecar(S1, 'tasks/ad286defbc77bc090.output', 'ONE');
    expect((await readSpill(fixture.paths, { path: output })).content).toBe('ONE');
    const job = await fixture.addJob('bdb23713', { state: 'done', sessionId: S1 });
    expect((await readSpill(fixture.paths, { path: job })).content).toContain('"state":"done"');
  });

  it('refuses anything outside projects/, tasks/ and jobs/ under the config home, however the path is spelled', async () => {
    const outside = join(fixture.configHome, '..', 'outside.txt');
    await expect(readSpill(fixture.paths, { path: outside })).rejects.toThrow(OUTSIDE); // does not exist: refused, not "not found"
    await writeFile(join(fixture.configHome, 'settings.json'), '{}');
    await expect(readSpill(fixture.paths, { path: join(fixture.configHome, 'settings.json') })).rejects.toThrow(OUTSIDE);
    await expect(readSpill(fixture.paths, { path: join(fixture.paths.projects, '..', 'settings.json') })).rejects.toThrow(OUTSIDE);
    await expect(readSpill(fixture.paths, { path: 'projects/x.txt' })).rejects.toThrow(OUTSIDE); // relative
    // A symlink inside the store that points out of it is judged by its target.
    const link = join(dirname(spill), 'escape.txt');
    await symlink(join(fixture.configHome, 'settings.json'), link);
    await expect(readSpill(fixture.paths, { path: link })).rejects.toThrow(OUTSIDE);
  });

  it('reports a spill that is gone by its path', async () => {
    const missing = join(dirname(spill), 'gone.txt');
    await expect(readSpill(fixture.paths, { path: missing })).rejects.toThrow(`spill not found: ${missing}`);
    await mkdir(join(dirname(spill), 'dir.txt'));
    await expect(readSpill(fixture.paths, { path: join(dirname(spill), 'dir.txt') })).rejects.toThrow('not a file');
  });
});
