// Answers and decisions (P5 O9 M2, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, Interfaces §D): a card's
// `RequestAnswer` mapped to the bridge's decision body (`POST /requests/<id>/decision`) from its typed fields, or refused
// when lane A can't carry it. A direct DX5 client gets none of the checks sminos's daemon makes on a remote RPC, and the
// child hands any rule list to the engine, so the driver makes the daemon's checks itself (`sminos_rpc.py`
// `scoped_rule`): a scope only from the request's own one suggestion, an `addRules` or `addDirectories` one, checked by
// the SHA-256 of its canonical JSON against the raised record the driver holds (what the card drew), `localSettings`
// only where the suggestion names it. Never `setMode`, never another rule list.
import { inputSha256, type JsonValue } from 'desk-hub/protocol';
import type { RequestAnswer } from '@shared/engine/answers';

type Raised = Record<string, unknown>;
type Controls = Record<string, { available: boolean; reason?: string } | undefined>;
export type Decision = { ok: true; body: Record<string, unknown> } | { ok: false; code: 'unsupported' | 'not-pending' | 'bad-args'; message: string };

const SCOPED_TYPES = new Set(['addRules', 'addDirectories']);

// The bridge's own rule (`sminos_bridge.py` `is_question`): `AskUserQuestion`, or an async question of the ask mod's.
export function requestKind(raised: Raised): 'permission' | 'question' | 'plan' {
  if (raised.tool === 'AskUserQuestion' || raised.async === true) return 'question';
  if (raised.tool === 'ExitPlanMode') return 'plan';
  return 'permission';
}

const refused = (code: 'unsupported' | 'not-pending' | 'bad-args', message: string): Decision => ({ ok: false, code, message });
const unavailable = (controls: Controls, key: string, otherwise: string): string => controls[key]?.reason ?? otherwise;
const misfit = (answer: RequestAnswer, kind: string) => refused('bad-args', `a ${answer.kind} answer does not fit this ${kind} request`);

async function hashOf(value: unknown): Promise<string | null> {
  try {
    return await inputSha256(value as JsonValue);
  } catch {
    return null; // no canonical form
  }
}

// `current` is the request as the bridge holds it now (its `GET /requests/<id>`); `held` the raised record the driver
// holds, which the card drew (null: none).
export async function decisionFor({ current, held, answer, controls }: { current: Raised; held: Raised | null; answer: RequestAnswer; controls: Controls }): Promise<Decision> {
  const kind = requestKind(current);
  switch (answer.kind) {
    case 'dialog':
    case 'elicitation':
      return refused('unsupported', unavailable(controls, 'elicitation.answer', 'answer this form in the terminal')); // the bridge raises neither
    case 'question': {
      if (kind !== 'question') return misfit(answer, kind);
      if (Object.keys(answer.answers).length > 0) return { ok: true, body: { behavior: 'allow', updatedInput: { answers: answer.answers } } };
      if (current.async === true) return refused('unsupported', 'an async question needs an answer');
      return { ok: true, body: { behavior: 'deny' } }; // every question skipped: a native question declined
    }
    case 'plan': {
      if (kind === 'question') return misfit(answer, kind);
      if (answer.outcome === 'clear_and_implement') return refused('unsupported', '/clear runs in the terminal');
      if (answer.outcome === 'implement') return { ok: true, body: { behavior: 'allow' } }; // the child carries the raw input
      return { ok: true, body: { behavior: 'deny', ...(typeof answer.feedback === 'string' && answer.feedback !== '' && { message: answer.feedback }) } };
    }
    case 'permission': {
      if (kind === 'question') {
        if (answer.decision !== 'deny') return misfit(answer, kind);
        if (current.async === true) return refused('unsupported', 'an async question is answered, never declined');
        return { ok: true, body: { behavior: 'deny' } };
      }
      if (answer.decision === 'deny_and_stop') return refused('unsupported', unavailable(controls, 'decide.interrupt', 'deny-and-interrupt is answered in the terminal'));
      if (answer.updatedInput !== undefined) return refused('unsupported', 'an edited input is answered in the terminal');
      if (answer.decision === 'deny') return { ok: true, body: { behavior: 'deny', ...(typeof answer.message === 'string' && answer.message !== '' && { message: answer.message }) } };
      if (answer.scope === undefined || answer.scope === 'once') return { ok: true, body: { behavior: 'allow' } };
      return scoped(current, held, answer.scope === 'session' ? 'session' : 'localSettings', controls);
    }
  }
}

async function scoped(current: Raised, held: Raised | null, destination: 'session' | 'localSettings', controls: Controls): Promise<Decision> {
  if (controls['decide.scope']?.available !== true) return refused('unsupported', unavailable(controls, 'decide.scope', 'a scoped allow is answered in the terminal'));
  const suggestions = current.suggestions;
  if (!Array.isArray(suggestions) || suggestions.length !== 1) return refused('unsupported', "a scoped allow takes the request's one suggestion; this request offers " + (Array.isArray(suggestions) ? String(suggestions.length) : 'none'));
  const suggestion = suggestions[0] as Record<string, unknown> | null;
  if (suggestion === null || typeof suggestion !== 'object' || !SCOPED_TYPES.has(String(suggestion.type))) {
    return refused('unsupported', `a scoped allow takes a rule or a directory the engine suggested, not ${String(suggestion?.type)}`);
  }
  if (destination === 'localSettings' && suggestion.destination !== 'localSettings') {
    return refused('unsupported', `local settings only where the engine suggested them; this suggestion is for ${String(suggestion.destination)}`);
  }
  const shown = Array.isArray(held?.suggestions) && held.suggestions.length === 1 ? held.suggestions[0] : undefined;
  const [drawn, now] = await Promise.all([shown === undefined ? null : hashOf(shown), hashOf(suggestion)]);
  if (drawn === null || now === null || drawn !== now) return refused('not-pending', 'the suggestions changed: the request no longer offers the one shown');
  return { ok: true, body: { behavior: 'allow', updatedPermissions: [{ ...suggestion, destination }] } };
}
