// Settings › Engine's custody row (C12 execution document, M4 task 2; Interfaces "Engine custody"): MAWS's own copy of
// the pinned engine as main's `settings.engineCustody` answers it, or the refusal a launch would give, in words.
import type { Settings } from '@shared/ipc/schema';
import { useCommand } from '../ipc/query';
import { CUSTODY_SETTINGS } from './copy';
import { Chip, Setting } from './parts';

export const CUSTODY_KEY = ['maws', 'settings.engineCustody', undefined];

export function CustodySetting({ settings }: { settings: Settings }) {
  const custody = useCommand('settings.engineCustody', undefined);
  const c = custody.data;
  return (
    <Setting label={CUSTODY_SETTINGS.label} note={CUSTODY_SETTINGS.note}>
      {c === undefined ? (
        <span className="text-ui-sm text-fg-muted">{custody.isError ? custody.error.message : CUSTODY_SETTINGS.reading}</span>
      ) : c === null ? (
        <span className="text-ui-sm text-fg-muted">{CUSTODY_SETTINGS.off}</span>
      ) : c.state === 'ok' ? (
        <span className="min-w-0 truncate font-mono text-ui-sm text-fg" title={c.path}>
          {CUSTODY_SETTINGS.ok(c.manifest.version, c.manifest.sha256, c.manifest.copiedAt)}
        </span>
      ) : (
        <span className="basis-full text-ui-sm text-warning">{c.message}</span>
      )}
      {c !== undefined && c !== null && settings.engine.binaryPath !== null && <Chip>{CUSTODY_SETTINGS.chosen}</Chip>}
    </Setting>
  );
}
