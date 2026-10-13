// The document store's typed refusals, shared by the storage and the document service.

// A write on a store a newer app wrote (the P3-A document's Decision Log 12): refused rather than corrupt the file.
export class StoreTooNewError extends Error {
  readonly code = 'storeTooNew';
  constructor(reason: string) {
    super(`the artifact store is read-only: ${reason}`);
  }
}
