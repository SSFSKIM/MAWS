// `org.*`'s handlers (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §B): the Org
// section's reads and acts on the production session, and `org.changed` at each change of its status. Under
// `MAWS_DEV_ORG` (O7's development session, unpackaged builds only) there is no production session: the status says
// `development`, from the development session's identity once it has loaded, and every act is refused `busy`.
//
// M2 adds `org.rows` (registerRowsHandler).
//
// Electron-free: main injects its `registerMainHandler` and `emit`.
import type { OrgAttempt, OrgRows, OrgStatus } from '@shared/ipc/schema/org';
import type { MainHandler } from '../ipc/router';
import type { OrgSessionService } from './org-session';
import type { OrgSession } from './session';

type OrgCommand = 'org.status' | 'org.register' | 'org.signIn' | 'org.reanchor' | 'org.cancel' | 'org.signOut';

export function registerOrgHandlers(deps: {
  register<N extends OrgCommand>(name: N, handler: MainHandler<N>): void;
  emit(name: 'org.changed', status: OrgStatus): void;
  /** The production session; null under `MAWS_DEV_ORG`. */
  service: OrgSessionService | null;
  /** O7's development session, when it is the one main runs. */
  development: OrgSession | null;
}): () => void {
  const { service, development } = deps;
  if (service === null) {
    const status = (): OrgStatus => {
      const identity = development?.current()?.identity;
      return { state: 'development', org: identity?.org ?? '', member: identity?.member ?? '', device: identity?.device ?? '' };
    };
    const refused: OrgAttempt = { ok: false, reason: { code: 'busy', detail: 'MAWS_DEV_ORG is in force' } };
    deps.register('org.status', status);
    deps.register('org.register', () => refused);
    deps.register('org.signIn', () => refused);
    deps.register('org.reanchor', () => refused);
    deps.register('org.cancel', () => {});
    deps.register('org.signOut', () => Promise.resolve());
    return development?.onChanged(() => deps.emit('org.changed', status())) ?? (() => {});
  }
  deps.register('org.status', () => service.status());
  deps.register('org.register', ({ code }) => service.register(code));
  deps.register('org.signIn', () => service.signIn());
  deps.register('org.reanchor', ({ code }) => service.reanchor(code));
  deps.register('org.cancel', () => service.cancel());
  deps.register('org.signOut', () => service.signOut());
  return service.onStatus((status) => deps.emit('org.changed', status));
}

/** M2: `org.rows`, the remote rows main holds (rows.ts); `org.rows.changed` goes out from the rows source's own `emit`. */
export function registerRowsHandler(deps: { register(name: 'org.rows', handler: MainHandler<'org.rows'>): void; rows: { rows(): OrgRows } }): void {
  deps.register('org.rows', () => deps.rows.rows());
}
