// The Chrome profile import sheet (E4b Design §3; Decision Log 21 and 28): one Radix Dialog rendered by Settings ›
// Browser's block on its own `open`, walking the store's stage: pick, consent, running, report, failed. Its state lives
// in `useBrowserImport`, so a sheet closed or unmounted mid-run (Settings closed, a reload) reopens on the run. Closing:
// in pick and consent it discards a standing inspection (main deletes the staging); while a run goes on it does nothing
// (only Cancel ends a run); in report and failed it just closes. While a start is in flight, consent cannot be
// dismissed either, so its answer never lands on a closed sheet. A sheet unmounted in pick or consent (Settings
// closed) discards as its close does. A report it renders is marked shown, so Settings stops offering it.
import { useEffect } from 'react';
import { Sheet } from '../../../sessions/Sheet';
import { SECONDARY } from '../../../sessions/ui';
import { Consent } from './Consent';
import { IMPORT_COPY } from './copy';
import { ProfilePicker, type PickerPreselect } from './ProfilePicker';
import { Progress } from './Progress';
import { Report } from './Report';
import { browserImport, discard, reportShown, useBrowserImport, type ImportStage } from './store';

const WIDTH = 'w-[min(560px,90vw)]';

function titleOf(stage: ImportStage): string {
  switch (stage.kind) {
    case 'pick':
      return IMPORT_COPY.title.pick;
    case 'consent':
      return IMPORT_COPY.title.consent(stage.inspection.profile.name);
    case 'running':
      return IMPORT_COPY.title.running(stage.name);
    case 'report':
      if (stage.report.outcome === 'done') return IMPORT_COPY.title.done(stage.report.name);
      return stage.report.outcome === 'cancelled' ? IMPORT_COPY.title.cancelled : IMPORT_COPY.title.failed;
    case 'failed':
      return IMPORT_COPY.title.failed;
  }
}

// `preselect` (cua #90): a re-import's picker, on the removed profile's folder with it chosen.
export function ImportSheet({ onClose, preselect }: { onClose(): void; preselect?: PickerPreselect }) {
  const stage = useBrowserImport((s) => s.stage);
  const busy = useBrowserImport((s) => s.busy);
  useEffect(
    () => () => {
      const kind = browserImport.getState().stage.kind;
      if (kind === 'pick' || kind === 'consent') discard();
    },
    [],
  );
  useEffect(() => {
    if (stage.kind === 'report') reportShown(stage.report);
  }, [stage]);
  const close = () => {
    if (stage.kind === 'running' || (stage.kind === 'consent' && busy)) return;
    if (stage.kind === 'pick' || stage.kind === 'consent') discard();
    onClose();
  };
  return (
    <Sheet title={titleOf(stage)} width={WIDTH} onClose={close} data-browser-import={stage.kind}>
      {stage.kind === 'pick' && <ProfilePicker preselect={preselect} />}
      {stage.kind === 'consent' && <Consent key={stage.inspection.inspectionId} inspection={stage.inspection} />}
      {stage.kind === 'running' && <Progress progress={stage.progress} cancelling={stage.cancelling} />}
      {stage.kind === 'report' && <Report report={stage.report} onClose={close} />}
      {stage.kind === 'failed' && (
        <div className="flex flex-col gap-3">
          <p role="alert" className="m-0 text-danger">
            {stage.message}
          </p>
          <div className="flex justify-end">
            <button type="button" autoFocus onClick={close} className={SECONDARY}>
              {IMPORT_COPY.close}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
