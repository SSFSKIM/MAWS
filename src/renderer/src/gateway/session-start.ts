// C10's `session.start` as the route switch calls it (C11 execution document, Interfaces "Gateway", *The switch*; M4
// refresh task "the switch's failure and the queue"): the resume of the stopped session (`message: null`) with the
// switch's `gateway` and, for a Direct switch off a gateway model, the `model` and `effort` overrides. C10's
// `StartOutcome` has no failure status, so every outcome but `starting` is a refusal in words, and a resume refused
// after it started arrives as a `session.setup` event whose outcome is `error`, `relay_unreachable` or `held`.
import type { Effort } from '@shared/engine/launch-spec';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { SetupEvent, StartOutcome } from '@shared/sessions/setup';
import { holderWords } from '../sessions/holder-words';
import { START, type Route } from './copy';

export type StartOptions = { gateway: Route; model?: string | null; effort?: Effort | null };
export type StartAnswer = { status: 'starting' } | { status: 'refused'; reason: string };

export interface SessionStart {
  start(appSessionId: AppSessionId, options: StartOptions): Promise<StartAnswer>;
  // A setup failure of the session after its start answered `starting`, in words; answers the unsubscribe.
  onSetupFailure(appSessionId: AppSessionId, listener: (reason: string) => void): () => void;
}

// Why a start did not begin, in words; null for `starting`.
export function startRefusal(outcome: StartOutcome): string | null {
  switch (outcome.status) {
    case 'starting':
      return null;
    case 'needs_trust':
      return START.needsTrust;
    case 'relay_unreachable':
      return START.relayUnreachable;
    case 'held':
      return START.held(holderWords(outcome.holder));
    case 'already_live':
      return START.alreadyLive;
    case 'archived':
      return START.archived;
    case 'missing_directory':
      return START.missingDirectory(outcome.directory);
    case 'invalid':
    case 'refused':
      return outcome.message;
  }
}

function setupFailure(outcome: SetupEvent['outcome']): string | null {
  switch (outcome?.kind) {
    case 'error':
      return outcome.message;
    case 'relay_unreachable':
      return START.relayUnreachable;
    case 'held':
      return START.held(holderWords(outcome.holder));
    default:
      return null;
  }
}

export function sessionStartOver(client: MawsBridge): SessionStart {
  return {
    async start(appSessionId, options) {
      const result = await client.invoke('session.start', { appSessionId, message: null, options });
      if (!result.ok) return { status: 'refused', reason: result.error.message };
      const refusal = startRefusal(result.value);
      return refusal === null ? { status: 'starting' } : { status: 'refused', reason: refusal };
    },
    onSetupFailure(appSessionId, listener) {
      return client.on('session.setup', (event) => {
        if (event.appSessionId !== appSessionId || event.phase !== 'failed') return;
        const reason = setupFailure(event.outcome);
        if (reason !== null) listener(reason);
      });
    },
  };
}
