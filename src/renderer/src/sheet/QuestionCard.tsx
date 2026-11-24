// One open question (the composite's §8, "The card"; the C3 plan's §G and "The look", M3; frames 1, 2 and 5). The card
// states which of frame 2's states it is in from its inputs alone: `question.queued` reads the queued answer back with
// Take back and Edit (Edit opens a draft that replaces it); `mark` draws "Updated", and a card refused as stale says why
// as well; a draft typed against an earlier revision is drawn as carried (its text in the field, its picks marked and not
// picked) and counts for nothing in Send until the person keeps it or edits the card, which confirms it. Its own state is
// what rightly dies with it: which option has the pointer or the focus, which reference is open, a compact card's fold.
// Its root carries `data-sheet-question`, by which C4's page finds a card to scroll to.
import { Checkbox, RadioGroup } from 'radix-ui';
import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import type { SheetBody, SheetImageType, SheetOption, SheetQuestion, SheetReference } from '@shared/sheet/model';
import { confirmDraft, isConfirmed, questionSentence, type QuestionDraft } from '@shared/sheet/words';
import { CardButton } from '../request-card/controls';
import { NamedGlyph } from '../ui/glyph';
import { SHEET_WORDS } from './copy';
import type { SheetHost } from './host';
import { Chevron, CloseIcon } from './icons';
import { ReferenceView } from './ReferenceView';
import { SheetMarkdown } from './SheetMarkdown';

export interface QuestionCardProps {
  session: string;
  question: SheetQuestion;
  draft: QuestionDraft | undefined;
  mark: 'none' | 'updated' | 'stale';
  busy: boolean; // an act of this surface on this question is in flight
  host: SheetHost;
  density?: 'full' | 'compact'; // compact: folded to its row line until chosen
  onDraft(next: QuestionDraft | null): void;
  onDismiss(): void;
  onRetract(key: string): void; // take back the queued answer that stands on the question
}

const IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] satisfies SheetImageType[];
const MAX_IMAGES = 8; // an inbox line's bound (the composite's §4.1)
const ROW =
  'flex w-full items-start gap-2 rounded-sm border border-border px-2.5 py-1.5 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:hover:bg-transparent data-[state=checked]:border-border-strong data-[state=checked]:bg-bg-active data-[carried]:border-dashed data-[carried]:border-border-strong';
const QUIET = 'self-start rounded-sm text-ui-sm text-fg-muted outline-accent hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:text-fg-faint';
const fromOf = (question: SheetQuestion): string | null => (question.asker === 'main' ? null : question.asker.name);
const isEmpty = (draft: QuestionDraft): boolean => draft.picks.length === 0 && draft.text === '' && draft.images.length === 0 && draft.replaces === undefined;

function OptionText({ n, option, carried }: { n: number; option: SheetOption; carried: boolean }) {
  return (
    <>
      <span aria-hidden="true" className="w-3 shrink-0 text-fg-muted tabular-nums">
        {n}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={carried ? 'text-fg-muted' : 'text-fg'}>
          {option.label}
          {option.recommended === true && <span className="ml-1.5 text-ui-sm whitespace-nowrap text-fg-muted">{SHEET_WORDS.recommended}</span>}
        </span>
        {option.description && <span className="text-ui-sm text-fg-muted">{option.description}</span>}
      </span>
    </>
  );
}

// L3: the preview of the focused option, else the picked one's, else the recommended one's; the first of them that has
// one, so the card does not move when focus leaves the options. Single-select only (previews are, §1).
function previewOf(question: SheetQuestion, picks: readonly string[], pointed: string | null): SheetOption | null {
  const labelled = (label: string | null | undefined) => question.options.find((option) => option.label === label && option.preview !== undefined);
  return labelled(pointed) ?? labelled(picks[0]) ?? question.options.find((option) => option.recommended === true && option.preview !== undefined) ?? null;
}

function Upload({ session, path, n, host, onRemove, disabled }: { session: string; path: string; n: number; host: SheetHost; onRemove(): void; disabled: boolean }) {
  const [body, setBody] = useState<SheetBody | null>(null);
  useEffect(() => {
    let live = true;
    host.body(session, { upload: path }).then(
      (answer) => live && setBody(answer),
      () => live && setBody({ kind: 'gone' }),
    );
    return () => {
      live = false;
    };
  }, [host, session, path]);
  return (
    <span className="flex items-center gap-1 rounded-sm border border-border bg-bg py-0.5 pr-0.5 pl-1 text-ui-sm text-fg-muted" data-sheet-upload={path}>
      {body?.kind === 'image' ? <img alt="" src={`data:${body.mediaType};base64,${body.data}`} className="size-5 rounded-[2px] object-cover" /> : null}
      <span>{SHEET_WORDS.image(n)}</span>
      {!disabled && (
        <NamedGlyph label={SHEET_WORDS.removeImage(n)} onClick={onRemove} className="inline-flex size-4 items-center justify-center rounded-sm text-fg-muted outline-accent hover:text-fg focus-visible:outline-2">
          <CloseIcon />
        </NamedGlyph>
      )}
    </span>
  );
}

// The answer a queued line stands for, read back in the receipt's shape (frame 2).
function QueuedAnswer({ picks, text }: { picks: readonly string[]; text: string }) {
  const head = picks.length > 0 ? picks.join(', ') : text;
  return (
    <div className="flex flex-col gap-0.5 rounded-sm bg-bg px-2.5 py-2">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span aria-hidden="true" className="transcript-question-arrow shrink-0">
          →
        </span>
        <span className="min-w-0 text-fg [overflow-wrap:anywhere]">{head}</span>
      </div>
      {picks.length > 0 && text.trim() !== '' && <p className="m-0 pl-[19px] text-fg-muted [overflow-wrap:anywhere] whitespace-pre-wrap">{text}</p>}
    </div>
  );
}

function Note({ tone, children }: { tone: 'warning' | 'neutral'; children: ReactNode }) {
  return (
    <div role="status" className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-sm border px-2.5 py-1.5 text-fg ${tone === 'warning' ? 'border-warning' : 'border-border-strong'}`}>
      {children}
    </div>
  );
}

export function QuestionCard({ session, question, draft, mark, busy, host, density = 'full', onDraft, onDismiss, onRetract }: QuestionCardProps) {
  const [pointed, setPointed] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set()); // references open, by hash
  const [folded, setFolded] = useState(true); // compact only
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const latest = useRef(draft); // what a pasted image's late answer adds to
  useEffect(() => {
    latest.current = draft;
  });

  const queued = question.queued;
  const editing = queued !== undefined && draft?.replaces === queued.key;
  const carried = draft !== undefined && !isConfirmed(draft, question);
  const picks = draft !== undefined && !carried ? draft.picks : [];
  const carriedPicks = carried ? draft.picks.filter((pick) => question.options.some((option) => option.label === pick)) : [];

  // Every edit starts from the draft as the person sees it: none, the confirmed one, or the carried one confirmed (§G).
  const startOf = (from: QuestionDraft | undefined): QuestionDraft => (from === undefined ? { revision: question.revision, picks: [], text: '', images: [] } : isConfirmed(from, question) ? from : confirmDraft(from, question));
  const edit = (change: (from: QuestionDraft) => QuestionDraft, from = draft): QuestionDraft | undefined => {
    if (busy) return from;
    const next = change(startOf(from));
    onDraft(isEmpty(next) ? null : next);
    return isEmpty(next) ? undefined : next;
  };
  const pick = (label: string) => edit((from) => ({ ...from, picks: [label] }));
  const toggle = (label: string, on: boolean) => edit((from) => ({ ...from, picks: on ? [...from.picks.filter((p) => p !== label), label] : from.picks.filter((p) => p !== label) }));
  const type = (text: string) => edit((from) => ({ ...from, text }));
  const keep = () => !busy && draft !== undefined && onDraft(confirmDraft(draft, question));
  const removeImage = (path: string) => edit((from) => ({ ...from, images: from.images.filter((image) => image !== path) }));

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...(event.clipboardData?.files ?? [])].filter((file) => IMAGE_TYPES.includes(file.type));
    if (files.length === 0 || !host.saveImage) return;
    event.preventDefault();
    const room = MAX_IMAGES - (draft?.images.length ?? 0);
    setPasteNote(files.length > room ? SHEET_WORDS.imagesFull : null);
    const save = host.saveImage;
    // One at a time, each added to the draft the last one left, so two pasted together both stay.
    void (async () => {
      for (const file of files.slice(0, Math.max(room, 0))) {
        const saved = await save(session, { mediaType: file.type as SheetImageType, bytes: new Uint8Array(await file.arrayBuffer()) });
        if (!saved.ok) {
          setPasteNote(saved.why);
          continue;
        }
        latest.current = edit((from) => (from.images.length >= MAX_IMAGES ? from : { ...from, images: [...from.images, saved.path] }), latest.current);
      }
    })();
  };

  const openReference = (reference: SheetReference) => setOpened((was) => new Set(was).add(reference.sha256));
  const setReference = (reference: SheetReference, open: boolean) =>
    setOpened((was) => {
      const next = new Set(was);
      if (open) next.add(reference.sha256);
      else next.delete(reference.sha256);
      return next;
    });

  const from = fromOf(question);
  const head = (
    <div className="flex min-h-5 min-w-0 items-center gap-1.5 text-ui-sm text-fg-muted">
      <span className="shrink-0 text-fg-faint tabular-nums">{question.id}</span>
      {question.header && <span className="min-w-0 truncate">{question.header}</span>}
      {from !== null && <span className="shrink-0">· {SHEET_WORDS.from(from)}</span>}
      {mark !== 'none' && <span className="transcript-badge ml-auto shrink-0">{SHEET_WORDS.updated}</span>}
    </div>
  );

  const preview = !question.multiSelect ? previewOf(question, picks, pointed ?? focused) : null;
  const hasPreviews = !question.multiSelect && question.options.some((option) => option.preview !== undefined);
  const hover = (label: string) => ({
    onPointerEnter: () => setPointed(label),
    onPointerLeave: () => setPointed((was) => (was === label ? null : was)),
    onFocus: () => setFocused(label),
    onBlur: () => setFocused((was) => (was === label ? null : was)),
  });
  const carriedOf = (label: string) => (carriedPicks.includes(label) ? { 'data-carried': '' } : {});

  const options =
    question.options.length === 0 ? null : question.multiSelect ? (
      <div role="group" aria-label={question.question} className="flex min-w-0 flex-col gap-1">
        {question.options.map((option, i) => (
          <Checkbox.Root key={option.label} aria-label={option.label} checked={picks.includes(option.label)} disabled={busy} onCheckedChange={(checked) => toggle(option.label, checked === true)} className={ROW} {...carriedOf(option.label)} {...hover(option.label)}>
            <OptionText n={i + 1} option={option} carried={carriedPicks.includes(option.label)} />
          </Checkbox.Root>
        ))}
      </div>
    ) : (
      <RadioGroup.Root aria-label={question.question} value={picks[0] ?? ''} disabled={busy} onValueChange={pick} className="flex min-w-0 flex-col gap-1">
        {question.options.map((option, i) => (
          <RadioGroup.Item key={option.label} value={option.label} aria-label={option.label} className={ROW} {...carriedOf(option.label)} {...hover(option.label)}>
            <OptionText n={i + 1} option={option} carried={carriedPicks.includes(option.label)} />
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    );

  const body = (
    <>
      {question.context !== undefined && question.context !== '' && <SheetMarkdown markdown={question.context} references={question.references} host={host} onReference={openReference} />}
      {question.references.length > 0 && (
        <div className="flex min-w-0 flex-col gap-0.5">
          {question.references.map((reference) => (
            <ReferenceView key={reference.sha256} session={session} reference={reference} host={host} open={opened.has(reference.sha256)} onOpenChange={(open) => setReference(reference, open)} />
          ))}
        </div>
      )}
      {queued !== undefined && !editing ? (
        <>
          <QueuedAnswer picks={queued.picks} text={queued.text} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <p className="m-0 basis-full text-ui-sm text-fg-muted">{SHEET_WORDS.queued}</p>
            <CardButton disabled={busy} onClick={() => onRetract(queued.key)}>
              {SHEET_WORDS.takeBack}
            </CardButton>
            <CardButton disabled={busy} onClick={() => onDraft({ revision: queued.revision, picks: [...queued.picks], text: queued.text, images: [...queued.images], replaces: queued.key })}>
              {SHEET_WORDS.edit}
            </CardButton>
          </div>
        </>
      ) : (
        <>
          {mark === 'stale' ? (
            <Note tone="warning">
              <span className="min-w-0 flex-1">{SHEET_WORDS.stale}</span>
              {carried && (
                <CardButton disabled={busy} onClick={keep}>
                  {SHEET_WORDS.keep}
                </CardButton>
              )}
            </Note>
          ) : (
            carried && (
              <Note tone="neutral">
                <span className="min-w-0 flex-1">{SHEET_WORDS.carried}</span>
                <CardButton disabled={busy} onClick={keep}>
                  {SHEET_WORDS.keep}
                </CardButton>
              </Note>
            )
          )}
          {hasPreviews ? (
            <div className="grid min-w-0 gap-2 @min-[560px]:grid-cols-2 @min-[560px]:items-start">
              {options}
              {preview && (
                <div data-sheet-preview={preview.label} className="flex min-w-0 flex-col gap-1.5 rounded-sm border border-border bg-bg px-2.5 py-2 text-ui-sm">
                  <span className="text-fg-muted">{preview.label}</span>
                  <SheetMarkdown markdown={preview.preview ?? ''} references={question.references} host={host} onReference={openReference} />
                </div>
              )}
            </div>
          ) : (
            options
          )}
          <textarea
            aria-label={SHEET_WORDS.answerName(question.id)}
            placeholder={SHEET_WORDS.placeholder}
            value={draft?.text ?? ''}
            rows={2}
            disabled={busy}
            onChange={(event) => type(event.target.value)}
            onPaste={paste}
            className="w-full resize-y rounded-sm border border-border-strong bg-bg px-2 py-1.5 text-fg outline-accent placeholder:text-fg-faint focus-visible:outline-2"
          />
          {(draft?.images.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {draft!.images.map((path, i) => (
                <Upload key={path} session={session} path={path} n={i + 1} host={host} disabled={busy} onRemove={() => removeImage(path)} />
              ))}
            </div>
          )}
          {pasteNote !== null && <p className="m-0 text-ui-sm text-fg-muted">{pasteNote}</p>}
          <button type="button" disabled={busy} onClick={onDismiss} className={QUIET}>
            {SHEET_WORDS.dismiss}
          </button>
        </>
      )}
    </>
  );

  if (density === 'compact') {
    return (
      <article data-sheet-question={question.id} tabIndex={-1} onFocus={(event) => event.target === event.currentTarget && setFolded(false)} className="@container flex min-w-0 flex-col outline-none [&+&]:border-t [&+&]:border-border">
        <button type="button" aria-expanded={!folded} onClick={() => setFolded(!folded)} className="flex w-full min-w-0 items-baseline gap-1.5 rounded-sm py-1.5 text-left text-fg-muted outline-accent focus-visible:outline-2">
          <span className="self-center">
            <Chevron />
          </span>
          <span className="shrink-0 text-fg-faint tabular-nums">{question.id}</span>
          {question.header && <span className="max-w-[40%] shrink-0 truncate font-medium text-fg">{question.header}</span>}
          {from !== null && <span className="shrink-0">· {SHEET_WORDS.from(from)}</span>}
          <span className="min-w-0 flex-1 truncate">{questionSentence(question.question)}</span>
          {mark !== 'none' && <span className="transcript-badge shrink-0">{SHEET_WORDS.updated}</span>}
        </button>
        {!folded && (
          <div className="flex min-w-0 flex-col gap-2 pt-0.5 pb-2.5 pl-[18px]">
            <p className="m-0 font-medium whitespace-pre-wrap text-fg [overflow-wrap:anywhere]">{question.question}</p>
            {body}
          </div>
        )}
      </article>
    );
  }
  return (
    <article data-sheet-question={question.id} tabIndex={-1} className="@container flex min-w-0 flex-col gap-3 rounded-md border border-border bg-bg-raised p-3 text-ui text-fg outline-accent focus-visible:outline-2">
      <div className="flex min-w-0 flex-col gap-1">
        {head}
        <p className="m-0 font-medium whitespace-pre-wrap [overflow-wrap:anywhere]">{question.question}</p>
      </div>
      {body}
    </article>
  );
}
