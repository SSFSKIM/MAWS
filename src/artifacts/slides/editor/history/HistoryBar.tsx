// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11; M8): the deck preview's bar in place of the
// editor's toolbar while a version shows, B's preview bar for a deck: what is shown, Show changes (on by default),
// "N changes" of the whole comparison with ↑ ↓ (the stage moves to each change's slide), Restore this version
// (confirmed first), Make a copy, Name this version, and Back to presentation.
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3): stepping through changes reads "2 / 5",
// named in words (G489); the buttons read Restore, Make a copy, Name and Done, each keeping its full name, which its
// tooltip shows (G490); the name field's placeholder is "Version name" (G492).
import { useState, type FormEvent, type ReactNode } from 'react';
import { BareCount } from '../../../../renderer/src/ui/count';
import { Tip } from '../../../../renderer/src/ui/tip';
import type { DeckHistoryController, DeckPreview } from './controller';
import { HISTORY_COPY as C } from './copy';

export function HistoryBar({ preview, controller, onBack, toolbarEnd }: { preview: DeckPreview; controller: DeckHistoryController; onBack(): void; toolbarEnd?: ReactNode }) {
  const [confirming, setConfirming] = useState(false);
  const [naming, setNaming] = useState(false);
  const count = preview.changes.count;
  return (
    <>
      <div className="deck-toolbar deck-history-bar" role="toolbar" aria-label={C.bar}>
        <span className="deck-history-heading">{preview.title}</span>
        <span className="deck-toolbar-divider" aria-hidden />
        <label className="deck-history-toggle">
          <input type="checkbox" checked={preview.showChanges} onChange={(event) => controller.setShowChanges(event.target.checked)} />
          {C.showChanges}
        </label>
        {preview.showChanges && (
          <>
            <span className="deck-history-count" aria-live="polite" data-history-count={count}>
              {preview.focus === null ? C.count(count) : <BareCount count={C.step(preview.focus + 1, preview.stops.length)} meaning={C.stepName(preview.focus + 1, preview.stops.length)} />}
            </span>
            <Button label={C.previous} disabled={count === 0} onClick={() => controller.step(-1)}>
              ↑
            </Button>
            <Button label={C.next} disabled={count === 0} onClick={() => controller.step(1)}>
              ↓
            </Button>
          </>
        )}
        <span className="deck-toolbar-spacer" />
        {preview.versionId !== null && (
          <>
            <Button label={C.restore} tip onClick={() => setConfirming(true)}>
              {C.restoreWord}
            </Button>
            <Button label={C.copy} onClick={() => void controller.duplicate()}>
              {C.copy}
            </Button>
            {controller.canName && (
              <Button label={C.name} tip onClick={() => setNaming(true)}>
                {C.nameWord}
              </Button>
            )}
          </>
        )}
        <Button label={C.back} tip onClick={onBack}>
          {C.backWord}
        </Button>
        {toolbarEnd}
      </div>
      {naming && <NameForm onName={(label) => controller.name(label)} onDone={() => setNaming(false)} />}
      {confirming && (
        <div className="deck-history-confirm" role="alertdialog" aria-label={C.restoreAsk}>
          <p>{C.restoreBody}</p>
          <div className="deck-history-actions">
            <Button label={C.cancel} onClick={() => setConfirming(false)}>
              {C.cancel}
            </Button>
            <Button
              label={C.restoreConfirm}
              onClick={() => {
                setConfirming(false);
                void controller.restore();
              }}
            >
              {C.restoreConfirm}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

// `tip`: its words are shorter than its name, so the name is its tooltip (G490); a button whose words are its name has
// none, and the arrows keep their system `title` as on master (board ticket 815).
function Button({ label, disabled, tip = false, onClick, children }: { label: string; disabled?: boolean; tip?: boolean; onClick(): void; children: ReactNode }) {
  const button = (
    <button type="button" className="deck-button" aria-label={label} title={tip ? undefined : label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
  return tip ? <Tip content={label}>{button}</Tip> : button;
}

function NameForm({ onName, onDone }: { onName(label: string): Promise<boolean>; onDone(): void }) {
  const [label, setLabel] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = label.trim();
    if (name === '') return;
    void onName(name).then((named) => named && onDone());
  };
  return (
    <form className="deck-history-confirm" aria-label={C.name} onSubmit={submit}>
      <input className="deck-history-name" aria-label={C.nameField} placeholder={C.namePlaceholder} maxLength={200} value={label} onChange={(event) => setLabel(event.target.value)} />
      <div className="deck-history-actions">
        <Button label={C.cancel} onClick={onDone}>
          {C.cancel}
        </Button>
        <button type="submit" className="deck-button" disabled={label.trim() === ''}>
          {C.save}
        </button>
      </div>
    </form>
  );
}
