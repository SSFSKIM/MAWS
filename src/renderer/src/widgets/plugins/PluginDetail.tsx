// A plugin's detail (P2-B execution document §5.7): it replaces My items' list (Desktop draws no list-and-detail split,
// readable/app-2.16120.0/web/app/v1/c76f00e40-PPHTkF49.js:1836-1857), and Back or ⌘[ returns to the list as it was.
// Desktop's head (c9daefa17-BWbtnBvR.js:383-439; c24c8737b-BY-86Rbf.js:900-999): the icon tile, the name, the byline
// ("by <author> · <version> · <marketplace> · updated <when>"), and at the right the enable switch (checked from the
// CLI's effective state here, its position always the last read's), Update ("Update to <version>"; "On latest version"
// only on an equal pair) and the overflow's Uninstall…; each change through E8's confirm sheet at the selected chip's
// scope, passed explicitly (E8 D-16: a project's plugin changed at user scope fails `not_installed`). Then the scope
// chips, and the Overview: the description, two facts that never merge ("Enabled for this project", from the CLI;
// "Loaded in this session", from the session's loaded list, with its freshness), the last init's problems for this
// plugin, and What's inside; a tab per non-empty kind lists it. A chip that is not here or the user's offers no change
// and says where the plugin is managed.
import { DropdownMenu } from 'radix-ui';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { Availability } from '@shared/ipc/schema/session';
import type { PluginsAction, PluginsScope } from '@shared/plugins/cli';
import { ChevronLeftIcon } from '../../app/IconButton';
import { useNow } from '../../app/use-now';
import { FRESHNESS } from '../../sessions/observed';
import { LIBRARY as L, PLUGIN_MANAGEMENT as W } from '../copy';
import { TextButton } from '../parts';
import { chipLabel, chipManagedWords, chipsOf, loadedFactOf, OTHER_PROJECTS, projectCount, unreadNotice, updateOffer } from './detail';
import { MoreIcon, PluginGlyph } from './icons';
import { basename, dateWords, displayNameOf, installationRef, manifestKeyOf, updatedOf, versionWords, type PluginIdentity } from './library';
import { RefreshGesture, useRefresh, type SessionPlugins } from './LoadedLine';
import { present } from './LoadedView';
import { Gone, OperationLine, Switch, useManage } from './manage';
import { usePluginManifests } from './manifests';
import { INSTALLED_PREFIX, installationOf, installedKey } from './PluginRow';
import { requestFor } from './present';
import type { Reloads } from './reload';
import { OtherProjects, ScopeChips } from './ScopeChips';
import { InsideSummary, InsideTabs } from './WhatsInside';

export interface PluginDetailProps {
  appSessionId: AppSessionId;
  availability: Availability | null; // A's `useAvailability`
  identity: PluginIdentity;
  loaded: SessionPlugins; // A's `useLoadedPlugins`, its `refresh` the loaded line's
  loadedIds: ReadonlySet<string> | null; // the loaded list's ids; null when none was observed
  reloads: Reloads | null; // on a ready process
  listManifests: { error: string | null; retry(): void }; // the list's read, which holds the representative installation's view
  backTo?: string; // the view Back returns to: My items, or Browse for an installed card opened there
  onBack(): void;
}

const ACTION = 'inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-ui outline-accent focus-visible:outline-2 disabled:cursor-default';
const SECONDARY = `${ACTION} border border-border text-fg hover:bg-bg-hover disabled:text-fg-faint disabled:hover:bg-transparent`;
const PRIMARY = `${ACTION} bg-accent text-bg hover:opacity-90 disabled:bg-bg-active disabled:text-fg-faint`;
const ITEM = 'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';

type Change = Extract<PluginsAction, 'update' | 'uninstall' | 'enable' | 'disable'>;

export function PluginDetail({ appSessionId, availability, identity, loaded, loadedIds, reloads, listManifests, backTo = L.myItems, onBack }: PluginDetailProps) {
  const { ask, cwd, ops } = useManage();
  const now = useNow();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current?.focus(), []); // the detail takes the keyboard (⌘[, Tab to Back) where it opens

  // the chips, and the one chosen (the representative installation's until another is chosen, and again when the
  // chosen one leaves the list)
  const { chips, others, defaultKey } = chipsOf(identity);
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = chosen !== null && (chosen === OTHER_PROJECTS ? others.length > 0 : chips.some((c) => c.key === chosen)) ? chosen : defaultKey;
  const chip = chips.find((c) => c.key === selected) ?? null;

  // what the chips' other installations say about themselves (the representative's is the list's, already read)
  const representative = installedKey(identity.representative);
  const requests = chips.filter((c) => c.key !== representative).map(({ installation }) => ({ ...installationRef(installation), lastUpdated: installation.lastUpdated })); // the hook keys on the request's content
  const own = usePluginManifests(cwd === '' ? null : cwd, requests);
  const ownRead = chip !== null && chip.key !== representative;
  const view = ownRead ? (own.views.get(manifestKeyOf(installationRef(chip.installation))) ?? null) : identity.manifest;
  // a refused read of the shown installation's files is nonfatal: the listing's controls and facts stay, and it says so;
  // the notice is this installation's own (P2-F L134), never the batch's that another plugin's read failed in
  const read = ownRead ? own : listManifests;
  const unread = unreadNotice(view, read);

  const name = displayNameOf(identity.name, view ?? identity.manifest);
  const installation = chip?.installation ?? identity.representative;
  const version = versionWords(installation.version);
  const updated = chip ? (installation.lastUpdated ?? installation.installedAt) : updatedOf(identity);
  const date = dateWords(updated, now);
  const byline = [view?.author ? L.by(view.author) : null, version ?? L.versionNotReported, identity.marketplace].filter((part): part is string => part !== null);

  const offered = identity.actionable.length > 0; // a switch, Update and Uninstall… only where this session can change it
  const actionable = chip?.actionable ?? false;
  const busy = chip !== null && ops.entries.get(chip.key)?.state.phase === 'working';
  const managed = chip === null ? (projectCount(others) === 1 ? L.managedIn(basename(others[0].projectPath ?? '')) : L.managedInMany(projectCount(others))) : chipManagedWords(chip);
  const update = updateOffer(installation.version, view?.marketplaceVersion ?? null);
  const change = (action: Change) => chip && ask(chip.key, requestFor(action, { plugin: identity.id, scope: chip.installation.scope as PluginsScope }, null));

  // the results of changes whose installation left the list, for this plugin
  const listed = new Set(identity.installations.map(installedKey));
  const gone = [...ops.entries.keys()].filter((key) => key.startsWith(INSTALLED_PREFIX) && !listed.has(key) && installationOf(key).id === identity.id);

  return (
    <div
      ref={root}
      tabIndex={-1}
      data-plugin-detail={identity.id}
      data-plugin-scope={chip?.installation.scope ?? OTHER_PROJECTS}
      className="flex min-h-0 flex-1 flex-col outline-none"
      onKeyDown={backOnChord(onBack)}
    >
      <div className="flex shrink-0 flex-col gap-3 border-b border-border px-3 pb-3">
        <BackButton to={backTo} onBack={onBack} />
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-active text-fg-muted">
            <PluginGlyph className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h3 className="m-0 truncate text-prose font-semibold text-fg" title={identity.id}>
              {name}
            </h3>
            <p className="m-0 truncate text-ui-sm text-fg-muted">
              {byline.join(' · ')}
              {date && (
                <>
                  {' · '}
                  <time dateTime={updated ?? undefined} title={date.title}>
                    {L.updated(date.text)}
                  </time>
                </>
              )}
            </p>
          </div>
          {offered ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="inline-flex" title={managed ?? (identity.enabledHere ? L.turnOff : L.turnOn)}>
                <Switch checked={identity.enabledHere} label={L.enablePlugin} disabled={!actionable || busy} onClick={() => change(identity.enabledHere ? 'disable' : 'enable')} />
              </span>
              <span className="inline-flex" title={managed ?? update.title}>
                <button type="button" className={update.available ? PRIMARY : SECONDARY} disabled={!actionable || busy || update.latest} onClick={() => change('update')}>
                  {L.update}
                </button>
              </span>
              <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    aria-label={L.moreActions(name)}
                    title={L.moreActions(name)}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 data-[state=open]:bg-bg-active"
                  >
                    <MoreIcon />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-40 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float">
                    <DropdownMenu.Item className={`${ITEM} text-danger`} disabled={!actionable || busy} onSelect={() => change('uninstall')}>
                      {L.uninstall}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <ScopeChips chips={chips} others={others} value={selected} onChange={setChosen} />
          {managed !== null && <p className="m-0 text-ui-sm text-fg-muted">{managed}</p>}
        </div>
        {chips.map((c) => (
          <div key={c.key} data-plugin-op={c.installation.scope} className="text-ui-sm empty:hidden">
            <OperationLine opKey={c.key} label={chips.length > 1 ? chipLabel(c) : undefined} />
          </div>
        ))}
        {gone.map((key) => (
          <Gone key={key} opKey={key} name={goneName(key)} data={{ 'data-plugin-result': identity.id, 'data-plugin-scope': installationOf(key).scope }} />
        ))}
      </div>

      <InsideTabs
        label={name}
        view={view}
        overview={(openTab) => (
          <>
            {selected === OTHER_PROJECTS && <OtherProjects installations={others} />}
            {view?.description && <p className="m-0 text-ui text-fg [overflow-wrap:anywhere] whitespace-pre-line">{view.description}</p>}
            <Facts appSessionId={appSessionId} availability={availability} identity={identity} loaded={loaded} loadedIds={loadedIds} reloads={reloads} now={now} />
            {installation.errors.length > 0 && (
              <ul className="m-0 list-none p-0 text-ui-sm text-danger">
                {installation.errors.map((error, i) => (
                  <li key={i} className="[overflow-wrap:anywhere]">
                    {error}
                  </li>
                ))}
              </ul>
            )}
            {unread !== null && <ReadFailed words={unread} onRetry={read.retry} />}
            <InsideSummary view={view} onOpen={openTab} />
          </>
        )}
      />
    </div>
  );
}

// A refused read of a plugin's files: nonfatal, the listing's controls and facts stay, and it says so with Retry.
export function ReadFailed({ words, onRetry }: { words: string; onRetry(): void }) {
  return (
    <p role="status" className="m-0 flex flex-wrap items-baseline gap-x-2 text-ui-sm text-warning">
      <span>{L.detailsFailed}</span>
      {words !== '' && <span className="min-w-0 text-fg-muted [overflow-wrap:anywhere]">{words}</span>}
      <button type="button" className="rounded-sm text-fg outline-accent hover:underline focus-visible:outline-2" onClick={onRetry}>
        {L.retry}
      </button>
    </p>
  );
}

// The head of a detail: Back (‹ with the library's view it returns to), which ⌘[ also takes.
export function BackButton({ to, onBack }: { to: string; onBack(): void }) {
  return (
    <button type="button" onClick={onBack} aria-label={L.backTo(to)} className="-ml-1 inline-flex h-6 items-center gap-1 self-start rounded-sm px-1 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
      <ChevronLeftIcon className="size-3.5" />
      {to}
    </button>
  );
}

// ⌘[ on a detail: back to the list it came from.
export const backOnChord = (onBack: () => void) => (event: KeyboardEvent<HTMLElement>) => {
  if (event.key === '[' && event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey) {
    event.preventDefault();
    onBack();
  }
};

// A result whose installation left the list (while the plugin stays listed), named with the scope it acted at.
const goneName = (key: string): string => {
  const { id, scope } = installationOf(key);
  return `${id} (${scope})`;
};

// The two facts, never merged: "Enabled for this project" from the CLI, and "Loaded in this session" from the
// session's loaded list (A's observed facts) with its freshness ("Loaded now", "Loaded last time, <relative>"); a known
// list without it reads "Not loaded in this session" and, when the plugin is enabled here, offers Reload plugins (ready)
// or the loaded line's Refresh, with A's line for a session that cannot start; no list reads "Not observed yet". The
// last init's problems for this plugin beneath.
function Facts({ appSessionId, availability, identity, loaded, loadedIds, reloads, now }: Omit<PluginDetailProps, 'onBack' | 'listManifests' | 'backTo'> & { now: number }) {
  const fact = loadedFactOf(identity.id, loaded, loadedIds);
  const refresh = useRefresh(loaded.refresh);
  const problems = present(loaded).problems.filter((p) => p.plugin === identity.name || p.plugin === identity.id);
  let loadedWords: string;
  if (fact.kind === 'unknown') loadedWords = FRESHNESS.notObserved;
  else if (fact.kind === 'absent') loadedWords = L.notLoadedHere;
  else if (fact.freshness.kind === 'now') loadedWords = `${L.loadedHere} · ${FRESHNESS.loadedNow}`;
  else if (fact.freshness.kind === 'last') loadedWords = `${L.loadedHere} · ${FRESHNESS.loadedLast(fact.freshness.at, now)}`;
  else loadedWords = L.loadedHere;
  const offerReload = fact.kind === 'absent' && identity.enabledHere;
  return (
    <div className="flex flex-col gap-1 text-ui">
      <p data-plugin-fact="enabled" className="m-0 text-fg">
        {identity.enabledHere ? L.enabledHere : L.notEnabledHere}
      </p>
      <div data-plugin-fact="loaded" className="flex flex-wrap items-baseline gap-x-2 text-fg [&>[data-dormant-gesture]]:mb-0">
        <span>{loadedWords}</span>
        {offerReload && (
          <RefreshGesture
            appSessionId={appSessionId}
            availability={availability}
            refresh={refresh}
            ready={reloads && (
              <TextButton onClick={reloads.reloadMods} disabled={reloads.busy}>
                {W.reloadMods}
              </TextButton>
            )}
          />
        )}
      </div>
      {offerReload && reloads?.line && (
        <p role="status" className={`m-0 text-ui-sm ${reloads.failed ? 'text-danger' : 'text-fg-muted'}`}>
          {reloads.line}
        </p>
      )}
      {offerReload && !reloads?.line && loaded.reload.failed && (
        <p role="alert" className="m-0 text-ui-sm text-danger [overflow-wrap:anywhere]">
          {loaded.reload.line}
        </p>
      )}
      {problems.length > 0 && (
        <ul aria-label={L.problems(problems.length)} className="m-0 mt-1 list-none p-0 text-ui-sm">
          {problems.map((p, i) => (
            <li key={i} className="flex min-w-0 items-baseline gap-2">
              <span className={p.level === 'error' ? 'shrink-0 text-danger' : 'shrink-0 text-warning'}>{p.level}</span>
              <span className="min-w-0 text-fg-muted [overflow-wrap:anywhere]">{p.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
