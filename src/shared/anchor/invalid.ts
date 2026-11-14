// A side command's input main refuses (E3 execution document, Design §9): `path` names the field relative to the
// comment (`side.sendToMain`'s input, `side.thread.open`'s `from`), so the registration answers `invalid_input` with the
// command's own path, and no other refusal is ever read as one of these fields. UX wave U5a: moved here from
// src/services/side/ with the screenshot's reader (./screenshot.ts), which main's `side.comment.content` reads too.
export class InvalidSideInput extends Error {
  constructor(
    readonly path: (string | number)[], // an array's index a number, as in a schema's issue (UX wave U5a: `more.0.screenshot`)
    message: string,
  ) {
    super(message);
    this.name = 'InvalidSideInput';
  }
}
