// Lane A's answers (P5 O9, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, Interfaces §D), the same locally and
// remotely: a card's `RequestAnswer` read, from its typed fields, as what lane A can carry (an allow, an allow scoped to
// the request's own one suggestion, a deny with an optional message, a question's answers), or refused with the reason
// the card shows. The local driver turns an intent into the bridge's decision body (src/services/lane-a/decisions.ts),
// the remote adapter into DX6's `sminos.answer` and `sminos.decide` args (src/main/lane-a/remote.ts).
//
// A scope follows `sminos_rpc.py` `scoped_rule`: only when the request carries exactly one suggestion, an `addRules` or
// `addDirectories` one, and the destination is `session` (any) or `localSettings` (only where the suggestion names it),
// and only while `controls['decide.scope']` is available. Never `setMode`, never another rule list.
import { inputSha256, type JsonValue } from 'desk-hub/protocol';
import type { RequestAnswer } from '@shared/engine/answers';

type Raised = Record<string, unknown>;
export type Controls = Record<string, { available: boolean; reason?: string } | undefined>;
export type AnswerIntent =
  | { kind: 'allow' }
  | { kind: 'allow-scoped'; suggestion: Record<string, unknown>; destination: 'session' | 'localSettings' }
  | { kind: 'deny'; message?: string }
  | { kind: 'answers'; answers: Record<string, string> };
export type AnswerRefusal = { ok: false; code: 'unsupported' | 'bad-args'; message: string };

const SCOPED_TYPES = new Set(['addRules', 'addDirectories']);

/** The bridge's own rule (`sminos_bridge.py` `is_question`): `AskUserQuestion`, or an async question of the ask mod's. */
export function requestKind(raised: Raised): 'permission' | 'question' | 'plan' {
  if (raised.tool === 'AskUserQuestion' || raised.async === true) return 'question';
  if (raised.tool === 'ExitPlanMode') return 'plan';
  return 'permission';
}

const refused = (code: AnswerRefusal['code'], message: string): AnswerRefusal => ({ ok: false, code, message });
const unavailable = (controls: Controls, key: string, otherwise: string): string => controls[key]?.reason ?? otherwise;
const misfit = (answer: RequestAnswer, kind: string) => refused('bad-args', `a ${answer.kind} answer does not fit this ${kind} request`);
const ok = (intent: AnswerIntent) => ({ ok: true as const, intent });

/** What `answer` asks of the request `raised` as lane A carries it, or why it can't. */
export function answerIntent({ raised, answer, controls }: { raised: Raised; answer: RequestAnswer; controls: Controls }): { ok: true; intent: AnswerIntent } | AnswerRefusal {
  const kind = requestKind(raised);
  switch (answer.kind) {
    case 'dialog':
    case 'elicitation':
      return refused('unsupported', unavailable(controls, 'elicitation.answer', 'answer this form in the terminal')); // the bridge raises neither
    case 'question': {
      if (kind !== 'question') return misfit(answer, kind);
      if (Object.keys(answer.answers).length > 0) return ok({ kind: 'answers', answers: answer.answers });
      if (raised.async === true) return refused('unsupported', 'an async question needs an answer');
      return ok({ kind: 'deny' }); // every question skipped: a native question declined
    }
    case 'plan': {
      if (kind === 'question') return misfit(answer, kind);
      if (answer.outcome === 'clear_and_implement') return refused('unsupported', '/clear runs in the terminal');
      if (answer.outcome === 'implement') return ok({ kind: 'allow' });
      return ok({ kind: 'deny', ...(typeof answer.feedback === 'string' && answer.feedback !== '' && { message: answer.feedback }) });
    }
    case 'permission': {
      if (kind === 'question') {
        if (answer.decision !== 'deny') return misfit(answer, kind);
        if (raised.async === true) return refused('unsupported', 'an async question is answered, never declined');
        return ok({ kind: 'deny' });
      }
      if (answer.decision === 'deny_and_stop') return refused('unsupported', unavailable(controls, 'decide.interrupt', 'deny-and-interrupt is answered in the terminal'));
      if (answer.updatedInput !== undefined) return refused('unsupported', 'an edited input is answered in the terminal');
      if (answer.decision === 'deny') return ok({ kind: 'deny', ...(typeof answer.message === 'string' && answer.message !== '' && { message: answer.message }) });
      if (answer.scope === undefined || answer.scope === 'once') return ok({ kind: 'allow' });
      return scoped(raised, answer.scope === 'session' ? 'session' : 'localSettings', controls);
    }
  }
}

function scoped(raised: Raised, destination: 'session' | 'localSettings', controls: Controls): { ok: true; intent: AnswerIntent } | AnswerRefusal {
  if (controls['decide.scope']?.available !== true) return refused('unsupported', unavailable(controls, 'decide.scope', 'a scoped allow is answered in the terminal'));
  const suggestions = raised.suggestions;
  if (!Array.isArray(suggestions) || suggestions.length !== 1) return refused('unsupported', "a scoped allow takes the request's one suggestion; this request offers " + (Array.isArray(suggestions) ? String(suggestions.length) : 'none'));
  const suggestion = suggestions[0] as Record<string, unknown> | null;
  if (suggestion === null || typeof suggestion !== 'object' || !SCOPED_TYPES.has(String(suggestion.type))) {
    return refused('unsupported', `a scoped allow takes a rule or a directory the engine suggested, not ${String(suggestion?.type)}`);
  }
  if (destination === 'localSettings' && suggestion.destination !== 'localSettings') {
    return refused('unsupported', `local settings only where the engine suggested them; this suggestion is for ${String(suggestion.destination)}`);
  }
  return ok({ kind: 'allow-scoped', suggestion, destination });
}

/** A suggestion's DX6 hash (the lowercase hex SHA-256 of its canonical JSON), or null when it has no canonical form. */
export async function suggestionSha256(value: unknown): Promise<string | null> {
  try {
    return await inputSha256(value as JsonValue);
  } catch {
    return null;
  }
}
