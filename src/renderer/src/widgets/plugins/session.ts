// Optional runtime facts alongside the cwd-based library. Customize never acquires a process; the session modal
// retains its explicit Refresh gesture. No session is unavailable, not an empty or unobserved loaded list.
import type { AppSessionId } from '@shared/graph/ids';
import type { Availability } from '@shared/ipc/schema/session';
import type { SessionPlugins } from './LoadedLine';
import type { Reloads } from './reload';

export interface PluginSession {
  appSessionId: AppSessionId;
  availability: Availability | null;
  loaded: SessionPlugins;
  reloads: Reloads | null;
  allowAcquire: boolean;
}

export const SESSION_UNAVAILABLE = 'Loaded plugins are unavailable without a running session.';
