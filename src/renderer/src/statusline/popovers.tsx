// The six status-line popovers (§5.5 "Clicking opens popovers"; C7 execution document, "Status line popovers and
// usage"), each a Radix Popover around C5's field button, which Radix gives `aria-haspopup`, `aria-expanded` and
// `aria-controls`. A body mounts only while its popover is open, so the reads it makes (context, cost, models) run on
// open and never for a closed field.
import { Popover } from 'radix-ui';
import { useState, type ReactElement, type ReactNode } from 'react';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import { useCommand } from '../ipc/query';
import { useSessions } from '../stores/sessions';
import { ContextPopoverBody } from './ContextPopover';
import { ModeMenu, useLiveModeBinding } from './ModeMenu';
import { UsagePopoverBody } from './UsagePopover';

const CONTENT = 'z-50 max-h-[var(--radix-popover-content-available-height)] overflow-auto rounded-md border border-border-strong bg-bg-overlay text-ui text-fg';
const ACTION = 'self-start rounded-sm border border-border-strong px-2 py-0.5 outline-accent hover:bg-bg-hover focus-visible:outline-2';

function StatusPopover({ label, width, trigger, children }: { label: string; width: string; trigger: ReactElement; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content aria-label={label} side="top" align="start" sideOffset={6} collisionPadding={8} className={`${CONTENT} ${width}`}>
          {children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CwdBody({ record }: { record: SessionRecord }) {
  const [copied, setCopied] = useState(false);
  const branch = record.worktree?.branch ?? record.branch;
  const copy = () => {
    void navigator.clipboard?.writeText(record.directory);
    setCopied(true);
  };
  return (
    <div className="flex flex-col gap-2.5 p-3.5">
      <h3 className="font-semibold">Working directory</h3>
      <p className="font-mono text-ui-sm break-all">{record.directory}</p>
      {record.worktree && (
        <p className="text-ui-sm text-fg-muted">
          Worktree <span className="font-mono break-all">{record.worktree.path}</span>
        </p>
      )}
      <p className="text-ui-sm text-fg-muted">Branch {branch ?? '—'}</p>
      {record.additionalDirectories.length > 0 && (
        <div className="text-ui-sm">
          <p className="text-fg-muted">Additional directories</p>
          <ul aria-label="Additional directories" className="mt-1 flex flex-col gap-0.5 font-mono break-all">
            {record.additionalDirectories.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" onClick={copy} className={ACTION}>
        {copied ? 'Copied' : 'Copy path'}
      </button>
    </div>
  );
}

// Cost: the digest's running total at once; the engine's own cost report (`get_session_cost`, the `/cost` text with
// its per-model lines) read on open while the process is ready.
function CostBody({ record }: { record: SessionRecord }) {
  const id = record.appId;
  const live = useSessions((s) => s.engine.get(id)?.process === 'ready');
  const cost = useSessions((s) => s.digests.get(id)?.cost ?? null);
  const report = useCommand('session.getSessionCost', { appSessionId: id }, { enabled: live, staleTime: 10_000 });
  return (
    <div className="flex flex-col gap-2.5 p-3.5">
      <h3 className="font-semibold">Session cost</h3>
      <p>
        {cost ? `$${cost.totalUsd.toFixed(2)}` : '$—'}
        {cost && cost.sinceSeenUsd > 0 && <span className="text-ui-sm text-fg-muted"> · ${cost.sinceSeenUsd.toFixed(2)} since you last looked</span>}
      </p>
      {report.data ? (
        <pre aria-label="Cost by model" className="font-mono text-ui-sm whitespace-pre-wrap text-fg-muted">
          {report.data.text.trim()}
        </pre>
      ) : (
        <p className="text-ui-sm text-fg-muted">{live ? (report.isError ? report.error.message : 'Reading the engine’s cost report…') : 'Per-model cost is read from a running session'}</p>
      )}
    </div>
  );
}

function ModeBody({ record, close }: { record: SessionRecord; close: () => void }) {
  const binding = useLiveModeBinding(record);
  return (
    <div className="p-1.5">
      <ModeMenu binding={binding} onDone={close} />
    </div>
  );
}

type FieldProps = { record: SessionRecord; children: ReactElement };

export const CwdPopover = ({ record, children }: FieldProps) => (
  <StatusPopover label="Working directory" width="w-96" trigger={children}>
    {() => <CwdBody record={record} />}
  </StatusPopover>
);

export const ContextPopover = ({ record, children }: FieldProps) => (
  <StatusPopover label="Context window" width="w-80" trigger={children}>
    {(close) => <ContextPopoverBody record={record} close={close} />}
  </StatusPopover>
);

// The 5h and the 7d fields open the same popover.
export const UsagePopover = ({ record, status, children }: FieldProps & { status: EngineSessionStatus | null }) => (
  <StatusPopover label="Account usage" width="w-80" trigger={children}>
    {() => <UsagePopoverBody record={record} status={status} />}
  </StatusPopover>
);

export const CostPopover = ({ record, children }: FieldProps) => (
  <StatusPopover label="Session cost" width="w-80" trigger={children}>
    {() => <CostBody record={record} />}
  </StatusPopover>
);

export const ModePopover = ({ record, children }: FieldProps) => (
  <StatusPopover label="Permission mode" width="w-72" trigger={children}>
    {(close) => <ModeBody record={record} close={close} />}
  </StatusPopover>
);
