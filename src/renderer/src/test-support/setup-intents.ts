// Builders for C10's renderer suites: intents, trust states, relay health and setup failures as main answers them.
import type { AppSessionId } from '@shared/graph/ids';
import type { RelayHealth } from '@shared/engine/relay-health';
import type { SetupIntent } from '@shared/sessions/intent';
import type { SetupResources } from '@shared/sessions/setup';
import type { TrustState } from '@shared/sessions/trust';
import { useSetup } from '../sessions/store';

export const T0 = '2026-09-29T10:00:00.000Z';
export const ID = '11111111-1111-4111-8111-111111111111' as AppSessionId;
export const REPO = '/private/tmp/maws-e2e/repo';
export const MESSAGE = { content: 'Reply OK', display: 'Reply OK' };

export function intent(over: Partial<SetupIntent> = {}): SetupIntent {
  return {
    appSessionId: ID,
    projectId: null,
    createdAt: T0,
    updatedAt: T0,
    kind: 'create',
    source: null,
    location: { kind: 'directory', path: REPO },
    additionalDirectories: [],
    model: null,
    effort: null,
    permissionMode: null,
    gateway: 'gateway',
    trust: 'unanswered',
    trustKey: null,
    message: null,
    draft: null,
    progress: { engineSessionId: null, worktree: null, trustRecorded: false, bootstrap: null, launch: null, send: null, lastFailure: null },
    ...over,
  };
}

export function trustState(over: Partial<TrustState> = {}): TrustState {
  return {
    directory: REPO,
    trustKey: REPO,
    keyKind: 'repo',
    configPath: '/private/tmp/maws-e2e/config/.claude.json',
    trusted: false,
    source: null,
    isHome: false,
    found: [
      { file: '.claude/settings.json', summary: '1 allow rule, 1 hook' },
      { file: '.mcp.json', summary: '1 MCP server: c10-sentinel' },
    ],
    ...over,
  };
}

export function health(over: Partial<RelayHealth> = {}): RelayHealth {
  return { url: 'http://127.0.0.1:8641', ok: false, status: null, latencyMs: null, checkedAt: T0, error: 'connect ECONNREFUSED', ...over };
}

export function resources(over: Partial<SetupResources> = {}): SetupResources {
  return { worktree: null, record: 'removed', transcript: 'none', ...over };
}

export function resetSetupStore(): void {
  useSetup.setState({ loaded: true, intents: new Map(), phases: new Map(), cards: new Map(), invoking: new Set(), deletions: new Map(), dismissed: new Set(), removed: new Set(), resumes: new Map() });
}

export function putIntent(value: SetupIntent): void {
  useSetup.getState().setIntent(value);
}
