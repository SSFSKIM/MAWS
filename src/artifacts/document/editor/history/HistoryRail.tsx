// The version history rail (D10 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.7 of the parent): beside
// the page, the versions grouped by day newest first with runs of automatic versions folded under an expander, each
// row titled by its name or time with its author's chip (`--author-N` by `actorDisplay`) and one line of summary;
// "Named only"; "Save version" with a name and a note. A click previews a version in the editor in place; a
// shift-click compares it with the selected one. App chrome, so it reads the app's tokens (chrome.css).
import { useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { actorKey } from '@shared/artifacts/actor';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { HistoryController, HistorySnapshot } from './controller';
import { authorOf, groupVersions, versionSummary, versionTitle, type Entry } from './model';

interface Props {
  controller: HistoryController;
  snapshot: HistorySnapshot;
  sessionTitle?: (appSessionId: string) => string | undefined;
  onClose(): void;
}

export function HistoryRail({ controller, snapshot, sessionTitle, onClose }: Props) {
  const [namedOnly, setNamedOnly] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const groups = useMemo(() => groupVersions(snapshot.versions ?? [], { now: Date.now(), namedOnly }), [snapshot.versions, namedOnly]);
  const select = (version: ArtifactVersion, event: MouseEvent) => void controller.select(version.id, { extend: event.shiftKey });
  const row = (version: ArtifactVersion) => <VersionRow key={version.id} version={version} selected={snapshot.selected.includes(version.id)} sessionTitle={sessionTitle} onSelect={select} />;
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
      {(snapshot.status || snapshot.error || snapshot.loading) && (
        <p className="doc-history-status" role="status" data-error={snapshot.error ? '' : undefined}>
          {snapshot.error ?? (snapshot.loading ? 'Loading the version…' : snapshot.status)}
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
  const summary = versionSummary(version);
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
