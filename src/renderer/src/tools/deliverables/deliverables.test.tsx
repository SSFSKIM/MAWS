// E2 (M4): the Deliverables tool over a fake main (Design §4, §5): the list's groups and order, the scope toggle, the
// drill-in with Back keeping the scroll, the viewer's targets and versions, its actions, the bodies (the HTML frame
// sandboxed, the PDF frame without a sandbox for a PDF alone, native media, the read-only file viewer), the missing and
// gone states, the console chip and Reload, the summary section and the `deliverable` main tab.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnchorSchema, type Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, type TabRef } from '@shared/ipc/schema/layout';
import { deliverableUrl, type DeliverableRecord } from '@shared/maws/deliverable';
import { record as sessionRecord } from '../../../../../test/support/builders';
import { panelHost } from '../../panel/host';
import type { PanelToolContext } from '../../panel/tool';
import { useLayout } from '../../stores/layout';
import { activeTab } from '../../stores/layout-model';
import { useSessions } from '../../stores/sessions';
import { fail, installFakeMain, ok } from '../../test-support/code';
import { registerCommentComposer } from '../code/anchor/anchor';
import { useFiles } from '../code/files/store';
import { useViewer } from '../code/viewer/viewer-store';
import { DeliverablesSummary } from './DeliverablesSummary';
import { deliverablesTool, type DeliverablesHandle, type DeliverablesParams } from './DeliverablesTool';
import { DeliverableTab } from './DeliverableTab';
import { connectDeliverables, resetDeliverables } from './store';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (minute: number) => `2026-10-06T10:${String(minute).padStart(2, '0')}:00.000Z`;

function file(n: number, path: string, over: Partial<DeliverableRecord> = {}): DeliverableRecord {
  return { id: id(n), appSessionId: A, kind: 'file', path, title: path.split('/').at(-1), versions: [{ path, at: at(n) }], createdAt: at(n), ...over };
}

const ART = file(1, `/u/deliverables/${A}/${id(1)}/v2.html`, {
  kind: 'artifact', artifactId: 'dash', title: 'Dashboard', updatedAt: at(40),
  versions: [{ path: `/u/deliverables/${A}/${id(1)}/v1.html`, at: at(1) }, { path: `/u/deliverables/${A}/${id(1)}/v2.html`, at: at(40) }],
});
const PAGE = file(2, '/work/app-a/out/page.html');
const PDF = file(3, '/tmp/out/doc.pdf');
const CLIP = file(4, '/work/app-a/out/clip.webm');
const TONE = file(5, '/work/app-a/out/tone.wav');
const NOTES = file(6, '/work/app-a/notes.md', { caption: 'Release notes' });
const OUTSIDE = file(7, '/tmp/x/outside.md');
const BIN = file(8, '/work/app-a/data.bin');
const OTHER = file(9, '/work/app-b/b.txt', { appSessionId: B });
const SHOT = file(10, '/work/app-a/shot.png', { kind: 'screenshot' });
const RECORDS = [ART, PAGE, PDF, CLIP, TONE, NOTES, OUTSIDE, BIN, OTHER, SHOT];

let main: ReturnType<typeof installFakeMain>;
let present: Map<string, boolean[]>;
let records: DeliverableRecord[];
const offs: (() => void)[] = [];

function installMain() {
  main = installFakeMain((name, input) => {
    const newest = (list: DeliverableRecord[]) => [...list].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
    switch (name) {
      case 'deliverables.list':
        return ok({ records: newest(records.filter((r) => r.appSessionId === input.appSessionId)) });
      case 'deliverables.listAll':
        return ok({ records: newest(records) });
      case 'deliverables.get': {
        const found = records.find((r) => r.appSessionId === input.appSessionId && r.id === input.id) ?? null;
        return ok({ record: found, present: found ? (present.get(found.id) ?? found.versions.map(() => true)) : [] });
      }
      case 'files.openExternal':
        return ok({ opened: true, message: null });
      case 'files.reveal':
        return String(input.path).startsWith('/tmp/x') ? fail('not allowed here') : ok({ revealed: true, message: null });
      case 'files.watch':
      case 'files.unwatch':
      case 'layout.set':
        return ok();
      case 'files.read': {
        const text = '# Notes\n\nhello\n';
        return ok({ encoding: 'utf8', content: text, bytes: text.length, offset: 0, length: text.length, truncated: false, mime: 'text/markdown', hash: 'a'.repeat(64), utf8: true });
      }
      default:
        return fail(`unexpected ${name}`);
    }
  });
}

// happy-dom would load every frame's URL, and knows no `maws-deliverable:` scheme: child-frame navigation is off, so a
// frame only takes its URL (the frames' attributes are what these cases read). The chunks the file viewer and the
// transcript load lazily are loaded up front, so none is still loading when the environment is torn down.
beforeAll(async () => {
  (window as unknown as { happyDOM: { settings: { navigation: { disableChildFrameNavigation: boolean } } } }).happyDOM.settings.navigation.disableChildFrameNavigation = true;
  await Promise.all([import('../code/viewer/CodeView'), import('../../transcript/view/Transcript'), import('../../transcript/view/TranscriptSlot'), import('../../transcript/view/markdown/Markdown')]);
});

beforeEach(() => {
  resetDeliverables();
  useViewer.getState().reset();
  useFiles.getState().reset();
  useLayout.setState({ main: LAYOUT_DEFAULTS.main });
  useSessions.setState({
    records: new Map([
      [A, sessionRecord(A, { title: { text: 'Fix the dashboard', source: 'user' } })],
      [B, sessionRecord(B, { title: { text: 'Other work', source: 'user' } })],
    ]),
  });
  present = new Map();
  records = RECORDS;
  installMain();
  offs.push(connectDeliverables());
});

const handles: DeliverablesHandle[] = [];
afterEach(() => {
  cleanup();
  handles.splice(0).forEach((handle) => deliverablesTool.dispose(handle));
  offs.splice(0).forEach((off) => off());
});

const create = (params?: DeliverablesParams, appSessionId: AppSessionId | null = A) => {
  const handle = deliverablesTool.createState({ appSessionId, session: null, instanceId: 'deliverables:test', params: params as DeliverablesParams });
  handles.push(handle);
  return handle;
};

function Mounted({ state, appSessionId = A }: { state: DeliverablesHandle; appSessionId?: AppSessionId | null }) {
  const ctx: PanelToolContext = {
    appSessionId, session: null, status: null, pinned: false, visible: true, focusRequest: 0, setTitle: () => {}, close: () => {}, openTool: panelHost.addTool,
  };
  const Body = deliverablesTool.render;
  return <Body state={state} ctx={ctx} />;
}

async function mount(params?: DeliverablesParams) {
  const handle = create(params);
  const view = render(<Mounted state={handle} />);
  await settle();
  return { handle, view };
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const rows = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-deliverable-row]')).map((row) => ({
    id: row.dataset.deliverableId,
    kind: row.dataset.kind,
    title: row.querySelector('[data-part="title"]')?.textContent,
    line: row.querySelector('[data-part="line"]')?.textContent,
    session: row.querySelector('[data-part="session"]')?.textContent ?? null,
  }));
const groups = () => Array.from(document.querySelectorAll<HTMLElement>('[data-group]')).map((g) => [g.dataset.group, g.querySelector('h3')?.textContent]);
const row = (n: number) => document.querySelector<HTMLElement>(`[data-deliverable-row][data-deliverable-id="${id(n)}"]`)!;
const viewer = () => document.querySelector<HTMLElement>('[data-deliverable-viewer]');
const frame = () => document.querySelector<HTMLIFrameElement>('iframe');
const button = (name: string) => screen.queryByRole('button', { name });

async function openRecord(n: number) {
  fireEvent.click(row(n));
  await settle();
}

describe('the list', () => {
  it('groups Artifacts, Files and Screenshots, newest first, with each row’s title and second line', async () => {
    await mount();
    expect(groups()).toEqual([
      ['artifact', 'Artifacts'],
      ['file', 'Files'],
      ['screenshot', 'Screenshots'],
    ]);
    const shown = rows();
    expect(shown.map((r) => r.id)).toEqual([ART, BIN, OUTSIDE, NOTES, TONE, CLIP, PDF, PAGE, SHOT].map((r) => r.id));
    expect(shown[0]).toMatchObject({ kind: 'artifact', title: 'Dashboard' });
    expect(shown[0]!.line).toMatch(/^v2 · /);
    expect(shown.find((r) => r.id === NOTES.id)).toMatchObject({ kind: 'file', title: 'notes.md', line: 'Release notes', session: null });
    expect(shown.find((r) => r.id === PDF.id)!.line).toBe('/tmp/out');
    expect(main.callsOf('deliverables.list')).toEqual([{ appSessionId: A }]);
  });

  it('says so when nothing was delivered', async () => {
    records = [];
    await mount();
    expect(screen.getByText('Nothing delivered yet')).toBeTruthy();
  });

  it('shows a refused read with Retry, which reads again', async () => {
    main = installFakeMain((name) => (name === 'deliverables.list' ? fail('EACCES') : fail(`unexpected ${name}`)));
    await mount();
    expect(screen.getByText("Couldn't read this session's deliverables")).toBeTruthy();
    installMain();
    fireEvent.click(button('Retry')!);
    await settle();
    expect(rows()).toHaveLength(9);
  });

  it('All sessions reads every session’s records and names each row’s session', async () => {
    await mount();
    fireEvent.click(button('All sessions')!);
    await settle();
    expect(main.callsOf('deliverables.listAll')).toEqual([{}]);
    expect(button('All sessions')!.getAttribute('aria-pressed')).toBe('true');
    expect(rows().find((r) => r.id === OTHER.id)).toMatchObject({ session: 'Other work' });
    expect(rows().find((r) => r.id === NOTES.id)).toMatchObject({ session: 'Fix the dashboard' });
    fireEvent.click(button('This session')!);
    expect(rows().some((r) => r.id === OTHER.id)).toBe(false);
  });

  it('an HTML record of another session in the All scope frames that session’s URL', async () => {
    const page = file(11, '/work/app-b/page.html', { appSessionId: B });
    records = [...RECORDS, page];
    await mount({ scope: 'all' });
    await openRecord(11);
    expect(frame()!.getAttribute('src')).toBe(deliverableUrl(B, page.id, 1));
  });

  it('a row of another session in the All scope opens with that session’s id', async () => {
    const { handle } = await mount({ scope: 'all' });
    await openRecord(9);
    expect(main.callsOf('deliverables.get').at(-1)).toEqual({ appSessionId: B, id: OTHER.id });
    expect(handle.snapshot().view).toMatchObject({ kind: 'record', appSessionId: B, id: OTHER.id });
    expect(viewer()!.dataset.deliverableId).toBe(OTHER.id);
    // its file viewer reads through B's admission
    await waitFor(() => expect(main.callsOf('files.read').at(-1)).toMatchObject({ appSessionId: B, path: OTHER.path }));
  });

  it('a click opens the viewer; Back returns to the list where it was scrolled', async () => {
    await mount();
    const list = document.querySelector<HTMLElement>('[data-deliverables-list]')!;
    list.scrollTop = 120;
    fireEvent.scroll(list);
    await openRecord(6);
    expect(viewer()!.dataset.deliverableId).toBe(NOTES.id);
    expect(document.querySelector('[data-deliverables-list]')).toBeNull();
    fireEvent.click(button('Back')!);
    expect(document.querySelector<HTMLElement>('[data-deliverables-list]')!.scrollTop).toBe(120);
  });
});

describe('open', () => {
  it('with a target shows that record at its latest version', async () => {
    await mount({ target: ART.id });
    expect(viewer()!.dataset).toMatchObject({ deliverableId: ART.id, version: '2', body: 'html' });
    expect(frame()!.getAttribute('src')).toBe(deliverableUrl(A, ART.id, 2));
  });

  it('with a version shows that version, and an existing tab re-targets', async () => {
    const { handle } = await mount({ target: ART.id, version: 1 });
    expect(viewer()!.dataset.version).toBe('1');
    expect(frame()!.getAttribute('src')).toBe(deliverableUrl(A, ART.id, 1));
    act(() => deliverablesTool.open!(handle, { target: PAGE.id }));
    await settle();
    expect(viewer()!.dataset.deliverableId).toBe(PAGE.id);
    act(() => deliverablesTool.open!(handle, {}));
    await settle();
    expect(viewer()).toBeNull();
    expect(rows().length).toBeGreaterThan(0);
  });

  it('with another session’s id shows that session’s record', async () => {
    await mount({ target: OTHER.id, appSessionId: B });
    expect(main.callsOf('deliverables.get')).toEqual([{ appSessionId: B, id: OTHER.id }]);
    expect(viewer()!.dataset.deliverableId).toBe(OTHER.id);
  });

  it('a record that is gone returns to the list with the notice', async () => {
    const gone = id(77);
    await mount({ target: gone });
    expect(viewer()).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(`No deliverable ${gone} in this session`);
    expect(rows().length).toBeGreaterThan(0);
  });

  it('a pinned tab keeps a record of the session it follows to (show_pane for another session, then the switch)', async () => {
    const handle = create({ target: OTHER.id, appSessionId: B });
    const shown = render(<Mounted state={handle} />);
    await settle();
    expect(viewer()!.dataset.deliverableId).toBe(OTHER.id);
    shown.rerender(<Mounted state={handle} appSessionId={B} />);
    await settle();
    expect(viewer()!.dataset.deliverableId).toBe(OTHER.id);
    expect(handle.snapshot()).toMatchObject({ appSessionId: B, view: { kind: 'record', appSessionId: B, id: OTHER.id } });
  });

  it('a pinned tab following another session resets to that session’s list', async () => {
    const handle = create({ target: ART.id });
    const shown = render(<Mounted state={handle} />);
    await settle();
    expect(viewer()).not.toBeNull();
    shown.rerender(<Mounted state={handle} appSessionId={B} />);
    await settle();
    expect(viewer()).toBeNull();
    expect(rows().map((r) => r.id)).toEqual([OTHER.id]);
  });
});

describe('the viewer', () => {
  it('switches versions, the frame’s URL following, latest marked', async () => {
    await mount({ target: ART.id });
    const select = screen.getByRole('combobox', { name: 'Version' }) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['v1', 'v2 · latest']);
    expect(select.value).toBe('2');
    fireEvent.change(select, { target: { value: '1' } });
    await settle();
    expect(viewer()!.dataset.version).toBe('1');
    expect(frame()!.getAttribute('src')).toBe(deliverableUrl(A, ART.id, 1));
  });

  it('offers no version switcher for a record of one version', async () => {
    await mount({ target: PAGE.id });
    expect(screen.queryByRole('combobox', { name: 'Version' })).toBeNull();
  });

  it('draws HTML in a scripts-only sandboxed frame on the scheme URL, never through about:blank', async () => {
    await mount({ target: PAGE.id });
    const html = frame()!;
    expect(html.getAttribute('sandbox')).toBe('allow-scripts');
    expect(html.getAttribute('src')).toBe(deliverableUrl(A, PAGE.id, 1));
    expect(html.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(html.dataset.deliverableFrame).toBe('html');
  });

  it('draws a PDF in a frame with no sandbox attribute (Decision Log 31), and no other body gets that frame', async () => {
    await mount({ target: PDF.id });
    expect(frame()!.hasAttribute('sandbox')).toBe(false);
    expect(frame()!.dataset.deliverableFrame).toBe('pdf');
    expect(frame()!.getAttribute('src')).toBe(deliverableUrl(A, PDF.id, 1));
    for (const record of [ART, PAGE, CLIP, TONE, NOTES, BIN]) {
      cleanup();
      await mount({ target: record.id });
      for (const element of document.querySelectorAll('iframe')) expect(element.getAttribute('sandbox'), record.path).toBe('allow-scripts');
    }
  });

  it('plays video and audio natively from the scheme', async () => {
    await mount({ target: CLIP.id });
    const video = document.querySelector('video')!;
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.getAttribute('src')).toBe(deliverableUrl(A, CLIP.id, 1));
    expect(video.getAttribute('preload')).toBe('metadata');
    cleanup();
    await mount({ target: TONE.id });
    expect(document.querySelector('audio')!.getAttribute('src')).toBe(deliverableUrl(A, TONE.id, 1));
  });

  it('draws markdown through the file viewer, read-only', async () => {
    await mount({ target: NOTES.id });
    await waitFor(() => expect(useViewer.getState().entries.get(`deliverable:${NOTES.id}:v1`)).toMatchObject({ status: 'ready', kind: 'markdown', editable: false }));
    expect(document.querySelector('[data-file-viewer]')!.getAttribute('data-path')).toBe(NOTES.path);
  });

  it('shows a version whose file is gone, with Reveal disabled and nothing framed', async () => {
    present.set(PAGE.id, [false]);
    await mount({ target: PAGE.id });
    expect(document.querySelector('[data-missing]')!.textContent).toBe(`Not on disk any more: ${PAGE.path}`);
    expect(frame()).toBeNull();
    expect((button('Reveal in Finder') as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens externally and reveals the shown version through main, a refusal shown inline', async () => {
    await mount({ target: PDF.id });
    fireEvent.click(button('Open externally')!);
    fireEvent.click(button('Reveal in Finder')!);
    await settle();
    expect(main.callsOf('files.openExternal')).toEqual([{ appSessionId: A, path: PDF.path }]);
    expect(main.callsOf('files.reveal')).toEqual([{ appSessionId: A, path: PDF.path }]);
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();
    await mount({ target: OUTSIDE.id });
    fireEvent.click(button('Reveal in Finder')!);
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('Refused: not allowed here');
  });

  it('offers Open externally only for the kinds main hands to the OS', async () => {
    await mount({ target: BIN.id });
    expect(button('Open externally')).toBeNull();
    cleanup();
    await mount({ target: NOTES.id });
    expect(button('Open externally')).toBeNull();
    cleanup();
    await mount({ target: CLIP.id });
    expect(button('Open externally')).not.toBeNull();
  });

  it('Open as file opens the file tab for a file under the session’s directories, and is not offered outside them', async () => {
    await mount({ target: NOTES.id });
    await waitFor(() => expect(button('Open as file')).not.toBeNull());
    fireEvent.click(button('Open as file')!);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'file', path: NOTES.path, appSessionId: A });
    cleanup();
    await mount({ target: OUTSIDE.id });
    await waitFor(() => expect(useViewer.getState().entries.get(`deliverable:${OUTSIDE.id}:v1`)?.status).toBe('ready'));
    expect(button('Open as file')).toBeNull();
    cleanup();
    await mount({ target: PAGE.id }); // a framed kind: the file tab would not draw it
    expect(button('Open as file')).toBeNull();
  });

  it('Open in tab opens the deliverable main tab for the record', async () => {
    await mount({ target: ART.id });
    fireEvent.click(button('Open in tab')!);
    expect(activeTab(useLayout.getState().main)).toEqual({ id: `deliverable:${A}:${ART.id}`, kind: 'deliverable', appSessionId: A, deliverableId: ART.id, pinned: false });
  });
});

describe('the console chip and Reload', () => {
  const log = (deliverableId: string, version: number, level: 'error' | 'warning' = 'error', message = 'Uncaught Error: E2_BOOM') =>
    act(() => main.emit('deliverables.console', { appSessionId: A, deliverableId, version, level, message, line: 3, source: null }));

  it('counts the shown version’s errors, lists them in a popover, and clears on Reload with a fresh frame on the same URL', async () => {
    await mount({ target: ART.id });
    expect(document.querySelector('[data-console-chip]')).toBeNull();
    log(ART.id, 1); // another version's: not shown on v2
    expect(document.querySelector('[data-console-chip]')).toBeNull();
    log(ART.id, 2);
    log(ART.id, 2, 'warning', 'deprecated');
    const chip = document.querySelector<HTMLElement>('[data-console-chip]')!;
    expect(chip.textContent).toBe('1 console error');
    fireEvent.click(chip);
    const popover = await screen.findByRole('dialog');
    expect(within(popover).getByText('Uncaught Error: E2_BOOM')).toBeTruthy();
    expect(within(popover).getByText('deprecated')).toBeTruthy();
    fireEvent.keyDown(popover, { key: 'Escape' });

    const before = frame()!;
    fireEvent.click(button('Reload')!);
    await settle();
    expect(document.querySelector('[data-console-chip]')).toBeNull();
    expect(frame()).not.toBe(before); // remounted, not navigated through about:blank
    expect(frame()!.getAttribute('src')).toBe(deliverableUrl(A, ART.id, 2));
  });

  it('counts once per version however often the frame mounts again (v2 → v1 → v2, Back and reopen)', async () => {
    const { handle } = await mount({ target: ART.id });
    const select = () => screen.getByRole('combobox', { name: 'Version' });
    log(ART.id, 2); // v2's first mount logs its error
    fireEvent.change(select(), { target: { value: '1' } });
    await settle();
    log(ART.id, 1);
    fireEvent.change(select(), { target: { value: '2' } });
    await settle();
    log(ART.id, 2); // the remounted v2 frame logs the same error again
    expect(document.querySelector('[data-console-chip]')!.textContent).toBe('1 console error');
    act(() => handle.back());
    act(() => deliverablesTool.open!(handle, { target: ART.id }));
    await settle();
    log(ART.id, 2);
    expect(document.querySelector('[data-console-chip]')!.textContent).toBe('1 console error');
  });

  it('shows on a delivered HTML file too', async () => {
    await mount({ target: PAGE.id });
    log(PAGE.id, 1);
    expect(document.querySelector('[data-console-chip]')!.textContent).toBe('1 console error');
  });
});

// E2 (M6): comment mode (Design §10). The frame's page cannot be reached from the app (an opaque origin), so the
// viewer posts `maws:pick` into the frame and listens for what the bridge script posts back, from that frame alone.
describe('comment mode on an artifact element', () => {
  const opened: { anchor: Anchor; context: { appSessionId: AppSessionId } }[] = [];
  let offComposer: () => void;
  beforeEach(() => {
    opened.length = 0;
    offComposer = registerCommentComposer((anchor, context) => void opened.push({ anchor, context }));
  });
  afterEach(() => offComposer());

  const picked = { type: 'maws:picked', selector: 'body > h1:nth-of-type(1)', label: 'h1.title', text: 'Sales overview', rect: { x: 0, y: 0, width: 10, height: 10 } };
  const post = (data: unknown, source: unknown) => act(() => void window.dispatchEvent(new MessageEvent('message', { data, source: source as MessageEventSource })));
  const hint = () => screen.queryByText('Click an element to comment on it · Esc cancels');
  // what the viewer posts into the frame's window
  const spyFrame = () => {
    const target = frame()!.contentWindow!;
    const sent: unknown[] = [];
    target.postMessage = ((data: unknown) => void sent.push(data)) as typeof target.postMessage;
    return { target, sent };
  };

  it('is offered on an artifact alone: not on a delivered HTML page, a PDF or a file', async () => {
    await mount({ target: ART.id });
    expect(button('Comment')).not.toBeNull();
    for (const n of [2, 3, 6]) {
      cleanup();
      await mount({ target: id(n) });
      expect(viewer()!.dataset.deliverableId).toBe(id(n));
      expect(button('Comment')).toBeNull();
    }
  });

  it('Comment starts picking in the frame; a pick from that frame opens the composer with the artifact-element anchor', async () => {
    await mount({ target: ART.id });
    const { target, sent } = spyFrame();
    fireEvent.click(button('Comment')!);
    expect(sent).toEqual([{ type: 'maws:pick', on: true }]);
    expect(hint()).not.toBeNull();
    expect(button('Comment')!.getAttribute('aria-pressed')).toBe('true');
    post(picked, target);
    expect(opened).toEqual([
      { anchor: { kind: 'artifact-element', locator: 'body > h1:nth-of-type(1)', label: 'Dashboard v2 › h1.title “Sales overview”', pageUrl: deliverableUrl(A, ART.id, 2) }, context: { appSessionId: A } },
    ]);
    expect(AnchorSchema.safeParse(opened[0]!.anchor).success).toBe(true);
    expect(hint()).toBeNull(); // one pick per Comment
    expect(sent.at(-1)).toEqual({ type: 'maws:pick', on: false });
  });

  it('ignores a pick from anywhere but the frame, a malformed one, and one that arrives while not picking', async () => {
    await mount({ target: ART.id });
    const { target } = spyFrame();
    post(picked, target); // not picking: the page cannot open the composer on its own
    expect(opened).toEqual([]);
    fireEvent.click(button('Comment')!);
    post(picked, window);
    post(picked, null);
    post({ ...picked, selector: 7 }, target);
    expect(opened).toEqual([]);
    expect(hint()).not.toBeNull(); // still picking
  });

  it('Escape in the app or a cancel from the frame ends picking; Comment again toggles it off', async () => {
    await mount({ target: ART.id });
    const { target, sent } = spyFrame();
    fireEvent.click(button('Comment')!);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(hint()).toBeNull();
    expect(sent).toEqual([{ type: 'maws:pick', on: true }, { type: 'maws:pick', on: false }]);
    fireEvent.click(button('Comment')!);
    post({ type: 'maws:pick-cancelled' }, target);
    expect(hint()).toBeNull();
    fireEvent.click(button('Comment')!);
    fireEvent.click(button('Comment')!);
    expect(hint()).toBeNull();
    post(picked, target);
    expect(opened).toEqual([]);
  });

  it('leaves an Escape that something else answered, or that ends a composition, to that', async () => {
    await mount({ target: ART.id });
    fireEvent.click(button('Comment')!);
    const answered = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    answered.preventDefault();
    act(() => void window.dispatchEvent(answered));
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true })));
    expect(hint()).not.toBeNull();
  });

  it('asks the frame to pick again after it loads, so a Comment pressed before the page loaded reaches it', async () => {
    await mount({ target: ART.id });
    const { sent } = spyFrame();
    fireEvent.click(button('Comment')!);
    act(() => void frame()!.dispatchEvent(new Event('load')));
    expect(sent).toEqual([{ type: 'maws:pick', on: true }, { type: 'maws:pick', on: true }]);
  });

  it('Reload ends picking (a new frame), and a version whose file goes missing ends it with its frame', async () => {
    await mount({ target: ART.id });
    fireEvent.click(button('Comment')!);
    fireEvent.click(button('Reload')!);
    await settle();
    expect(hint()).toBeNull();
    expect(button('Comment')!.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(button('Comment')!);
    expect(hint()).not.toBeNull();
    present.set(ART.id, [true, false]);
    await act(async () => main.emit('deliverables.changed', { appSessionId: A, id: ART.id, change: 'updated' }));
    await settle();
    expect(document.querySelector('[data-missing]')).not.toBeNull();
    expect(hint()).toBeNull();
    expect(button('Comment')).toBeNull();
  });

  it('a version switch ends picking, and Comment then picks on the version shown', async () => {
    await mount({ target: ART.id });
    fireEvent.click(button('Comment')!);
    fireEvent.change(screen.getByRole('combobox', { name: 'Version' }), { target: { value: '1' } });
    await settle();
    expect(hint()).toBeNull();
    const { target } = spyFrame();
    fireEvent.click(button('Comment')!);
    post(picked, target);
    expect(opened[0]!.anchor).toMatchObject({ label: 'Dashboard v1 › h1.title “Sales overview”', pageUrl: deliverableUrl(A, ART.id, 1) });
  });

  it('is offered in the deliverable main tab too', async () => {
    render(<DeliverableTab tab={{ id: `deliverable:${A}:${ART.id}`, kind: 'deliverable', appSessionId: A, deliverableId: ART.id, pinned: false }} />);
    await settle();
    const { target } = spyFrame();
    fireEvent.click(button('Comment')!);
    post(picked, target);
    expect(opened).toHaveLength(1);
  });
});

describe('the summary section', () => {
  it('reads the count and the latest title, and Open opens the tool on its list', async () => {
    const opened: unknown[] = [];
    render(<DeliverablesSummary appSessionId={A} open={(params) => opened.push(params)} />);
    await settle();
    expect(document.querySelector('[data-summary="deliverables"]')!.textContent).toContain('9 delivered · Dashboard');
    fireEvent.click(button('Open')!);
    expect(opened).toEqual([undefined]);
  });

  it('says the read failed rather than that nothing was delivered', async () => {
    main = installFakeMain((name) => (name === 'deliverables.list' ? fail('EACCES') : fail(`unexpected ${name}`)));
    render(<DeliverablesSummary appSessionId={A} open={() => {}} />);
    await settle();
    expect(screen.queryByText('Nothing delivered yet')).toBeNull();
    expect(screen.getByText("Couldn't read this session's deliverables")).toBeTruthy();
  });

  it('says nothing was delivered yet', async () => {
    records = [];
    render(<DeliverablesSummary appSessionId={A} open={() => {}} />);
    await settle();
    expect(screen.getByText('Nothing delivered yet')).toBeTruthy();
  });
});

describe('the deliverable main tab', () => {
  const tab = (deliverableId: string): Extract<TabRef, { kind: 'deliverable' }> => ({ id: `deliverable:${A}:${deliverableId}`, kind: 'deliverable', appSessionId: A, deliverableId, pinned: false });

  it('draws the viewer with no Back and no Open in tab', async () => {
    render(<DeliverableTab tab={tab(ART.id)} />);
    await settle();
    expect(viewer()!.dataset).toMatchObject({ deliverableId: ART.id, version: '2' });
    expect(button('Back')).toBeNull();
    expect(button('Open in tab')).toBeNull();
    expect(button('Reveal in Finder')).not.toBeNull();
  });

  it('offers Retry when the record could not be read, which reads it again', async () => {
    main = installFakeMain((name) => (name === 'deliverables.get' ? fail('EIO') : fail(`unexpected ${name}`)));
    render(<DeliverableTab tab={tab(ART.id)} />);
    await settle();
    expect(screen.getByRole('alert').textContent).toBe("Couldn't read this deliverable: EIO");
    installMain();
    fireEvent.click(button('Retry')!);
    await settle();
    expect(viewer()!.dataset.deliverableId).toBe(ART.id);
  });

  it('restores to the session’s list with the notice when the record is gone; a row opens its own tab', async () => {
    const gone = id(55);
    render(<DeliverableTab tab={tab(gone)} />);
    await settle();
    expect(viewer()).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(`No deliverable ${gone} in this session`);
    await openRecord(6);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'deliverable', appSessionId: A, deliverableId: NOTES.id });
  });
});
