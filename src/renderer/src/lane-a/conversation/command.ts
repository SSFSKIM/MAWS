// Slash parsing preserves listed names verbatim (including an MCP prompt's suffix). A path and a lone slash are words.
import type { Catalog } from 'desk-hub/protocol';
export type TypedCommand = { name: string; args: string };
export function parseCommand(text: string, catalog?: Catalog | null): TypedCommand | null {
  const input = text.trim();
  const listed = catalog?.commands.filter((c) => input.startsWith(`/${c.name}`) && (input.length === c.name.length + 1 || /\s/.test(input[c.name.length + 1])))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (listed) return { name: listed.name, args: input.slice(listed.name.length + 1).trim() };
  const typed = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(input);
  return typed ? { name: typed[1], args: (typed[2] ?? '').trim() } : null;
}
