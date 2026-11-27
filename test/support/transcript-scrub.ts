// A recorded session's transcript scrubbed for the repository, as test/fixtures/lane-a/README.md describes: the engine's
// request bookkeeping rows and the attachments that carry the machine's environment dropped, each child re-chained past
// them; the project's path made /work/demo, the rest of the scratch /work/scratch, the home /Users/me; the account's
// name (standing alone, in free text as in metadata: an `ls -l` listing's owner, `user@host`) made "me" and the
// machine's name "studio"; hook commands hook-<n>, request ids and references req_scrubbed, signatures scrubbed. The
// question sheet's live check (e2e/sheet-live.rig.ts) records through it, and `remainingNames` says what still names
// the account, the machine or the scratch, so a recording that leaks fails where it is made.
import { basename } from 'node:path';

export interface ScrubNames {
  project: string; // the project's directory, as the engine ran in it
  scratch: string; // the run's scratch root, which holds the project
  home: string; // the account's home directory
  account: string; // the account's name
  host: string; // the machine's name, as os.hostname() gives it
}
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Row = Record<string, unknown>;

const BOOKKEEPING = /^(api-request.*|atis-latch|last-prompt|cost-state|queue-operation|file-history-snapshot)$/;
const ENVIRONMENT = new Set([
  'instructions', 'skill_listing', 'agent_listing', 'agent_listing_delta', 'system_prompt_snapshot', 'prompt_snapshot', 'output_style',
  'deferred_tools', 'deferred_tool_list', 'deferred_tools_delta', 'deferred_tools_record', 'environment', 'session_context', 'model', 'date',
  'remote_session_change', 'mcp_instructions', 'mcp_instructions_delta', 'nested_memory', 'memory', 'claude_md', 'plan_mode', 'todo_reminder',
  'date_change', 'critical_system_reminder', 'total_tokens_reminder',
]);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The name standing alone: not inside a longer word, path segment or identifier. Case as given. */
const alone = (name: string) => new RegExp(`(?<![A-Za-z0-9_-])${escape(name)}(?![A-Za-z0-9_-])`, 'g');
const hostLabel = (host: string) => host.split('.')[0]!;
/** A path in both the forms macOS gives a scratch under /tmp: its real path and its /tmp one. */
const forms = (path: string) => (path.startsWith('/private/') ? [path, path.slice('/private'.length)] : [path]);

function rewrite(text: string, names: ScrubNames): string {
  let out = text;
  for (const project of forms(names.project)) out = out.replaceAll(project, '/work/demo');
  for (const scratch of forms(names.scratch)) out = out.replaceAll(scratch, '/work/scratch');
  out = out.replaceAll(names.home, '/Users/me');
  out = out.replaceAll(names.host, 'studio').replace(alone(hostLabel(names.host)), 'studio');
  return out.replace(alone(names.account), 'me');
}

export function scrubTranscript(rows: readonly Row[], names: ScrubNames): Row[] {
  const dropped = new Map<string, unknown>();
  const kept: Row[] = [];
  for (const row of rows) {
    const attachment = row.type === 'attachment' ? (row.attachment as { type?: string } | undefined) : undefined;
    if (BOOKKEEPING.test(String(row.type ?? '')) || (attachment?.type !== undefined && ENVIRONMENT.has(attachment.type))) {
      if (typeof row.uuid === 'string') dropped.set(row.uuid, row.parentUuid ?? null);
    } else kept.push(row);
  }
  const chained = (parent: unknown): unknown => {
    let at = parent;
    while (typeof at === 'string' && dropped.has(at)) at = dropped.get(at);
    return at;
  };
  const hooks = new Map<string, string>();
  const walk = (value: Json, key: string | null, inHook: boolean): Json => {
    if (typeof value === 'string') {
      if (key === 'signature') return 'scrubbed';
      if (key === 'requestId' || key === 'requestRef') return 'req_scrubbed';
      if (key === 'command' && inHook) {
        if (!hooks.has(value)) hooks.set(value, `hook-${hooks.size + 1}`);
        return hooks.get(value)!;
      }
      return rewrite(value, names);
    }
    if (Array.isArray(value)) return value.map((item) => walk(item, key, inHook));
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k, inHook || /^hook/i.test(k))]));
    return value;
  };
  return kept.map((row) => {
    const out = walk(row as Json, null, false) as Row;
    if ('parentUuid' in row) out.parentUuid = chained(row.parentUuid) as Json;
    return out;
  });
}

/** What of the account, the machine or the scratch still stands in `text`, by name, once each. */
export function remainingNames(text: string, names: ScrubNames): string[] {
  const checks: [string, RegExp][] = [
    [names.account, alone(names.account)],
    [hostLabel(names.host), alone(hostLabel(names.host))],
    [basename(names.scratch), new RegExp(escape(basename(names.scratch)), 'g')],
  ];
  return checks.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
