// The engine host's artifact store, as its register constructs it (the P3-A document's M2): the SQLite storage at
// `<userData>/artifacts/store.sqlite` and the document service over it, whose kind adapters follow each artifact's
// entity row. The store failing to open costs the artifacts, never the host: it is logged and the host serves its
// sessions without them (M4's `artifacts.status` surfaces the state).
import { join } from 'node:path';
import { DocumentService } from './service';
import { SqliteDocumentStorage } from './storage';

export interface Documents {
  readonly storage: SqliteDocumentStorage;
  readonly service: DocumentService;
  close(): void; // the open batch commits, every replica and connection closes, the file closes; idempotent
}

export function openDocuments(userData: string, log: (line: string) => void = (line) => console.error(`[documents] ${line}`)): Documents | null {
  let storage: SqliteDocumentStorage;
  try {
    storage = SqliteDocumentStorage.open(join(userData, 'artifacts', 'store.sqlite'), { log });
  } catch (error) {
    log(`the artifact store could not be opened; artifacts are unavailable this run: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const service = new DocumentService(storage, { kindOf: (artifactId) => storage.kindOf(artifactId), log });
  return {
    storage,
    service,
    close: () => {
      service.close();
      storage.close();
    },
  };
}
