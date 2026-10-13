// sigkill.test.ts's child: the real storage and document service, written through an agent replica without waiting for
// each write (so writes are in flight whenever it is killed). Every few writes it waits for the durable ack and tells
// the parent the last token that ack covers and the revision it named. Runs until killed.
import type { AppSessionId } from '@shared/graph/ids';
import { DocumentService } from './service';
import { SqliteDocumentStorage } from './storage';

const storage = SqliteDocumentStorage.open(process.argv[2], { log: () => {} });
const service = new DocumentService(storage, { log: () => {} });
const replica = service.replica('app-kill' as AppSessionId, 'doc');
await replica.whenSynced();
const text = replica.doc.get('t');
for (let token = 0; ; token++) {
  text.insert(text.length, `<${token}>`);
  if (token % 4 === 3) {
    const revision = await replica.whenSaved();
    process.send!({ token, revision });
  } else {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
