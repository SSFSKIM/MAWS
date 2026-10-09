// The sheet's report state (E4b Design §10): the summary line, the Keychain outcome when cookies were not imported,
// the partitioned line, the sites per skip reason (hosts only, Decision Log 22), each extension with its state and the
// permissions MAWS doesn't support, and which profile new tabs now browse as. A run that did not finish kept nothing
// (main rolled it back, Decision Log 2), so its counts are framed as what the run reached before it stopped, and no
// extension state or active line is shown for it.
import { COOKIE_SKIP_REASONS, HISTORY_SKIP_REASONS, type ImportedExtension, type ImportReport } from '@shared/browser/import';
import { PRIMARY, SECONDARY } from '../../../sessions/ui';
import { useSettings } from '../../../stores/settings';
import { IMPORT_COPY } from './copy';

export function Report({ report, onClose }: { report: ImportReport; onClose(): void }) {
  const done = report.outcome === 'done';
  return (
    <div className="flex flex-col gap-3">
      <div className="-mr-2 flex max-h-[56vh] flex-col gap-2 overflow-y-auto pr-2">
        {done ? <Finished report={report} /> : <Stopped report={report} />}
      </div>
      <div className="flex justify-end">
        <button type="button" autoFocus onClick={onClose} className={done ? PRIMARY : SECONDARY}>
          {done ? IMPORT_COPY.done : IMPORT_COPY.close}
        </button>
      </div>
    </div>
  );
}

function Stopped({ report }: { report: ImportReport }) {
  return (
    <>
      {report.outcome === 'failed' && (
        <p role="alert" title={report.failure ?? undefined} className="m-0 text-danger">
          {IMPORT_COPY.failure(report.failure)}
        </p>
      )}
      <p className="m-0 text-fg">{IMPORT_COPY.nothingKept(report.name)}</p>
      <p data-import-summary className="m-0 text-ui-sm text-fg-muted">
        {IMPORT_COPY.reached(IMPORT_COPY.summary(report))}
      </p>
    </>
  );
}

function Finished({ report }: { report: ImportReport }) {
  const active = useSettings((s) => s.state?.settings.browser.profile === report.profileDir);
  const { cookies, history, extensions, bookmarks } = report;
  const keychain = cookies ? IMPORT_COPY.keychainLine(cookies, report.outcome) : null;
  return (
    <>
      <p data-import-summary className="m-0 text-fg">
        {IMPORT_COPY.summary(report)}
      </p>
      {keychain !== null && (
        <p data-import-keychain={cookies!.keychain} title={cookies!.error ?? undefined} className="m-0 text-ui-sm text-fg-muted">
          {keychain}
        </p>
      )}
      {history?.error != null && (
        <p title={history.error} className="m-0 text-ui-sm text-danger">
          {IMPORT_COPY.historyError(history.error)}
        </p>
      )}
      {bookmarks?.error != null && (
        <p title={bookmarks.error} className="m-0 text-ui-sm text-danger">
          {IMPORT_COPY.bookmarksError(bookmarks.error)}
        </p>
      )}
      {cookies !== null && cookies.partitioned.imported > 0 && (
        <p className="m-0 text-ui-sm text-fg-muted">{IMPORT_COPY.partitionedLine(cookies.partitioned.imported, cookies.partitioned.verified)}</p>
      )}
      {cookies !== null &&
        COOKIE_SKIP_REASONS.map((reason) => (
          <Sites key={`cookies-${reason}`} label={IMPORT_COPY.skippedSites('cookies', IMPORT_COPY.cookieReasons[reason], cookies.skipped[reason])} hosts={cookies.hosts[reason]} />
        ))}
      {history !== null &&
        HISTORY_SKIP_REASONS.map((reason) => (
          <Sites key={`history-${reason}`} label={IMPORT_COPY.skippedSites('history', IMPORT_COPY.historyReasons[reason], history.skipped[reason])} hosts={history.hosts[reason]} />
        ))}
      {extensions !== null && extensions.length > 0 && (
        <section aria-label={IMPORT_COPY.extensionsHeading} className="mt-1 flex flex-col gap-1.5">
          <h3 className="m-0 text-ui-sm font-medium text-fg-muted">{IMPORT_COPY.extensionsHeading}</h3>
          {extensions.map((extension) => (
            <div key={extension.id} data-extension-id={extension.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2 text-ui-sm">
                <span className="text-fg">{extension.name}</span>
                <span className="text-fg-muted">{extension.version}</span>
                <StatusChip extension={extension} />
              </div>
              {extension.unsupportedPermissions.length > 0 && (
                <details className="text-ui-sm text-fg-muted">
                  <summary className="cursor-default">{IMPORT_COPY.unsupportedHeading}</summary>
                  <p className="m-0 mt-0.5">{extension.unsupportedPermissions.join(', ')}</p>
                </details>
              )}
            </div>
          ))}
        </section>
      )}
      {active && <p className="m-0 mt-1 text-fg">{IMPORT_COPY.nowActive(report.name)}</p>}
    </>
  );
}

// One skip reason's sites (at most 20 hosts, main's cap), shown only when main named some.
function Sites({ label, hosts }: { label: string; hosts: string[] | undefined }) {
  if (!hosts || hosts.length === 0) return null;
  return (
    <details className="text-ui-sm text-fg-muted">
      <summary className="cursor-default">{label}</summary>
      <p className="m-0 mt-0.5 break-all">{hosts.join(', ')}</p>
    </details>
  );
}

// An imported extension's state as a chip; a failure (it could not be copied or loaded, or its background died) in the
// danger token, its code or first line in the title. Settings › Browser's extension rows show the same chip.
export function StatusChip({ extension }: { extension: ImportedExtension }) {
  const failed = extension.status === 'loadFailed' || extension.status === 'copyFailed' || (extension.status === 'loaded' && extension.background === 'failed');
  return (
    <span
      data-extension-status={extension.status}
      title={extension.error ?? undefined}
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-ui-sm ${failed ? 'border-danger text-danger' : 'border-border text-fg-muted'}`}
    >
      {IMPORT_COPY.extensionStatus(extension)}
    </span>
  );
}
