// A slash command as typed in a session's composer (the desk control surface spec, 2026-10-22, M0): `/<name>` and the
// text after it. The name runs to the first space and never holds a slash, so a path (`/Users/new/notes.md is …`) and a
// lone slash are words. Which class the command is, and whether it runs, is the bridge's to say (its route table);
// the web never decides it.

export type TypedCommand = { name: string; args: string };

export function parseCommand(text: string): TypedCommand | null {
  const typed = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return typed ? { name: typed[1], args: (typed[2] ?? '').trim() } : null;
}
