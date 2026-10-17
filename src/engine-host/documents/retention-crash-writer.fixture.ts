// retention-crash.test.ts's child (E3 M1 fix wave): the real store with the dashboard kind registered. It publishes three
// query snapshots (the first retired by the third), holds the retired one, reports the refs, and on the parent's word
// publishes a fourth that kills the process inside its own write frame, after its retention ran and before any commit.
import { randomUUID } from 'node:crypto';
import { setDataset } from '@artifacts/dashboard/datasets';
import type { Actor } from '@shared/artifacts/actor';
import { registerDashboards } from '../dashboards';
import { openDocuments } from '.';

const documents = openDocuments(process.argv[2]!, () => {})!;
registerDashboards({ documents });
const human: Actor = { kind: 'human' };

function refresh(artifactId: string, content: string, crash = false): Promise<string> {
  let ref = '';
  const at = Date.now();
  return documents.store
    .writeWithAssets(
      artifactId,
      human,
      [{ bytes: new TextEncoder().encode(content), name: `query-${randomUUID()}.json`, mime: 'application/json', querySnapshot: true }],
      (doc, refs) => {
        ref = refs[0]!.ref;
        setDataset(doc, 'live', { title: 'Live', source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: { ref, at } }, columns: [{ name: 'v', type: 'number' }], rows: 1, updated: { at, by: human }, state: { status: 'ok', at } });
      },
      {
        inFrame: (revision) => {
          documents.store.retainQuerySnapshots(artifactId, 'live', ref, revision);
          if (crash) process.kill(process.pid, 'SIGKILL'); // the retirement of `a` is in this frame, uncommitted
        },
      },
    )
    .then(() => ref);
}

const { id } = await documents.store.create({ kind: 'dashboard', title: 'Board' }, human);
const x = await refresh(id, '[{"v":0}]');
const a = await refresh(id, '[{"v":1}]');
const b = await refresh(id, '[{"v":2}]'); // x retired: a and b are the latest two
documents.store.holdAsset(id, x); // held when the process dies: a hold lives no longer than its process
process.on('message', () => void refresh(id, '[{"v":3}]', true));
process.send!({ id, x, a, b });
