// The Artifacts page (DESIGN.md section 21): the library of what sessions made. A thing is one line on the field,
// told apart by its kind's glyph; it opens into a sheet of glass with its facts, the sessions that touched it and
// what can be done with it. Making something new is one round button of glass at the top right.
import { useCallback, useState } from 'react';
import {
  AppWindow,
  ChartColumn,
  Check,
  ChevronRight,
  Copy,
  Download,
  File,
  FileText,
  FolderInput,
  FolderPlus,
  Frame,
  Link2,
  ListFilter,
  Monitor,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Presentation,
  Send,
  Sparkles,
  SwatchBook,
  Trash2,
} from 'lucide-react';
import { artifactKinds, artifacts, artifactSpaces, fleet, type Artifact, type ArtifactKind } from '../../content/fixtures';
import { useNeeds } from './needs';
import { Pop } from './parts';
import { Facts, Find, Line, Narrow, Plus1 } from './Shelf';
import { itemsOf } from './Transcript';

export type ShelfGroup = 'date' | 'space';

const ICON: Record<ArtifactKind, typeof FileText> = { document: FileText, presentation: Presentation, design: Frame, design_system: SwatchBook, dashboard: ChartColumn, html: AppWindow, file: File };
export function KindGlyph({ kind, size = 15 }: { kind: ArtifactKind; size?: number }) {
  const Icon = ICON[kind];
  return <Icon size={size} strokeWidth={1.75} />;
}
const kindOf = (kind: ArtifactKind) => artifactKinds.find((k) => k.kind === kind)!;
const spaceOf = (id: string | undefined) => artifactSpaces.find((s) => s.id === id);
const sessions = fleet.flatMap((p) => p.sessions);
const ago = (age: string) => (age === 'now' ? 'just now' : `${age} ago`);

function groupsOf(list: Artifact[], by: ShelfGroup): { key: string; title: string; mirroredTo?: string; rows: Artifact[] }[] {
  if (by === 'space') {
    const groups = artifactSpaces.map((s) => ({ key: s.id, title: s.name, mirroredTo: s.mirroredTo, rows: list.filter((a) => a.space === s.id) }));
    const loose = list.filter((a) => !a.space);
    return [...groups, { key: 'none', title: 'General', rows: loose }].filter((g) => g.rows.length > 0);
  }
  const out: { key: string; title: string; rows: Artifact[] }[] = [];
  const pinned = list.filter((a) => a.pinned);
  if (pinned.length) out.push({ key: 'pinned', title: 'Pinned', rows: pinned });
  for (const a of list) {
    if (a.pinned) continue;
    const last = out[out.length - 1];
    if (last && last.key === a.when) last.rows.push(a);
    else out.push({ key: a.when, title: a.when, rows: [a] });
  }
  return out;
}

/** What a line opens into: what the app's row prints at once, and what its menu holds. */
function Inside({ a }: { a: Artifact }) {
  const needs = useNeeds();
  const space = spaceOf(a.space);
  return (
    <>
      <Facts>
        <span>{kindOf(a.kind).label}</span>
        {space && <span className="xl-s-chip">{space.name}</span>}
        {a.project && <span>{a.project}</span>}
        <span>
          Edited {ago(a.age)} by {a.by}
        </span>
        {a.sent && (
          <span>
            <Send size={12} strokeWidth={1.75} />
            {a.sent.to}, {ago(a.sent.age)}
          </span>
        )}
      </Facts>
      {a.sessions && a.sessions.length > 0 && (
        <div className="xl-s-chips">
          {a.sessions.map((s) => {
            const session = sessions.find((x) => x.id === s.id);
            const can = itemsOf(s.id).length > 0;
            return (
              <button key={s.id} type="button" className="xl-s-chip" data-press="" data-tip={s.roles.join(', ')} data-tip-at="above-start" onClick={() => can && needs.open(s.id)}>
                {session?.title ?? s.id}
              </button>
            );
          })}
        </div>
      )}
      <div className="xl-s-acts">
        <button type="button" className="xl-icon" aria-label={a.pinned ? 'Unpin' : 'Pin'} data-tip={a.pinned ? 'Unpin' : 'Pin'} data-tip-at="above-start">
          {a.pinned ? <PinOff size={15} strokeWidth={1.75} /> : <Pin size={15} strokeWidth={1.75} />}
        </button>
        <button type="button" className="xl-icon" aria-label="Rename" data-tip="Rename" data-tip-at="above">
          <Pencil size={15} strokeWidth={1.75} />
        </button>
        <button type="button" className="xl-icon" aria-label="Move to a Space" data-tip="Move to a Space" data-tip-at="above">
          <FolderInput size={15} strokeWidth={1.75} />
        </button>
        <button type="button" className="xl-icon" aria-label="Duplicate" data-tip="Duplicate" data-tip-at="above">
          <Copy size={15} strokeWidth={1.75} />
        </button>
        <button type="button" className="xl-icon" aria-label="Export" data-tip="Export" data-tip-at="above">
          <Download size={15} strokeWidth={1.75} />
        </button>
        <button type="button" className="xl-icon" aria-label="Delete" data-tip="Delete" data-tip-at="above">
          <Trash2 size={15} strokeWidth={1.75} />
        </button>
        <span className="xl-grow" />
        <button type="button" className="xl-btn" data-kind="go">
          Open
        </button>
      </div>
    </>
  );
}

export function ArtifactsPage({ group, setGroup, empty, first }: { group: ShelfGroup; setGroup: (g: ShelfGroup) => void; empty: boolean; first?: string }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ArtifactKind | null>(null);
  const [pinned, setPinned] = useState(false);
  const [open, setOpen] = useState<string | null>(first ?? null);
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [menu, setMenu] = useState(false);
  const close = useCallback(() => setMenu(false), []);
  const q = query.trim().toLowerCase();
  const list = (empty ? [] : artifacts).filter((a) => (!kind || a.kind === kind) && (!pinned || a.pinned) && (!q || a.title.toLowerCase().includes(q) || a.by.toLowerCase().includes(q)));
  const groups = groupsOf(list, group);
  return (
    <div className="xl-items xl-board xl-shelf">
      <Find words="Search artifacts" value={query} onChange={setQuery}>
        {kind && (
          <Narrow onClear={() => setKind(null)}>
            <KindGlyph kind={kind} size={13} />
            {kindOf(kind).plural}
          </Narrow>
        )}
        {pinned && (
          <Narrow onClear={() => setPinned(false)}>
            <Pin size={12} strokeWidth={1.9} />
            Pinned
          </Narrow>
        )}
        <button type="button" ref={setEl} className="xl-icon" aria-label="Narrow or arrange the list" aria-expanded={menu} data-tip="Show" data-tip-at="end" onClick={() => setMenu((v) => !v)}>
          <ListFilter size={16} strokeWidth={1.75} />
        </button>
      </Find>
      <Pop open={menu} anchor={el} place="below-end" onClose={close} className="xl-s-menu" label="Show">
        {artifactKinds.map((k) => (
          <button key={k.kind} type="button" className="xl-item" onClick={() => setKind(kind === k.kind ? null : k.kind)}>
            <KindGlyph kind={k.kind} />
            <span>{k.plural}</span>
            {kind === k.kind && <Check size={14} strokeWidth={2} />}
          </button>
        ))}
        <button type="button" className="xl-item" onClick={() => setPinned((v) => !v)}>
          <Pin size={15} strokeWidth={1.75} />
          <span>Pinned</span>
          {pinned && <Check size={14} strokeWidth={2} />}
        </button>
        <div className="xl-sep" />
        <button type="button" className="xl-item" onClick={() => setGroup('date')}>
          <span>By date</span>
          {group === 'date' && <Check size={14} strokeWidth={2} />}
        </button>
        <button type="button" className="xl-item" onClick={() => setGroup('space')}>
          <span>By Space</span>
          {group === 'space' && <Check size={14} strokeWidth={2} />}
        </button>
        <div className="xl-sep" />
        <button type="button" className="xl-item" onClick={close}>
          <FolderPlus size={15} strokeWidth={1.75} />
          <span>New Space</span>
        </button>
        <button type="button" className="xl-item" onClick={close}>
          <Monitor size={15} strokeWidth={1.75} />
          <span>This Mac</span>
          <ChevronRight size={13} strokeWidth={2} />
        </button>
      </Pop>

      {groups.length === 0 && <p className="xl-s-none">{empty ? 'What your sessions make lands here.' : `Nothing matches${q ? ` “${query.trim()}”` : ''}.`}</p>}
      {groups.map((g) => (
        <section key={g.key} className="xl-o-group" aria-label={g.title}>
          <h3 className="xl-o-head">
            {g.title}
            {g.mirroredTo && (
              <span className="xl-s-mirror" data-tip={`Copied into ${g.mirroredTo}`} tabIndex={0}>
                <Link2 size={13} strokeWidth={1.9} />
              </span>
            )}
          </h3>
          {g.rows.map((a) => {
            const space = spaceOf(a.space);
            return (
              <Line
                key={a.id}
                label={a.title}
                open={open === a.id}
                onToggle={() => setOpen(open === a.id ? null : a.id)}
                mark={<KindGlyph kind={a.kind} />}
                title={a.title}
                badge={a.pinned && group !== 'date' ? <Pin className="xl-s-pin" size={12} strokeWidth={1.9} aria-label="Pinned" /> : undefined}
                line={a.by}
                end={
                  <span className="xl-o-meta">
                    {group === 'date' && space && <span className="xl-o-where">{space.name}</span>}
                    <span className="xl-o-age">{a.age}</span>
                  </span>
                }
              >
                <Inside a={a} />
              </Line>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** Making something new: every kind as one row; a press makes a blank one, and the spark asks Claude for it. */
export function MakeNew({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Plus1 open={open} onToggle={onToggle} icon={<Plus size={17} strokeWidth={1.75} />} words={{ show: 'Make something new', hide: 'Close' }} label="Make something new">
      <section className="xl-part" aria-label="New">
        <h3 className="xl-module-head">New</h3>
        {artifactKinds.map((k) => (
          <div key={k.kind} className="xl-line xl-s-make">
            <button type="button" className="xl-s-make-main" data-tip={k.blurb} data-tip-at="above-start">
              <KindGlyph kind={k.kind} />
              <span className="xl-line-text">{k.kind === 'file' ? 'File from your Mac' : k.label}</span>
            </button>
            {k.kind !== 'file' && (
              <button type="button" className="xl-icon xl-s-ask" aria-label={`Ask Claude for a ${k.label.toLowerCase()}`} data-tip="Ask Claude" data-tip-at="above-end">
                <Sparkles size={15} strokeWidth={1.75} />
              </button>
            )}
          </div>
        ))}
      </section>
    </Plus1>
  );
}
