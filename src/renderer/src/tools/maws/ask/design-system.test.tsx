// P3-D M6b: the Question sheet's design_system question (docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md D13,
// Acceptance 14). Each live system is a row with its name, its five main swatches (the system's resolved values, read
// through the apply API's view, so they follow its tokens) and its origin; "Build one with me" unless the question says `allowCreate: false`; Decide for
// me and Skip as for every modality; Submit answers `{designSystemId, name}` or `{create: true}`; the answered ask reads
// back by the system's name.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignSystemHostContext } from '@artifacts/design-system/apply';
import { tokenProperties } from '@artifacts/design-system/css';
import { setToken, writeSystem, type SystemOrigin } from '@artifacts/design-system/model';
import { parseTokens } from '@artifacts/design-system/tokens';
import type { ArtifactHost, DocumentHandle } from '@artifacts/host';
import { defaultSystem } from '@artifacts/types/design_system/defaults';
import { newDoc, type Doc } from '@artifacts/yjs';
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import type { LibraryRow } from '@shared/ipc/schema/library';
import type { PendingAsk } from '@shared/maws/ask';
import type { AskQuestion } from '@shared/maws/tools';
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client';
import { record } from '../../../../../../test/support/builders';
import { resetLibrary } from '../../../library/store';
import type { PanelToolContext } from '../../../panel/tool';
import { askSheetTool } from './AskSheetTool';
import { SHEET } from './copy';
import { AnsweredSection } from './QuestionSection';
import { resetAskSheets } from './store';

const holder: { client: FakeClient['client'] | null } = { client: null };
vi.mock('../../../ipc/client', () => ({
  ipc: {
    invoke: (...args: Parameters<FakeClient['client']['invoke']>) => holder.client!.invoke(...args),
    on: (...args: Parameters<FakeClient['client']['on']>) => holder.client!.on(...args),
  },
}));

const A = 'app-a' as AppSessionId;
const HOUSE = '6f1c1d2e-0b7a-4c55-9a3e-2f1b0c9d8e71';
const ACME = '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a';
const AT = Date.UTC(2026, 9, 13);
const SWATCHES = ['--ds-color-bg', '--ds-color-bg-raised', '--ds-color-text', '--ds-color-text-muted', '--ds-color-accent'];

function systemDoc(key: string, origin: SystemOrigin, name: string): Doc {
  const doc = newDoc();
  writeSystem(doc, defaultSystem(key)!.files, origin, { name });
  return doc;
}
let docs: Record<string, Doc>;

const host: ArtifactHost = {
  open: async (id): Promise<DocumentHandle> => {
    const doc = docs[id];
    if (!doc) throw new Error(`no artifact ${id}`);
    return {
      doc, awareness: null as never, state: () => ({ phase: 'live', synced: true, unsaved: 0, revision: 1, integrated: 0, readOnly: false }),
      subscribe: () => () => {}, onRestored: () => () => {}, onProvisional: () => () => {}, holdRemote: () => {}, close: () => {},
    };
  },
  assetUrl: (id, ref) => `maws-artifact://${id}/live/${ref}`,
  export: async () => ({ path: '' }),
  versionState: async () => new Uint8Array(),
  attributions: async () => new Uint8Array(),
  acceptSuggestion: async () => ({ revision: 0 }), // P3-D re-merge: A's landed required members
  rejectSuggestion: async () => ({ revision: 0 }),
  uploadAsset: async () => ({ assetId: '', ref: '' }),
  copyAsset: async () => ({ assetId: '', ref: '' }), // P3-C (Decision Log 25)
  readDataset: async () => ({ columns: [], rows: [], total: 0, truncated: false }), // P3-E (E2 M2)
  downloadAsset: async () => ({ path: null }), // P3-E (E2 M3)
  holdDatasets: async () => ({ release: () => {}, invalidated: new Promise<void>(() => {}) }), // E3: A's landed required member
  identity: () => ({ actor: { kind: 'human' }, name: 'Owner', color: 'var(--author-1)' }),
  // P3-H H4: the connector family, which these tests never reach
  openConnectors: () => {
    throw new Error('no connectors here');
  },
  connectorGrants: async () => [],
  grantConnectorTool: async () => ({ ok: false, state: 'paused', reason: 'noRoute' }),
  revokeConnectorTool: async () => false,
};

// Rows as main's index answers them (the client validates answers), out of title order.
const row = (id: string, title: string): LibraryRow => ({
  id, kind: 'design_system', title, createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 1, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false,
  revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 1, sessions: [],
});
const counts = Object.fromEntries(ARTIFACT_KINDS.map((kind) => [kind, kind === 'design_system' ? 2 : 0]));

const ask = (questions: AskQuestion[]): PendingAsk => ({
  askId: 'toolu_d', toolUseId: 'toolu_d' as ToolUseId, requestId: 'r1' as RequestId, blocking: true, title: 'A look for the handout', context: null, questions, openedAt: '2026-10-13T00:00:00.000Z',
});
const PICK: AskQuestion = { id: 's1', question: 'Which design system should the handout use?', header: 'Design system', modality: 'design_system' };

let fake: FakeClient;

function ctx(): PanelToolContext {
  return {
    appSessionId: A, session: record(A, { directory: '/work/app-a' }), status: null, pinned: false, visible: true, focusRequest: 0,
    setTitle: () => {}, close: () => {}, openTool: (() => '') as never, editorHost: { surface: 'panel', tabId: 'ask:test' },
  };
}

async function mountWith(questions: AskQuestion[]) {
  const pending = ask(questions);
  const state = askSheetTool.createState({ appSessionId: A, session: record(A), instanceId: 'ask-sheet:t', params: { askId: pending.askId } });
  const Body = askSheetTool.render;
  render(
    <DesignSystemHostContext.Provider value={host}>
      <Body state={state} ctx={ctx()} />
    </DesignSystemHostContext.Provider>,
  );
  await fake.reply('maws.asks.list', { asks: [pending] });
  await fake.reply('library.list', { rows: [row(HOUSE, 'MAWS'), row(ACME, 'Acme web')].reverse(), counts });
  await act(async () => {}); // the systems' views open
}

const section = (id: string) => document.querySelector<HTMLElement>(`[data-question-id="${id}"]`)!;
const rowOf = (id: string) => section('s1').querySelector<HTMLElement>(`[data-design-system="${id}"]`)!;

beforeEach(() => {
  resetAskSheets();
  resetLibrary();
  fake = fakeClient();
  holder.client = fake.client;
  docs = {
    [HOUSE]: systemDoc('maws', { route: 'default', key: 'maws', at: AT }, 'MAWS'),
    [ACME]: systemDoc('classroom', { route: 'adopted', from: 'acme.com', at: AT }, 'Acme web'),
  };
});
afterEach(() => {
  cleanup();
  resetAskSheets();
  resetLibrary();
});

describe('the design_system question', () => {
  it('lists each live system by name with its five main swatches and its origin, then "Build one with me"', async () => {
    await mountWith([PICK]);
    const radios = within(section('s1')).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual(['Acme web', 'MAWS', 'Build one with me']);
    expect(fake.invoked('library.list')).toEqual([{ filter: { kind: 'design_system' } }]);

    expect(within(rowOf(HOUSE)).getByText('Built in')).toBeTruthy();
    expect(within(rowOf(ACME)).getByText('Adopted from acme.com')).toBeTruthy();
    // the swatches are the system's own values, as its tokens.css writes them; no scope (and so none of its faces)
    const values = tokenProperties(parseTokens(JSON.parse(defaultSystem('maws')!.files['tokens.tokens.json']!)).tokens!, 'document');
    const swatches = [...rowOf(HOUSE).querySelectorAll<HTMLElement>('[data-swatch]')];
    expect(swatches.map((swatch) => [swatch.dataset.swatch, swatch.dataset.swatchValue])).toEqual(SWATCHES.map((name) => [name, values.get(name)]));
    expect(swatches[4]!.style.backgroundColor).not.toBe('');
    expect(new Set(swatches.map((swatch) => swatch.dataset.swatchValue)).size).toBeGreaterThan(1);
    expect(rowOf(HOUSE).querySelector('[data-ds-scope]')).toBeNull();
    expect(document.head.querySelectorAll('style[data-ds-scope-style]')).toHaveLength(0);

    // a system the owner recolours is redrawn in place: here the accent takes the text colour
    act(() => setToken(docs[HOUSE]!, 'color.accent.$root', { $value: '{color.text.$root}' }));
    expect(rowOf(HOUSE).querySelector<HTMLElement>('[data-swatch="--ds-color-accent"]')!.dataset.swatchValue).toBe(values.get('--ds-color-text'));
    expect(values.get('--ds-color-text')).not.toBe(values.get('--ds-color-accent'));

    expect(within(section('s1')).getByRole('button', { name: 'Decide for me' })).toBeTruthy();
    expect(within(section('s1')).getByRole('button', { name: 'Skip' })).toBeTruthy();
  });

  // P4 (W1, tracker 2026-10-19 L277): a duplicate of the house system reads as a copy of its source, not "Built in"; an
  // adopted system's source, which the law's sentence gave whole, reads as a phrase, never a cut fragment
  it('labels a duplicate by its source and an adopted system by the phrase that names its source', async () => {
    docs[HOUSE] = systemDoc('maws', { route: 'default', key: 'maws', at: AT, copiedFrom: 'MAWS' }, 'MAWS');
    docs[ACME] = systemDoc('classroom', { route: 'adopted', from: 'the GOV.UK Design System (design-system.service.gov.uk and www.gov.uk):', at: AT }, 'Acme web');
    await mountWith([PICK]);
    expect(within(rowOf(HOUSE)).getByText('Copy of MAWS')).toBeTruthy();
    expect(within(rowOf(HOUSE)).queryByText('Built in')).toBeNull();
    expect(within(rowOf(ACME)).getByText('Adopted from the GOV.UK Design System')).toBeTruthy();
  });

  it('clips a source with no break in it to a few words', () => {
    expect(SHEET.systemOrigin({ route: 'derived', from: 'the shared tokens of every product page our design team has published over the last five years' })).toBe('Derived from the shared tokens of every product page our…');
    expect(SHEET.systemOrigin({ route: 'adopted', from: 'https://acme.com/brand' })).toBe('Adopted from https://acme.com/brand'); // a URL's colon is no break
    expect(SHEET.systemOrigin({ route: 'adopted', from: 'acme.com' })).toBe('Adopted from acme.com');
    expect(SHEET.systemOrigin({ route: 'imported' })).toBe('Imported from Claude');
  });

  // P4 (W1, L277): a title is no sentence, so a dash or colon in it is part of the name, and only its length is clipped
  it('keeps a duplicate source’s whole title, clipping a long one at a word', () => {
    expect(SHEET.systemOrigin({ route: 'default', copiedFrom: 'Acme — Light' })).toBe('Copy of Acme — Light');
    expect(SHEET.systemOrigin({ route: 'derived', copiedFrom: 'Acme — Dark' })).toBe('Copy of Acme — Dark');
    expect(SHEET.systemOrigin({ route: 'adopted', copiedFrom: 'Brand: Marketing' })).toBe('Copy of Brand: Marketing');
    expect(SHEET.systemOrigin({ route: 'adopted', copiedFrom: 'Brand (2026)' })).toBe('Copy of Brand (2026)');
    expect(SHEET.systemOrigin({ route: 'default', copiedFrom: 'The shared tokens of every product page our design team has published' })).toBe('Copy of The shared tokens of every product page our…');
  });

  it('answers the chosen system by its id and name, once Submit has read it live', async () => {
    await mountWith([PICK]);
    fireEvent.click(within(section('s1')).getByRole('radio', { name: 'MAWS' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(fake.invoked('artifacts.get')).toEqual([{ artifactId: HOUSE, prepare: false }]);
    await act(() => fake.reply('artifacts.get', { artifact: { id: HOUSE, kind: 'design_system', title: 'MAWS' } }));
    expect(fake.invoked('maws.ask.answer')).toEqual([{ appSessionId: A, askId: 'toolu_d', answers: [{ id: 's1', question: PICK.question, status: 'answered', designSystemId: HOUSE, name: 'MAWS' }] }]);
  });

  // F's L176: the system was deleted between the pick and Submit (its row still on screen until the library's re-read)
  it('does not call an untouched answer skipped, but reflects an intentional Skip', async () => {
    await mountWith([PICK]);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy();
    fireEvent.click(within(section('s1')).getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('button', { name: 'Submit · 1 skipped' })).toBeTruthy();
    fireEvent.click(within(section('s1')).getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy();
  });

  it('sends nothing for a pick deleted since, unpicks it and names it in the sheet’s notice', async () => {
    await mountWith([PICK]);
    fireEvent.click(within(section('s1')).getByRole('radio', { name: 'Acme web' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await act(() => fake.reply('artifacts.get', { artifact: null }));
    expect(fake.invoked('maws.ask.answer')).toEqual([]);
    expect(screen.getAllByRole('status').map((status) => status.textContent)).toContain('Acme web was deleted. Choose another design system.');
    expect(within(section('s1')).getByRole('radio', { name: 'Acme web' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy();
  });

  it('answers create for "Build one with me", and has no such row when the question does not allow it', async () => {
    const closed: AskQuestion = { id: 's2', question: 'Which of my systems?', modality: 'design_system', allowCreate: false };
    await mountWith([PICK, closed]);
    expect(within(section('s2')).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual(['Acme web', 'MAWS']);
    fireEvent.click(within(section('s1')).getByRole('radio', { name: 'Build one with me' }));
    fireEvent.click(within(section('s2')).getByRole('button', { name: 'Decide for me' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(fake.invoked('maws.ask.answer')).toEqual([{
      appSessionId: A, askId: 'toolu_d', answers: [
        { id: 's1', question: PICK.question, status: 'answered', create: true },
        { id: 's2', question: closed.question, status: 'decide_for_me' },
      ],
    }]);
  });

  it('with no systems yet, still offers "Build one with me"', async () => {
    const pending = ask([PICK]);
    const state = askSheetTool.createState({ appSessionId: A, session: record(A), instanceId: 'ask-sheet:t', params: { askId: pending.askId } });
    const Body = askSheetTool.render;
    render(
      <DesignSystemHostContext.Provider value={host}>
        <Body state={state} ctx={ctx()} />
      </DesignSystemHostContext.Provider>,
    );
    await fake.reply('maws.asks.list', { asks: [pending] });
    await fake.reply('library.list', { rows: [], counts: { ...counts, design_system: 0 } });
    expect(within(section('s1')).getByText('You have no design systems yet.')).toBeTruthy();
    expect(within(section('s1')).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual(['Build one with me']);
  });
});

describe('the answered design_system question', () => {
  it('reads back by the system’s name, or as the build request', () => {
    render(<AnsweredSection question={PICK} answers={[{ id: 's1', question: PICK.question, status: 'answered', designSystemId: HOUSE, name: 'MAWS' }]} />);
    expect(within(section('s1')).getByText('MAWS')).toBeTruthy();
    cleanup();
    render(<AnsweredSection question={PICK} answers={[{ id: 's1', question: PICK.question, status: 'answered', create: true }]} />);
    expect(within(section('s1')).getByText('Build one with me')).toBeTruthy();
  });
});
