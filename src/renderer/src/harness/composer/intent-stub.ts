// The harness's stand-in for C10's setup intent (C7 execution document, M4: "an unstarted session (the harness's stub
// intent hook)"): a small store of intents by session, registered as the composer's hook at module load, as C10's
// App.tsx block will register `useSetupIntent`. `start` stays pending until the test answers it; every start and
// patch is recorded (a patch applies to the stub intent, except `message`, which only the test sets).
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import { registerSetupIntentHook, type HookResult, type SetupIntent, type SetupIntentHook } from '../../composer/setup-intent';

interface StubState {
  intents: ReadonlyMap<string, SetupIntent>;
}

export const useStubIntents = create<StubState>()(() => ({ intents: new Map() }));

export const stubLog = {
  starts: [] as { appSessionId: string; content: unknown; display: string }[],
  patches: [] as { appSessionId: string; patch: Record<string, unknown> }[],
  pending: [] as ((result: HookResult) => void)[],
};

export function setStubIntent(appSessionId: string, intent: SetupIntent | null): void {
  useStubIntents.setState((s) => {
    const intents = new Map(s.intents);
    if (intent) intents.set(appSessionId, intent);
    else intents.delete(appSessionId);
    return { intents };
  });
}

function useStubIntent(appSessionId: AppSessionId): SetupIntentHook | null {
  const intent = useStubIntents((s) => s.intents.get(appSessionId) ?? null);
  if (!intent) return null;
  return {
    intent,
    options: {
      locations: [intent.location, { kind: 'newWorktree', repoRoot: intent.location.kind === 'directory' ? intent.location.path : '', name: 'harness-wt', branch: { kind: 'new', name: 'worktree-harness-wt', base: 'HEAD' } }],
      branches: ['main'],
      models: [
        { value: 'sonnet', displayName: 'Sonnet', supportsAutoMode: true },
        { value: 'haiku', displayName: 'Haiku', supportsAutoMode: false },
      ],
      autoModeNote: null,
    },
    async patch(patch) {
      stubLog.patches.push({ appSessionId, patch: patch as Record<string, unknown> });
      const held = useStubIntents.getState().intents.get(appSessionId);
      if (held) setStubIntent(appSessionId, { ...held, ...patch });
      return { ok: true };
    },
    start(first) {
      stubLog.starts.push({ appSessionId, content: first.content, display: first.display });
      return new Promise<HookResult>((resolve) => stubLog.pending.push(resolve));
    },
  };
}

registerSetupIntentHook(useStubIntent);
