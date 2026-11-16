// A mention's text form, the one writer of a mention onto the wire (the serialiser, schema.ts's node and the uploads'
// notices all call it). Pure and import-free, so the guard of who sends as the person (test/support/person-sends.test.ts)
// runs the real writer.

// A mention's text form: `@<path>` (quoted when the path holds whitespace, the terminal's form) or `@agent-<name>`, the
// form the engine's agent-mention producer recognises.
export function mentionText({ id, kind }: { id: string; kind: 'file' | 'agent' }): string {
  if (kind === 'agent') return `@agent-${id}`;
  return /\s/.test(id) ? `@"${id}"` : `@${id}`;
}
