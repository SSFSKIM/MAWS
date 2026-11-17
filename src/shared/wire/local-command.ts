// The engine's record of a slash command (`<command-name>/compact</command-name>`, then `<command-message>` and
// `<command-args>` in either order; pass3/compact's replay at seq 46 and its disk record): the command and its
// arguments on one line, as typed. Null for anything else, including a record with text outside its tags.
const COMMAND_TAG = /<(command-name|command-message|command-args)>([\s\S]*?)<\/\1>/g;
export const COMMAND_NAME_OPENING = '<command-name>';
// UX wave U1c, the review round's R4: the openings of a local command's output as the engine records it (a `!` command's
// replayed `<bash-stdout>` and `<bash-stderr>`, a slash command's `<local-command-stdout>` and `<local-command-stderr>`;
// pass2/bash-context-echoed, uxwave/u3-commands-r1), which composed-forms.ts claims
export const LOCAL_COMMAND_OUTPUT_OPENINGS = ['<bash-stdout>', '<bash-stderr>', '<local-command-stdout>', '<local-command-stderr>'] as const;
// A slash command as typed, before the engine records it (UX wave U6e, the reader of the person's own text): `/` and a
// command's name (letters, digits, `-`, `_`, `.`, `:`), then white space or the end. A path names no command: its first
// segment runs into a second `/`.
export const TYPED_COMMAND = /^\/[A-Za-z0-9][\w.:-]*(?:\s|$)/;

export function slashCommandLine(text: string): string | null {
  if (!text.includes(COMMAND_NAME_OPENING)) return null;
  const parts = new Map<string, string>();
  const rest = text.replace(COMMAND_TAG, (_whole, tag: string, body: string) => (parts.set(tag, body), ''));
  const name = parts.get('command-name')?.trim();
  if (!name || rest.trim() !== '') return null;
  const args = parts.get('command-args')?.trim() ?? '';
  return args ? `${name} ${args}` : name;
}
