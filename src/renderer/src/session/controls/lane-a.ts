// Lane A behind the controls port (P5 O9 M5, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, Interfaces §C and §D): a
// session a terminal or a `--bg` job holds, driven through its sminos bridge by main's lane A driver (`laneA.*`). Every
// control's capability is drawn from the session's capability list (its `LaneAState`: the bridge's ops, its
// `capabilities.controls` and the turn), never from its lane; each gap is closed in place with its reason, in MAWS's
// words where the owner's Q2 gives them and the bridge's sentence otherwise. Each method reaches its `laneA.*` command and
// maps the answer into the port's (lane B's) types: a refusal and an unknown outcome as `{ok: false}` with
// `issues: {refusal}` or `issues: {unknown}`, never a new `IpcError` code.
//
// - Send is the bridge's `deliver` in either turn state (main's delivery lane); a `/` text goes by its slash route, run
//   through `laneA.command` when the bridge's catalog says it runs, refused with the route's reason otherwise. A send
//   whose fate `laneA.send` could not name yet is handed to the pending-send strip by its key (`unconfirmed`).
// - The model chip lists the catalog's models (with `fable`, which the bridge takes though the catalog leaves it out)
//   and the five efforts, names the bridge's override when set and the session's model otherwise, and sends only what
//   changed. The mode and the directories are closed: no bridge op sets them.
// - The palette lists the bridge's catalog and opens only the widgets a lane A read or op backs (the model selector,
//   compact, MCP, the side question).
import type { Catalog } from 'desk-hub/protocol';
import type { RequestAnswer } from '@shared/engine/answers';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { CommandName, CommandResult, IpcError, MawsBridge } from '@shared/ipc/schema';
import { ipcError } from '@shared/ipc/errors';
import type { ControlResult, LaneARaised, LaneAState } from '@shared/ipc/schema/lane-a';
import { aliasOf, chipLabel } from '@shared/sessions/model-label';
import type { HookResult, ModelInfo } from '../../composer/setup-intent';
import type { FrameBindings } from '../../composer/frame/bindings';
import type { HumanPromptResult } from '../../composer/submit/send-human-prompt';
import { WIDGET_COMMANDS } from '../../composer/mentions/widgets';
import { commandRoute, slashItems } from '../../lane-a/conversation/catalog';
import { announceCommand } from '../../lane-a/outcomes';
import { watchLaneA } from '../../lane-a/watches';
import { branchLabel, recordBranch } from '../../sessions/branch-label';
import { canTakeOver } from '../../sessions/holder-words'; // not record-ops: its imports reach the terminal stack
import type { SessionCatalog } from '../../stores/catalog';
import { holdPendingSend, useLaneA } from '../../stores/lane-a';
import { MODE_OPTIONS } from '../../statusline/mode-menu';
import type { Capability, ControlKey, SessionControls } from './types';

// The words MAWS says for lane A's gaps (the owner's Q2, built as recommended).
export const LANE_A_WORDS = {
  noBridge: 'This session has no bridge MAWS can drive',
  idle: 'Nothing is running in this session',
  mode: "A terminal session's mode is changed in the terminal",
  rewind: 'Rewind is a terminal panel: use /rewind there',
  queue: 'The terminal keeps its own queue',
  elicitation: 'Answer this form in the terminal',
  directories: 'Add a directory in the terminal',
  location: 'Where the terminal runs this session',
  reopen: 'The session is live in the terminal',
  takeOver: 'Only an interactive terminal or a named background job can be taken over',
  attachments: "An image or a PDF isn't sent to a terminal session yet",
  widget: 'Not available for a terminal session',
  catalog: 'The command catalog has not arrived yet',
  unknownCommand: 'The command may have run: check the transcript before running it again',
  unknownAsk: 'It may have been asked: its answer shows here if it was',
  unknownAnswer: 'The answer may have been taken: the card settles if it was',
  unknown: 'It may have run: the transcript shows it if it did',
};

// What the machine is called in a route's reason (`<machine>`): a local session's is this Mac.
const HERE = 'this Mac';
type BridgeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'; // the bridge's efforts (`model` op)
// The widgets a lane A read or op backs in O9 (M5): the model selector's three names, compact, MCP and the side question.
const BACKED_WIDGETS = new Set(['model', 'effort', 'fast', 'compact', 'mcp', 'btw']);
const OP_OF: Partial<Record<ControlKey, string>> = { send: 'deliver', interrupt: 'interrupt', command: 'command', 'stop-task': 'stop' };
const CONTROLLED = new Set<ControlKey>(['decide', 'decide.scope', 'decide.interrupt', 'decide.addDirectory', 'model', 'btw', 'compact', 'mcp.enable', 'mcp.disable', 'mcp.reconnect', 'stop-agent', 'tell', 'forget', 'rewind-files', 'elicitation.answer']);
// A gap MAWS words itself, whatever the bridge says (Q2).
const OWN_WORDS: Partial<Record<ControlKey, string>> = { mode: LANE_A_WORDS.mode, queue: LANE_A_WORDS.queue, rewind: LANE_A_WORDS.rewind, 'elicitation.answer': LANE_A_WORDS.elicitation, reopen: LANE_A_WORDS.reopen, media: LANE_A_WORDS.attachments };

const AVAILABLE: Capability = { available: true };
const closed = (reason: string): Capability => ({ available: false, reason });
// The bridge's sentence as MAWS shows one: its first letter capitalised.
const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const notInSminos = (state: LaneAState) => `Not in sminos ${state.sminos ?? 'on this machine'}`;

const failed = (message: string, issues: Record<string, string>): { ok: false; error: IpcError } => ({ ok: false, error: ipcError('internal', message, issues) });
const transport = (error: { message: string }): ControlResult => ({ state: 'refused', code: 'transport', message: error.message });

// One `laneA.*` control's answer as a ControlResult: the transport's failure refused with its words.
async function control(call: Promise<CommandResult<CommandName>>): Promise<ControlResult> {
  const result = await call;
  return result.ok ? (result.value as ControlResult) : transport(result.error);
}

// The route a palette row of the bridge's catalog offers: its argument form when that runs (`/mcp`, `/rename`), else the
// bare one.
const offered = (entry: Catalog['commands'][number]) => (entry.withArgs && (entry.withArgs.class === 'run' || entry.withArgs.class === 'run-prompt') ? entry.withArgs : entry.route);

// The catalog's models as the selector's rows: its options, then its aliases, then `fable`; each takes every effort.
export function modelRows(catalog: Catalog | null): ModelInfo[] {
  const aliases = catalog?.models.aliases ?? {};
  const names = [...(catalog?.models.options ?? []), ...Object.keys(aliases).filter((name) => name !== 'default'), 'fable'];
  return [...new Set(names)].map((value) => {
    const resolved = aliases[value];
    return { value, displayName: value, supportsEffort: true, ...(typeof resolved === 'string' && { resolvedModel: resolved }) };
  });
}

// A text the person typed as its words, or null when it holds what lane A can't send yet (an image, a document).
function textOf(content: string | readonly { type: string; text?: unknown }[]): string | null {
  if (typeof content === 'string') return content;
  if (content.some((block) => block.type !== 'text')) return null;
  return content.map((block) => String(block.text ?? '')).join('\n');
}

// Whether lane A carries a card's answer on this request, and why not (Interfaces §D): the same rules main's driver
// applies before it posts (src/main/lane-a/decisions.ts), checked here before the option is offered.
export function laneAAnswerCapability(raised: LaneARaised | null, answer: RequestAnswer, controls: LaneAState['controls']): Capability {
  const control = (key: string, otherwise: string) => sentence(controls[key]?.reason ?? otherwise);
  const question = raised !== null && (raised.tool === 'AskUserQuestion' || raised.async === true);
  switch (answer.kind) {
    case 'dialog':
    case 'elicitation':
      return closed(LANE_A_WORDS.elicitation);
    case 'question':
      return Object.keys(answer.answers).length === 0 && raised?.async === true ? closed('An async question needs an answer') : AVAILABLE;
    case 'plan':
      return answer.outcome === 'clear_and_implement' ? closed('/clear runs in the terminal') : AVAILABLE;
    case 'permission': {
      if (question) return answer.decision === 'deny' && raised?.async === true ? closed('An async question is answered, never declined') : AVAILABLE;
      if (answer.decision === 'deny_and_stop') return closed(control('decide.interrupt', 'deny-and-interrupt is answered in the terminal'));
      if (answer.updatedInput !== undefined) return closed('An edited input is answered in the terminal');
      if (answer.decision === 'deny' || answer.scope === undefined || answer.scope === 'once') return AVAILABLE;
      if (controls['decide.scope']?.available !== true) return closed(control('decide.scope', 'a scoped allow is answered in the terminal'));
      const suggestions = raised?.suggestions ?? [];
      if (suggestions.length !== 1) return closed(`A scoped allow takes the request's one suggestion; this request offers ${suggestions.length === 0 ? 'none' : suggestions.length}`);
      const suggestion = suggestions[0] as { type?: unknown; destination?: unknown } | null;
      if (suggestion?.type !== 'addRules' && suggestion?.type !== 'addDirectories') return closed('A scoped allow takes a rule or a directory the engine suggested');
      if (answer.scope === 'local_settings' && suggestion.destination !== 'localSettings') return closed('Local settings only where the engine suggested them');
      return AVAILABLE;
    }
  }
}

export interface LaneAInputs {
  appSessionId: AppSessionId;
  client: MawsBridge;
}

export function laneAControls(state: LaneAState, record: SessionRecord | null, { appSessionId, client }: LaneAInputs): SessionControls {
  const live = state.bridge === 'live' ? null : (state.reason ?? LANE_A_WORDS.noBridge);
  const catalogNow = (): Catalog | null => (useLaneA.getState().catalogs.get(appSessionId) as Catalog | undefined) ?? null;
  const stateNow = (): LaneAState => useLaneA.getState().states.get(appSessionId) ?? state;
  // The session's watch held across an op's call, so its `op` messages are kept even when an early end beats whoever
  // follows them (`followOp`); let go a tick after the answer, once the follower holds its own.
  const holdWatch = (): (() => void) => {
    const off = watchLaneA(appSessionId, () => {}, { client });
    return () => void setTimeout(off, 0);
  };

  function capability(key: ControlKey): Capability {
    const own = OWN_WORDS[key];
    if (own !== undefined) return closed(own);
    if (key === 'subagent-rows') return AVAILABLE;
    if (key === 'take-over') return record && (record.holder.kind === 'terminal' || record.holder.kind === 'background_job') && canTakeOver(record.holder) ? AVAILABLE : closed(LANE_A_WORDS.takeOver);
    if (live !== null) return closed(live);
    if (key === 'answer') return AVAILABLE;
    const op = OP_OF[key];
    if (op !== undefined) {
      if (!state.ops.includes(op)) return closed(`Not in this session’s sminos${state.sminos ? ` (${state.sminos})` : ''}`);
      return key === 'interrupt' && !state.turn.running ? closed(LANE_A_WORDS.idle) : AVAILABLE;
    }
    if (!CONTROLLED.has(key)) return closed(LANE_A_WORDS.widget);
    const given = state.controls[key];
    if (given === undefined) return closed(notInSminos(state));
    if (!given.available) return closed(sentence(given.reason ?? notInSminos(state)));
    if (key === 'mcp.enable' || key === 'mcp.disable' || key === 'mcp.reconnect') {
      const catalog = catalogNow();
      if (catalog === null) return closed(LANE_A_WORDS.catalog);
      const route = commandRoute(catalog, 'mcp', `${key.slice('mcp.'.length)} server`, HERE);
      if (route.kind !== 'command') return closed(sentence(route.kind === 'unavailable' ? route.reason : LANE_A_WORDS.widget));
    }
    return AVAILABLE;
  }

  // A `/` text by its slash route: run when the bridge's catalog says it runs, its outcome announced from its op.
  async function slashSend(text: string): Promise<HumanPromptResult> {
    const typed = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (!typed) return { disposition: 'refused', started: false, reason: LANE_A_WORDS.widget };
    const [, name, args = ''] = typed;
    const route = commandRoute(catalogNow(), name, args, HERE);
    if (route.kind === 'unavailable') return { disposition: 'refused', started: false, reason: route.reason };
    if (route.kind === 'widget') return { disposition: 'refused', started: false, reason: `Use the ${route.name} control` };
    const release = holdWatch();
    const result = await control(client.invoke('laneA.command', { appSessionId, name, args: args.trim() })).finally(release);
    if (result.state === 'refused') return { disposition: 'refused', started: false, reason: result.message };
    if (result.state === 'unknown') return { disposition: 'refused', started: false, reason: LANE_A_WORDS.unknownCommand };
    const id = (result.result as { id?: unknown } | null | undefined)?.id;
    if (typeof id === 'string') announceCommand(appSessionId, name, id, client);
    return { disposition: 'sent', started: false };
  }

  const models = () => modelRows(catalogNow());
  const current = () => ({ model: stateNow().override?.model ?? null, effort: stateNow().override?.effort ?? null });

  const bindings = (): FrameBindings => {
    const override = state.override;
    const rows = models();
    const modelClosed = capability('model');
    const refusedWith = (reason: string) => async (): Promise<HookResult> => ({ ok: false, error: reason });
    return {
      location: { path: record?.worktree?.path ?? record?.directory ?? '', branch: branchLabel(recordBranch(record), null), note: LANE_A_WORDS.location },
      project: null,
      model: {
        value: { model: override?.model ?? null, effort: (override?.effort ?? null) as BridgeEffort | null },
        label: chipLabel(aliasOf(override?.model ?? state.model, rows), (override?.effort ?? null) as BridgeEffort | null),
        options: rows,
        disabled: modelClosed.available ? null : modelClosed.reason,
        // Only what changed goes: the bridge's `model` op replaces both, and main keeps the other as it reads it fresh.
        set: async (next) => {
          if (!modelClosed.available) return { ok: false, error: modelClosed.reason };
          const now = current();
          const change = { ...(next.model !== now.model && { model: next.model }), ...(next.effort !== now.effort && { effort: next.effort }) };
          if (Object.keys(change).length === 0) return { ok: true };
          const result = await control(client.invoke('laneA.model', { appSessionId, ...change }));
          return result.state === 'done' ? { ok: true } : { ok: false, error: result.state === 'refused' ? result.message : LANE_A_WORDS.unknown };
        },
      },
      mode: { value: null, options: MODE_OPTIONS.map((o) => o.mode), disabled: LANE_A_WORDS.mode, refusal: null, autoUnavailable: null, set: refusedWith(LANE_A_WORDS.mode) },
      directories: { value: [...(record?.additionalDirectories ?? [])], options: [], disabled: LANE_A_WORDS.directories, set: refusedWith(LANE_A_WORDS.directories) },
    };
  };

  return {
    capability,
    answerCapability: (item: AttentionItem, answer: RequestAnswer) => {
      if (live !== null) return closed(live);
      const raised = stateNow().pending.find((p) => p.request === item.request.requestId) ?? null;
      return laneAAnswerCapability(raised, answer, state.controls);
    },
    async send(content, options) {
      if (options.current?.() === false || options.precheck?.() === false) return { disposition: 'refused', started: false };
      const text = textOf(content);
      if (text === null) return { disposition: 'refused', started: false, reason: LANE_A_WORDS.attachments };
      const sendable = capability('send');
      if (!sendable.available) return { disposition: 'refused', started: false, reason: sendable.reason };
      if (text.trimStart().startsWith('/')) return slashSend(text);
      const result = await client.invoke('laneA.send', { appSessionId, text });
      if (!result.ok) throw new Error(result.error.message); // the composer shows the error with its Retry, as lane B's host error
      const out = result.value;
      if (out.state === 'entered') return { disposition: stateNow().turn.running ? 'steered' : 'sent', started: false, ...(out.uuid !== undefined && { messageUuid: out.uuid as MessageUuid }) };
      if (out.state === 'refused') return { disposition: 'refused', started: false, reason: out.reason ?? 'The session did not take the message' };
      if (out.key !== null) holdPendingSend(appSessionId, out.key, text); // its fate arrives in the state's deliveries
      return { disposition: 'unconfirmed', started: false };
    },
    // The bridge holds no MAWS queue, so Stop and Esc both interrupt.
    async interrupt() {
      const result = await control(client.invoke('laneA.interrupt', { appSessionId }));
      if (result.state === 'done') return { ok: true, value: { stillQueued: [], cancelled: [] } };
      return result.state === 'refused' ? failed(result.message, { refusal: result.code }) : failed(LANE_A_WORDS.unknown, { unknown: result.why });
    },
    async answer(item, answer) {
      const result = await client.invoke('laneA.answer', { appSessionId, request: item.request.requestId ?? '', answer });
      if (!result.ok) return { ok: false, error: result.error };
      const out = result.value;
      if (out.outcome === 'delivered') return { ok: true, value: { outcome: 'delivered' } };
      if (out.outcome === 'not_pending') return { ok: true, value: { outcome: 'not_pending' } };
      return out.outcome === 'refused' ? failed(out.message, { refusal: out.code }) : failed(LANE_A_WORDS.unknownAnswer, { unknown: out.why });
    },
    bindings,
    queue: () => null,
    // A retry asks again as a new op: the bridge keeps no log of side questions.
    async btw(question) {
      const release = holdWatch(); // its answer is followed by the side store
      const result = await control(client.invoke('laneA.btw', { appSessionId, prompt: question })).finally(release);
      if (result.state === 'refused') return failed(result.message, { refusal: result.code });
      if (result.state === 'unknown') return failed(LANE_A_WORDS.unknownAsk, { unknown: result.why, ...(result.id !== undefined && { opId: result.id }) });
      const id = (result.result as { id?: unknown } | null | undefined)?.id;
      return typeof id === 'string' ? { ok: true, value: { opId: id } } : failed(LANE_A_WORDS.unknownAsk, { unknown: 'no-id' });
    },
    command(name, args) {
      const release = holdWatch(); // its outcome is followed by the caller
      return control(client.invoke('laneA.command', { appSessionId, name, args })).finally(release);
    },
    compact: (instructions) => control(client.invoke('laneA.compact', { appSessionId, ...(instructions !== undefined && instructions !== '' && { instructions }) })),
    stopAgent: (agentId) => control(client.invoke('laneA.stopAgent', { appSessionId, agentId })),
    tell: (agentId, text) => control(client.invoke('laneA.tell', { appSessionId, agentId, text })),
    stopTask: (taskId) => control(client.invoke('laneA.stopTask', { appSessionId, taskId })),
    turn: () => ({ running: stateNow().turn.running }),
    slash(_engine, registered) {
      const catalog = catalogNow();
      const widgets = new Set([...registered].filter((name) => BACKED_WIDGETS.has(name)));
      const unavailable: Record<string, string> = {};
      // why each command of the catalog can't run from here, by the lifted desk-web rules (`catalog.ts`)
      for (const item of catalog === null ? [] : slashItems(catalog, HERE, null)) {
        if (item.action.kind === 'unavailable' && !BACKED_WIDGETS.has(item.name)) unavailable[item.name] = item.action.hint;
      }
      for (const { name } of WIDGET_COMMANDS) {
        if (widgets.has(name) || catalog?.commands.some((c) => c.name === name)) continue;
        unavailable[name] = name === 'rewind' ? LANE_A_WORDS.rewind : catalog === null ? LANE_A_WORDS.catalog : LANE_A_WORDS.widget;
      }
      const listed: SessionCatalog = {
        launchId: `lane-a:${catalog?.fingerprint ?? ''}`,
        revision: catalog === null ? 0 : 1,
        commands: (catalog?.commands ?? []).map((entry) => {
          const route = offered(entry);
          return { name: entry.name, description: entry.description, argumentHint: route.forms?.hint ?? (route.forms?.args === 'required' ? '<arguments>' : null), builtin: entry.source === 'builtin' };
        }),
        agents: [],
        skills: catalog?.skills ?? [],
        terminalOnly: [],
        unavailable,
      };
      return { catalog: listed, widgets };
    },
  };
}
