// Where this browser stands as a `web-cards` device, as the cards say it (P5 O13 M5): the cards are answered only by a
// device the org state lists, so until then — no device, a pairing waiting for the Mac, one expired, or a device the
// org no longer lists — the cards views say so and offer the Device panel.
import type { DeviceRecord } from '../../cards/device-store';
import { buttonSecondary } from '../common/Dialog';

export function DeviceStanding({ loaded, record, onDevice }: { loaded: boolean; record: DeviceRecord | null; onDevice(): void }) {
  if (!loaded) {
    return (
      <p className="m-0 text-ui-sm text-fg-muted" role="status">
        Reading this device…
      </p>
    );
  }
  const kind = record?.state.kind ?? 'none';
  const text =
    kind === 'removed'
      ? 'This phone is no longer listed in the org: it answers no cards now. Forget it in the Device panel, then pair it again if you mean to.'
      : kind === 'pending'
        ? 'This browser is waiting for your Mac to approve it as a device. Its cards show here once it is listed.'
        : kind === 'expired'
          ? 'The pairing expired before your Mac approved it. Pair this browser again in the Device panel.'
          : "This browser isn't a device of the org yet. Pair it in the Device panel to answer the cards of machines moved to MAWS.";
  return (
    <div className="flex flex-col items-start gap-2" data-testid="cards-device" data-state={kind}>
      <p className="m-0 text-ui-sm leading-5 text-fg-muted">{text}</p>
      <button type="button" className={buttonSecondary} onClick={onDevice}>
        Open the Device panel
      </button>
    </div>
  );
}
