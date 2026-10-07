// E4a (Task 3.3): the chrome's second row (Design §4 "Navigation row"): Back, Forward, Reload (Stop while the page
// loads), the address field, the partition pill, the control slot, later children's extras (E4d's Comment toggle), and
// the overflow menu. While the page loads a thin bar runs along the row's foot, as Codex's toolbar shows it; it sits
// over the row's border, so the row keeps its height.
import type { RefObject } from 'react';
import { DEFAULT_PARTITION, type BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { IconButton } from '../../../app/IconButton';
import { navigate } from '../actions';
import { BROWSER_COPY } from '../copy';
import { useChromeExtras } from '../extras';
import { BackIcon, CloseIcon, ForwardIcon, ReloadIcon } from '../icons';
import { AddressField } from './AddressField';
import { ControlSlot } from './ControlSlot';
import { OverflowMenu } from './OverflowMenu';
import { PartitionPill } from './PartitionPill';

export interface NavRowProps {
  appSessionId: AppSessionId;
  surface: 'panel' | 'main';
  tab: BrowserTab | null;
  addressRef: RefObject<HTMLInputElement | null>;
  owns: boolean;
  onFind(): void;
}

export function NavRow({ appSessionId, surface, tab, addressRef, owns, onFind }: NavRowProps) {
  const extras = useChromeExtras();
  const loading = tab?.loading ?? false;
  return (
    <div className="relative flex h-9 shrink-0 items-center gap-0.5 px-1">
      <IconButton label={BROWSER_COPY.back} disabled={!tab?.canGoBack} onClick={() => tab && navigate(tab.tabId, 'back')}>
        <BackIcon />
      </IconButton>
      <IconButton label={BROWSER_COPY.forward} disabled={!tab?.canGoForward} onClick={() => tab && navigate(tab.tabId, 'forward')}>
        <ForwardIcon />
      </IconButton>
      {loading ? (
        <IconButton label={BROWSER_COPY.stop} onClick={() => tab && navigate(tab.tabId, 'stop')}>
          <CloseIcon />
        </IconButton>
      ) : (
        <IconButton label={BROWSER_COPY.reloadPage} disabled={!tab || tab.url === ''} onClick={() => tab && navigate(tab.tabId, 'reload')}>
          <ReloadIcon />
        </IconButton>
      )}
      <AddressField appSessionId={appSessionId} surface={surface} tab={tab} inputRef={addressRef} />
      <PartitionPill partition={tab?.partition ?? DEFAULT_PARTITION} />
      {tab && <ControlSlot tab={tab} />}
      {tab && extras.map((Extra, index) => <Extra key={index} tab={tab} appSessionId={appSessionId} surface={surface} />)}
      <OverflowMenu appSessionId={appSessionId} surface={surface} tab={tab} owns={owns} onFind={onFind} />
      {loading && (
        <div aria-hidden data-browser-loading="" className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden">
          <div className="size-full animate-pulse bg-accent motion-reduce:animate-none" />
        </div>
      )}
    </div>
  );
}
