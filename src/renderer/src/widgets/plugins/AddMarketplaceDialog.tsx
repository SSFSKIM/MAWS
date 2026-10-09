// Add marketplace (P2-B execution document §5.9; Claude Desktop's dialog in its 2.16120.0 bundle, gated off for local Code
// there, readable/app-2.16120.0/web/app/v1/caeab6b9d-M8Zj-WvL.js:835-1091): a `Sheet` beside the frame (E8 D-16) at
// Desktop's large width, its trust warning verbatim, one field labelled "Source" (E8's placeholder; a GitHub owner/repo,
// a Git repository URL or a folder, typed or chosen with Choose folder…), and Add, which opens E8's `marketplace-add`
// confirm sheet above it; nothing runs before that sheet is confirmed. The field's rules are E8's (`isPluginsArgument`,
// `sourceKindOfTyped`). The dialog stays open with the change's operation line under the field, in the engine's own
// words (Desktop's error mapping and its access-token step rest on its own Git client and are not ported), so another
// source can be added; Cancel becomes Done once one has run.
import { useId, useState } from 'react';
import { isPluginsArgument } from '@shared/plugins/cli';
import { ipc } from '../../ipc/client';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { FIELD, PRIMARY, SECONDARY } from '../../sessions/ui';
import { LIBRARY as L, PLUGIN_MANAGEMENT as W } from '../copy';
import { OperationLine, useManage } from './manage';
import { requestFor, sourceKindOfTyped } from './present';

export const ADD_KEY = 'marketplace-add';

export function AddMarketplaceDialog({ onClose }: { onClose(): void }) {
  const { ops, ask } = useManage();
  const [source, setSource] = useState('');
  const field = useId();
  const helper = useId();
  const typed = source.trim();
  const entry = ops.entries.get(ADD_KEY);
  const busy = entry?.state.phase === 'working';
  const choose = async () => {
    const result = await ipc.invoke('layout.pickFiles', { kind: 'directory', directory: null, multiple: false });
    const picked = result.ok ? result.value.files[0] : undefined;
    if (picked) setSource(picked.path);
  };
  return (
    <Sheet title={L.addMarketplace} width="w-[min(720px,90vw)]" onClose={onClose} data-marketplaces-dialog="add">
      <SheetForm
        canSubmit={isPluginsArgument(typed) && !busy}
        onSubmit={() => ask(ADD_KEY, requestFor('marketplace-add', { source: typed }, sourceKindOfTyped(typed)))}
        submitLabel={L.add}
        submitClass={PRIMARY}
        cancelLabel={entry ? L.done : L.cancel}
      >
        <p role="note" className="m-0 rounded-md border border-danger px-3 py-2 text-ui-sm text-fg">
          {L.trustWarning}
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={field} className="font-medium text-fg">
            {L.sourceField}
          </label>
          <div className="flex items-center gap-2">
            <input
              id={field}
              autoFocus
              aria-describedby={helper}
              placeholder={W.addPlaceholder}
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className={`${FIELD} min-w-0 flex-1`}
            />
            <button type="button" className={SECONDARY} onClick={() => void choose()}>
              {W.chooseFolder}
            </button>
          </div>
          <p id={helper} className="m-0 text-ui-sm text-fg-muted">
            {L.sourceHelper}
          </p>
          <div data-marketplace-add-line className="text-ui-sm empty:hidden">
            <OperationLine opKey={ADD_KEY} />
          </div>
        </div>
      </SheetForm>
    </Sheet>
  );
}
