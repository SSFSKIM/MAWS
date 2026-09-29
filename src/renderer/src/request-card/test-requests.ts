// Request events and attention items for the request card's tests: the originating `*.requested` event of a probe
// fixture row or of a synthetic request under test/fixtures/requests, normalised by C3's own normaliser (the path the
// harness and C6's tests use), and the X1 item C3's broker would publish for it. Imported by tests only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AttentionItem } from '@shared/graph/attention';
import type { AttentionKind } from '@shared/graph/enums';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { loadJournal, TEST_FIXTURE_DIR, type FixturePass } from '../../../../test/support/fixtures';
import { journalToEvents } from '../transcript/dev/journal';

export type RequestEvent = Extract<SessionEvent, { kind: `${string}.requested` }>;
export type PermissionEvent = Extract<SessionEvent, { kind: 'permission.requested' }>;

const REQUEST_KINDS = new Set(['permission.requested', 'question.requested', 'plan.requested', 'dialog.requested', 'elicitation.requested']);

// The request event the fixture's row `seq` produces.
export function fixtureRequest(pass: FixturePass, name: string, seq: number): RequestEvent {
  const event = journalToEvents(loadJournal(pass, name)).find((e) => e.seq === seq && REQUEST_KINDS.has(e.kind));
  if (!event) throw new Error(`${pass}/${name} seq ${seq} yields no request event`);
  return event as RequestEvent;
}

// A synthetic request (`test/fixtures/requests/<name>.json`), its frame replayed as one `in` row; `patch` edits the
// wire request first (a flag removed, another added).
export function syntheticRequest(name: string, patch: (request: Record<string, unknown>) => void = () => {}): RequestEvent {
  const { frame } = JSON.parse(readFileSync(join(TEST_FIXTURE_DIR, 'requests', `${name}.json`), 'utf8')) as { frame: { request: Record<string, unknown> } };
  patch(frame.request);
  const row = { seq: 1, direction: 'in', at: '2026-09-29T09:00:00.000Z', frame } as JournalRow;
  const event = journalToEvents([row]).find((e) => REQUEST_KINDS.has(e.kind));
  if (!event) throw new Error(`requests/${name} yields no request event`);
  return event as RequestEvent;
}

// A permission event with the fields a test names (C3's normaliser shape, the optional C7 fields absent unless given).
export function permission(over: Partial<PermissionEvent> = {}): PermissionEvent {
  return {
    id: 'evt-perm' as PermissionEvent['id'], sessionId: 's-1' as PermissionEvent['sessionId'], at: '2026-09-29T09:00:00.000Z', seq: null, agentId: null, parentToolUseId: null,
    kind: 'permission.requested', requestId: 'req-perm' as PermissionEvent['requestId'], toolUseId: 'toolu_perm' as PermissionEvent['toolUseId'], toolName: 'Bash',
    displayName: 'Bash', input: { command: 'ls' }, description: null, decisionReasonType: null, suggestions: [], blockedPath: null, ...over,
  };
}

const KIND_OF: Record<RequestEvent['kind'], AttentionKind> = {
  'permission.requested': 'permission',
  'question.requested': 'question',
  'plan.requested': 'plan',
  'dialog.requested': 'dialog',
  'elicitation.requested': 'elicitation',
};

// The attention item C3's broker publishes for the request, in `appSessionId`.
export function itemFor(event: RequestEvent, appSessionId = 'app-test', over: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: `att-${event.requestId}` as AttentionId, appSessionId: appSessionId as AppSessionId, sessionId: event.sessionId, kind: KIND_OF[event.kind],
    request: { requestId: event.requestId, toolUseId: 'toolUseId' in event ? event.toolUseId : null, taskId: null, agentId: event.agentId },
    summary: event.kind, createdAt: event.at, state: 'pending', stateChangedAt: event.at, expiresAt: null, ...over,
  };
}
