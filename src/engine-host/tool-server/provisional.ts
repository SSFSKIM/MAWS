// P4-A2 (X35, the editors' provisional layer; docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.2's four rules
// [binding]; this child's execution document, docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md, R1 and R5 to
// R9): the host's half of "the edit shown as it is written". One emitter per session reads each artifact call's input as
// it streams (the `assistant.block.delta` events of a `maws` tool_use block, joined to the call by the block's id) and
// tells every open port of the target doc what the call will write, as far as it parses (`ArtifactProvisional`):
//
//   streaming  per batch tick (PROVISIONAL_TICK_MS, longer for a long input: INPUT_PER_MS), only when the ops changed;
//              sent now (`DocumentService.broadcast`), since it reveals nothing of the store
//   committed  from the write's own frame (`committed`, called by the tool), queued ahead of the write's update frames
//              (`DocumentService.announceWrite`), naming the row the edit's own transaction is, which its update
//              carries as its seq (rows the kind's hooks append after it reveal nothing the layer stands for)
//   dropped    on every other ending (R8): the tool's refusal or failure (`withProvisional`), a `tool.result` no commit
//              preceded (the engine denied the call, or the model abandoned it), the turn's end, the process's exit;
//              and from the write's frame when the write changed nothing (`uncommitted`): no row will carry a seq to
//              wait for, so the layer goes at once
//
// From the tick in which `artifact` resolves, the session's replica of the doc shows the agent editing the blocks the
// ops name so far (R6), held as a batch's outline is (`holdPresence`); an `artifact_edit` commit takes it over (the
// tool's cursor and its 4 s hold), any other ending releases it to the idle name. A `replace_text` without `block` is
// placed on the first top-level block whose text holds its quote once the quote is whole (R5). In suggest mode, or when
// the owner takes agent edits as suggestions, the layer is the suggestion doc's; a `mode: 'suggest'` read late moves it
// there, dropped on the main doc (R7). Nothing here writes a doc, a row or a version (rule 1), and nothing here throws
// into a tool: a failure is logged and the layer is left to the call's ending.
import { DocIndex } from '@artifacts/document/block-index';
import { needleOf } from '@artifacts/document/edit-plan';
import { stripMilestones } from '@artifacts/document/markdown';
import { encodeFrame } from '@artifacts/provider/frames';
import { actorDisplay, type Actor } from '@shared/artifacts/actor';
import { isDocKind, type ArtifactKind } from '@shared/artifacts/entity';
import { isProvisionalTool, PROVISIONAL_TICK_MS, ProvisionalOpSchema, type ArtifactProvisional, type ProvisionalOp, type ProvisionalTool } from '@shared/artifacts/provisional';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import { readPartialJson } from '@shared/maws/partial-json';
import { MAWS_SERVER_NAME } from '@shared/maws/tools';
import type { AgentReplica } from '../documents/replica';
import type { ArtifactStore } from '../documents/store';

// An input past this is no longer read (the layer stays as it was); the call itself is the tool's to refuse.
const MAX_INPUT = 2 * 1024 * 1024;
// A tick reads the whole input (the reader reads about 35 KB a millisecond on the MacBook), so a long input is read
// less often: its ticks are spaced by its length over this, about four times its reading, which keeps the reading to
// about a fifth of the host's loop (a 1 MB input every 125 ms); an input under 128 KB is read every PROVISIONAL_TICK_MS.
const INPUT_PER_MS = 8_000;
const MAWS_PREFIX = `mcp__${MAWS_SERVER_NAME}__`; // the engine's name for a `maws` tool, as its tool_use block carries it

// Whose ops stream to the renderers: the document batch's, which the document editor draws (M5). A publish's files and
// a dataset's id are not drawn until G2 (the slide, design and dashboard layers), so until then their input is read
// only until its target resolves (presence from the first delta, which needs the `artifact` key alone) and no further:
// re-reading a whole-deck publish at every tick and decoding its frame on every connection of the doc, the host's own
// agent replicas included, would cost the host loop and the open editor for nothing visible (the hand-back review).
// G2 flips the flag per kind it draws; `opsOf` already reads the files and the id.
const STREAMS_OPS: Record<ProvisionalTool, boolean> = { artifact_edit: true, artifact_publish: false, artifact_dataset: false };

// The kinds each call writes; another kind's call is refused by its tool, so it shows nothing.
const WRITES: Record<ProvisionalTool, (kind: ArtifactKind) => boolean> = {
  artifact_edit: (kind) => kind === 'document' || kind === 'dashboard',
  artifact_publish: (kind) => isDocKind(kind) && kind !== 'document' && kind !== 'dashboard',
  artifact_dataset: (kind) => kind === 'dashboard',
};

export interface ProvisionalEmitterDeps {
  store: () => ArtifactStore | null; // the host's store; null when it failed to open
  appSessionId: AppSessionId;
  artifactScope?: readonly AppSessionId[]; // P2-E1: a side thread's ancestors, which `artifact` also resolves over
  log?: (line: string) => void;
  onFrame?: (frame: ArtifactProvisional) => void; // every frame as sent (the perf seam counts them)
}

type Path = (string | number)[];

interface Call {
  toolUseId: ToolUseId;
  tool: ProvisionalTool;
  buffer: string;
  timer: ReturnType<typeof setTimeout> | null;
  started: boolean; // its `tools/call` arrived: the input is whole, nothing more is read
  inert: boolean; // past MAX_INPUT, a kind its tool does not write, or a tool whose ops are not drawn yet (presence stands)
  target: { id: string; kind: ArtifactKind; asSuggestions: boolean } | null;
  key: string | null; // the doc the layer is on: the artifact's, or its suggestion doc's
  sent: string | null; // the ops of the last streaming frame on `key` (JSON), null before one
  ops: ProvisionalOp[];
  presence: { key: string; agent: AgentReplica; blocks: string } | null;
  quotes: Map<number, string | null>; // an unscoped quote's block, by op index, once found (or found in none)
}

export class ProvisionalEmitter {
  private readonly calls = new Map<ToolUseId, Call>();
  private readonly ended = new Set<ToolUseId>(); // calls of this turn already committed or dropped: later deltas are not read
  private readonly actor: Actor;
  private readonly display: { name: string; color: string };

  constructor(private readonly deps: ProvisionalEmitterDeps) {
    this.actor = { kind: 'session', appSessionId: deps.appSessionId };
    this.display = actorDisplay(this.actor);
  }

  // The session's events (`EngineSession.react`, every lane): a `maws` artifact call's input deltas, and the engine's
  // result of a call, which drops a layer no commit announced. The turn's end arrives through `turnEnded`, as the
  // session reads it (its main lane, not an echo receipt).
  observe(events: readonly SessionEvent[]): void {
    for (const event of events) {
      if (event.kind === 'assistant.block.delta') {
        const name = event.toolName?.startsWith(MAWS_PREFIX) ? event.toolName.slice(MAWS_PREFIX.length) : null;
        if (event.blockType === 'tool_use' && event.toolUseId && event.inputJsonDelta !== null && name !== null) this.delta(event.toolUseId, name, event.inputJsonDelta);
      } else if (event.kind === 'tool.result') {
        this.dropped(event.toolUseId);
      }
    }
  }

  // One piece of a call's input as the engine streamed it; `toolName` is the `maws` tool's own name.
  delta(toolUseId: ToolUseId, toolName: string, partialJson: string): void {
    if (!isProvisionalTool(toolName) || this.ended.has(toolUseId)) return;
    let call = this.calls.get(toolUseId);
    if (!call) {
      call = { toolUseId, tool: toolName, buffer: '', timer: null, started: false, inert: false, target: null, key: null, sent: null, ops: [], presence: null, quotes: new Map() };
      this.calls.set(toolUseId, call);
    }
    if (call.started || call.inert) return;
    call.buffer += partialJson;
    if (call.buffer.length > MAX_INPUT) {
      call.inert = true;
      this.cancel(call);
      return;
    }
    this.schedule(call);
  }

  // The call's `tools/call` arrived (the tool's first step): its input is whole, so the pending tick runs now and no
  // streaming frame follows the commit or the drop.
  callStarted(toolUseId: ToolUseId): void {
    const call = this.calls.get(toolUseId);
    if (!call) return;
    this.flush(call);
    call.started = true;
  }

  // From the write's own frame (rule 2): the committed notice, queued ahead of the write's update frames on `docKey`,
  // names `commitSeq`, the row the edit's own transaction is (`WriteOptions.inFrame`'s `edited`: the seq its update
  // carries, so a replica withdraws the layer in the task that applies it, not at a later row of the kind's hooks), and
  // carries the last ops. A layer on another doc (the owner's setting changed under the call) is dropped there instead.
  committed(toolUseId: ToolUseId, docKey: string, commitSeq: number): void {
    const call = this.calls.get(toolUseId);
    if (!call) return;
    this.flush(call);
    this.end(call, (store) => {
      if (call.key !== null && call.sent !== null) {
        if (call.key === docKey) store.service.announceWrite(docKey, this.frame(call, 'committed', call.ops, commitSeq));
        else store.service.broadcast(call.key, this.frame(call, 'dropped', []));
      }
      this.handOver(store, call, docKey);
    });
  }

  // P4-A2 (X35): from the frame of a write whose edit changed nothing (`edited` null): no row of it will reach a replica
  // (and the doc's last row may be the owner's own, which is never relayed back to them), so the layer is withdrawn at
  // once, as a drop; the outline is handed over as a commit hands it, the tool having published its own.
  uncommitted(toolUseId: ToolUseId, docKey: string): void {
    const call = this.calls.get(toolUseId);
    if (!call) return;
    this.cancel(call);
    this.end(call, (store) => {
      if (call.key !== null && call.sent !== null) store.service.broadcast(call.key, this.frame(call, 'dropped', []));
      this.handOver(store, call, docKey);
    });
  }

  // The call ended without a commit: its layer is withdrawn and its outline released.
  dropped(toolUseId: ToolUseId): void {
    const call = this.calls.get(toolUseId);
    if (!call) return;
    this.cancel(call);
    this.end(call, (store) => this.withdraw(store, call));
  }

  // Whether an open call of this session shows its outline on `docKey`: an earlier batch's hold ending meanwhile leaves
  // the outline to it.
  presenting(docKey: string): boolean {
    for (const call of this.calls.values()) if (call.presence?.key === docKey) return true;
    return false;
  }

  // The session's turn ended (R8: a call that never arrived, its stream interrupted, ends here).
  turnEnded(): void {
    for (const call of [...this.calls.values()]) this.dropped(call.toolUseId);
    this.ended.clear();
  }

  // The process is gone, every call with it.
  processExited(): void {
    this.turnEnded();
  }

  private schedule(call: Call): void {
    if (call.timer !== null) return;
    call.timer = setTimeout(() => {
      call.timer = null;
      this.tick(call);
    }, Math.max(PROVISIONAL_TICK_MS, call.buffer.length / INPUT_PER_MS));
    call.timer.unref?.();
  }

  private cancel(call: Call): void {
    if (call.timer === null) return;
    clearTimeout(call.timer);
    call.timer = null;
  }

  private flush(call: Call): void {
    if (call.timer === null) return;
    this.cancel(call);
    this.tick(call);
  }

  private end(call: Call, finish: (store: ArtifactStore) => void): void {
    this.calls.delete(call.toolUseId);
    this.ended.add(call.toolUseId);
    const store = this.deps.store();
    if (!store) return;
    try {
      finish(store);
    } catch (error) {
      this.log(call, `could not end its layer: ${messageOf(error)}`);
    }
  }

  // The outline at a write's frame: an edit's own write publishes its cursor and blocks and holds them (D11); any other
  // write's outline ends here.
  private handOver(store: ArtifactStore, call: Call, docKey: string): void {
    if (call.presence && !(call.tool === 'artifact_edit' && call.presence.key === docKey)) store.service.releasePresence(call.presence.agent, this.display);
  }

  // The layer's `dropped` on the doc it was drawn on, and the outline back to the idle name.
  private withdraw(store: ArtifactStore, call: Call): void {
    if (call.key !== null && call.sent !== null) store.service.broadcast(call.key, this.frame(call, 'dropped', []));
    if (call.presence) store.service.releasePresence(call.presence.agent, this.display);
  }

  private tick(call: Call): void {
    if (call.started || call.inert) return;
    const store = this.deps.store();
    if (!store) return;
    try {
      this.read(store, call);
    } catch (error) {
      this.log(call, `could not read its input: ${messageOf(error)}`);
    }
  }

  private read(store: ArtifactStore, call: Call): void {
    const input = readPartialJson(call.buffer);
    if (!isRecord(input)) return;
    let open: Path | null | undefined; // computed once, and only when a name's wholeness matters
    const whole = (...path: Path) => isWhole((open = open === undefined ? openPath(call.buffer) : open), path);
    if (!call.target) {
      // a handle streams through its prefixes (`plan` on the way to `plan-2`): resolved only once whole; unknown, the
      // next tick tries again
      if (typeof input.artifact !== 'string' || !whole('artifact')) return;
      const id = store.resolve(input.artifact, [this.deps.appSessionId, ...(this.deps.artifactScope ?? [])]);
      const artifact = id === null ? null : store.get(id);
      if (!artifact) return;
      if (!WRITES[call.tool](artifact.kind)) {
        call.inert = true;
        return;
      }
      call.target = { id: artifact.id, kind: artifact.kind, asSuggestions: artifact.agentEditsAsSuggestions };
    }
    const suggest = call.tool !== 'artifact_dataset' && (call.target.asSuggestions || input.mode === 'suggest');
    const key = suggest ? store.service.suggestionDoc(call.target.id) : call.target.id;
    if (!STREAMS_OPS[call.tool]) {
      // presence on the doc the owner's setting names, then nothing more of the input (the call's end releases it)
      call.key = key;
      this.present(store, call, key, []);
      call.inert = true;
      return;
    }
    if (call.key !== null && call.key !== key) {
      // R7: the layer moves to the suggestion doc, withdrawn where it was drawn
      this.withdraw(store, call);
      call.sent = null;
      call.presence = null;
      call.quotes.clear();
    }
    call.key = key;
    const { ops, blocks } = this.opsOf(store, call, input, whole);
    this.present(store, call, key, blocks);
    const json = JSON.stringify(ops);
    if (json === (call.sent ?? '[]')) return;
    call.ops = ops;
    call.sent = json;
    store.service.broadcast(key, this.frame(call, 'streaming', ops));
  }

  // R6: the agent's presence on `key`, the blocks named so far outlined, held as a batch's outline is (a turn end
  // meanwhile leaves it to the call's ending); republished only when the blocks change.
  private present(store: ArtifactStore, call: Call, key: string, blocks: string[]): void {
    const outline = JSON.stringify(blocks);
    if (call.presence?.blocks === outline) return;
    const agent = store.service.replica(this.deps.appSessionId, key);
    agent.setPresence({ ...this.display, editing: { blocks } });
    store.service.holdPresence(agent);
    call.presence = { key, agent, blocks: outline };
  }

  // R1: the batch's ops as far as they parse, in op order, and the blocks they name so far (an insert's anchor is not
  // one: the block it makes is not there yet). A name counts once whole; an op whose fields the shape requires have not
  // parsed yet (its `op` among them) is left out until they have.
  private opsOf(store: ArtifactStore, call: Call, input: Record<string, unknown>, whole: (...path: Path) => boolean): { ops: ProvisionalOp[]; blocks: string[] } {
    const ops: ProvisionalOp[] = [];
    const blocks: string[] = [];
    const add = (op: Record<string, unknown>) => {
      const parsed = ProvisionalOpSchema.safeParse(op);
      if (parsed.success) ops.push(parsed.data);
    };
    const target = (block: string | null | undefined) => {
      if (block && !blocks.includes(block)) blocks.push(block);
    };
    if (call.tool === 'artifact_publish') {
      if (isRecord(input.files)) for (const [path, text] of Object.entries(input.files)) if (typeof text === 'string') add({ op: 'file', path, text });
      return { ops, blocks };
    }
    if (call.tool === 'artifact_dataset') {
      if (typeof input.id === 'string' && whole('id')) add({ op: 'dataset', dataset: input.id, text: '' });
      return { ops, blocks };
    }
    if (!Array.isArray(input.ops)) return { ops, blocks };
    input.ops.forEach((op: unknown, i) => {
      if (!isRecord(op)) return;
      // a name, read once whole: `null` while it streams, `undefined` when absent
      const name = (field: string): string | null | undefined => (typeof op[field] !== 'string' ? undefined : whole('ops', i, field) ? (op[field] as string) : null);
      const text = (field: string): string | undefined => (typeof op[field] === 'string' ? (op[field] as string) : undefined);
      switch (op.op) {
        case 'replace_text': {
          const named = name('block');
          if (named === null) return;
          const old = text('old');
          const block = named ?? (old !== undefined && whole('ops', i, 'old') ? this.quoteBlock(store, call, i, old) : null);
          target(block);
          add({ op: 'replace_text', block, old, text: text('new') });
          return;
        }
        case 'replace_block': {
          const id = name('id');
          target(id);
          if (id) add({ op: 'replace_block', block: id, text: text('markdown') });
          return;
        }
        case 'insert': {
          const after = name('after');
          const before = name('before');
          if (after !== null && before !== null && (after ?? before) !== undefined) add({ op: 'insert', ...(after !== undefined && { after }), ...(before !== undefined && { before }), text: text('markdown') });
          return;
        }
        case 'set_cell': {
          const table = name('table');
          target(table);
          if (table) add({ op: 'set_cell', table, row: op.row, col: op.col, text: text('markdown') });
          return;
        }
        case 'delete':
        case 'move': {
          const id = name('id');
          target(id);
          if (id) add({ op: op.op, block: id });
          return;
        }
      }
    });
    return { ops, blocks };
  }

  // R5: the first top-level block in document order whose markdown holds the quote, as the tool matches it (edit-plan.ts:
  // milestones stripped, the block's agent markdown searched, the quote's plain-text needle a filter over its raw text
  // only, every block read when the filter leaves none), on the session's host replica of the layer's doc (the one its
  // batch is planned on, whose index its read warmed); none, null.
  private quoteBlock(store: ArtifactStore, call: Call, i: number, old: string): string | null {
    const known = call.quotes.get(i);
    if (known !== undefined) return known;
    const quote = stripMilestones(old);
    const needle = quote ? needleOf(quote) : null;
    const found = !quote
      ? null
      : store.service.readAs(call.key!, this.actor, (doc) => {
          const index = DocIndex.of(doc);
          const first = (filter: boolean) => {
            for (const tabId of index.tabIds()) for (const top of index.tops(tabId)) if (top.id !== null && (!filter || index.rawText(top).includes(needle!)) && index.md(top).includes(quote)) return top.id;
            return null;
          };
          return (needle !== null ? first(true) : null) ?? first(false);
        });
    call.quotes.set(i, found);
    return found;
  }

  private frame(call: Call, state: ArtifactProvisional['state'], ops: ProvisionalOp[], commitSeq?: number): Uint8Array {
    const frame: ArtifactProvisional = {
      toolUseId: call.toolUseId, appSessionId: this.deps.appSessionId, artifactId: call.key!, kind: call.target!.kind, state,
      ...(commitSeq !== undefined && { commitSeq }), at: Date.now(), ...this.display, ops,
    };
    this.deps.onFrame?.(frame);
    return encodeFrame({ type: 'provisional', json: JSON.stringify(frame) });
  }

  private log(call: Call, line: string): void {
    this.deps.log?.(`provisional ${call.tool} ${call.toolUseId}: ${line}`);
  }
}

// P4-A2 (R8): a tool's call with its layer: the call's start flushes what streamed, and any ending the write's frame did
// not announce as committed (a refusal, a failed write, a throw, an abort) drops it. A call with no tool-use id has no
// layer.
export async function withProvisional<T>(emitter: ProvisionalEmitter | undefined, toolUseId: ToolUseId | null, run: () => Promise<T>): Promise<T> {
  if (!emitter || toolUseId === null) return run();
  emitter.callStarted(toolUseId);
  try {
    return await run();
  } finally {
    emitter.dropped(toolUseId);
  }
}

// The path of the member a streamed JSON text ends inside (`['ops', 2, 'new']` while that string streams), down to the
// innermost container still open; null once the text is a whole value. Every value of the partial parse off this path
// is whole: a string closed, a container closed. The partial parse cannot tell (it closes what is open), so a name is
// read only once it is off the path.
export function openPath(text: string): Path | null {
  interface Level {
    object: boolean;
    key: string | number; // an object's last key; an array's index of its last value (-1 before one)
    open: boolean; // a value of the current member started and has not ended
    expectKey: boolean; // an object between members: the next string is a key
  }
  const stack: Level[] = [];
  let inString = false;
  let isKey = false;
  let escape = false;
  let from = 0;
  let inLiteral = false;
  const begin = (level: Level | undefined) => {
    if (!level) return;
    if (!level.object) level.key = (level.key as number) + 1;
    level.open = true;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    const top = stack[stack.length - 1];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') {
        inString = false;
        if (isKey && top) top.key = JSON.parse(text.slice(from, i + 1)) as string;
        else if (top) top.open = false;
      }
      continue;
    }
    if (inLiteral) {
      if (ch !== ',' && ch !== '}' && ch !== ']' && !/\s/.test(ch)) continue;
      inLiteral = false;
      if (top) top.open = false;
    }
    if (/\s/.test(ch)) continue;
    switch (ch) {
      case '"':
        inString = true;
        escape = false;
        from = i;
        isKey = top?.object === true && top.expectKey;
        if (isKey) top!.expectKey = false;
        else begin(top);
        break;
      case '{':
      case '[':
        begin(top);
        stack.push({ object: ch === '{', key: ch === '{' ? '' : -1, open: false, expectKey: ch === '{' });
        break;
      case '}':
      case ']': {
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent) parent.open = false;
        break;
      }
      case ',':
        if (top) {
          top.open = false;
          top.expectKey = top.object;
        }
        break;
      case ':':
        break;
      default:
        begin(top);
        inLiteral = true;
    }
  }
  if (stack.length === 0) return null;
  const path: Path = [];
  stack.forEach((level, k) => {
    if (k < stack.length - 1 || level.open) path.push(level.key);
  });
  return path;
}

// Whether the value at `path` is whole: off the open path (or the text is whole).
const isWhole = (open: Path | null, path: Path): boolean => open === null || path.length > open.length || path.some((key, k) => open[k] !== key);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
