// Lane B's request digest (O10 M7; RL4): DX6's `Digest` (`{session, request, tool, input_sha256}`), drawn from a pending
// request's originating event, so an answer is bound to the request as its sender saw it. The engine host compares an
// answer's digest with the one it draws from the broker's item now (`host.op`, `digest-mismatch`); a device draws the same
// from the request it shows (M8's `cards` view hydrates it). `session` is the appSessionId, the lane B session an
// action names; `tool` is a permission's tool, and for any other request its event kind; `input_sha256` is the lowercase
// hex SHA-256 of the canonical JSON (RFC 8785) of what it asks: its `input`, else its `questions`, else its `payload`.
import { createHash } from 'node:crypto';
import { canonicalize } from 'org-protocol';
import type { SessionEvent } from '@shared/graph/events';

export type RequestDigest = { session: string; request: string; tool: string; input_sha256: string };

export function requestDigestOf(appSessionId: string, event: SessionEvent): RequestDigest | null {
  const fields = event as unknown as Record<string, unknown>;
  if (typeof fields.requestId !== 'string' || typeof fields.kind !== 'string' || !fields.kind.endsWith('.requested')) return null;
  const tool = typeof fields.toolName === 'string' ? fields.toolName : fields.kind;
  const asked = 'input' in fields ? fields.input : 'questions' in fields ? fields.questions : 'payload' in fields ? fields.payload : null;
  let canonical: string;
  try {
    canonical = canonicalize(asked ?? null);
  } catch {
    return null;
  }
  return { session: appSessionId, request: fields.requestId, tool, input_sha256: createHash('sha256').update(canonical, 'utf8').digest('hex') };
}
