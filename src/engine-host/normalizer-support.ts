// Pure helpers the normaliser's mapping uses: token usage, the spill path, the `!` bash tags, denial kinds. Each is a
// wire-to-X1 projection with its evidence named (C3 execution document, Interfaces "Normaliser").
import { DENIAL_KINDS, type DenialKind } from '@shared/graph/enums';
import type { ContentBlock, EventPayload, TaskUsage, TokenUsage } from '@shared/graph/events';
import type { AgentId, ParentToolUseId } from '@shared/graph/ids';

// `result.usage` and `message_delta.usage` share this shape; absent counters read as 0, thinking as null.
export function tokenUsageOf(usage: unknown): TokenUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const details = u.output_tokens_details as { thinking_tokens?: unknown } | undefined;
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadInputTokens: num(u.cache_read_input_tokens),
    cacheCreationInputTokens: num(u.cache_creation_input_tokens),
    thinkingTokens: typeof details?.thinking_tokens === 'number' ? details.thinking_tokens : null,
  };
}

// task_notification.usage is optional and loose on the wire; only a complete usage report replaces progress.
export function taskUsageOf(usage: unknown): TaskUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  if (typeof u.total_tokens !== 'number' || typeof u.tool_uses !== 'number' || typeof u.duration_ms !== 'number') return undefined;
  return { totalTokens: u.total_tokens, toolUses: u.tool_uses, durationMs: u.duration_ms };
}

// The absolute path the engine reports for a spilled result (§4.3): Bash's `tool_use_result.persistedOutputPath`
// (SPEC 16 §16.13), else the notice every other tool's result opens with (SPEC 12 §12.12), else null.
// CLI 2.1.283 Lme (cli.pretty.js:316303): the path ends at the newline, not at a space; the notice may be wrapped.
const SPILL_NOTICE = /^Output too large \([^)]*\)\. Full output saved to: (\/[^\r\n]+)/m;
export function spillPathOf(toolUseResult: unknown, content: string | ContentBlock[]): string | null {
  const structured = toolUseResult as { persistedOutputPath?: unknown } | null;
  if (structured && typeof structured === 'object' && typeof structured.persistedOutputPath === 'string') return structured.persistedOutputPath;
  const text = typeof content === 'string' ? content : firstText(content);
  const match = text === null ? null : SPILL_NOTICE.exec(text);
  return match ? match[1]! : null;
}

function firstText(blocks: ContentBlock[]): string | null {
  const block = blocks.find((b) => b.type === 'text');
  return block && typeof block.text === 'string' ? block.text : null;
}

// The `!` mode's replayed frames (`pass2/bash-context-echoed` seq 6–7): `<bash-input>` and `<bash-stdout>…<bash-exit-code>`.
export type BashPart = { part: 'input'; command: string } | { part: 'output'; stdout: string; stderr: string; exitCode: number };
const BASH_INPUT = /^<bash-input>([\s\S]*?)<\/bash-input>\s*$/;
const BASH_OUTPUT = /^<bash-stdout>([\s\S]*?)<\/bash-stdout><bash-stderr>([\s\S]*?)<\/bash-stderr>(?:<bash-exit-code>(-?\d+)<\/bash-exit-code>)?\s*$/;
export function bashPartOf(content: string | ContentBlock[]): BashPart | null {
  if (typeof content !== 'string') return null;
  const input = BASH_INPUT.exec(content);
  if (input) return { part: 'input', command: input[1]! };
  const output = BASH_OUTPUT.exec(content);
  if (output) return { part: 'output', stdout: output[1]!, stderr: output[2]!, exitCode: output[3] === undefined ? 0 : Number(output[3]) };
  return null;
}

// Engine-authored `user` frames that are not a human prompt and must never read as one downstream (coordinator
// correction after M2): the `<local-command-stdout>` echo after a slash command such as `set_model` (`pass2/auto-routed`
// seq 153; the content becomes the tag's inner text) and the `[Request interrupted by user]` marker after an interrupt
// (`pass2/per-task-stop-on` seq 65; `… for tool use` in `per-task-stop-off` seq 71). Null for every other frame.
export type EngineUserMarker = { origin: 'local-command'; content: string } | { origin: 'interrupt-marker'; content: string | ContentBlock[] };
const LOCAL_COMMAND_STDOUT = /^<local-command-stdout>([\s\S]*)<\/local-command-stdout>\s*$/;
export const INTERRUPT_MARKER = /^\[Request interrupted by user[^\]]*\]$/;
export function engineUserMarkerOf(content: string | ContentBlock[]): EngineUserMarker | null {
  const text = typeof content === 'string' ? content : content.length === 1 && content[0]!.type === 'text' && typeof content[0]!.text === 'string' ? content[0]!.text : null;
  if (text === null) return null;
  const local = LOCAL_COMMAND_STDOUT.exec(text);
  if (local) return { origin: 'local-command', content: local[1]! };
  if (INTERRUPT_MARKER.test(text.trim())) return { origin: 'interrupt-marker', content };
  return null;
}

export function denialKindOf(kind: string | undefined): DenialKind | 'unknown' | null {
  if (kind === undefined) return null;
  return (DENIAL_KINDS as readonly string[]).includes(kind) ? (kind as DenialKind) : 'unknown';
}

// Drops keys whose value is undefined so a strict schema with optional fields sees them as absent.
export function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) if (value !== undefined) out[key] = value;
  return out as T;
}

export const stringOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export const boolOr = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
export const numberOr = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);

// Child attribution of an event: the parent tool use whose lane the frame arrived on and the agent behind it.
export interface Attribution {
  parentToolUseId: ParentToolUseId | null;
  agentId: AgentId | null;
}

// Where a mapping puts its payloads; the Normalizer's Emitter stamps the base fields (id, seq, at, sessionId).
export interface EventSink {
  emit(payload: EventPayload, attribution: Attribution | null): void;
}
