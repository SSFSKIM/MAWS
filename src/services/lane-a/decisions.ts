// Answers and decisions (P5 O9 M2, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, Interfaces §D): a card's
// `RequestAnswer` mapped to the bridge's decision body (`POST /requests/<id>/decision`) from its typed fields, or refused
// when lane A can't carry it. The mapping is lane A's own, shared with the remote adapter (@shared/lane-a/answers).
// A direct DX5 client gets none of the checks sminos's daemon makes on a remote RPC, and the child hands any rule list to
// the engine, so the driver makes the daemon's checks itself: a scope only from the request's own one suggestion (the
// shared mapping's rule), checked by the SHA-256 of its canonical JSON against the raised record the driver holds (what
// the card drew), as `sminos_rpc.py` checks a remote one's.
import type { RequestAnswer } from '@shared/engine/answers';
import { answerIntent, suggestionSha256, type Controls } from '@shared/lane-a/answers';

export { requestKind } from '@shared/lane-a/answers';

type Raised = Record<string, unknown>;
export type Decision = { ok: true; body: Record<string, unknown> } | { ok: false; code: 'unsupported' | 'not-pending' | 'bad-args'; message: string };

// `current` is the request as the bridge holds it now (its `GET /requests/<id>`); `held` the raised record the driver
// holds, which the card drew (null: none).
export async function decisionFor({ current, held, answer, controls }: { current: Raised; held: Raised | null; answer: RequestAnswer; controls: Controls }): Promise<Decision> {
  const read = answerIntent({ raised: current, answer, controls });
  if (!read.ok) return read;
  const { intent } = read;
  switch (intent.kind) {
    case 'allow':
      return { ok: true, body: { behavior: 'allow' } }; // a plan's too: the child carries the raw input
    case 'deny':
      return { ok: true, body: { behavior: 'deny', ...(intent.message !== undefined && { message: intent.message }) } };
    case 'answers':
      return { ok: true, body: { behavior: 'allow', updatedInput: { answers: intent.answers } } };
    case 'allow-scoped': {
      const shown = Array.isArray(held?.suggestions) && held.suggestions.length === 1 ? held.suggestions[0] : undefined;
      const [drawn, now] = await Promise.all([shown === undefined ? null : suggestionSha256(shown), suggestionSha256(intent.suggestion)]);
      if (drawn === null || now === null || drawn !== now) return { ok: false, code: 'not-pending', message: 'the suggestions changed: the request no longer offers the one shown' };
      return { ok: true, body: { behavior: 'allow', updatedPermissions: [{ ...intent.suggestion, destination: intent.destination }] } };
    }
  }
}
