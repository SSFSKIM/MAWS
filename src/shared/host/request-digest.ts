// Lane B's request digest (O10 M7; RL4): DX6's `Digest` (`{session, request, tool, input_sha256}`), drawn from a pending
// request's originating event, so an answer is bound to the request as its sender saw it. The engine host compares an
// answer's digest with the one it draws from the broker's item now (`host.op`, `digest-mismatch`); a device draws the same
// from the request it shows (M8's `cards` view hydrates it).
//
// The shape is lane A's (desk-hub's `inputSha256`: the lowercase hex SHA-256 of the RFC 8785 JSON of the tool input),
// so a device draws a digest one way on either lane. `session` is the appSessionId, the lane B session an action names;
// `tool` and what is hashed are the tool call's where lane A has one:
//   - a permission: its `toolName`, its `input`;
//   - a question: `AskUserQuestion`, `{questions}`;
//   - a plan: `ExitPlanMode`, its `input` (the tool input, carried whole);
//   - a request with no lane A counterpart (a dialog, an elicitation): its event kind, its `payload`.
// A question's event carries its questions normalized (normalizer-controls.ts's `questionOf`: every field present, an
// absent one null, nothing else kept), not the tool input, so its hash equals lane A's for the same engine call only when
// that input was already in normalized form. Lane B stays sound, since the device and the host hash the same event;
// byte equality for every input needs the raw input on `question.requested`, which M7 does not change.
import { createHash } from 'node:crypto';
import { canonicalize } from 'org-protocol';
import type { SessionEvent } from '@shared/graph/events';

export type RequestDigest = { session: string; request: string; tool: string; input_sha256: string };

export function requestDigestOf(appSessionId: string, event: SessionEvent): RequestDigest | null {
  const fields = event as unknown as Record<string, unknown>;
  if (typeof fields.requestId !== 'string' || typeof fields.kind !== 'string' || !fields.kind.endsWith('.requested')) return null;
  const [tool, asked] = askedOf(fields.kind, fields);
  let canonical: string;
  try {
    canonical = canonicalize(asked ?? null);
  } catch {
    return null;
  }
  return { session: appSessionId, request: fields.requestId, tool, input_sha256: createHash('sha256').update(canonical, 'utf8').digest('hex') };
}

/** The tool a request is named by and what it asks, as lane A draws them from the tool call. */
function askedOf(kind: string, fields: Record<string, unknown>): [string, unknown] {
  if (kind === 'question.requested') return ['AskUserQuestion', { questions: fields.questions }];
  if (kind === 'plan.requested') return ['ExitPlanMode', fields.input];
  if (typeof fields.toolName === 'string') return [fields.toolName, fields.input];
  return [kind, fields.payload];
}
