// The custom connector's form (docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, "The form's fields",
// "Secrets", "A name the engine empties", §D): from the typed fields, the page's scope and what is configured here to the
// entry Add sends, or each field's first problem in §E's words. Pure: the sheet and the tests read these, and the later
// landing that opens the sheet filled in (`customFieldsOf`). Every rule is §A's (`splitArgs`, `mcpEntryProblem`,
// `isMcpName` through `nameProblem`, the reserved-name predicate, `existingOf`, `remoteEmptiedNamesIn`); none is added
// here. The one thing the form changes is the command, whose end spaces it drops; every other field goes into the entry
// as typed, and a row with neither a name nor a value is not sent.
import type { CustomizationServer } from '@shared/ipc/schema/customization';
import { splitArgs } from '@shared/plugins/argv-split';
import { mcpEntryProblem, type McpEntry, type McpEntryAdd, type McpEntryProblem, type McpPair, type PluginsScope } from '@shared/plugins/cli';
import { remoteEmptiedNamesIn } from '@shared/plugins/remote-emptied-names';
import { isReservedServerName } from '@shared/engine/app-mcp-servers';
import { CONNECTORS as C } from './copy';
import { existingOf, nameProblem, type ConfiguredServers } from './present';

export type CustomType = McpEntry['type'];
export type RowsField = 'headers' | 'env';

/** What the person typed: both types' fields, kept while the sheet is open; only the chosen type's are sent. */
export interface CustomFields {
  name: string;
  type: CustomType;
  url: string; // the two remote types
  headers: readonly McpPair[];
  command: string; // a local command
  args: string; // one line, split as a shell splits words
  env: readonly McpPair[];
  scope: PluginsScope;
}

export interface RowCheck {
  problem: string | null;
  emptied: string[]; // a header's value: the names Claude Code sends to a remote server as empty
}

export interface CustomCheck {
  name: string | null; // the name's problem
  existing: CustomizationServer | null; // the entry that already holds the name, once what is configured here is read
  url: string | null;
  urlEmptied: string[];
  command: string | null;
  commandHasSpace: boolean; // a note, not a problem: the command is taken whole
  args: { ok: true; words: string[] } | { ok: false; problem: string };
  argsProblem: string | null; // a bound the split words break
  rowsField: RowsField; // the chosen type's rows
  rows: RowCheck[]; // by the row's index among the chosen type's rows
  rowsProblem: string | null; // too many rows
  sharedWarning: boolean; // the project's .mcp.json, with a header or a variable filled in
  entryProblem: string | null; // the whole entry too large
  entry: McpEntry | null; // what Add sends, when every field holds
}

const remote = (type: CustomType): type is 'http' | 'sse' => type !== 'stdio';
const isEmptyRow = ({ name, value }: McpPair) => name === '' && value === '';

// A field is checked alone, beside stand-ins every rule of §A accepts, so each field's first problem is found whatever
// the others hold; the whole entry is checked last, for its size.
const STAND_IN = { url: 'http://x', command: 'x' } as const;

// A control character, or a bound: what is over and the limit (R11). A row's name over its length is §A's `name`, not a
// bound, so it reads as the name's rule.
function boundWords(problem: McpEntryProblem): string {
  if (problem.code === 'control') return C.controlCharacter;
  if (problem.code === 'too-large') return C.tooLarge;
  if (problem.code === 'too-many') return problem.field === 'headers' ? C.tooManyHeaders : problem.field === 'env' ? C.tooManyVariables : C.tooManyArgs;
  switch (problem.field) {
    case 'url':
      return C.urlTooLong;
    case 'command':
      return C.commandTooLong;
    case 'args':
      return C.argTooLong((problem.index ?? 0) + 1);
    default:
      return C.valueTooLong; // a header's or a variable's value
  }
}

function urlWords(url: string, problem: McpEntryProblem | null): string | null {
  if (problem === null) return null;
  if (problem.code === 'url') return url === '' ? C.urlRequired : C.urlScheme;
  return boundWords(problem);
}

function commandWords(problem: McpEntryProblem | null): string | null {
  if (problem === null) return null;
  return problem.code === 'empty' ? C.commandRequired : boundWords(problem);
}

function rowWords(field: RowsField, pair: McpPair, problem: McpEntryProblem): string {
  switch (problem.code) {
    case 'name':
      return pair.name === '' ? C.rowNameMissing[field] : C.rowNameRule[field];
    case 'duplicate':
      return C.rowDuplicate[field](pair.name);
    default:
      return boundWords(problem);
  }
}

// Each sent row's first problem: a row is checked after the rows before it that hold, so a duplicate is the later row's.
function rowProblems(field: RowsField, sent: readonly McpPair[], probe: (pairs: McpPair[]) => McpEntryProblem | null): (McpEntryProblem | null)[] {
  const holding: McpPair[] = [];
  return sent.map((pair) => {
    const problem = probe([...holding, pair]);
    if (problem !== null && problem.field === field && problem.index === holding.length) return problem;
    holding.push(pair);
    return null;
  });
}

export function checkCustom(fields: CustomFields, servers: readonly CustomizationServer[] | null): CustomCheck {
  const { type } = fields;
  const nameWrong = nameProblem(fields.name) ?? (isReservedServerName(fields.name) ? C.reserved : null);
  const existing = nameWrong === null && servers !== null ? existingOf(fields.name, servers) : null;
  const rowsField: RowsField = remote(type) ? 'headers' : 'env';
  const typed = remote(type) ? fields.headers : fields.env;
  const pairs = typed.map(({ name, value }) => ({ name, value })); // exactly a pair: the command's schema is strict
  const sent = pairs.filter((pair) => !isEmptyRow(pair));
  const probe = (rows: McpPair[]) => (remote(type) ? mcpEntryProblem({ type, url: STAND_IN.url, headers: rows }) : mcpEntryProblem({ type, command: STAND_IN.command, args: [], env: rows }));
  const problems = rowProblems(rowsField, sent, probe);
  const whole = probe(sent);
  const rowsProblem = whole !== null && whole.field === rowsField && whole.code === 'too-many' ? boundWords(whole) : null;
  let at = 0;
  const rows: RowCheck[] = pairs.map((pair) => {
    const emptied = remote(type) ? remoteEmptiedNamesIn(pair.value) : [];
    if (isEmptyRow(pair)) return { problem: null, emptied };
    const problem = problems[at];
    at += 1;
    return { problem: problem ? rowWords(rowsField, pair, problem) : null, emptied };
  });

  const url = remote(type) ? urlWords(fields.url, mcpEntryProblem({ type, url: fields.url, headers: [] })) : null;
  const command = fields.command.trim();
  const commandWrong = remote(type) ? null : commandWords(mcpEntryProblem({ type, command, args: [], env: [] }));
  const split = splitArgs(fields.args);
  const args: CustomCheck['args'] = split.ok ? { ok: true, words: split.args } : { ok: false, problem: split.problem === 'trailing-backslash' ? C.argsBackslash : C.argsOpenQuote };
  const argsBound = !remote(type) && split.ok ? mcpEntryProblem({ type, command: STAND_IN.command, args: split.args, env: [] }) : null;
  const argsProblem = argsBound && boundWords(argsBound);

  const fieldsHold = url === null && commandWrong === null && (remote(type) || (args.ok && argsProblem === null)) && rows.every((row) => row.problem === null) && rowsProblem === null;
  const built: McpEntry | null = !fieldsHold ? null : remote(type) ? { type, url: fields.url, headers: sent } : { type, command, args: split.ok ? split.args : [], env: sent };
  const wholeProblem = built && mcpEntryProblem(built);
  return {
    name: nameWrong,
    existing,
    url,
    urlEmptied: remote(type) ? remoteEmptiedNamesIn(fields.url) : [],
    command: commandWrong,
    commandHasSpace: !remote(type) && command.includes(' '),
    args,
    argsProblem,
    rowsField,
    rows,
    rowsProblem,
    sharedWarning: fields.scope === 'project' && pairs.some((pair) => !isEmptyRow(pair)),
    entryProblem: wholeProblem ? boundWords(wholeProblem) : null,
    entry: wholeProblem ? null : built,
  };
}

/** The request's input Add confirms, `{ name, scope, entry }`, or null while a field fails, the name is taken, or what
 * is configured here has not been read whole. */
export function customInputOf(fields: CustomFields, check: CustomCheck, configured: ConfiguredServers): McpEntryAdd | null {
  if (check.entry === null || check.name !== null || configured.state !== 'read' || check.existing !== null) return null;
  return { name: fields.name, scope: fields.scope, entry: check.entry };
}

/** The input Details builds the shown line from (`argvOf`, which puts `•••` in every value slot), whatever is configured
 * here: Add's input but for the name check against what is configured. */
export const customDetailsInputOf = (fields: CustomFields, check: CustomCheck): McpEntryAdd | null => (check.entry === null || check.name !== null ? null : { name: fields.name, scope: fields.scope, entry: check.entry });

// A word as a shell reads it back with `splitArgs`: as it is when nothing in it is special, else single-quoted.
const argWord = (arg: string): string => (/^[\w@%+=:,./~-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`);

/** The fields a request opens the sheet with: its entry's, the other type's empty. */
export function customFieldsOf(input: McpEntryAdd): CustomFields {
  const { entry } = input;
  const base = { name: input.name, scope: input.scope, url: '', headers: [], command: '', args: '', env: [] };
  if (entry.type === 'stdio') return { ...base, type: entry.type, command: entry.command, args: entry.args.map(argWord).join(' '), env: entry.env };
  return { ...base, type: entry.type, url: entry.url, headers: entry.headers };
}

/** What is configured here as Add may rely on it: the opening's read, once it answered and no read is out; until then
 * Add waits, since an older answer vouches for nothing (it may be 30 s old, and a terminal's change is not heard). */
export function configuredSinceOpening(answered: boolean, read: { isFetching: boolean; configured: ConfiguredServers }): ConfiguredServers {
  return answered && !read.isFetching ? read.configured : { state: 'reading' };
}

/** The scopes "Add to" offers: all projects alone on the user configuration's page; a project's two only on its page. */
export const addToScopes = (cwd: string | null): PluginsScope[] => (cwd === null ? ['user'] : ['user', 'local', 'project']);

export const addToWords = (scope: PluginsScope, place: string): string => (scope === 'user' ? C.allProjects : scope === 'local' ? C.projectOnly(place) : C.projectShared(place));
