// The spine's project channel (P5 O8 M7b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7b, Interfaces §O):
// the journal of this machine's to-human entries per org project (./journal.ts), fed by lane B's source (./lane-b.ts) from
// the owner channel's event batches and states, and by lane A through `record`, which the endpoint's seam calls with
// sminos's sub-less RL10 host messages (O8 M7b Task 2). `channel.history` pages a project's entries; `channel.changed`
// tells each entry once, as it is recorded. An entry is validated here, at the journal's boundary, whichever lane sent
// it. A session's project is sminos's project id of its checkout, through the org-project join (OX3's `smnsId`).
import type { AppSessionId } from '@shared/graph/ids';
import { HISTORY_LIMIT_MAX, NewHostEntrySchema, type NewHostEntry } from '@shared/ipc/schema/channel';
import type { ServicesBus } from '@shared/spine/bus';
import type { Index } from '../index/index';
import type { HostEvents } from '../sessions/context';
import { LaneBSource, type LaneBPlace } from './lane-b';

export interface ChannelDeps {
  index: Pick<Index, 'channel' | 'sessions' | 'projects' | 'unavailable'>;
  onEvent: HostEvents; // the engine host's
  onEmitted: ServicesBus['onEmitted']; // the owner channel's states
  register: ServicesBus['register'];
  emit: ServicesBus['emit'];
  now?: () => number; // epoch ms; the tests' clock
  log?: (line: string) => void;
}

// What the endpoint's seam hands lane A's entries to (`EndpointServices.channel`, O8 M7b Task 2).
export interface ChannelRecorder {
  record(entry: NewHostEntry): void;
}

export interface ProjectChannel extends ChannelRecorder {
  stop(): void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function startChannel(deps: ChannelDeps): ProjectChannel {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line) => console.warn(`[channel] ${line}`));
  const journal = deps.index.channel;

  const record = (entry: NewHostEntry): void => {
    const parsed = NewHostEntrySchema.safeParse(entry);
    if (!parsed.success) {
      log(`an entry from lane ${String((entry as { lane?: unknown } | null)?.lane)} is not one, and is dropped: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
      return;
    }
    try {
      const stored = journal.record(parsed.data, now());
      if (stored !== null) deps.emit('channel.changed', { project: stored.project, entry: stored });
    } catch (error) {
      log(`an entry of ${parsed.data.project} could not be recorded: ${messageOf(error)}`);
    }
  };

  // The org-project join: the session's checkout, and its sminos id.
  const place = (appSessionId: AppSessionId): LaneBPlace | null => {
    const session = deps.index.sessions.get(appSessionId);
    if (session === null || session.projectId === null) return null;
    const project = deps.index.projects.org(session.projectId)?.smnsId ?? null;
    return project === null ? null : { project, engineSessionId: session.engineSessionId };
  };

  deps.register('channel.history', ({ project, before, limit }) => journal.history({ project, ...(before === undefined ? {} : { before }), limit: limit ?? HISTORY_LIMIT_MAX }, now()));

  const offs: (() => void)[] = [];
  if (deps.index.unavailable === null) {
    try {
      journal.prune(now());
    } catch (error) {
      log(`the journal could not be pruned at start: ${messageOf(error)}`);
    }
    const laneB = new LaneBSource({ place, record, recorded: (src) => journal.has(src) });
    const guarded = (what: string, read: () => void) => {
      try {
        read();
      } catch (error) {
        log(`${what} could not be read: ${messageOf(error)}`);
      }
    };
    offs.push(
      deps.onEvent('session.eventBatch', ({ appSessionId, events }) => guarded(`a batch of ${appSessionId}`, () => laneB.onEvents(appSessionId as AppSessionId, events))),
      deps.onEmitted('ownerChannel.changed', ({ appSessionId, state }) => guarded(`the owner channel's state of ${appSessionId}`, () => laneB.ownerChanged(state))),
    );
  } else log(`lane B's entries are not kept: index unavailable: ${deps.index.unavailable}`);

  return { record, stop: () => offs.splice(0).forEach((off) => off()) };
}
