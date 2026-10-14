// E2 (M5, Design §9): the artifact tools in the transcript through the public reducer-to-rows pipeline. An
// `artifact_create` or `artifact_update` call is an artifact row, opened from the call, filled from its result (the first
// JSON text block) and refined by `maws.delivery.artifact`; `artifact_list` and `artifact_screenshot` are standalone
// cells whose labels read their results. The recorded `p1-maws-artifacts` journal pins the same rows; the disk path
// (no events) is pinned over its exported transcript in disk.test.ts.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { loadJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { presentationOf, tableRowOf } from './classify';
import { artifactHeading } from './copy';
import { isPersistentRow, rowsOf, withAllExpanded } from './derive';
import { rowId } from './keys';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { builder, request, tool, type Builder } from './test-events';

type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;
const ofKind = <K extends Row['kind']>(rows: Row[], kind: K) => rows.filter((row): row is RowOf<K> => row.kind === kind);
const expandedRows = (events: Builder['events']) => rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
const foldedRows = (events: Builder['events']) => rowsOf(applyEvents(createState(null, null), events));

const CREATE = 'mcp__maws__artifact_create';
const UPDATE = 'mcp__maws__artifact_update';
const LIST = 'mcp__maws__artifact_list';
const SCREENSHOT = 'mcp__maws__artifact_screenshot';
const DELIVERABLE = '10edca26-3f45-406b-b141-781c4e54fe4b';
const json = (value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }];
const IMAGE = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };
const created = (title = 'Dashboard') => json({ status: 'created', id: 'dash', deliverableId: DELIVERABLE, version: 1, title, externalReferences: 0 });
const updated = (version: number, title = 'Dashboard') => json({ status: 'updated', id: 'dash', deliverableId: DELIVERABLE, version, title, externalReferences: 0 });

describe('the artifact row', () => {
  it('opens from the call, pending, and fills the deliverable id, version and title from the result', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_c', CREATE, { id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' });
    const [pending] = ofKind(expandedRows(b.events), 'artifact');
    expect(pending).toEqual({
      id: rowId.artifact(tool('toolu_c')), turnId: 'turn:u1', at: pending.at, kind: 'artifact', toolUseId: 'toolu_c', action: 'create', artifactId: 'dash', title: 'Dashboard',
      htmlPath: 'dashboard.html', deliverableId: null, version: null, error: null, answered: false,
    });
    b.result('toolu_c', created());
    expect(ofKind(expandedRows(b.events), 'artifact')[0]).toMatchObject({ deliverableId: DELIVERABLE, version: 1, title: 'Dashboard', error: null, answered: true });
  });

  it('an update with no title takes the result’s; a renaming update the new title; the event wins over the result', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_u', UPDATE, { id: 'dash', html_path: 'dashboard.html' });
    expect(ofKind(expandedRows(b.events), 'artifact')[0]).toMatchObject({ action: 'update', artifactId: 'dash', title: null, version: null });
    b.result('toolu_u', updated(2));
    expect(ofKind(expandedRows(b.events), 'artifact')[0]).toMatchObject({ title: 'Dashboard', version: 2 });

    const renamed = builder();
    renamed.turn('u1');
    renamed.toolUse('toolu_r', UPDATE, { id: 'dash', html_path: 'dashboard.html', title: 'Sales, Q3' });
    renamed.emit('maws.delivery.artifact', { toolUseId: tool('toolu_r'), requestId: request('r1'), action: 'update', artifactId: 'dash', deliverableId: DELIVERABLE, version: 3, title: 'Sales, Q3' });
    renamed.result('toolu_r', updated(9, 'stale'));
    expect(ofKind(expandedRows(renamed.events), 'artifact')[0]).toMatchObject({ title: 'Sales, Q3', deliverableId: DELIVERABLE, version: 3 });
  });

  // P3-L M6b fix wave 2: the revision the call wrote, from the result (a session read from disk) or the event, rides the
  // row beside E2's ordinal; an E2 answer names none
  it('carries the revision the call wrote, from the result or the event; none from an answer that names none', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_p', UPDATE, { id: 'dash', html_path: 'dashboard.html' });
    b.result('toolu_p', json({ status: 'published', id: 'dash', deliverableId: DELIVERABLE, version: 2, title: 'Dashboard', revision: 41 }));
    expect(ofKind(expandedRows(b.events), 'artifact')[0]).toMatchObject({ version: 2, revision: 41 });
    const live = builder();
    live.turn('u1');
    live.toolUse('toolu_q', UPDATE, { id: 'dash', html_path: 'dashboard.html' });
    live.emit('maws.delivery.artifact', { toolUseId: tool('toolu_q'), requestId: request('r1'), action: 'update', artifactId: 'dash', deliverableId: DELIVERABLE, version: 3, title: 'Dashboard', revision: 57 });
    expect(ofKind(expandedRows(live.events), 'artifact')[0]).toMatchObject({ version: 3, revision: 57 });
    const e2 = builder();
    e2.turn('u1');
    e2.toolUse('toolu_e', UPDATE, { id: 'dash', html_path: 'dashboard.html' });
    e2.result('toolu_e', updated(2));
    expect(ofKind(expandedRows(e2.events), 'artifact')[0]).not.toHaveProperty('revision');
  });

  it('a refused call reads its error, a result that is not the tool’s JSON answers the row without a version, and a call with no result is unanswered', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_n', UPDATE, { id: 'nope', html_path: 'dashboard.html' });
    b.result('toolu_n', 'artifact_update: no artifact "nope" in this session; use artifact_create', { isError: true });
    b.toolUse('toolu_x', CREATE, { id: 'x', html_path: 'x.html', title: 'X' });
    b.result('toolu_x', 'something else');
    b.toolUse('toolu_w', CREATE, { id: 'w', html_path: 'w.html', title: 'W' });
    expect(ofKind(expandedRows(b.events), 'artifact').map((row) => [row.artifactId, row.deliverableId, row.version, row.error, row.answered])).toEqual([
      ['nope', null, null, 'artifact_update: no artifact "nope" in this session; use artifact_create', true],
      ['x', null, null, null, true],
      ['w', null, null, null, false],
    ]);
  });

  it('arguments the schema refuses still draw from the call as recorded', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_bad', CREATE, { id: '/x', html_path: 'a.html' });
    b.result('toolu_bad', 'artifact_create: invalid arguments: id: Invalid string', { isError: true });
    expect(ofKind(expandedRows(b.events), 'artifact')[0]).toMatchObject({ action: 'create', artifactId: '/x', htmlPath: 'a.html', title: null, error: 'artifact_create: invalid arguments: id: Invalid string' });
  });

  it('an event arriving after the turn closed and another turn ran refines the row, in its own turn', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_c', CREATE, { id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' });
    b.end(['u1']);
    b.turn('u2', 'something else');
    b.end(['u2']);
    let state = applyEvents(createState(null, null), b.events);
    expect(ofKind(rowsOf(state), 'artifact')[0]).toMatchObject({ version: null, turnId: 'turn:u1' });
    const later = builder(new Date(b.at).toISOString());
    later.emit('maws.delivery.artifact', { toolUseId: tool('toolu_c'), requestId: request('r1'), action: 'create', artifactId: 'dash', deliverableId: DELIVERABLE, version: 1, title: 'Dashboard' }, { id: 'late-1' });
    state = applyEvents(state, later.events);
    expect(ofKind(rowsOf(state), 'artifact')[0]).toMatchObject({ deliverableId: DELIVERABLE, version: 1, turnId: 'turn:u1' });
  });

  it('stays in view when its turn folds', () => {
    const b = builder();
    b.turn('u1');
    b.text('m0', 0, 'Registering it.');
    b.toolUse('toolu_c', CREATE, { id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' });
    b.result('toolu_c', created());
    b.text('m1', 0, 'Done.');
    b.end(['u1']);
    const rows = foldedRows(b.events);
    expect(rows.filter((row) => row.kind !== 'time').map((row) => row.kind)).toEqual(['user', 'divider', 'artifact', 'assistant_text']);
    expect(isPersistentRow(ofKind(rows, 'artifact')[0])).toBe(true);
  });

  // P2-E1 (D10): a side thread's update of an ancestor's artifact names the record's session on its row
  it("a side thread's update of its parent's artifact carries the owner, from the event and from the result alone; its own carries none", () => {
    const PARENT = 'app-parent' as AppSessionId;
    const announced = builder();
    announced.turn('u1');
    announced.toolUse('toolu_t', UPDATE, { id: 'dash', html_path: 'dashboard.html' });
    announced.emit('maws.delivery.artifact', { toolUseId: tool('toolu_t'), requestId: request('r1'), action: 'update', artifactId: 'dash', deliverableId: DELIVERABLE, version: 2, title: 'Dashboard', ownerAppSessionId: PARENT });
    announced.result('toolu_t', json({ status: 'updated', id: 'dash', deliverableId: DELIVERABLE, version: 2, title: 'Dashboard', externalReferences: 0, ownerAppSessionId: PARENT }));
    expect(ofKind(expandedRows(announced.events), 'artifact')[0]).toMatchObject({ deliverableId: DELIVERABLE, version: 2, ownerAppSessionId: PARENT });

    // the disk path: the call and its result, no host event
    const disk = builder();
    disk.turn('u1');
    disk.toolUse('toolu_t', UPDATE, { id: 'dash', html_path: 'dashboard.html' });
    disk.result('toolu_t', json({ status: 'updated', id: 'dash', deliverableId: DELIVERABLE, version: 3, title: 'Dashboard', externalReferences: 0, ownerAppSessionId: PARENT }));
    expect(ofKind(expandedRows(disk.events), 'artifact')[0]).toMatchObject({ version: 3, ownerAppSessionId: PARENT });

    const own = builder();
    own.turn('u1');
    own.toolUse('toolu_o', UPDATE, { id: 'dash', html_path: 'dashboard.html' });
    own.result('toolu_o', updated(2));
    expect(ofKind(expandedRows(own.events), 'artifact')[0]).not.toHaveProperty('ownerAppSessionId');
  });
});

// P3-A (M6; X25): `artifact_publish` replaced E2's update, and its row reads as the update's did; an E2 journal's
// `artifact_update` keeps reading as it was written. The namespace's other tools are standalone cells.
describe('the artifact row of a publish (P3-A)', () => {
  const PUBLISH = 'mcp__maws__artifact_publish';
  const published = (version: number) =>
    json({ status: 'published', artifactId: DELIVERABLE, kind: 'html', title: 'Dashboard', revision: 4, changed: ['index.html'], kept: [], removed: [], id: 'dash', deliverableId: DELIVERABLE, version, externalReferences: 0 });

  it('names the artifact the call named and fills the version from an html publish’s answer; a file kind’s answer leaves none', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_p', PUBLISH, { artifact: 'dash', baseRevision: 3, files: { 'index.html': '<p/>' } });
    expect(ofKind(expandedRows(b.events), 'artifact')[0]).toMatchObject({ action: 'update', artifactId: 'dash', title: null, version: null, answered: false });
    b.result('toolu_p', published(2));
    expect(ofKind(expandedRows(b.events), 'artifact')[0]).toMatchObject({ action: 'update', artifactId: 'dash', title: 'Dashboard', deliverableId: DELIVERABLE, version: 2, answered: true });
    b.toolUse('toolu_f', PUBLISH, { artifact: 'site', baseRevision: 3, files: { 'a.css': 'x' } });
    b.result('toolu_f', json({ status: 'published', artifactId: DELIVERABLE, kind: 'design', title: 'Site', revision: 5, changed: ['a.css'], kept: [], removed: [] }));
    expect(ofKind(expandedRows(b.events), 'artifact')[1]).toMatchObject({ artifactId: 'site', deliverableId: null, version: null, answered: true });
  });

  it('a create names its artifact by handle and its page by path; a refusal reads without the tool’s prefix or the refusal’s JSON', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_c', CREATE, { handle: 'dash', path: 'dashboard.html', title: 'Dashboard' });
    b.toolUse('toolu_n', PUBLISH, { artifact: 'dash', baseRevision: 1, files: { 'index.html': '<p/>' } });
    b.result('toolu_n', 'artifact_publish: changed by someone else since your read: index.html {"reason":"conflict","paths":["index.html"]}', { isError: true });
    const [create, refused] = ofKind(expandedRows(b.events), 'artifact');
    expect(create).toMatchObject({ artifactId: 'dash', htmlPath: 'dashboard.html' });
    expect(artifactHeading(refused!)).toBe('Could not register artifact dash: changed by someone else since your read: index.html');
  });

  it('classes the other artifact tools as standalone cells, and the retired update still as a row', () => {
    for (const name of ['artifact_read', 'artifact_describe_type', 'artifact_upload_asset', 'artifact_list_assets', 'artifact_export']) {
      expect(presentationOf(`mcp__maws__${name}`), name).toBe('cell');
      expect(tableRowOf(`mcp__maws__${name}`), name).toMatchObject({ groupable: false });
    }
    expect(presentationOf(UPDATE)).toBe('artifact');
    expect(presentationOf(PUBLISH)).toBe('artifact');
  });

  it('counts a library listing as it counted E2’s', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_l', LIST, {});
    b.result('toolu_l', json({ status: 'listed', artifacts: [{ id: DELIVERABLE, handle: 'dash', kind: 'html', title: 'Dashboard', revision: 2, updatedAt: '2026-10-13T00:00:00.000Z', lastEditor: null }] }));
    expect(ofKind(expandedRows(b.events), 'cell').find((cell) => cell.toolUseId === 'toolu_l')?.label).toBe('Listed 1 artifact');
  });
});

describe('the artifact_list and artifact_screenshot cells', () => {
  const cells = (b: Builder) => ofKind(expandedRows(b.events), 'cell').map((cell) => [cell.toolUseId, cell.status, cell.label, cell.category, cell.classification.groupable]);

  it('read what the result says, or why it failed; running before it', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_l1', LIST, {});
    b.result('toolu_l1', json({ status: 'listed', artifacts: [] }));
    b.toolUse('toolu_l2', LIST, {});
    b.result('toolu_l2', json({ status: 'listed', artifacts: [1, 2].map((n) => ({ id: `a${n}`, deliverableId: DELIVERABLE, title: 'T', versions: 1, createdAt: 'x', updatedAt: 'x' })) }));
    b.toolUse('toolu_s1', SCREENSHOT, { id: 'dash' });
    b.result('toolu_s1', [IMAGE, { type: 'text', text: '[Image: source: /tmp/a.png]' }, ...json({ status: 'captured', id: 'dash', deliverableId: DELIVERABLE, title: 'Dashboard', version: 2, width: 1280, height: 800, bytes: 9, consoleErrors: [] })]);
    b.toolUse('toolu_s2', SCREENSHOT, { id: 'gone' });
    b.result('toolu_s2', 'artifact_screenshot: no artifact "gone" in this session', { isError: true });
    b.toolUse('toolu_s3', SCREENSHOT, { id: 'dash' });
    b.toolUse('toolu_l3', LIST, {});
    expect(cells(b)).toEqual([
      ['toolu_l1', 'done', 'Listed no artifacts', 'other', false],
      ['toolu_l2', 'done', 'Listed 2 artifacts', 'other', false],
      ['toolu_s1', 'done', 'Screenshot of Dashboard v2 (1280 × 800)', 'other', false],
      ['toolu_s2', 'error', 'Could not screenshot: no artifact "gone" in this session', 'other', false],
      ['toolu_s3', 'running', 'Taking a screenshot of dash', 'other', false],
      ['toolu_l3', 'running', 'Listing artifacts', 'other', false],
    ]);
  });
});

describe('SendUserFile, retired', () => {
  it('draws as any unknown tool: a grouped cell in other, "Used SendUserFile"', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_f', 'SendUserFile', { file_path: '/repo/report.pdf' });
    b.result('toolu_f', 'sent');
    const group = ofKind(expandedRows(b.events), 'group')[0] ?? null;
    const cell = group ? group.cells[0] : ofKind(expandedRows(b.events), 'cell')[0];
    expect([cell.label, cell.category, cell.classification.groupable]).toEqual(['Used SendUserFile', 'other', true]);
  });
});

describe('p1-maws-artifacts, recorded', () => {
  const rows = () => expandedRows(journalToEvents(loadJournal('pass3', 'p1-maws-artifacts')));

  it('two artifact rows with their versions and the refused update’s error row', () => {
    expect(ofKind(rows(), 'artifact').map((row) => [row.action, row.artifactId, row.title, row.deliverableId, row.version, row.error])).toEqual([
      ['create', 'dash', 'Dashboard', DELIVERABLE, 1, null],
      ['update', 'dash', 'Dashboard', DELIVERABLE, 2, null],
      ['update', 'nope', null, null, null, 'artifact_update: no artifact "nope" in this session; use artifact_create'],
    ]);
  });

  it('the list cell and the screenshot cell with the recording’s title and size', () => {
    const labels = ofKind(rows(), 'cell').filter((cell) => cell.toolName === LIST || cell.toolName === SCREENSHOT).map((cell) => cell.label);
    expect(labels).toEqual(['Screenshot of Dashboard v1 (64 × 64)', 'Listed 1 artifact']);
  });
});
