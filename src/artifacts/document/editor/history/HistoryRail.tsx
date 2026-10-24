// The version history rail (D10 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.7 of the parent): beside
// the page, the versions grouped by day newest first with runs of automatic versions folded under an expander, each
// row titled by its name or time with its author's chip (`--author-N` by `actorDisplay`) and one line of summary;
// "Named only"; "Save version" with a name and a note. A click previews a version in the editor in place; a
// shift-click compares it with the selected one. App chrome, so it reads the app's tokens (chrome.css). P4 W1-B: a
// turn's line names its blocks and comments by the controller's `words`, the live document's, read once per list.
import { preserveSubmenuPointer } from '../../../ui/menu-pointer';
import { useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { DropdownMenu } from 'radix-ui';
import './version-export.css';
import { actorKey } from '@shared/artifacts/actor';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { HistoryController, HistorySnapshot } from './controller';
import { authorOf, groupVersions, versionTitle, type Entry } from './model';

export interface HistoryExport {
  id: string;
  label: string;
  disabled?: boolean;
  description?: string;
  children?: readonly HistoryExport[];
  onSelect(): void;
}
/** The host's existing export formats, bound to this card's retained version, not the editor's current view. */
export type VersionExports = (versionId: number) => readonly HistoryExport[];

interface Props {
  versionExports?: VersionExports;
  controller: Pick<HistoryController, 'select' | 'save' | 'now'> & Partial<Pick<HistoryController, 'words'>>; // P3-C (M8): what the rail drives, so a deck's controller drives it too; `now` names the list's days (gate-offload Decision Log 41); `words` the lines' blocks and comments (P4 W1-B; without it "a block", "a comment")
  snapshot: Pick<HistorySnapshot, 'versions' | 'selected' | 'loading' | 'status' | 'error'>; // P3-C (M8): the list fields it reads
  sessionTitle?: (appSessionId: string) => string | undefined;
  /** Whether the Save version form is open (the editor holds it, so the header's Save version can open it). */
  saving: boolean;
  onSaving(open: boolean): void;
  onClose(): void;
}

export function HistoryRail({ controller, snapshot, sessionTitle, saving, onSaving: setSaving, onClose, versionExports }: Props) {
  const [namedOnly, setNamedOnly] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const groups = useMemo(() => groupVersions(snapshot.versions ?? [], { now: controller.now(), namedOnly }), [controller, snapshot.versions, namedOnly]);
  const select = (version: ArtifactVersion, event: MouseEvent) => void controller.select(version.id, { extend: event.shiftKey });
  const row = (version: ArtifactVersion) => (
    <div key={version.id} className="doc-version-card">
      <VersionRow version={version} selected={snapshot.selected.includes(version.id)} sessionTitle={sessionTitle} onSelect={select} />
      {versionExports && <VersionExportMenu version={version} entries={versionExports(version.id)} />}
    </div>
  );
  const entry = (item: Entry) => {
    if (item.kind === 'version') return row(item.version);
    const [newest, ...rest] = item.versions;
    const open = expanded.has(newest.id);
    return (
      <div key={`run-${newest.id}`} className="doc-version-run">
        {row(newest)}
        <button
          type="button"
          className="doc-version-fold"
          aria-expanded={open}
          onClick={() => {
            const next = new Set(expanded);
            if (open) next.delete(newest.id);
            else next.add(newest.id);
            setExpanded(next);
          }}
        >
          {rest.length} more {rest.length === 1 ? 'version' : 'versions'}
        </button>
        {open && rest.map(row)}
      </div>
    );
  };
  return (
    <aside className="doc-rail" aria-label="Version history">
      <header className="doc-rail-header">
        <h2 className="doc-rail-title">Version history</h2>
        <button type="button" className="doc-tool" aria-label="Close version history" title="Close version history" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="doc-history-controls">
        <button type="button" className="doc-tool" aria-expanded={saving} onClick={() => setSaving(!saving)}>
          Save version
        </button>
        <label className="doc-history-filter">
          <input type="checkbox" checked={namedOnly} onChange={(event) => setNamedOnly(event.target.checked)} />
          Named only
        </label>
      </div>
      {saving && <SaveForm onSave={(version) => controller.save(version)} onDone={() => setSaving(false)} />}
      {(snapshot.error || snapshot.loading) && (
        <p className="doc-history-status" role="status" data-error={snapshot.error ? '' : undefined}>
          {snapshot.error ?? 'Loading the version…'}
        </p>
      )}
      <div className="doc-rail-body">
        {snapshot.versions === null ? (
          <p className="doc-rail-empty">Loading versions…</p>
        ) : groups.length === 0 ? (
          <p className="doc-rail-empty">{namedOnly ? 'No named versions yet.' : 'No versions yet.'}</p>
        ) : (
          groups.map((group) => (
            <section key={group.key} className="doc-version-day" aria-label={group.label}>
              <h3 className="doc-version-day-label">{group.label}</h3>
              {group.entries.map(entry)}
            </section>
          ))
        )}
      </div>
    </aside>
  );
}

function VersionRow({ version, selected, sessionTitle, onSelect }: { version: ArtifactVersion; selected: boolean; sessionTitle?: (id: string) => string | undefined; onSelect(version: ArtifactVersion, event: MouseEvent): void }) {
  const author = authorOf(actorKey(version.actor), sessionTitle);
  const title = versionTitle(version);
  const summary = version.note;
  return (
    <button
      type="button"
      className="doc-version"
      aria-pressed={selected}
      aria-label={`Version ${title} by ${author.name}${summary ? `: ${summary}` : ''}`}
      title="Click to preview; Shift-click to compare with the selected version"
      data-kind={version.kind}
      onClick={(event) => onSelect(version, event)}
    >
      <span className="doc-version-title">{title}</span>
      <span className="doc-version-author">
        <span className="doc-author-chip" data-author={author.name} style={{ background: `var(${author.color})` }} aria-hidden />
        {author.name}
      </span>
      {summary && <span className="doc-version-summary">{summary}</span>}
    </button>
  );
}

function VersionExportMenu({ version, entries }: { version: ArtifactVersion; entries: readonly HistoryExport[] }) {
  const label = `Export version ${versionTitle(version)}`;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="doc-tool doc-version-export" aria-label={label} title={label}>Export</button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="doc-tab-menu" align="end" sideOffset={4} aria-label={label}>
          {entries.map((entry) => <VersionExportItem key={entry.id} entry={entry} />)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function VersionExportItem({ entry }: { entry: HistoryExport }) {
  const label = <span className="doc-version-export-label">{entry.label}{entry.description && <span className="doc-version-export-description">{entry.description}</span>}</span>;
  if (entry.children?.length) return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger onPointerLeave={preserveSubmenuPointer} className="doc-tab-menu-item doc-version-export-group" disabled={entry.disabled}>
        {label}<span aria-hidden="true">›</span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent className="doc-tab-menu" sideOffset={4} aria-label={entry.label}>
          {entry.children.map(child => <VersionExportItem key={child.id} entry={child} />)}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
  return <DropdownMenu.Item className="doc-tab-menu-item" disabled={entry.disabled} onSelect={() => entry.onSelect()}>{label}</DropdownMenu.Item>;
}

// Save version: a name (required) and what changed.
function SaveForm({ onSave, onDone }: { onSave(version: { label: string; note?: string }): Promise<boolean>; onDone(): void }) {
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (label.trim() === '') return;
    void onSave({ label: label.trim(), ...(note.trim() ? { note: note.trim() } : {}) }).then((saved) => saved && onDone());
  };
  return (
    <form className="doc-history-save" onSubmit={submit}>
      <input aria-label="Version name" placeholder="Name, e.g. Draft to legal" maxLength={200} value={label} onChange={(event) => setLabel(event.target.value)} />
      <textarea aria-label="What changed" placeholder="What changed (optional)" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      <div className="doc-history-save-actions">
        <button type="button" className="doc-tool" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="doc-tool" disabled={label.trim() === ''}>
          Save
        </button>
      </div>
    </form>
  );
}
