// The X12 mirror (the P3-A document's Decision Log 4): one version per call, however many times the call's mirror runs.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import { FileDeliverableStore } from '../deliverables/store';
import { X12Mirror } from './x12-mirror';

const OWNER = 'app-owner' as AppSessionId;
const ID = '0b5e1c2d-3a4f-4b6c-8d7e-9f0a1b2c3d4e';
let dir: string;
let deliverables: FileDeliverableStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-mirror-'));
  deliverables = new FileDeliverableStore(dir);
  writeFileSync(join(dir, 'page.html'), '<p/>');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the X12 mirror', () => {
  it('appends one version per tool-use id, deduplicated inside the record’s write chain', async () => {
    const mirror = new X12Mirror({ deliverables });
    await mirror.page({ id: ID, title: 'D', handle: 'dash' }, OWNER, { path: join(dir, 'page.html') }, 'toolu_c' as ToolUseId);
    const both = await Promise.all([1, 2].map(() => mirror.pageVersion(ID, OWNER, OWNER, 'D', join(dir, 'page.html'), 'toolu_p' as ToolUseId)));
    expect(both).toEqual([2, 2]);
    expect((await deliverables.get(OWNER, ID))!.versions.map((v) => v.toolUseId)).toEqual(['toolu_c', 'toolu_p']);
  });

  it('writes a page’s and a file’s record once, however many mirrors race', async () => {
    const written: string[] = [];
    const announced = new FileDeliverableStore(dir, { onWritten: (record, change) => written.push(`${record.id}:${change}`) });
    const mirror = new X12Mirror({ deliverables: announced });
    await Promise.all([1, 2].map(() => mirror.page({ id: ID, title: 'D' }, OWNER, { path: join(dir, 'page.html') }, 'toolu_c' as ToolUseId)));
    const FILE = '1c6f2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
    await Promise.all([1, 2].map(() => mirror.files([{ id: FILE, path: join(dir, 'page.html'), title: 'page.html' }], OWNER, undefined, 'toolu_f' as ToolUseId)));
    expect(written).toEqual([`${ID}:created`, `${FILE}:created`]);
  });
});
