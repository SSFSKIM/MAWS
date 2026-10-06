// What a turn's own lane did about orchestration that the transcript alone records (E7 execution document, Design §4,
// §5 and §7; Decision Log 15): its `CronCreate` and `CronDelete` calls with their outcomes, and its `ListAgents`
// listings. They live on the turn's activity (`TurnActivity.crons`, `.listings`, activity.ts), which sees the backfill
// and the live stream across launches, where the agents tool's task graph sees only the current launch's wire. Read
// from the turn's top-level events, so a child agent's calls (kept under `children`) are never the session's. Pure.
import type { SessionEvent } from '@shared/graph/events';
import type { ToolUseId } from '@shared/graph/ids';
import { parseListing, type Listing } from './agent-listing';
import { resultText } from './cells';
import { parseCronResult } from './cron-result';
import type { TurnState } from './reduce';

export type CronCall = { kind: 'create'; cron: string; prompt: string; recurring: boolean; durable: boolean } | { kind: 'delete'; id: string };
// null until the result arrives; a failed call keeps the engine's text
export type CronOutcome = { ok: true; id: string; humanSchedule: string; durable: boolean } | { ok: true } | { ok: false; text: string } | null;

export interface TurnCron {
  toolUseId: ToolUseId;
  at: string; // the call's
  call: CronCall;
  result: CronOutcome;
}

export interface TurnListing {
  toolUseId: ToolUseId;
  at: string;
  parsed: Listing | null; // null until the result arrives
}

export interface TurnOrchestration {
  crons: TurnCron[];
  listings: TurnListing[];
}

type ToolResult = Extract<SessionEvent, { kind: 'tool.result' }>;
const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});

// The call as the engine reads its input (SPEC 22 §22.9: `recurring` defaults to true, `durable` to false); null for an
// input the engine would refuse before running.
function cronCall(toolName: string, input: unknown): CronCall | null {
  const value = record(input);
  if (toolName === 'CronDelete') return typeof value.id === 'string' ? { kind: 'delete', id: value.id } : null;
  if (typeof value.cron !== 'string' || typeof value.prompt !== 'string') return null;
  return { kind: 'create', cron: value.cron, prompt: value.prompt, recurring: value.recurring !== false, durable: value.durable === true };
}

// A create's id and schedule from its result text; the structured result answers when the wording is one this parser
// does not know (both paths carry it), so a reworded engine still lists its jobs.
function cronOutcome(call: CronCall, result: ToolResult): CronOutcome {
  const text = resultText(result.content);
  if (result.isError) return { ok: false, text };
  if (call.kind === 'delete') return { ok: true };
  const parsed = parseCronResult(text);
  if (parsed) return { ok: true, id: parsed.id, humanSchedule: parsed.humanSchedule, durable: parsed.durable };
  const structured = record(result.structured);
  if (typeof structured.id === 'string' && typeof structured.humanSchedule === 'string') return { ok: true, id: structured.id, humanSchedule: structured.humanSchedule, durable: structured.durable === true };
  return { ok: false, text };
}

export function turnOrchestration(turn: TurnState): TurnOrchestration {
  const crons: TurnCron[] = [];
  const listings: TurnListing[] = [];
  const results = new Map<ToolUseId, ToolResult>();
  // A call whose message the engine retracted or superseded (a refused attempt) is none of the turn's, as derive.ts drops it.
  const dropped = new Set<string>();
  for (const event of turn.events) {
    if (event.kind === 'tool.result') results.set(event.toolUseId, event);
    else if (event.kind === 'boundary.retraction') for (const uuid of event.retractedMessageUuids) dropped.add(uuid);
    else if (event.kind === 'assistant.block.complete') for (const uuid of event.supersedes) dropped.add(uuid);
  }
  for (const event of turn.events) {
    if (event.kind !== 'tool.use' || (event.messageUuid !== null && dropped.has(event.messageUuid))) continue;
    const result = results.get(event.toolUseId);
    if (event.toolName === 'ListAgents') {
      listings.push({ toolUseId: event.toolUseId, at: event.at, parsed: result ? parseListing(resultText(result.content)) : null });
    } else if (event.toolName === 'CronCreate' || event.toolName === 'CronDelete') {
      const call = cronCall(event.toolName, event.input);
      if (call) crons.push({ toolUseId: event.toolUseId, at: event.at, call, result: result ? cronOutcome(call, result) : null });
    }
  }
  return { crons, listings };
}
