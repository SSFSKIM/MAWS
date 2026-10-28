// Host hooks (charter §4.2; C3 execution document, Interfaces "X6", `HostHookRegistry`): hook callbacks the host
// registers with `initialize.hooks` and answers when the engine sends `hook_callback`. Callback ids are
// `maws_<event>_<n>`. Host hooks round-trip without lifecycle frames and are absent from `get_hooks_listing` (pass 2
// `hooks`). P5 O2 M2: every launch registers one, the Stop callback the strict idle release reads the session's crons
// from (work-state.ts); `appHostHooks` is the `initialize.hooks` that gives, which app replays project onto a recording
// (replay-handshake.ts), as they project the app's other launch-owned fields.
import type { InitializeRequest } from '@shared/wire/control';
import type { RequestId } from '@shared/graph/ids';

export type HostHook = (input: Record<string, unknown>, ctx: { requestId: RequestId; toolUseId: string | null }) => unknown;

interface Registered {
  id: string;
  event: string;
  matcher: string | null;
  fn: HostHook;
  timeoutSec: number | undefined;
}

export class HostHookRegistry {
  private readonly hooks = new Map<string, Registered>();
  private counter = 0;

  // Returns the callback id the engine will name in `hook_callback.callback_id`.
  register(event: string, matcher: string | null, fn: HostHook, timeoutSec?: number): string {
    const id = `maws_${event}_${++this.counter}`;
    this.hooks.set(id, { id, event, matcher, fn, timeoutSec });
    return id;
  }

  get(callbackId: string): HostHook | undefined {
    return this.hooks.get(callbackId)?.fn;
  }

  ids(): string[] {
    return [...this.hooks.keys()];
  }

  // The `initialize.hooks` value (pass 2 `hooks` seq 3: `{ PreToolUse: [{ matcher, hookCallbackIds, timeout }] }`), or
  // undefined when nothing is registered so the key is omitted.
  forInitialize(): InitializeRequest['hooks'] | undefined {
    if (this.hooks.size === 0) return undefined;
    const out: NonNullable<InitializeRequest['hooks']> = {};
    for (const hook of this.hooks.values()) {
      const entry: { matcher?: string; hookCallbackIds: string[]; timeout?: number } = { hookCallbackIds: [hook.id] };
      if (hook.matcher !== null) entry.matcher = hook.matcher;
      if (hook.timeoutSec !== undefined) entry.timeout = hook.timeoutSec;
      (out[hook.event] ??= []).push(entry);
    }
    return out;
  }
}

// P5 O2 M2: the Stop callback every EngineSession registers first in its registry (no matcher; 10 s, though it answers
// `{}` at once and never blocks a stop), and the `initialize.hooks` a session with only it sends.
export const STOP_HOOK = { event: 'Stop', matcher: null, timeoutSec: 10 } as const;

export function registerStopHook(registry: HostHookRegistry, fn: HostHook): string {
  return registry.register(STOP_HOOK.event, STOP_HOOK.matcher, fn, STOP_HOOK.timeoutSec);
}

export function appHostHooks(): NonNullable<InitializeRequest['hooks']> {
  const registry = new HostHookRegistry();
  registerStopHook(registry, () => ({}));
  return registry.forInitialize()!;
}

// The Stop callback's ids, whose event input the normaliser keeps without the turn's last assistant message.
export const isStopCallbackId = (callbackId: string): boolean => /^maws_Stop_\d+$/.test(callbackId);
