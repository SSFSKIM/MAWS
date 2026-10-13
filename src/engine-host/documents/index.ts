// The engine host's artifact store, as its register constructs it (the P3-A document's M2 and M3): the SQLite storage at
// `<userData>/artifacts/store.sqlite`, the document service over it, whose kind adapters follow each artifact's entity
// row, and the artifact store over both, with its nightly maintenance scheduled. The store failing to open costs the
// artifacts, never the host: it is logged and the host serves its sessions without them (M4's `artifacts.status`
// surfaces the state).
import { join } from 'node:path';
import { DocumentService } from './service';
import { SqliteDocumentStorage } from './storage';
import { ArtifactStore } from './store';

export interface Documents {
  readonly storage: SqliteDocumentStorage;
  readonly service: DocumentService;
  readonly store: ArtifactStore;
  close(): void; // the open batch commits, every replica and connection closes, the file closes; idempotent
}

export function openDocuments(userData: string, log: (line: string) => void = (line) => console.error(`[documents] ${line}`)): Documents | null {
  const root = join(userData, 'artifacts');
  let storage: SqliteDocumentStorage;
  try {
    storage = SqliteDocumentStorage.open(join(root, 'store.sqlite'), { log });
  } catch (error) {
    log(`the artifact store could not be opened; artifacts are unavailable this run: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const service = new DocumentService(storage, { kindOf: (artifactId) => storage.kindOf(artifactId), log });
  const store = new ArtifactStore(service, storage, { root, log });
  store.maintenance.start();
  return {
    storage,
    service,
    store,
    close: () => {
      store.close();
      service.close();
      storage.close();
    },
  };
}
