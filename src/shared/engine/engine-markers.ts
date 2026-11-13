// Two texts the engine writes itself into a session's user rows and frames, read alike by the live normaliser, the disk
// backfill, the remote reader and the arrivals reader (UX wave U3, UC-2): the marker an interrupt leaves, and the tags a
// slash command's output travels in, which the normaliser and the backfill also write back (`localCommandText`). Pure.

// The engine's marker after an interrupt (`pass2/per-task-stop-on` seq 65; `… for tool use` in `per-task-stop-off`
// seq 71): any bracketed words after "[Request interrupted by user", whole.
export const INTERRUPT_MARKER = /^\[Request interrupted by user[^\]]*\]$/;

// The engine's local-command echo (`/model`, `/status` and the like): its output in `<local-command-stdout>` or
// `<local-command-stderr>`, after the `<local-command-caveat>` that tells the model what follows.
export const LOCAL_COMMAND_TAG = /<local-command-(stdout|stderr|caveat)>([\s\S]*?)<\/local-command-\1>/g;

/**
 * Slash commands' outputs written back in the engine's own tags, the inverse of `localCommandParts`: each output's
 * stdout, then its stderr, each in the tag that says which, one line between them; an output with neither is an empty
 * stdout tag, so a command that printed nothing still has its row.
 */
export function localCommandText(outputs: readonly { stdout: string; stderr: string }[]): string {
  return outputs
    .flatMap(({ stdout, stderr }) => [
      ...(stdout !== '' || stderr === '' ? [`<local-command-stdout>${stdout}</local-command-stdout>`] : []),
      ...(stderr !== '' ? [`<local-command-stderr>${stderr}</local-command-stderr>`] : []),
    ])
    .join('\n');
}

/**
 * A slash command's output, the text of each of its two tags joined: null unless the text is those tags and nothing
 * else, with an output tag among them (a caveat alone is no output). The texts are as written, not trimmed.
 */
export function localCommandParts(text: string): { stdout: string; stderr: string } | null {
  const matches = [...text.matchAll(LOCAL_COMMAND_TAG)];
  if (text.replace(LOCAL_COMMAND_TAG, '').trim() !== '' || !matches.some((match) => match[1] !== 'caveat')) return null;
  const of = (tag: string) => matches.filter((match) => match[1] === tag).map((match) => match[2]!).join('\n');
  return { stdout: of('stdout'), stderr: of('stderr') };
}
