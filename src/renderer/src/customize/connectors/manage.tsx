// The connector sheet's half of Customize's one place (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md,
// §D; moved whole from ConnectorsSection.tsx, where U11g put it): `askIn` opens the connector sheet, every opening reads
// `plugins.env` again, as the install sheet does, and a removal runs in its own folder when it names one (sweep#2).
// UX wave U11g (docs/doperpowers/plans/2026-11-14-ux-wave-U11g-custom-connector.md, "After Add", §D): every opening of
// the custom sheet reads what is configured here again, and the sheet checks the name only against that read; its add
// runs under `connector:add:<scope>:<name>`. The operations are the page's one book (`keep`), and the sheet is its
// place's (`usePlaceHeld`): a change of project closes it.
import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { isMcpEntryAdd, type PluginsScope } from '@shared/plugins/cli';
import { usePlaceHeld, type Manage } from '../../widgets/plugins/manage';
import { usePluginOperations } from '../../widgets/plugins/operation';
import { requestFor, type PluginsRequest } from '../../widgets/plugins/present';
import { usePluginsEnv } from '../../widgets/plugins/read';
import { resolutionOf } from '../../widgets/PluginsWidget';
import type { EngineResolution } from '../../widgets/plugins/ConfirmSheet';
import { useCustomizationInventory } from '../inventory';
import { ConnectorSheet } from './ConnectorSheet';
import { configuredSinceOpening } from './custom-form';
import { configuredOf, customAddKey, type ConfiguredServers } from './present';
import { forgetSignIn } from './sign-in';

/** A confirmation asked for, run in `runIn` when given (a removal from a parent directory's .mcp.json), else the page's. */
export type AskIn = (key: string, request: PluginsRequest, runIn: string | null) => void;

// runIn: a removal's own directory (sweep#2); read: for a custom add, whether this opening's read of what is configured
// here has answered (null for every other sheet, which reads the page's answer)
type Asking = { key: string; request: PluginsRequest; engine: EngineResolution; opening: number; runIn: string | null; read: 'out' | 'answered' | null };

// What "Add custom connector…" opens (U11g §D): Remote (HTTP), all projects, nothing typed.
export const CUSTOM_ADD_KEY = 'connector:add'; // the sheet's own key; its add runs under `customAddKey` once named
export const CUSTOM_ADD = requestFor('mcp-add', { name: '', scope: 'user', entry: { type: 'http', url: '', headers: [] } }, null);

export function useConnectorManage(cwd: string | null, place: string | null, configured: ConfiguredServers, retryServers: () => void, keep: string): { manage: Manage; sheet: ReactNode; askIn: AskIn } {
  const env = usePluginsEnv();
  const { reread } = env;
  const runCwd = cwd ?? env.data?.configHome ?? '';
  const ops = usePluginOperations(keep);
  const [asking, setAsking] = usePlaceHeld<Asking>(keep);
  const openings = useRef(0);
  // U11g: the page's inventory, read again at a custom sheet's opening (the same query as the page's, so they share it)
  const inventory = useCustomizationInventory(cwd);
  const { refetch } = inventory;
  // A read begun after the opening: with an answer in hand a refetch cancels any read in flight and starts its own; with
  // none yet, TanStack Query joins the read in flight, which began before the opening, so that one is let end and a read
  // is begun after it (M2's review).
  const unanswered = inventory.data === undefined;
  const askIn = useCallback<AskIn>(
    (key, request, runIn) => {
      const opening = ++openings.current;
      const custom = request.action === 'mcp-add' && isMcpEntryAdd(request.input);
      setAsking({ key, request, engine: { state: 'loading' }, opening, runIn, read: custom ? 'out' : null });
      void reread().then((read) => setAsking((current) => (current?.opening === opening ? { ...current, engine: resolutionOf(read) } : current)));
      if (!custom) return;
      const readAfterOpening = unanswered ? refetch().then(() => refetch()) : refetch();
      void readAfterOpening.then(() => setAsking((current) => (current?.opening === opening ? { ...current, read: 'answered' } : current)));
    },
    [reread, refetch, unanswered, setAsking],
  );
  const ask = useCallback((key: string, request: PluginsRequest) => askIn(key, request, null), [askIn]);
  const manage = useMemo<Manage>(() => ({ cwd: runCwd, ops, ask, reloadMods: null }), [runCwd, ops, ask]);
  const runIn = asking?.runIn ?? runCwd;
  const sheetConfigured = asking?.read == null ? configured : configuredSinceOpening(asking.read === 'answered', { isFetching: inventory.isFetching, configured: configuredOf(inventory) });
  const sheet = asking && (
    <ConnectorSheet
      key={`${asking.key}:${asking.opening}`}
      request={asking.request}
      env={{ cwd, runCwd: runIn, engine: asking.engine, configured: sheetConfigured, retryServers, place }}
      onConfirm={(request, binary) => {
        setAsking(null);
        // a configuration MAWS removed or replaced: a sign-in's result for that name and scope says nothing about it now
        const { name, scope } = request.input as { name: string; scope: PluginsScope };
        const key = asking.read === null ? asking.key : customAddKey(scope, name);
        void ops.run(key, request, runIn, binary).then((done) => done?.outcome?.ok && forgetSignIn({ name, scope, cwd }));
      }}
      onClose={() => setAsking(null)}
    />
  );
  return { manage, sheet, askIn };
}
