// `org.*`'s handlers (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §B): the Org
// section's reads and acts on the production session, and `org.changed` at each change of its status. Under
// `MAWS_DEV_ORG` (O7's development session, unpackaged builds only) there is no production session: the status says
// `development`, from the development session's identity once it has loaded, and every act is refused `busy`.
//
// M2 adds `org.rows` (registerRowsHandler). M3 adds the signer's acts: `org.resign`, `org.revokeSuperseded`, `org.rekey`,
// `org.discardPending` and `org.resetSigning`, each refused under `MAWS_DEV_ORG` as the rest are. M4a adds the Org page's
// `org.view`, `org.preview`, `org.change` and `org.pair.*` (under `MAWS_DEV_ORG`: no view, and every act refused).
//
// Electron-free: main injects its `registerMainHandler` and `emit`.
import type { DiscardResult, OrgAttempt, OrgRows, OrgStatus, PairStartResult, PreviewResult, SignResult } from '@shared/ipc/schema/org';
import type { MainHandler } from '../ipc/router';
import type { OrgSessionService } from './org-session';
import type { OrgSession } from './session';

type OrgCommand =
  | 'org.status'
  | 'org.register'
  | 'org.signIn'
  | 'org.reanchor'
  | 'org.cancel'
  | 'org.signOut'
  | 'org.resign'
  | 'org.revokeSuperseded'
  | 'org.rekey'
  | 'org.discardPending'
  | 'org.resetSigning'
  | 'org.view'
  | 'org.preview'
  | 'org.change'
  | 'org.pair.start'
  | 'org.pair.approve'
  | 'org.pair.cancel';

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
    const unsigned: SignResult = { ok: false, reason: 'busy', detail: 'MAWS_DEV_ORG is in force' };
    const undiscarded: DiscardResult = { ok: false, reason: 'none' };
    deps.register('org.status', status);
    deps.register('org.register', () => refused);
    deps.register('org.signIn', () => refused);
    deps.register('org.reanchor', () => refused);
    deps.register('org.cancel', () => {});
    deps.register('org.signOut', () => Promise.resolve());
    deps.register('org.resign', () => unsigned);
    deps.register('org.revokeSuperseded', () => unsigned);
    deps.register('org.rekey', () => refused);
    deps.register('org.discardPending', () => undiscarded);
    deps.register('org.resetSigning', () => {});
    const unpreviewed: PreviewResult = { ok: false, reason: 'not-root', detail: 'MAWS_DEV_ORG is in force', findings: [] };
    const unpaired: PairStartResult = { ok: false, reason: 'busy', detail: 'MAWS_DEV_ORG is in force' };
    deps.register('org.view', () => null);
    deps.register('org.preview', () => unpreviewed);
    deps.register('org.change', () => unsigned);
    deps.register('org.pair.start', () => unpaired);
    deps.register('org.pair.approve', () => unsigned);
    deps.register('org.pair.cancel', () => {});
    return development?.onChanged(() => deps.emit('org.changed', status())) ?? (() => {});
  }
  deps.register('org.status', () => service.status());
  deps.register('org.register', ({ code }) => service.register(code));
  deps.register('org.signIn', () => service.signIn());
  deps.register('org.reanchor', ({ code }) => service.reanchor(code));
  deps.register('org.cancel', () => service.cancel());
  deps.register('org.signOut', () => service.signOut());
  deps.register('org.resign', () => service.resign());
  deps.register('org.revokeSuperseded', ({ offer }) => service.revokeSuperseded(offer));
  deps.register('org.rekey', ({ code }) => service.rekey(code));
  deps.register('org.discardPending', ({ confirmed, hash }) => service.discardPending(confirmed, hash));
  deps.register('org.resetSigning', ({ confirmed }) => service.resetSigning(confirmed));
  deps.register('org.view', () => service.view());
  deps.register('org.preview', ({ change }) => service.preview(change));
  deps.register('org.change', ({ change, digest }) => service.change(change, digest));
  deps.register('org.pair.start', (input) => service.pairStart(input));
  deps.register('org.pair.approve', (input) => service.pairApprove(input));
  deps.register('org.pair.cancel', () => service.pairCancel());
  return service.onStatus((status) => deps.emit('org.changed', status));
}

/** M2: `org.rows`, the remote rows main holds (rows.ts); `org.rows.changed` goes out from the rows source's own `emit`. */
export function registerRowsHandler(deps: { register(name: 'org.rows', handler: MainHandler<'org.rows'>): void; rows: { rows(): OrgRows } }): void {
  deps.register('org.rows', () => deps.rows.rows());
}
