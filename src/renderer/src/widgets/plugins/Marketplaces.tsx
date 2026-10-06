// Marketplaces (E8 execution document, M2): one row per `claude plugin marketplace list --json` entry — its name, source
// kind and repository, URL or path — with Refresh and Remove…, and below the rows "Add marketplace": an `owner/repo`, a
// URL or a folder (typed, or chosen with Choose folder…). Every change asks first; a removed marketplace's result stays
// beneath the rows after its row leaves. Removing a marketplace uninstalls the plugins installed from it (2.1.291), so
// its sheet names them, from the installed read, and the files that uninstall writes.
import { useState, type FormEvent } from 'react';
import type { Marketplace } from '@shared/ipc/schema/marketplaces';
import type { InstalledPlugin } from '@shared/ipc/schema/plugins';
import { isPluginsArgument } from '@shared/plugins/cli';
import { ipc } from '../../ipc/client';
import { FRAME, PLUGIN_MANAGEMENT as W } from '../copy';
import { Group, Mono, Row, Rows, TextButton } from '../parts';
import { Gone, OperationLine, useManage } from './manage';
import { requestFor, sourceKindOfTyped } from './present';
import { usePluginsRead } from './read';

const marketplaceKey = (name: string) => `marketplace:${name}`;
const ADD_KEY = 'marketplace-add';

function MarketplaceRow({ marketplace, installed }: { marketplace: Marketplace; installed: readonly InstalledPlugin[] }) {
  const { ops, ask } = useManage();
  const key = marketplaceKey(marketplace.name);
  const busy = ops.entries.get(key)?.state.phase === 'working';
  return (
    <Row
      data-marketplace-row={marketplace.name}
      main={marketplace.name}
      note={marketplace.source}
      detail={
        <span className="flex flex-col gap-0.5">
          {marketplace.locator !== null && <Mono>{marketplace.locator}</Mono>}
          <OperationLine opKey={key} />
        </span>
      }
      actions={
        <span className="flex shrink-0 items-center gap-1">
          <TextButton onClick={() => ask(key, requestFor('marketplace-update', { name: marketplace.name }, marketplace.source))} disabled={busy}>
            {W.refresh}
          </TextButton>
          <TextButton onClick={() => ask(key, requestFor('marketplace-remove', { name: marketplace.name }, marketplace.source, { uninstalls: uninstallsOf(installed, marketplace.name) }))} disabled={busy}>
            {W.remove}
          </TextButton>
        </span>
      }
    />
  );
}

// The installations a removal of `name` uninstalls.
const uninstallsOf = (installed: readonly InstalledPlugin[], name: string) => installed.filter((p) => p.marketplace === name).map(({ id, scope, projectPath }) => ({ id, scope, projectPath }));

function AddMarketplace() {
  const { ops, ask } = useManage();
  const [source, setSource] = useState('');
  const typed = source.trim();
  const busy = ops.entries.get(ADD_KEY)?.state.phase === 'working';
  const can = isPluginsArgument(typed) && !busy;
  const add = (event?: FormEvent) => {
    event?.preventDefault();
    if (can) ask(ADD_KEY, requestFor('marketplace-add', { source: typed }, sourceKindOfTyped(typed)));
  };
  const choose = async () => {
    const result = await ipc.invoke('layout.pickFiles', { kind: 'directory', directory: null, multiple: false });
    const picked = result.ok ? result.value.files[0] : undefined;
    if (picked) setSource(picked.path);
  };
  return (
    <form onSubmit={add} className="mt-2 flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          aria-label={W.addMarketplace}
          placeholder={W.addPlaceholder}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          className="min-w-0 flex-1 rounded-sm border border-border bg-bg px-2 py-0.5 text-ui-sm outline-accent focus-visible:outline-2"
        />
        <TextButton onClick={() => add()} disabled={!can}>
          {W.add}
        </TextButton>
        <TextButton onClick={() => void choose()}>{W.chooseFolder}</TextButton>
      </div>
      <OperationLine opKey={ADD_KEY} />
    </form>
  );
}

export function MarketplacesSection({ cwd, installed }: { cwd: string; installed: readonly InstalledPlugin[] }) {
  const { ops } = useManage();
  const read = usePluginsRead('marketplaces.list', cwd);
  const marketplaces = read.data?.marketplaces ?? [];
  const listed = new Set(marketplaces.map((m) => marketplaceKey(m.name)));
  const gone = read.data ? [...ops.entries.keys()].filter((key) => key.startsWith('marketplace:') && !listed.has(key)) : [];
  return (
    <div data-plugins-section="marketplaces">
      <Group label={W.marketplaces} count={read.data ? marketplaces.length : undefined}>
        {read.state === 'loading' && <p className="m-0 text-ui-sm text-fg-muted">{FRAME.reading}</p>}
        {read.error !== null && <p className={`m-0 text-ui-sm ${read.data ? 'text-warning' : 'text-danger'}`}>{read.error}</p>}
        {read.data &&
          (marketplaces.length === 0 ? (
            <p className="m-0 text-ui-sm text-fg-muted">{W.noMarketplaces}</p>
          ) : (
            <Rows label={W.marketplaceList}>
              {marketplaces.map((marketplace) => (
                <MarketplaceRow key={marketplace.name} marketplace={marketplace} installed={installed} />
              ))}
            </Rows>
          ))}
        {gone.map((key) => (
          <Gone key={key} opKey={key} name={key.slice('marketplace:'.length)} data={{ 'data-marketplace-result': key.slice('marketplace:'.length) }} />
        ))}
        <AddMarketplace />
      </Group>
    </div>
  );
}
