// A connector's row in My items (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §E; cut out
// of ConnectorsSection.tsx with its code kept): the image, the configured name, "<scope> scope · <transport>", the
// sign-in state, Cancel while a sign-in runs, Sign in or why not, Remove, the file's path on the second line, and the
// operation's line. What depends on the kind of connector (what follows the name, the second line, which sign-in it
// sends, whether it has Remove) is decided on `row.kind` in `partsOf`, so that a second kind is one branch there.
// The row's parts are named for what later columns read: `data-connector-main` (the name, what follows it, the state)
// and `data-connector-trailing` (Cancel, Sign in or its sentence, Remove), and after them, only under All, the kind word.
// A row the engine does not use (the same name in a scope it ranks higher, or MAWS's own server of the name; ./present.ts
// `shadowedBy`) says which entry shadows it and offers no Sign in: the engine signs a name in, so Sign in belongs to the
// row it uses. U11a M8: a row of MAWS's own list is a dynamic connector to the sign-in, offered only with its
// configuration's revision. UX wave U11c M1 (§C): its image, the icon of the one directory record its address matches
// (the posture's), else its tile. UX wave U11h (docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, §E):
// a plugin's connector is the second kind: its server's name, "from <plugin>" (which opens the plugin's detail) and its
// transport, no file line and no Remove; its state's place and its Sign in come from §E's table (./plugin-row.ts), a
// retained sign-in giving words alone, and its record is shown against the row's revision, not main's fingerprint.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { CustomizationServer } from '@shared/ipc/schema/customization';
import type { PluginsScope } from '@shared/plugins/cli';
import { SECONDARY } from '../../sessions/ui';
import { OperationLine, useManage } from '../../widgets/plugins/manage';
import { TextButton } from '../../widgets/parts';
import { ItemImage } from '../image/ItemImage';
import { KindWord, NoLastControl } from '../KindWord';
import { openMine } from '../open';
import { CONNECTORS as C } from './copy';
import type { AskIn } from './manage';
import { pluginRowViewOf, type PluginRowState } from './plugin-row';
import { removalDirectoryOf, removeRequestOf, resultFor, shadowWords, signInViewOf, type AuthPosture, type SignInFacts, type SignInView } from './present';
import type { ConnectorRowModel } from './rows';
import { cancelSignIn, forgetSignIn, RUNNING, signInKeyOf, signInMachineOf, signsInDynamic, startSignIn, startSignInDynamic, startSignInFromRow, useSignIns, useStartedOn, type SignInRecord, type SignInServer } from './sign-in';

const BUTTON = 'rounded-sm px-2 py-1 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint';
const TONE: Record<SignInView['tone'], string> = { muted: 'text-fg-muted', success: 'text-success', danger: 'text-danger' };
const FROM = 'rounded-sm text-fg-muted outline-accent hover:text-fg hover:underline focus-visible:outline-2';

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
  kindWord?: boolean; // under My items, All: "Connector" after the trailing controls, and the width of a last control
  plugin?: { state: PluginRowState; name: string; revisionRead: boolean }; // a plugin's row: §E's table now, its plugin's name as My items shows it, and whether main has answered `revision` for the inventory's latest read
}

// What the row draws and sends for its kind: the name drawn and its marks, the words after the name, the second line, the
// server a sign-in is kept for, where a file sign-in runs, and the removal.
function partsOf(row: ConnectorRowModel, cwd: string | null, pluginName: string) {
  switch (row.kind) {
    case 'configured': {
      const own = row.scope === 'app';
      const target = own ? null : { name: row.name, scope: row.scope as PluginsScope, cwd, path: row.path };
      const kept: Omit<SignInServer, 'machine'> | null = own ? (signsInDynamic(row.name) ? { name: row.name, scope: 'dynamic', cwd: null } : null) : target;
      const after: ReactNode = [C.scopeOf(row.scope), row.transport].filter(Boolean).join(' · ');
      return { shown: row.name, marks: { 'data-connector': row.name, 'data-connector-scope': row.scope }, after, second: row.path as string | null, own, target, kept, remove: removeRequestOf(row), runIn: removalDirectoryOf(row) };
    }
    case 'plugin': {
      // kept as a dynamic connector by the engine's name, as the session's dialog keeps it (U11a)
      const kept: Omit<SignInServer, 'machine'> | null = row.name !== null && signsInDynamic(row.name) ? { name: row.name, scope: 'dynamic', cwd: null } : null;
      const after: ReactNode = (
        <>
          <button type="button" data-connector-from className={FROM} onClick={() => openMine('plugins', { pluginId: row.plugin })}>
            {C.fromPlugin(pluginName)}
          </button>
          {` · ${row.transport}`}
        </>
      );
      return { shown: row.server, marks: { 'data-connector': row.server, 'data-connector-scope': 'plugin', 'data-connector-plugin': row.plugin }, after, second: null, own: false, target: null, kept, remove: null, runIn: null };
    }
  }
}

export function ConnectorRow({ row, askIn, shadow, cwd, place, session, live, liveRead, posture, fingerprint, revision, iconUrl, kindWord = false, plugin }: ConnectorRowProps) {
  const { ops } = useManage();
  const { shown, marks, after, second, own, target, kept, remove, runIn } = partsOf(row, cwd, plugin?.name ?? '');
  // P5 O7 M5c: the result of the machine its Sign in runs on (a session's address names it; none, this Mac)
  const machine = signInMachineOf(row.kind === 'plugin' ? (plugin?.state.signIn ?? null) : session);
  const named = useSignIns((s) => (kept === null ? null : (s.byServer.get(signInKeyOf({ ...kept, machine })) ?? null)));
  // a sign-in pressed on this row stays on it while it runs, whatever its engine name reads now (§E)
  const latest = useRunningStartedOn(row.key) ?? named;
  // a plugin's row shows a finished result against its revision (§E, "What a retained record is kept by")
  const known = useKnownRevision(row.kind === 'plugin' ? kept : null, machine, revision, plugin?.revisionRead ?? true, latest);
  const record = resultFor(latest, row.kind === 'plugin' ? known : fingerprint);
  const last = record?.event ?? null;
  const pluginView = row.kind === 'plugin' && plugin !== undefined ? pluginRowViewOf(plugin.state, record) : null;
  const state: SignInView | null =
    pluginView !== null
      ? { text: pluginView.text, tone: pluginView.tone, signIn: false, cancel: pluginView.cancel }
      : shadow !== null
        ? { text: shadowWords(shadow, shown), tone: 'muted', signIn: false, cancel: false }
        : signInViewOf({ live, liveRead, posture, last: record, transport: row.transport });
  const busy = ops.entries.get(row.key)?.state.phase === 'working';
  return (
    <li {...marks} className="flex min-w-0 items-start gap-3 border-b border-border px-2 py-2 last:border-b-0">
      <ItemImage kind="connector" seed={shown} iconUrl={iconUrl} size="row" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span data-connector-main className="contents">
            <span className="font-medium [overflow-wrap:anywhere]">{shown}</span>
            <span className="text-ui-sm text-fg-muted">{after}</span>
            {state?.text && (
              <span data-sign-in-state className={`text-ui-sm ${TONE[state.tone]}`}>
                {state.text}
              </span>
            )}
            {pluginView?.notInAttached && (
              <span data-not-in-attached className="text-ui-sm text-fg-muted">
                {C.notInAttached}
              </span>
            )}
          </span>
          <span data-connector-trailing className="ml-auto flex shrink-0 items-baseline gap-1">
            {state?.cancel && last && <TextButton onClick={() => cancelSignIn(last.opId, record!.appSessionId)}>{C.cancel}</TextButton>}
            {pluginView !== null && row.kind === 'plugin' && row.name !== null && revision !== null && pluginView.signIn !== null && (
              // §E row 9: through the session the rule admits, with the engine's name and the revision the row was drawn with
              <button type="button" aria-label={C.signInName(shown)} className={SECONDARY} onClick={() => void startSignInFromRow(row.key, { name: row.name!, revision }, revision, pluginView.signIn as AppSessionId)}>
                {C.signIn}
              </button>
            )}
            {pluginView?.openSession && (
              <span data-sign-in-needs-session className="text-ui-sm text-fg-muted">
                {C.openSession(null)}
              </span>
            )}
            {row.kind === 'configured' &&
              state?.signIn &&
              (own ? (
                // U11a M8: only with the revision the press must carry, so it signs in this configuration or nothing
                kept !== null &&
                revision !== null &&
                (session === null ? (
                  <span data-sign-in-needs-session className="text-ui-sm text-fg-muted">
                    {C.openSession(null)}
                  </span>
                ) : (
                  <button type="button" aria-label={C.signInName(shown)} className={SECONDARY} onClick={() => void startSignInDynamic({ name: shown, revision }, fingerprint, session as AppSessionId)}>
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
                  <button type="button" aria-label={C.signInName(shown)} className={SECONDARY} onClick={() => void startSignIn(target, fingerprint, session)}>
                    {C.signIn}
                  </button>
                )
              ))}
            {remove && (
              <button type="button" aria-label={C.removeName(shown)} disabled={busy} className={BUTTON} onClick={() => askIn(row.key, remove, runIn)}>
                {C.remove}
              </button>
            )}
          </span>
        </div>
        {second !== null && <span className="font-mono text-ui-sm break-all text-fg-faint">{second}</span>}
        <div className="text-ui-sm empty:hidden">
          <OperationLine opKey={row.key} />
        </div>
      </div>
      {kindWord && (
        <>
          <KindWord kind="connector" />
          <NoLastControl />
        </>
      )}
    </li>
  );
}

// The record of the operation this row's own press started (`startSignInFromRow`) while it runs, else null (UX wave
// U11h, the architect's rulings of 2026-11-16): its step and Cancel stay on this row when the row's engine name changes
// or can no longer be read, and no other operation of the server is taken for it. The binding ends where the events are
// heard; the row's result is then the one its name now keys, shown by today's rule (its revision).
function useRunningStartedOn(rowKey: string): SignInRecord | null {
  const started = useStartedOn((s) => s.rows.get(rowKey) ?? null);
  return useSignIns((s) => {
    const record = started === null ? undefined : s.byServer.get(started.key);
    return record !== undefined && record.event.opId === started!.opId && RUNNING.has(record.event.state) ? record : null;
  });
}

// A plugin's row's revision as last answered: while main's answer for a re-read is out the last one stands, so a result
// is not hidden while it is read again; an answer is taken as it is, null included (a local command has no address, so
// no revision). A revision that changed (the plugin's key, installation, name, transport or address moved) drops the
// ended record the row was showing (§E): the record was for what the row declared then. Only a change this row saw, and
// only a record started from it, so another row of the same engine name, and the session's dialog, keep theirs.
function useKnownRevision(kept: Omit<SignInServer, 'machine'> | null, machine: SignInServer['machine'], revision: string | null, answered: boolean, latest: SignInRecord | null): string | null {
  const [known, setKnown] = useState(revision);
  if (answered && revision !== known) setKnown(revision);
  const seen = useRef(known);
  useEffect(() => {
    const before = seen.current;
    seen.current = known;
    if (kept === null || before === null || before === known || latest === null) return;
    if (latest.fingerprint === before && !RUNNING.has(latest.event.state)) forgetSignIn({ ...kept, machine });
  }, [kept, machine, known, latest]);
  return known;
}
