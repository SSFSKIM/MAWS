// P5 O17 M9b (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M9): the supervisor's relay of a host's events. Each
// goes to the windows, then to main's listeners (supervisor.ts: those hear what the relay took), unless it is main's
// alone: `mawsd`'s `browserEngine.request` to the app's tab engine carries a remote person's keys and text, which no
// window reads. Taken (true) without a window told, so main's listeners still hear it.
import type { EventName, EventPayload } from '@shared/ipc/schema';

type Relay = <N extends EventName>(name: N, payload: EventPayload<N>) => boolean;

const MAIN_ONLY_EVENTS: ReadonlySet<EventName> = new Set<EventName>(['browserEngine.request']);

export function hostEventToWindows(windows: Relay): Relay {
  return (name, payload) => MAIN_ONLY_EVENTS.has(name) || windows(name, payload);
}
