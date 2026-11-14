// UX wave U2 (O-29, O-15; the U2a document, Interfaces §B): what a run of calls, and a whole turn, did, in Claude
// Desktop's words and by its counting: its caption builder (`web/app/v1/c24951e9f-DKQNorfR.js` of app 5.1231.2; the
// kinds' words at :664-1000, the order at :1176-1183 and :1291-1337, a key's outcome at :615-623 and :1184-1186, the
// marks at :161-217 and :624-641, the calls of no kind at :1103-1123 and :1313-1334, the one-file part at :1227-1282,
// the cap at :137-138 and :247-302), with MAWS's three additions to its kinds (the shell's output, kill and monitor calls with the
// commands, LS with the file searches, the Task tools with the todos) and the turn's own steps (agents, sent messages).
import { stoppedMember } from './classify';
import { baseName } from './copy';
import type { Cell, ChangedLines, Row, SubagentRef, SubagentStatus } from './rows';

export type CaptionKind =
  | 'read' | 'create' | 'edit' | 'notebook' | 'command' | 'grep' | 'glob' | 'web_search' | 'web_fetch' | 'todos'
  | 'worktree_enter' | 'worktree_exit' | 'agent' | 'peer_message' | 'agent_message';
export type StepOutcome = 'succeeded' | 'failed' | 'stopped' | 'running';

// One thing a caption counts: a call, an agent, a sent message. `key` is what a part of a kind counts it by (a file's
// path, a recipient, an agent, else the call itself); `words` are a step of no kind's, its row's done label with the
// first letter lowered ('' for a step of a kind); `path` is a file step's.
export interface CaptionStep {
  kind: CaptionKind | null;
  key: string;
  words: string;
  outcome: StepOutcome;
  path: string | null;
}

// `count` is what the part counts (Desktop's): its keys for a part of a kind, its verbs for the one-file part, its calls
// for a part of no kind; the cap's `N more actions` sums it over the parts left out.
export interface CaptionPart {
  text: string;
  calls: number;
  count: number;
  changed: boolean;
  agent: boolean;
}

const counted = (one: string, several: (n: number) => string) => (n: number) => (n === 1 ? one : several(n));
const KIND_WORDS: Record<CaptionKind, (n: number) => string> = {
  read: counted('read a file', (n) => `read ${n} files`),
  create: counted('created a file', (n) => `created ${n} files`),
  edit: counted('edited a file', (n) => `edited ${n} files`),
  notebook: counted('edited a notebook', (n) => `edited ${n} notebooks`),
  command: counted('ran a command', (n) => `ran ${n} commands`),
  grep: () => 'searched code',
  glob: () => 'searched for files',
  web_search: counted('searched the web', (n) => `searched the web ${n} times`),
  web_fetch: counted('fetched a page', (n) => `fetched ${n} pages`),
  todos: () => 'updated todos',
  worktree_enter: counted('moved to a worktree', (n) => `moved to ${n} worktrees`),
  worktree_exit: counted('left the worktree', (n) => `left ${n} worktrees`),
  agent: counted('ran an agent', (n) => `ran ${n} agents`),
  peer_message: counted('messaged another session', (n) => `messaged ${n} other sessions`),
  agent_message: counted('messaged a subagent', (n) => `messaged ${n} subagents`),
};
// The kinds that name a file, and each one's verb when the steps of a run or a turn all name one file
const FILE_VERB: Partial<Record<CaptionKind, string>> = { read: 'read', create: 'created', edit: 'edited', notebook: 'edited' };
const CHANGED = new Set<CaptionKind>(['create', 'edit', 'notebook']);
const moreActions = (n: number) => (n === 1 ? 'and 1 more action' : `and ${n} more actions`);
const CAP_KEPT = 3; // Desktop's `ce`: from five parts on, the first three and the rest counted
const CAP_FROM = CAP_KEPT + 2;

const lowerFirst = (text: string) => (text.length === 0 ? text : text[0].toLowerCase() + text.slice(1));
const raiseFirst = (text: string) => (text.length === 0 ? text : text[0].toUpperCase() + text.slice(1));
// Desktop joins the verbs of one file by the locale's conjunction (`formatList`, type conjunction)
const conjunction = (items: readonly string[]) =>
  items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;

function kindOf(cell: Cell, writes: ReadonlyMap<string, string>): CaptionKind | null {
  switch (cell.toolName) {
    case 'Read': case 'NotebookRead': return 'read';
    // Desktop's `wrote`: the first Write of a file that finished decides whether its Writes created it or edited it;
    // until one finished, a Write creates
    case 'Write': {
      const path = pathOf(cell);
      return path !== null && writes.get(path) === 'update' ? 'edit' : 'create';
    }
    case 'Edit': case 'MultiEdit': return 'edit';
    case 'NotebookEdit': return 'notebook';
    // `TaskStop` stops a background task, a shell or an agent; 2.1.322 makes `KillShell` and `KillBash` its aliases
    // (`cli.pretty.js:103217, 751918`). The bundle shows no alias for `TaskOutput`; it lists it beside `BashOutput` and
    // `AgentOutput` (`:417594`). Both are commands, not todos, by the architect's ruling of 2026-11-13
    case 'Bash': case 'PowerShell': case 'BashOutput': case 'KillShell': case 'Monitor': case 'TaskOutput': case 'TaskStop': return 'command';
    case 'Grep': return 'grep';
    case 'Glob': case 'LS': return 'glob';
    case 'WebSearch': return 'web_search';
    case 'WebFetch': return 'web_fetch';
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': case 'TaskList': case 'TaskGet': return 'todos';
    // Desktop's `J`: a worktree call that failed has no kind
    case 'EnterWorktree': return cell.status === 'error' ? null : 'worktree_enter';
    case 'ExitWorktree': return cell.status === 'error' ? null : 'worktree_exit';
    default: return null;
  }
}

// A file call's path, by its detail. A read that returned image blocks is an image detail, whose caption is the path the
// call asked for (`detailOf` in cells.ts), so it is keyed by its file as any other read is.
function pathOf(cell: Cell): string | null {
  const { detail } = cell;
  const path = detail.kind === 'edit' ? detail.filePath : detail.kind === 'read' ? (detail.files[0]?.path ?? '') : detail.kind === 'image' ? (detail.caption ?? '') : '';
  return path === '' ? null : path;
}

function outcomeOf(status: Cell['status']): StepOutcome {
  switch (status) {
    case 'done': return 'succeeded';
    case 'error': return 'failed';
    case 'running': return 'running';
    default: return 'stopped';
  }
}

// A refused call that stands alone (denied, auto-denied, or auto mode unavailable) is no step: the turn's line counts it
const standsAlone = (cell: Cell) => cell.classification.denial !== null && !stoppedMember(cell.classification.denial);

function writesOf(cells: readonly Cell[]): Map<string, string> {
  const writes = new Map<string, string>();
  for (const cell of cells) {
    if (cell.toolName !== 'Write' || cell.status !== 'done' || cell.detail.kind !== 'edit' || writes.has(cell.detail.filePath)) continue;
    writes.set(cell.detail.filePath, cell.detail.change);
  }
  return writes;
}

function stepOf(cell: Cell, writes: ReadonlyMap<string, string>): CaptionStep {
  const kind = kindOf(cell, writes);
  const path = kind !== null && FILE_VERB[kind] !== undefined ? pathOf(cell) : null;
  const call = cell.toolUseId ?? cell.id;
  return { kind, key: path ?? call, words: kind === null ? lowerFirst(cell.doneLabel ?? cell.label) : '', outcome: outcomeOf(cell.status), path };
}

// A run's steps: its calls, in order; thoughts and refused calls that stand alone give none.
export function stepsOfCells(cells: readonly Cell[]): CaptionStep[] {
  const writes = writesOf(cells);
  return cells.filter((cell) => cell.toolName !== 'thinking' && !standsAlone(cell)).map((cell) => stepOf(cell, writes));
}

const AGENT_OUTCOME: Record<SubagentStatus, StepOutcome> = { started: 'running', working: 'running', finished: 'succeeded', finished_with_errors: 'failed', stopped: 'stopped' };

// What a message the turn sent did, read from the sending call's own result by the turn's derivation (its drawn row
// keeps no such fact): its outcome, or `null` for a call refused and standing alone, which is no step.
export type SentOutcome = (row: Extract<Row, { kind: 'agent_message' }>) => StepOutcome | null;

// A turn's steps (decision 8), from the rows of its work in order: every call of its runs and of its rows that are
// cells, but the refused ones that stand alone; each agent of its subagent rows, but one a message of this turn
// re-started, by its own status; and each message it sent to a subagent or to another session, by recipient, by its
// call's own outcome, but the refused ones that stand alone. Arrivals, questions and thoughts are no steps. A re-start
// (the architect's ruling on M5, (G) narrowed): live, an agent the turn messaged starts again under the sending call's
// id; `restarts` holds the turn's own calls that launch nothing (presentation not `subagent`), and a ref whose start
// names one of them is no step, the call being the step. A ref whose start names a launching call of the turn, a call
// the turn does not hold (a nested agent) or none counts.
export function stepsOfTurn(rows: readonly Row[], restarts: ReadonlySet<string>, agentStatus: (ref: SubagentRef) => SubagentStatus, sent: SentOutcome): CaptionStep[] {
  const writes = writesOf(rows.flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : [])));
  const steps: CaptionStep[] = [];
  const step = (kind: CaptionKind, key: string, outcome: StepOutcome | null) => {
    if (outcome !== null) steps.push({ kind, key, words: '', outcome, path: null });
  };
  for (const row of rows) {
    if (row.kind === 'group' || row.kind === 'cell') {
      for (const cell of row.kind === 'group' ? row.cells : [row]) if (cell.toolName !== 'thinking' && !standsAlone(cell)) steps.push(stepOf(cell, writes));
    } else if (row.kind === 'subagent') {
      for (const ref of row.agents) if (ref.toolUseId === null || !restarts.has(ref.toolUseId)) step('agent', ref.taskId, AGENT_OUTCOME[agentStatus(ref)]);
    } else if (row.kind === 'agent_message' && row.direction === 'to_child') {
      // a recipient this transcript does not know is counted by its message, its own recipient
      step('agent_message', row.to?.agentId ?? row.to?.taskId ?? row.id, sent(row));
    } else if (row.kind === 'agent_message' && row.direction === 'between' && row.peer?.recipient) {
      step('peer_message', row.peer.recipient.address, sent(row));
    }
  }
  return steps;
}

// Desktop's `X`: a key keeps the outcome of its latest step, but a stopped step does not replace an outcome it already
// has, and a step still running clears it until it ends.
function settle(outcome: StepOutcome | undefined, next: StepOutcome): StepOutcome | undefined {
  if (next === 'stopped' && outcome !== undefined) return outcome;
  return next === 'running' ? undefined : next;
}

function marks(failed: number, stopped: number): string {
  if (failed === 0 && stopped === 0) return '';
  if (stopped === 0) return ` (${failed} failed)`;
  if (failed === 0) return ` (${stopped} stopped)`;
  return ` (${failed} failed, ${stopped} stopped)`;
}

const countOf = (outcomes: Iterable<StepOutcome | undefined>, of: StepOutcome) => [...outcomes].filter((outcome) => outcome === of).length;

// A run's parts, in Desktop's order: the parts of the kinds in the order each kind first occurred, then the parts of
// no kind in the order each label first occurred. When every file step names the same one file, the file parts are one
// part that names it, at the first file part's place.
export function captionParts(steps: readonly CaptionStep[]): CaptionPart[] {
  const kinds = new Map<CaptionKind, { keys: Map<string, StepOutcome | undefined>; calls: number }>();
  const unkinded = new Map<string, { calls: number; failed: number; stopped: number }>();
  const fileSteps: CaptionStep[] = [];
  const paths = new Set<string>();
  let everyFileNamed = true;
  for (const step of steps) {
    if (step.kind === null) {
      const part = unkinded.get(step.words) ?? { calls: 0, failed: 0, stopped: 0 };
      part.calls += 1;
      if (step.outcome === 'failed') part.failed += 1;
      if (step.outcome === 'stopped') part.stopped += 1;
      unkinded.set(step.words, part);
      continue;
    }
    const part = kinds.get(step.kind) ?? { keys: new Map(), calls: 0 };
    part.calls += 1;
    part.keys.set(step.key, settle(part.keys.get(step.key), step.outcome));
    kinds.set(step.kind, part);
    if (FILE_VERB[step.kind] === undefined) continue;
    fileSteps.push(step);
    if (step.path === null) everyFileNamed = false;
    else paths.add(step.path);
  }
  const oneFile = everyFileNamed && paths.size === 1 ? [...paths][0] : null;
  const parts: CaptionPart[] = [];
  let fileMerged = false;
  for (const [kind, part] of kinds) {
    if (oneFile !== null && FILE_VERB[kind] !== undefined) {
      if (!fileMerged) parts.push(oneFilePart(fileSteps, oneFile));
      fileMerged = true;
      continue;
    }
    const outcomes = [...part.keys.values()];
    parts.push({ text: KIND_WORDS[kind](part.keys.size) + marks(countOf(outcomes, 'failed'), countOf(outcomes, 'stopped')), calls: part.calls, count: part.keys.size, changed: CHANGED.has(kind), agent: kind === 'agent' });
  }
  for (const [words, part] of unkinded) {
    parts.push({ text: (part.calls > 1 ? `${words} ${part.calls} times` : words) + marks(part.failed, part.stopped), calls: part.calls, count: part.calls, changed: false, agent: false });
  }
  return parts;
}

// The verbs of one file in the order they first occurred (an edit and a notebook edit are one verb), then its name; a
// mark counts the verbs whose outcome for the file is failed or stopped (Desktop's `ne`).
function oneFilePart(steps: readonly CaptionStep[], path: string): CaptionPart {
  const verbs = new Map<string, StepOutcome | undefined>();
  for (const step of steps) {
    const verb = FILE_VERB[step.kind!]!;
    verbs.set(verb, settle(verbs.get(verb), step.outcome));
  }
  const outcomes = [...verbs.values()];
  const text = `${conjunction([...verbs.keys()])} ${baseName(path)}${marks(countOf(outcomes, 'failed'), countOf(outcomes, 'stopped'))}`;
  return { text, calls: steps.length, count: verbs.size, changed: [...verbs.keys()].some((verb) => verb !== 'read'), agent: false };
}

// The turn's order (O-15): the parts that changed files first, then agents, then the rest, each in its run order.
export function turnOrder(parts: readonly CaptionPart[]): CaptionPart[] {
  return [...parts.filter((part) => part.changed), ...parts.filter((part) => !part.changed && part.agent), ...parts.filter((part) => !part.changed && !part.agent)];
}

// The parts joined by `, `, the first letter raised; capped, from five parts on, at the first three and one more item,
// `and N more actions`, N the sum of the left-out parts' counts (Desktop's `oe` and its joiner; the architect's ruling of
// 2026-11-13). '' for no part.
export function captionText(parts: readonly CaptionPart[], cap: boolean): string {
  if (parts.length === 0) return '';
  const capped = cap && parts.length >= CAP_FROM;
  const items = capped ? [...parts.slice(0, CAP_KEPT).map((part) => part.text), moreActions(parts.slice(CAP_KEPT).reduce((n, part) => n + part.count, 0))] : parts.map((part) => part.text);
  return raiseFirst(items.join(', '));
}

// The lines the finished edits among these cells added and removed: a failed, stopped or still running edit changed
// nothing yet, and a call in the background holds nothing back.
export function finishedLines(cells: readonly Cell[]): ChangedLines {
  let added = 0;
  let removed = 0;
  for (const cell of cells) {
    if (cell.status !== 'done' || cell.detail.kind !== 'edit') continue;
    added += cell.detail.added;
    removed += cell.detail.removed;
  }
  return { added, removed };
}
