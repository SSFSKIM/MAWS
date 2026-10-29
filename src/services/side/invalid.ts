// A side command's input main refuses (E3 execution document, Design §9): `path` names the field relative to the
// comment (`side.sendToMain`'s input, `side.thread.open`'s `from`), so the registration answers `invalid_input` with the
// command's own path, and no other refusal is ever read as one of these fields.
export class InvalidSideInput extends Error {
  constructor(
    readonly path: string[],
    message: string,
  ) {
    super(message);
    this.name = 'InvalidSideInput';
  }
}
