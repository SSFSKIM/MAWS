// The engine's record of a slash command (`<command-name>/compact</command-name>`, then `<command-message>` and
// `<command-args>` in either order; pass3/compact's replay at seq 46 and its disk record): the command and its
// arguments on one line, as typed. Null for anything else, including a record with text outside its tags.
const COMMAND_TAG = /<(command-name|command-message|command-args)>([\s\S]*?)<\/\1>/g;

export function slashCommandLine(text: string): string | null {
  if (!text.includes('<command-name>')) return null;
  const parts = new Map<string, string>();
  const rest = text.replace(COMMAND_TAG, (_whole, tag: string, body: string) => (parts.set(tag, body), ''));
  const name = parts.get('command-name')?.trim();
  if (!name || rest.trim() !== '') return null;
  const args = parts.get('command-args')?.trim() ?? '';
  return args ? `${name} ${args}` : name;
}

