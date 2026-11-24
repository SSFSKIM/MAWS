// One open question (the composite's §8, "The card"; the C3 plan's §G): its states from its inputs alone, the person's
// edits handed back as a draft, and a carried draft that counts for nothing until kept or edited.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SheetQuestion } from '@shared/sheet/model';
import type { QuestionDraft } from '@shared/sheet/words';
import { QuestionCard, type QuestionCardProps } from './QuestionCard';
import { fixtureHost } from './test-support/fixture-host';
import { CLASH, CLASH_REVISED, FIXTURE, NOTICES, SEASON } from './test-support/questions';

afterEach(cleanup);
const SESSION = '5eed0000-0000-4000-8000-0000000000aa';
const draft = (revision: number, extra: Partial<QuestionDraft> = {}): QuestionDraft => ({ revision, picks: [], text: '', images: [], ...extra });

function card(question: SheetQuestion, props: Partial<QuestionCardProps> = {}) {
  const handlers = { onDraft: vi.fn(), onDismiss: vi.fn(), onRetract: vi.fn(), onAttach: vi.fn() };
  const view = render(<QuestionCard session={SESSION} question={question} draft={undefined} mark="none" busy={false} host={fixtureHost()} {...handlers} {...props} />);
  return { ...handlers, ...view };
}
const option = (label: string) => screen.getByRole('radio', { name: new RegExp(label) });

describe('QuestionCard', () => {
  it.each(['full', 'compact'] as const)("carries its question's id on its root (%s)", (density) => {
    const { container } = card(CLASH, { density });
    expect(container.firstElementChild?.getAttribute('data-sheet-question')).toBe('q4');
  });

  it('draws the head, the question, the numbered options with the recommended mark, the text field and Dismiss', () => {
    card(FIXTURE);
    expect(screen.getByText('q7')).toBeTruthy();
    expect(screen.getByText('Fixture')).toBeTruthy();
    expect(screen.getByText('· from reviewer')).toBeTruthy();
    expect(screen.getByText(FIXTURE.question)).toBeTruthy();
    expect(screen.getByRole('textbox').getAttribute('placeholder')).toBe('Type your own answer');
    cleanup();
    card(CLASH);
    expect(option('Keep the earlier sailing').textContent).toMatch(/^1Keep the earlier sailingRecommended/);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('hands back each edit as a draft at the question’s revision: a pick, a multi-select toggle, typed text', () => {
    const { onDraft } = card(CLASH);
    fireEvent.click(option('Keep the longer route'));
    expect(onDraft).toHaveBeenLastCalledWith(draft(1, { picks: ['Keep the longer route'] }));
    cleanup();
    const multi = card(NOTICES, { draft: draft(1, { picks: ['Tidal restrictions'] }) });
    fireEvent.click(screen.getByRole('checkbox', { name: /Vehicle deck limits/ }));
    expect(multi.onDraft).toHaveBeenLastCalledWith(draft(1, { picks: ['Tidal restrictions', 'Vehicle deck limits'] }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Tidal restrictions/ }));
    expect(multi.onDraft).toHaveBeenLastCalledWith(null);
    cleanup();
    const text = card(SEASON);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'From 1 November.' } });
    expect(text.onDraft).toHaveBeenLastCalledWith(draft(1, { text: 'From 1 November.' }));
  });

  it('dismisses through its handler', () => {
    const { onDismiss } = card(CLASH);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('reads "Updated" when marked; refused as stale it also says why and keeps the draft', () => {
    card(CLASH_REVISED, { mark: 'updated' });
    expect(screen.getByText('Updated')).toBeTruthy();
    expect(screen.queryByText(/The question changed before your answer arrived/)).toBeNull();
    cleanup();
    card(CLASH_REVISED, { mark: 'stale', draft: draft(1, { picks: ['Keep the earlier sailing'], text: 'Shuttle times are the ones people check.' }) });
    expect(screen.getByText('Updated')).toBeTruthy();
    expect(screen.getByText('The question changed before your answer arrived. Your draft is kept.')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Shuttle times are the ones people check.');
  });

  it('draws a draft typed against an earlier revision as carried: not picked, kept only by the person', () => {
    const carried = draft(1, { picks: ['Keep the earlier sailing'], text: 'Shuttle times are the ones people check.' });
    const { onDraft } = card(CLASH_REVISED, { mark: 'updated', draft: carried });
    expect(screen.getByText('You wrote this before the question changed.')).toBeTruthy();
    expect(option('Keep the earlier sailing').getAttribute('aria-checked')).toBe('false');
    expect(option('Keep the earlier sailing').hasAttribute('data-carried')).toBe(true);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(carried.text);
    fireEvent.click(screen.getByRole('button', { name: 'Keep my answer' }));
    expect(onDraft).toHaveBeenLastCalledWith({ ...carried, revision: 2 });
  });

  it('confirms a carried draft with any edit of the card', () => {
    const { onDraft } = card(CLASH_REVISED, { draft: draft(1, { picks: ['Keep the earlier sailing'], text: 'x' }) });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'xy' } });
    expect(onDraft).toHaveBeenLastCalledWith(draft(2, { picks: ['Keep the earlier sailing'], text: 'xy' }));
  });

  it('reads back a queued answer with Take back and Edit; Edit opens a draft that replaces it', () => {
    const queued = { key: 'page-1601a001', kind: 'answer' as const, picks: ['Keep the earlier sailing'], text: 'Shuttle times are the ones people check.', images: [], revision: 1, by: 'page' as const };
    const { onRetract, onDraft } = card({ ...CLASH, queued });
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('Keep the earlier sailing')).toBeTruthy();
    expect(screen.getByText('Queued. The session is stopped and gets this when it resumes.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take back' }));
    expect(onRetract).toHaveBeenCalledWith('page-1601a001');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onDraft).toHaveBeenLastCalledWith({ revision: 1, picks: queued.picks, text: queued.text, images: [], replaces: 'page-1601a001' });
    cleanup();
    card({ ...CLASH, queued }, { draft: { ...draft(1, { picks: ['Keep the longer route'] }), replaces: 'page-1601a001' } });
    expect(option('Keep the longer route').getAttribute('aria-checked')).toBe('true');
  });

  it('shows the focused option’s preview, else the picked one’s, else the recommended one’s', () => {
    const preview = () => document.querySelector('[data-sheet-preview]')?.getAttribute('data-sheet-preview');
    card(CLASH);
    expect(preview()).toBe('Keep the earlier sailing');
    fireEvent.focus(option('Keep the longer route'));
    expect(preview()).toBe('Keep the longer route');
    fireEvent.blur(option('Keep the longer route'));
    expect(preview()).toBe('Keep the earlier sailing');
    cleanup();
    card(CLASH, { draft: draft(1, { picks: ['Keep the longer route'] }) });
    expect(preview()).toBe('Keep the longer route');
  });

  it('opens a reference when its context links to it', async () => {
    const host = fixtureHost({ body: () => Promise.resolve({ kind: 'text', text: 'x\n' }) });
    card(SEASON, { host });
    expect(screen.getByRole('button', { name: /src\/auth\.ts/ }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByText('the auth notes'));
    await waitFor(() => expect(screen.getByRole('button', { name: /src\/auth\.ts/ }).getAttribute('aria-expanded')).toBe('true'));
  });

  it('takes no image without the host’s saveImage, and saves a pasted one through it', async () => {
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
    const plain = card(SEASON);
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [image], types: ['Files'] } });
    await Promise.resolve();
    expect(plain.onAttach).not.toHaveBeenCalled();
    cleanup();
    const host = fixtureHost({ saveImage: true });
    const saving = card(SEASON, { host });
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [image], types: ['Files'] } });
    await waitFor(() => expect(saving.onAttach).toHaveBeenLastCalledWith('uploads/maws-fixture-1.png'));
    expect(saving.onDraft).not.toHaveBeenCalled(); // the image joins the draft as it is when saved: the consumer's to do
    expect(host.images.map((saved) => saved.mediaType)).toEqual(['image/png']);
  });

  it('keeps every image of one paste', async () => {
    const shot = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
    const { onAttach } = card(SEASON, { host: fixtureHost({ saveImage: true }) });
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [shot('a.png'), shot('b.png')], types: ['Files'] } });
    await waitFor(() => expect(onAttach.mock.calls).toEqual([['uploads/maws-fixture-1.png'], ['uploads/maws-fixture-2.png']]));
  });

  it('takes nothing while an act on it is in flight', () => {
    const { onDraft } = card(CLASH, { busy: true });
    fireEvent.click(option('Keep the longer route'));
    expect(onDraft).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps two references that share a hash apart, each opened on its own', () => {
    const twin = { ...SEASON.references[0], path: 'src/auth-copy.ts', abs: '/work/harbour/src/auth-copy.ts' };
    card({ ...SEASON, references: [SEASON.references[0], twin] });
    fireEvent.click(screen.getByRole('button', { name: /src\/auth-copy\.ts/ }));
    expect(screen.getByRole('button', { name: /src\/auth-copy\.ts/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /src\/auth\.ts/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('turns its chevron in compact form: the chevron is the fold button’s own child', () => {
    card(FIXTURE, { density: 'compact' });
    const line = screen.getByRole('button', { name: /q7/ });
    expect(line.querySelector(':scope > .transcript-chevron')).not.toBeNull();
  });

  it("measures the preview's breakpoint on the card's own width: its container has no padding or border of its own", () => {
    const { container } = card(CLASH);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className.split(' ')).toContain('@container');
    expect(root.className).not.toMatch(/(^|\s)(p|px|py|border)(-|\s|$)/);
  });

  it('is folded to its row line in compact form until chosen', () => {
    card(FIXTURE, { density: 'compact' });
    const line = screen.getByRole('button', { name: /q7/ });
    expect(line.getAttribute('aria-expanded')).toBe('false');
    expect(within(line).getByText('May I replace it with this season’s sailings?')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(line);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });
});
