// A mention's text form, the one writer of a mention onto the wire (the serialiser, schema.ts's node and the uploads'
// notices all call it), and the one writer of a slash command's name into a draft. Pure, importing only the grant's
// module (itself import-free), so the guard of who sends as the person (test/support/person-sends.test.ts) runs the real
// writers.
import { LINE_OR_CONTROL, nameSlot } from '@shared/engine/grant';

// UX wave U1c (the review of rule R, F2): a mention is the one place a name a model may have written (a file's path, which
// a model with a shell can create; an agent's name) goes onto the wire outside any frame. A line break in it would put a
// line of the model's choosing into the person's message, so no control character goes out: each becomes U+FFFD, which
// is no separator and keeps the mention one token. The intake refuses such a path where it can say so (paste.ts).
// The class is the one copy a name's slot reads too (ticket 733a, `nameSlot`): C0 (LF, CR, tab among them), DEL, C1 (NEL
// among them), the line and paragraph separators.
export const MENTION_BREAKS = LINE_OR_CONTROL;

// A mention's text form: `@<path>` (quoted when the path holds whitespace, the terminal's form) or `@agent-<name>`, the
// form the engine's agent-mention producer recognises. Ticket 733a (its document, Design 3): the name goes by the name's
// rule, so it holds no line and a name that quotes the grant's opening is left out, `(a name left out by MAWS)` in its
// place (quoted, as a path holding whitespace is).
export function mentionText({ id, kind }: { id: string; kind: 'file' | 'agent' }): string {
  const name = nameSlot(id);
  return kind === 'agent' ? `@agent-${name}` : /\s/.test(name) ? `@"${name}"` : `@${name}`;
}

// Ticket 733a: a skill's or a command's name as the composer writes it into a draft, `/<name> ` (the `@` menu's skill row,
// the slash palette's row, the Skills widget's "Use in chat"); the name a catalogue, and so a plugin or a model, gave
// goes by the name's rule.
export const slashText = (name: string): string => `/${nameSlot(name)} `;
