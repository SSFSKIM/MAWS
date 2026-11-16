// A mention's text form, the one writer of a mention onto the wire (the serialiser, schema.ts's node and the uploads'
// notices all call it). Pure and import-free, so the guard of who sends as the person (test/support/person-sends.test.ts)
// runs the real writer.

// UX wave U1c (the review of rule R, F2): a mention is the one place a name a model may have written (a file's path, which
// a model with a shell can create; an agent's name) goes onto the wire outside any frame. A line break in it would put a
// line of the model's choosing into the person's message, so no control character goes out: each becomes U+FFFD, which
// is no separator and keeps the mention one token. The intake refuses such a path where it can say so (paste.ts).
export const MENTION_BREAKS = /[\p{Cc}\u2028\u2029]/u; // C0 (LF, CR, tab among them), DEL, C1 (NEL among them), the line and paragraph separators
const BREAKS = new RegExp(MENTION_BREAKS.source, 'gu');

// A mention's text form: `@<path>` (quoted when the path holds whitespace, the terminal's form) or `@agent-<name>`, the
// form the engine's agent-mention producer recognises.
export function mentionText({ id, kind }: { id: string; kind: 'file' | 'agent' }): string {
  const text = kind === 'agent' ? `@agent-${id}` : /\s/.test(id) ? `@"${id}"` : `@${id}`;
  return text.replace(BREAKS, '\ufffd');
}
