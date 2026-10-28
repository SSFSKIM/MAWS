// The controls port (P5 O9 M4, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, Interfaces §C): every control a session
// pane, its composer, its chips, its cards and its tools offer, behind one object per session. `controlsFor` picks the
// implementation from the session's record and its lane A state; nothing that draws a control asks which lane it has.
// Lane B's (`lane-b.ts`) is today's commands; lane A's (M5) is the bridge's, over `laneA.*`.
//
// The rule: a method that wraps a lane B command takes that command's input less `appSessionId` and answers its result,
// so lane B passes through unchanged; lane A maps into the same types (a member added only where M5 notes one).
import type { RequestAnswer } from '@shared/engine/answers';
import type { SendContent } from '@shared/engine/session-state-store';
import type { AttentionItem } from '@shared/graph/attention';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import type { ControlResult } from '@shared/ipc/schema/lane-a';
import type { FrameBindings } from '../../composer/frame/bindings';
import type { HumanPromptOptions, HumanPromptResult } from '../../composer/submit/send-human-prompt';
import type { SessionCatalog } from '../../stores/catalog';

export type { ControlResult };

export type ControlKey =
  | 'send' | 'interrupt' | 'answer' | 'decide' | 'decide.scope' | 'decide.interrupt' | 'decide.addDirectory'
  | 'model' | 'mode' | 'command' | 'btw' | 'compact' | 'mcp.enable' | 'mcp.disable' | 'mcp.reconnect'
  | 'stop-agent' | 'tell' | 'stop-task' | 'media' | 'queue' | 'rewind' | 'forget' | 'rewind-files'
  | 'elicitation.answer' | 'subagent-rows' | 'take-over' | 'reopen';

export type Capability = { available: true } | { available: false; reason: string };

export type Args<N extends CommandName> = Omit<CommandInput<N>, 'appSessionId'>;

export interface SessionControls {
  capability(key: ControlKey): Capability;
  answerCapability(item: AttentionItem, answer: RequestAnswer): Capability; // per option on a card
  send(content: SendContent, options: HumanPromptOptions): Promise<HumanPromptResult>;
  interrupt(args: Args<'session.interrupt'>): Promise<CommandResult<'session.interrupt'>>; // Stop holds the engine's queue, Esc doesn't
  answer(item: AttentionItem, answer: RequestAnswer): Promise<CommandResult<'session.answer'>>;
  bindings(): FrameBindings; // model, mode, directories: today's chips
  queue(): QueueControls | null; // lane B's queue; null on lane A (capability 'queue')
  btw(question: string, options?: { retryOf?: string }): Promise<CommandResult<'session.sideQuestion'>>;
  command(name: string, args: string): Promise<ControlResult>; // lane A only: a bridge slash route
  compact(instructions?: string): Promise<ControlResult>; // lane B: today's `/compact` send; lane A: the op
  stopAgent(agentId: string): Promise<ControlResult>;
  tell(agentId: string, text: string): Promise<ControlResult>;
  stopTask(taskId: string): Promise<ControlResult>;
  // P5 O9 M5, the two members lane A needs that lane B never produces. The turn of a session another process runs, as
  // that process reports it (lane A: the bridge's main loop); null where C3's status is the session's own turn (lane B),
  // which the composer reads instead.
  turn(): { running: boolean } | null;
  // What the `/` palette lists and opens for this session, from what the editor read (the engine's catalogue and every
  // registered widget): lane B's are those; lane A's are its bridge's catalog, with each command it can't run named and
  // why, and only the widgets a lane A read or op backs.
  slash(engine: SessionCatalog, registered: ReadonlySet<string>): { catalog: SessionCatalog; widgets: ReadonlySet<string> };
}

// Today's `QueueList` and Esc operations, unchanged.
export interface QueueControls {
  promote(args: Args<'session.queue.promote'>): Promise<CommandResult<'session.queue.promote'>>;
  hold(args: Args<'session.queue.hold'>): Promise<CommandResult<'session.queue.hold'>>;
  remove(args: Args<'session.queue.remove'>): Promise<CommandResult<'session.queue.remove'>>;
  edit(args: Args<'session.queue.edit'>): Promise<CommandResult<'session.queue.edit'>>;
  setPaused(args: Args<'session.queue.setPaused'>): Promise<CommandResult<'session.queue.setPaused'>>;
}
