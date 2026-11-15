// A connector's row in My items (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §E; cut out
// of ConnectorsSection.tsx with its code kept): the image, the configured name, "<scope> scope · <transport>", the
// sign-in state, Cancel while a sign-in runs, Sign in or why not, Remove, the file's path on the second line, and the
// operation's line. What depends on the kind of connector (what follows the name, the second line, which sign-in it
// sends, whether it has Remove) is decided on `row.kind` in `partsOf`, so that a second kind is one branch there.
// The row's parts are named for what later columns read: `data-connector-main` (the name, what follows it, the state)
// and `data-connector-trailing` (Cancel, Sign in or its sentence, Remove).
// A row the engine does not use (the same name in a scope it ranks higher, or MAWS's own server of the name; ./present.ts
// `shadowedBy`) says which entry shadows it and offers no Sign in: the engine signs a name in, so Sign in belongs to the
// row it uses. U11a M8: a row of MAWS's own list is a dynamic connector to the sign-in, offered only with its
// configuration's revision. UX wave U11c M1 (§C): its image, the icon of the one directory record its address matches
// (the posture's), else its tile.
import type { AppSessionId } from '@shared/graph/ids';
import type { CustomizationServer } from '@shared/ipc/schema/customization';
import type { PluginsScope } from '@shared/plugins/cli';
import { SECONDARY } from '../../sessions/ui';
import { OperationLine, useManage } from '../../widgets/plugins/manage';
import { TextButton } from '../../widgets/parts';
import { ItemImage } from '../image/ItemImage';
import { CONNECTORS as C } from './copy';
import type { AskIn } from './manage';
import { removalDirectoryOf, removeRequestOf, resultFor, shadowWords, signInViewOf, type AuthPosture, type SignInFacts, type SignInView } from './present';
import type { ConnectorRowModel } from './rows';
import { cancelSignIn, signInKeyOf, signInMachineOf, signsInDynamic, startSignIn, startSignInDynamic, useSignIns, type SignInServer } from './sign-in';

const BUTTON = 'rounded-sm px-2 py-1 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint';
const TONE: Record<SignInView['tone'], string> = { muted: 'text-fg-muted', success: 'text-success', danger: 'text-danger' };

export interface ConnectorRowProps {
  row: ConnectorRowModel;
  askIn: AskIn;
  shadow: CustomizationServer['scope'] | null;
  cwd: string | null;
  place: string | null;
  session: string | null; // the ready session a Sign in runs in, or none
  live: SignInFacts['live'];
  liveRead: SignInFacts['liveRead'];
  posture: AuthPosture | null;
  fingerprint: string | null;
  revision: string | null;
  iconUrl: string | null;
}

// What the row draws and sends for its kind: the words after the name, the second line, the server a sign-in is kept
// for, where a file sign-in runs, and the removal.
function partsOf(row: ConnectorRowModel, cwd: string | null) {
  switch (row.kind) {
    case 'configured': {
      const own = row.scope === 'app';
      const target = own ? null : { name: row.name, scope: row.scope as PluginsScope, cwd, path: row.path };
      const kept: Omit<SignInServer, 'machine'> | null = own ? (signsInDynamic(row.name) ? { name: row.name, scope: 'dynamic', cwd: null } : null) : target;
      return { after: [C.scopeOf(row.scope), row.transport].filter(Boolean).join(' · '), second: row.path, own, target, kept, remove: removeRequestOf(row), runIn: removalDirectoryOf(row) };
    }
  }
}

export function ConnectorRow({ row, askIn, shadow, cwd, place, session, live, liveRead, posture, fingerprint, revision, iconUrl }: ConnectorRowProps) {
  const { ops } = useManage();
  const { after, second, own, target, kept, remove, runIn } = partsOf(row, cwd);
  // P5 O7 M5c: the result of the machine its Sign in runs on (a session's address names it; none, this Mac)
  const machine = signInMachineOf(session);
  const record = resultFor(useSignIns((s) => (kept === null ? null : (s.byServer.get(signInKeyOf({ ...kept, machine })) ?? null))), fingerprint);
  const last = record?.event ?? null;
  const state: SignInView | null = shadow !== null ? { text: shadowWords(shadow, row.name), tone: 'muted', signIn: false, cancel: false } : signInViewOf({ live, liveRead, posture, last: record, transport: row.transport });
  const busy = ops.entries.get(row.key)?.state.phase === 'working';
  return (
    <li data-connector={row.name} data-connector-scope={row.scope} className="flex min-w-0 items-start gap-3 border-b border-border px-2 py-2 last:border-b-0">
      <ItemImage kind="connector" seed={row.name} iconUrl={iconUrl} size="row" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span data-connector-main className="contents">
            <span className="font-medium [overflow-wrap:anywhere]">{row.name}</span>
            <span className="text-ui-sm text-fg-muted">{after}</span>
            {state?.text && (
              <span data-sign-in-state className={`text-ui-sm ${TONE[state.tone]}`}>
                {state.text}
              </span>
            )}
          </span>
          <span data-connector-trailing className="ml-auto flex shrink-0 items-baseline gap-1">
            {state?.cancel && last && <TextButton onClick={() => cancelSignIn(last.opId, record!.appSessionId)}>{C.cancel}</TextButton>}
            {state?.signIn &&
              (own ? (
                // U11a M8: only with the revision the press must carry, so it signs in this configuration or nothing
                kept !== null &&
                revision !== null &&
                (session === null ? (
                  <span data-sign-in-needs-session className="text-ui-sm text-fg-muted">
                    {C.openSession(null)}
                  </span>
                ) : (
                  <button type="button" aria-label={C.signInName(row.name)} className={SECONDARY} onClick={() => void startSignInDynamic({ name: row.name, revision }, fingerprint, session as AppSessionId)}>
                    {C.signIn}
                  </button>
                ))
              ) : session === null ? (
                <span data-sign-in-needs-session className="text-ui-sm text-fg-muted">
                  {C.openSession(row.scope === 'user' ? null : place)}
                </span>
              ) : (
                // offered once main has said which configuration this is, so the result can be tied to it
                target !== null &&
                fingerprint !== null && (
                  <button type="button" aria-label={C.signInName(row.name)} className={SECONDARY} onClick={() => void startSignIn(target, fingerprint, session)}>
                    {C.signIn}
                  </button>
                )
              ))}
            {remove && (
              <button type="button" aria-label={C.removeName(row.name)} disabled={busy} className={BUTTON} onClick={() => askIn(row.key, remove, runIn)}>
                {C.remove}
              </button>
            )}
          </span>
        </div>
        <span className="font-mono text-ui-sm break-all text-fg-faint">{second}</span>
        <div className="text-ui-sm empty:hidden">
          <OperationLine opKey={row.key} />
        </div>
      </div>
    </li>
  );
}
