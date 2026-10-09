// Stand-ins for P2-A's names (P2-B execution document §5.6; the interface ledger §1), only until A's are on master: the
// rebase that brings A's replaces each import of this file with A's module and deletes the file, nothing kept beside
// them. Each has A's signature and file-level shape as built on A's branch: `useLoadedPlugins`, `Freshness`, `FRESHNESS`
// and the plugin types (`src/renderer/src/sessions/observed.ts`, `src/shared/engine/observed-facts.ts`),
// `useAvailability` and `Availability` (`sessions/availability.ts`, `src/shared/ipc/schema/session.ts`), and
// `acquisitionWords` and `AcquireOutcome` (`sessions/acquire.ts`, `src/shared/sessions/setup.ts`). What they answer
// is the engine status only (no observed facts file before A): the loaded list is the status's whenever there is one,
// "now" when its process is ready; a status that outlived its process keeps the list it last reported, as E8 drew it,
// with freshness `unknown` because the status says no time (so the line names none, never an invented one; the
// architect's ruling of 2026-10-09: no stand-in draws less than master did). Availability is usable or resumable, and
// there is no `refresh` (A's M3 adds it).
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { StartOutcome } from '@shared/sessions/setup';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { relativeAge } from '../../app/relative-age';
import { holderWords } from '../../sessions/holder-words';
import { useSessions } from '../../stores/sessions';

export type ObservedPlugin = EngineSessionStatus['plugins'][number];
export type ObservedPluginError = EngineSessionStatus['pluginErrors'][number];
export type ObservedPluginWarning = EngineSessionStatus['pluginWarnings'][number];

export type Freshness = { kind: 'now' } | { kind: 'last'; at: string } | { kind: 'unknown' };

const ago = (at: string, now: number) => relativeAge(Math.max(0, now - Date.parse(at)));
export const FRESHNESS = {
  loadedNow: 'Loaded now',
  loadedLast: (at: string, now = Date.now()) => `Loaded last time, ${ago(at, now)}`,
  notObserved: 'Not observed yet',
};

export interface LoadedPlugins {
  plugins: ObservedPlugin[];
  errors: ObservedPluginError[];
  warnings: ObservedPluginWarning[];
  freshness: Freshness;
}

const UNKNOWN: LoadedPlugins = { plugins: [], errors: [], warnings: [], freshness: { kind: 'unknown' } };

export function useLoadedPlugins(appSessionId: AppSessionId): LoadedPlugins {
  const status = useSessions(useShallow((s) => s.engine.get(appSessionId) ?? null));
  return useMemo(() => (status ? { plugins: status.plugins, errors: status.pluginErrors, warnings: status.pluginWarnings, freshness: status.process === 'ready' ? { kind: 'now' } : { kind: 'unknown' } } : UNKNOWN), [status]);
}

export type Availability = 'usable' | 'starting' | 'resumable' | 'foreign_held' | 'archived' | 'missing_directory' | 'needs_trust' | 'failed';

export function useAvailability(appSessionId: AppSessionId): Availability | null {
  return useSessions((s) => (s.engine.get(appSessionId)?.process === 'ready' ? 'usable' : s.records.has(appSessionId) || s.engine.has(appSessionId) ? 'resumable' : null));
}

export type AcquireOutcome =
  | { status: 'ready'; appSessionId: string; launched: boolean; joined: boolean }
  | Exclude<StartOutcome, { status: 'starting' | 'already_live' }>
  | { status: 'failed'; appSessionId: string; message: string };

export const ARCHIVED = 'Archived · unarchive it to continue';
export const TRUST_FIRST = 'Trust this folder in the session to continue';
export const RELAY_FIRST = 'The relay is unreachable · the session offers Run direct';

// What a surface other than the composer says when the attempt docked a card in the session's composer.
export const cardWords = (outcome: Extract<AcquireOutcome, { status: 'needs_trust' | 'relay_unreachable' }>): string => (outcome.status === 'needs_trust' ? TRUST_FIRST : RELAY_FIRST);

// The words a surface shows for an attempt that did not end ready; null for ready and for a card, which explains itself.
export function acquisitionWords(outcome: AcquireOutcome): string | null {
  switch (outcome.status) {
    case 'ready':
    case 'needs_trust':
    case 'relay_unreachable':
      return null;
    case 'held':
      return `Held by ${holderWords(outcome.holder)}`;
    case 'missing_directory':
      return `Directory not found: ${outcome.directory}`;
    case 'archived':
      return ARCHIVED;
    case 'invalid':
    case 'refused':
    case 'failed':
      return outcome.message;
  }
}
