// Host hooks (charter §4.2; C3 execution document, Interfaces "X6", `HostHookRegistry`): hook callbacks the host
// registers with `initialize.hooks` and answers when the engine sends `hook_callback`. None run in P0 production
// launches; the conformance and live tests exercise the mechanism. Callback ids are `maws_<event>_<n>`. Host hooks
// round-trip without lifecycle frames and are absent from `get_hooks_listing` (pass 2 `hooks`).
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
