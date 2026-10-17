// P3-E2 M2 (ledger X23 as amended by parent Decision Log 8): `artifacts.readDataset {artifactId, ref, format, offset?,
// limit?}` over the real store, as the runtime calls it (input validated, output checked against the registry): a page
// of the snapshot read as the format asked, refusals typed (a ref the artifact does not hold is `notFound`), the format
// required, a limit above the page bound refused before the store is reached.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DATASET_READ_MAX_ROWS } from '@artifacts/dashboard/datasets';
import { HostCommandError, type HostOn } from '@shared/host/runtime';
import type { CommandName, CommandOutput } from '@shared/ipc/schema';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import { openDocuments, type Documents } from '../documents';
import { registerArtifacts } from '../documents/register';

let dir: string;
let documents: Documents;
let handlers: Map<string, (input: unknown) => Promise<unknown>>;
let surface: { close(): void };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-read-ipc-'));
  documents = openDocuments(dir, () => {})!;
  handlers = new Map();
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  surface = registerArtifacts(on, () => true, { onDocPort: () => {} }, { documents, env: {} });
});
afterEach(() => {
  surface.close();
  documents.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call<N extends CommandName>(name: N, input: unknown): Promise<CommandOutput<N>> {
  const checked = validateCommandInput(name, input);
  if (!checked.ok) throw new Error(`invalid input for ${name}`);
  const value = await handlers.get(name)!(checked.value);
  const output = validateCommandOutput(name, value);
  if (!output.ok) throw new Error(`invalid output of ${name}: ${JSON.stringify(output.error.issues).slice(0, 400)}`);
  return output.value as CommandOutput<N>;
}

describe('artifacts.readDataset', () => {
  it('answers a page of the snapshot as the format asked, and refuses a ref the artifact does not hold', async () => {
    const human = { kind: 'human' } as const;
    const board = await documents.store.create({ kind: 'dashboard', title: 'Board' }, human);
    const other = await documents.store.create({ kind: 'dashboard', title: 'Other' }, human);
    const { ref } = await documents.store.uploadAsset(board.id, new TextEncoder().encode('a,b\tc\n1,2\t3\n4,5\t6\n'), { name: 'data.csv', mime: 'text/csv' }, human);
    expect(await call('artifacts.readDataset', { artifactId: board.id, ref, format: 'csv' })).toEqual({
      columns: [
        { name: 'a', type: 'number' },
        { name: 'b\tc', type: 'string' },
      ],
      rows: [
        [1, '2\t3'],
        [4, '5\t6'],
      ],
      total: 2,
      truncated: false,
    });
    expect(await call('artifacts.readDataset', { artifactId: board.id, ref, format: 'tsv', offset: 1, limit: 1 })).toMatchObject({ columns: [{ name: 'a,b' }, { name: 'c' }], rows: [['4,5', 6]], total: 2, truncated: false });
    const refused = await call('artifacts.readDataset', { artifactId: other.id, ref, format: 'csv' }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(HostCommandError);
    expect((refused as HostCommandError).ipcError).toMatchObject({ code: 'invalid_input', issues: { reason: 'notFound' } });
  });

  it('takes the format as required and a limit only up to the page bound', () => {
    const artifactId = '11111111-1111-4111-8111-111111111111';
    expect(validateCommandInput('artifacts.readDataset', { artifactId, ref: 'assets/a.csv' }).ok).toBe(false);
    expect(validateCommandInput('artifacts.readDataset', { artifactId, ref: 'assets/a.csv', format: 'xlsx' }).ok).toBe(false);
    expect(validateCommandInput('artifacts.readDataset', { artifactId, ref: 'assets/a.csv', format: 'json', limit: DATASET_READ_MAX_ROWS }).ok).toBe(true);
    expect(validateCommandInput('artifacts.readDataset', { artifactId, ref: 'assets/a.csv', format: 'json', limit: DATASET_READ_MAX_ROWS + 1 }).ok).toBe(false);
  });
});
