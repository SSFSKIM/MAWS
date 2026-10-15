// The desk's frame: sign-in (Access admits the person; `/api/me` names the member), the device's org key, the grid's
// socket, and the route — the grid, or a project.
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { fetchMe, SignInError, type Me } from './hub/me';
import { loadDeviceKey, useKeyHolder } from './key/holder';
import { hubBase } from './project/registry';
import { followHistory, useDeskLayout } from './shell/layout';
import { startGrid, useGrid } from './state/grid';
import { GridView } from './views/grid/GridView';
import { KeyDialog } from './views/key/KeyDialog';
import { MachinesDialog } from './views/machines/MachinesDialog';
import { ProjectView } from './views/project/ProjectView';

const queries = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

export function App() {
  return (
    <QueryClientProvider client={queries}>
      <SignedIn />
    </QueryClientProvider>
  );
}

const SIGN_IN_TEXT: Record<SignInError['reason'], string> = {
  'not-a-member': 'You are signed in, but the org does not hold you as a member.',
  'signed-out': 'Your sign-in has lapsed. Reload the page to sign in again.',
  unavailable: 'The hub cannot be reached. Reload the page to try again.',
};

function SignedIn() {
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  if (me.isPending) return null;
  if (me.isError) {
    const reason = me.error instanceof SignInError ? me.error.reason : 'unavailable';
    return (
      <div className="flex h-full items-center justify-center p-6" data-testid="sign-in">
        <p className="max-w-[420px] text-center text-ui text-fg-muted">{SIGN_IN_TEXT[reason]}</p>
      </div>
    );
  }
  return <Desk me={me.data} />;
}

type Panel = 'key' | 'machines' | null;

function Desk({ me }: { me: Me }) {
  const route = useDeskLayout((s) => s.route);
  const [panel, setPanel] = useState<Panel>(null);
  const close = useCallback(() => setPanel(null), []);
  useEffect(() => followHistory(), []);
  useEffect(() => startGrid(hubBase()), []);
  useEffect(() => void loadDeviceKey(me.org.id), [me.org.id]);
  return (
    <div className="grid h-full grid-rows-[var(--toolbar-h)_minmax(0,1fr)]">
      <TopBar me={me} open={setPanel} />
      {route.view === 'grid' ? <GridView onEnroll={() => setPanel('machines')} /> : <ProjectView key={route.project} me={me} project={route.project} channel={route.channel} />}
      {panel === 'key' && <KeyDialog me={me} onClose={close} />}
      {panel === 'machines' && <MachinesDialog me={me} onClose={close} />}
    </div>
  );
}

function TopBar({ me, open }: { me: Me; open: (panel: Panel) => void }) {
  const route = useDeskLayout((s) => s.route);
  const navigate = useDeskLayout((s) => s.navigate);
  const gridStatus = useGrid((s) => s.status);
  const name = useGrid((s) => (route.view === 'project' ? s.projects.find((p) => p.id === route.project)?.name : undefined));
  const keyState = useKeyHolder((s) => s.state);
  const keyNotForgotten = useKeyHolder((s) => s.forgetError !== null);
  return (
    <header className="flex items-center gap-3 border-b border-border bg-bg-raised px-4">
      <button type="button" onClick={() => navigate({ view: 'grid' })} className="rounded-sm px-1 text-ui-sm font-semibold tracking-[1.7px] text-fg-muted hover:bg-bg-hover">
        DESK
      </button>
      <nav className="flex min-w-0 items-center gap-2 text-ui" aria-label="Where">
        <button type="button" onClick={() => navigate({ view: 'grid' })} className={['rounded-sm px-1 hover:bg-bg-hover', route.view === 'grid' ? 'font-medium text-fg' : 'text-fg-muted'].join(' ')}>
          Projects
        </button>
        {route.view === 'project' && (
          <>
            <span className="text-fg-faint">/</span>
            <span className="truncate font-medium">{name ?? route.project.slice(0, 8)}</span>
          </>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-3 text-ui-sm text-fg-muted">
        <button type="button" onClick={() => open('machines')} className="rounded-sm px-1 hover:bg-bg-hover hover:text-fg">
          Machines
        </button>
        <button type="button" onClick={() => open('key')} className="rounded-sm px-1 hover:bg-bg-hover hover:text-fg" data-testid="key-state" disabled={keyState === 'loading'}>
          {keyState === 'locked' ? 'Locked' : keyState === 'unlocked' ? 'Unlocked' : ''}
          {keyNotForgotten && <span className="text-danger"> · key still stored</span>}
        </button>
        <span className="flex items-center gap-1.5" data-testid="grid-status">
          <span className={['h-1.5 w-1.5 rounded-full', gridStatus === 'open' ? 'bg-success' : 'bg-warning'].join(' ')} aria-hidden />
          {gridStatus === 'open' ? 'Live' : 'Reconnecting'}
        </span>
        <span className="truncate">{me.member.email}</span>
      </div>
    </header>
  );
}
