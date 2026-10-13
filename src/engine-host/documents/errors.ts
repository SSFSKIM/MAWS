// The document store's typed refusals, shared by the storage, the document service and the artifact store.

// A write on a store a newer app wrote (the P3-A document's Decision Log 12): refused rather than corrupt the file.
export class StoreTooNewError extends Error {
  readonly code = 'storeTooNew';
  constructor(reason: string) {
    super(`the artifact store is read-only: ${reason}`);
  }
}

// An artifact-store operation refused for a reason its caller can act on (M4's IPC and M6's tools map `code` and `data`
// to their machine-readable refusals).
export type ArtifactStoreErrorCode =
  | 'notFound' // no such artifact, space, version or asset (or it is deleted)
  | 'invalid' // an input the store cannot take (a kind's wrong content, an unsafe name, a missing file)
  | 'tooLarge' // over X12's 16 MiB cap
  | 'handleTaken' // the creating session already has an artifact with that handle (Decision Log 3)
  | 'designSystemInUse'; // a design system that still governs live artifacts (Decision Log 22a)

export class ArtifactStoreError extends Error {
  constructor(
    readonly code: ArtifactStoreErrorCode,
    message: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
