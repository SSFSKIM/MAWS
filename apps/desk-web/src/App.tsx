// The desk's frame: sign-in (Access admits the person; `/api/me` names the member), the device's org key, the grid's
// socket, the route — the grid, every session of the org, or a project — and the PWA's part: the service worker, this device's notifications
// handed to the hub again at start, and the card a tapped notification opens. A phone draws a compact top bar.
//
// The first load is the grid's: the project view (with MAWS's Markdown and request cards) and the dialogs load as
// chunks of their own when first opened, so the phone's first screen does not wait on them. So does the latency
// readout, drawn only when asked for (`latency/latency.ts`).
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { loadChunk } from './pwa/load-chunk';
import { fetchMe, SignInError, type Me } from './hub/me';
import { useAccess, watchAccess } from './hub/access';
import { loadDeviceKey, useKeyHolder } from './key/holder';
import { hubBase } from './hub/base';
import { recordPushOutcome } from './push/outcome';
import { browserPushEnv, resyncPush } from './push/device';
import { orgWaiting, showBadge } from './pwa/badge';
import { registerServiceWorker } from './pwa/service-worker';
import { followHistory, useDeskLayout } from './shell/layout';
import { usePhoneProject } from './shell/phone';
import { useNarrow } from './shell/viewport';
import { startGrid, useGrid } from './state/grid';
import { SignInAgainButton } from './views/access/SignInAgain';
import { GridView } from './views/grid/GridView';
import { useSecondMethodPrompt } from './views/key/second-method';
import { latency } from './latency/latency';

const ProjectView = lazy(() => loadChunk(() => import('./views/project/ProjectView').then((m) => ({ default: m.ProjectView }))));
const OrgView = lazy(() => loadChunk(() => import('./views/org/OrgView').then((m) => ({ default: m.OrgView }))));
const LatencyOverlay = lazy(() => loadChunk(() => import('./latency/LatencyOverlay').then((m) => ({ default: m.LatencyOverlay }))));
const KeyDialog = lazy(() => loadChunk(() => import('./views/key/KeyDialog').then((m) => ({ default: m.KeyDialog }))));
const MachinesDialog = lazy(() => loadChunk(() => import('./views/machines/MachinesDialog').then((m) => ({ default: m.MachinesDialog }))));
const NotificationsDialog = lazy(() => loadChunk(() => import('./views/notifications/NotificationsDialog').then((m) => ({ default: m.NotificationsDialog }))));

const queries = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

export function App() {
  return (
    <QueryClientProvider client={queries}>
      <SignedIn />
      {latency.on && (
        <Suspense fallback={null}>
          <LatencyOverlay />
        </Suspense>
      )}
    </QueryClientProvider>
  );
}

const SIGN_IN_TEXT: Record<SignInError['reason'], string> = {
  'not-a-member': 'You are signed in, but the org does not hold you as a member.',
  'signed-out': 'Your sign-in has expired.',
  unavailable: 'The hub cannot be reached. Reload the page to try again.',
};

function SignedIn() {
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  if (me.isPending) return null;
  if (me.isError) {
    const reason = me.error instanceof SignInError ? me.error.reason : 'unavailable';
    return (
      <div className="flex h-full items-center justify-center p-6" data-testid="sign-in">
        <div className="flex max-w-[420px] flex-col items-center gap-3">
          <p className="m-0 text-center text-ui text-fg-muted">{SIGN_IN_TEXT[reason]}</p>
          {reason === 'signed-out' && <SignInAgainButton />}
        </div>
      </div>
    );
  }
  return <Desk me={me.data} />;
}

type Panel = 'key' | 'machines' | 'notifications' | 'menu' | null;

function Desk({ me }: { me: Me }) {
  const route = useDeskLayout((s) => s.route);
  const [panel, setPanel] = useState<Panel>(null);
  // Right after the org key's first setup the key dialog opens on its prompt to add a second method.
  const secondMethodDue = useSecondMethodPrompt((s) => s.due);
  const close = useCallback(() => {
    setPanel(null);
    useSecondMethodPrompt.setState({ due: false });
  }, []);
  useEffect(() => followHistory(), []);
  // Before the sockets start: their failed connects are what set it probing.
  useEffect(() => watchAccess(), []);
  useEffect(() => startGrid(hubBase()), []);
  useEffect(() => void loadDeviceKey(me.org.id), [me.org.id]);
  // A device already subscribed hands its subscription to the hub again; what came of it is kept for the
  // Notifications panel, which shows a refusal and offers Retry.
  useEffect(() => {
    void recordPushOutcome(resyncPush(browserPushEnv(registerServiceWorker())));
  }, []);
  // The app icon's badge follows the grid while the app is open (a push sets it from its payload while it is not), so
  // a request answered anywhere clears it.
  const gridLoaded = useGrid((s) => s.loaded);
  const waiting = useGrid((s) => orgWaiting(s.projects));
  useEffect(() => {
    if (gridLoaded) void showBadge(navigator as Parameters<typeof showBadge>[0], waiting);
  }, [gridLoaded, waiting]);
  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <TopBar me={me} open={setPanel} />
      {route.view === 'grid' ? (
        <GridView onEnroll={() => setPanel('machines')} />
      ) : route.view === 'org' ? (
        <Suspense fallback={null}>
          <OrgView me={me} />
        </Suspense>
      ) : (
        <Suspense fallback={<Opening />}>
          <ProjectView key={route.project} me={me} project={route.project} channel={route.channel} />
        </Suspense>
      )}
      <Suspense fallback={null}>
        {(panel === 'key' || (secondMethodDue && panel === null)) && <KeyDialog me={me} onClose={close} />}
        {panel === 'machines' && <MachinesDialog me={me} onClose={close} />}
        {panel === 'notifications' && <NotificationsDialog onClose={close} />}
      </Suspense>
      {panel === 'menu' && <PhoneMenu me={me} open={setPanel} onClose={close} />}
    </div>
  );
}

function Opening() {
  return (
    <p className="m-0 p-6 text-ui-sm text-fg-muted" role="status">
      Opening the project…
    </p>
  );
}

function TopBar({ me, open }: { me: Me; open: (panel: Panel) => void }) {
  const route = useDeskLayout((s) => s.route);
  const navigate = useDeskLayout((s) => s.navigate);
  const narrow = useNarrow();
  const name = useGrid((s) => (route.view === 'project' ? s.projects.find((p) => p.id === route.project)?.name : undefined));
  const title = route.view === 'project' ? (name ?? route.project.slice(0, 8)) : route.view === 'org' ? 'All sessions' : null;
  const groupChatOpen = usePhoneProject((s) => s.groupChatOpen);
  const hubHealthy = useHubState().healthy;
  if (narrow) {
    // A phone's stack (05-phone.html, 3A): a channel goes back to the project's list, the list to the projects.
    const inChannel = route.view === 'project' && (route.channel.kind === 'session' || groupChatOpen);
    const back = () => {
      if (route.view !== 'project') return;
      if (route.channel.kind === 'session') navigate({ view: 'project', project: route.project, channel: { kind: 'group' } });
      else usePhoneProject.setState({ groupChatOpen: false });
    };
    const backButton = 'flex h-9 min-w-0 items-center rounded-sm px-1.5 text-ui text-fg-muted hover:bg-bg-hover';
    // The project's name takes the room the controls leave, and never less than a readable floor: past it the key's
    // state truncates instead. The bar is `min-w-0`, so a long name truncates in it rather than widening the desk's
    // column, and the whole app with it, past the phone's edge.
    // While the hub link needs attention the phone's bar says so in a word, and the name's floor gives that word its room.
    const label = `${hubHealthy ? 'min-w-20' : 'min-w-14'} flex-1`;
    return (
      <header className="flex h-[var(--toolbar-h)] min-w-0 items-center gap-2 border-b border-border bg-bg-raised px-3" data-testid="top-bar">
        {title === null ? (
          <span className="px-1 text-ui-sm font-semibold tracking-[1.7px] text-fg-muted">DESK</span>
        ) : inChannel ? (
          <div className={`flex ${label}`} data-testid="top-bar-label">
            <button type="button" onClick={back} className={backButton} aria-label={`Back to ${title}`}>
              <span className="truncate">‹ {title}</span>
            </button>
          </div>
        ) : (
          <>
            <button type="button" onClick={() => navigate({ view: 'grid' })} className={`${backButton} shrink-0`} aria-label="Projects">
              ‹ Projects
            </button>
            <span className={`${label} truncate text-ui font-medium`} data-testid="top-bar-label">
              {title}
            </span>
          </>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-1" data-testid="top-bar-controls">
          <GridStatus compact />
          <KeyButton open={open} compact />
          <button type="button" onClick={() => open('menu')} className="flex h-9 shrink-0 items-center rounded-sm px-2 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg" data-testid="menu">
            Menu
          </button>
        </div>
      </header>
    );
  }
  return (
    <header className="flex h-[var(--toolbar-h)] min-w-0 items-center gap-3 border-b border-border bg-bg-raised px-4" data-testid="top-bar">
      <button type="button" onClick={() => navigate({ view: 'grid' })} className="rounded-sm px-1 text-ui-sm font-semibold tracking-[1.7px] text-fg-muted hover:bg-bg-hover">
        DESK
      </button>
      <nav className="flex min-w-0 items-center gap-2 text-ui" aria-label="Where">
        <button type="button" onClick={() => navigate({ view: 'grid' })} className={['rounded-sm px-1 hover:bg-bg-hover', route.view === 'grid' ? 'font-medium text-fg' : 'text-fg-muted'].join(' ')}>
          Projects
        </button>
        {title !== null && (
          <>
            <span className="text-fg-faint">/</span>
            <span className="truncate font-medium">{title}</span>
          </>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-3 text-ui-sm text-fg-muted">
        <button type="button" onClick={() => open('notifications')} className="rounded-sm px-1 hover:bg-bg-hover hover:text-fg">
          Notifications
        </button>
        <button type="button" onClick={() => open('machines')} className="rounded-sm px-1 hover:bg-bg-hover hover:text-fg">
          Machines
        </button>
        <KeyButton open={open} />
        <GridStatus />
        <span className="truncate">{me.member.email}</span>
      </div>
    </header>
  );
}

/** The org key's state; `compact` (the phone's bar) keeps it to one line, truncating once the project's name is at its floor. */
function KeyButton({ open, compact = false }: { open: (panel: Panel) => void; compact?: boolean }) {
  const keyState = useKeyHolder((s) => s.state);
  const keyNotForgotten = useKeyHolder((s) => s.forgetError !== null);
  const text = (
    <>
      {keyState === 'locked' ? 'Locked' : keyState === 'unlocked' ? 'Unlocked' : ''}
      {keyNotForgotten && <span className="text-danger"> · key still stored</span>}
    </>
  );
  return (
    <button type="button" onClick={() => open('key')} className={`rounded-sm px-1 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg${compact ? ' flex min-w-0' : ''}`} data-testid="key-state" disabled={keyState === 'loading'}>
      {compact ? <span className="truncate">{text}</span> : text}
    </button>
  );
}

/** What the hub link is doing: the word the bar says, the dot's color, and whether it is healthy (the phone's bar says the word only when it is not). */
function useHubState(): { label: string; dot: string; healthy: boolean } {
  const status = useGrid((s) => s.status);
  const lapsed = useAccess((s) => s.lapsed);
  if (lapsed !== null) return { label: 'Signed out', dot: 'bg-danger', healthy: false };
  return status === 'open' ? { label: 'Live', dot: 'bg-success', healthy: true } : { label: 'Reconnecting', dot: 'bg-warning', healthy: false };
}

function GridStatus({ compact = false }: { compact?: boolean }) {
  const { label, dot, healthy } = useHubState();
  return (
    <span className="flex items-center gap-1.5 text-ui-sm text-fg-muted" data-testid="grid-status" title={compact ? label : undefined}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {compact ? (
        <span className={healthy ? 'sr-only' : 'whitespace-nowrap'} data-testid="grid-status-word">
          {label}
        </span>
      ) : (
        label
      )}
    </span>
  );
}

/** The phone's menu: what the wide top bar shows inline. */
function PhoneMenu({ me, open, onClose }: { me: Me; open: (panel: Panel) => void; onClose: () => void }) {
  const row = 'flex h-11 w-full items-center rounded-md px-3 text-left text-ui hover:bg-bg-hover';
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-fg/20" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Menu" className="w-full rounded-t-lg border-t border-border-strong bg-bg-overlay p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-fg shadow-lg">
        <button type="button" className={row} onClick={() => open('notifications')}>
          Notifications
        </button>
        <button type="button" className={row} onClick={() => open('key')}>
          Org key
        </button>
        <button type="button" className={row} onClick={() => open('machines')}>
          Machines
        </button>
        <p className="m-0 truncate px-3 py-2 text-ui-sm text-fg-muted">Signed in as {me.member.email}</p>
        <button type="button" className={`${row} justify-center text-fg-muted`} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
