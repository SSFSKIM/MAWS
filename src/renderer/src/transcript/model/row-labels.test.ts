// UX wave U2 (l6-artifacts-12, O-49; the U2a document, M3, Interfaces §D, decisions 13 and 14, acceptance 10 and 11):
// what a row reads, through the reducer and the derivation: an artifact call names what it did to which artifact, by
// the title a result in the loaded transcript gave it; a failed call carries the first line of its error; a stopped
// call names its short command or its artifact. Every title, handle, command and message is invented.
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState } from './reduce';
import type { Cell, Row } from './rows';
import { BASH_RESULT, builder, type Builder } from './test-events';

type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;
const drawn = (events: SessionEvent[]): Row[] => rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
const cellsOf = (rows: Row[]): Cell[] => rows.flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []));
const cellOf = (b: Builder, id: string): Cell => cellsOf(drawn(b.events)).find((cell) => cell.toolUseId === id)!;
const groupsOf = (b: Builder) => drawn(b.events).filter((row): row is RowOf<'group'> => row.kind === 'group');
const dividersOf = (b: Builder) => drawn(b.events).filter((row): row is RowOf<'divider'> => row.kind === 'divider');

const MAWS = (tool: string) => `mcp__maws__${tool}`;
const MEMO_ID = '5b0c6c1e-7d2a-4c8e-9f10-2a3b4c5d6e7f';
const json = (value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }];
const IMAGE = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } };

// A read that names the memo by its handle, its id and its title, as the host answers one
const readMemo = (b: Builder, id = 'r0') => {
  b.toolUse(id, MAWS('artifact_read'), { artifact: 'q3-memo' });
  b.result(id, json({ status: 'read', artifactId: MEMO_ID, kind: 'document', title: 'Q3 memo', revision: 4, handle: 'q3-memo', versions: [] }));
};

describe('an artifact call names what it did to which artifact', () => {
  // [tool, input, done, running, failed]
  const forms: [string, Record<string, unknown>, string, string, string][] = [
    ['artifact_read', { artifact: 'q3-memo' }, 'Read ‹Q3 memo›', 'Reading ‹Q3 memo›', 'Could not read ‹Q3 memo›'],
    ['artifact_edit', { artifact: 'q3-memo', edits: [] }, 'Edited ‹Q3 memo›', 'Editing ‹Q3 memo›', 'Could not edit ‹Q3 memo›'],
    ['artifact_comments', { artifact: 'q3-memo' }, 'Listed comments on ‹Q3 memo›', 'Listing comments on ‹Q3 memo›', 'Could not list comments on ‹Q3 memo›'],
    ['artifact_reply', { artifact: 'q3-memo', threadId: 'th-1', body: 'Done.' }, 'Replied on ‹Q3 memo›', 'Replying on ‹Q3 memo›', 'Could not reply on ‹Q3 memo›'],
    ['artifact_resolve', { artifact: 'q3-memo', threadId: 'th-1' }, 'Resolved a comment on ‹Q3 memo›', 'Resolving a comment on ‹Q3 memo›', 'Could not resolve a comment on ‹Q3 memo›'],
    ['artifact_resolve', { artifact: 'q3-memo', threadId: 'th-1', reopen: true }, 'Reopened a comment on ‹Q3 memo›', 'Resolving a comment on ‹Q3 memo›', 'Could not resolve a comment on ‹Q3 memo›'],
    ['artifact_export', { artifact: 'q3-memo', format: 'pdf' }, 'Exported ‹Q3 memo›', 'Exporting ‹Q3 memo›', 'Could not export ‹Q3 memo›'],
    ['artifact_upload_asset', { artifact: 'q3-memo', path: 'chart.png' }, 'Uploaded an asset to ‹Q3 memo›', 'Uploading an asset to ‹Q3 memo›', 'Could not upload an asset to ‹Q3 memo›'],
    ['artifact_list_assets', { artifact: 'q3-memo' }, 'Listed assets of ‹Q3 memo›', 'Listing assets of ‹Q3 memo›', 'Could not list assets of ‹Q3 memo›'],
    ['artifact_dataset', { artifact: 'q3-memo', name: 'sales' }, 'Bound a dataset to ‹Q3 memo›', 'Binding a dataset to ‹Q3 memo›', 'Could not bind a dataset to ‹Q3 memo›'],
    ['artifact_describe_type', { kind: 'document' }, 'Described the document kind', 'Describing the document kind', 'Could not describe the document kind'],
    ['artifact_search', { query: 'quarter' }, 'Searched artifacts', 'Searching artifacts', 'Could not search artifacts'],
    ['artifact_list', {}, 'Listed artifacts', 'Listing artifacts', 'Could not list artifacts'],
  ];

  it.each(forms)('%s %j: done, running and failed', (tool, input, done, running, failed) => {
    const label = (outcome: 'done' | 'running' | 'failed') => {
      const b = builder();
      b.turn('u1');
      readMemo(b);
      b.toolUse('t1', MAWS(tool), input);
      if (outcome === 'done') b.result('t1', json({ status: 'ok' }));
      if (outcome === 'failed') b.result('t1', `${tool}: the host refused it`, { isError: true });
      return cellOf(b, 't1').label;
    };
    expect([label('done'), label('running'), label('failed')]).toEqual([done, running, failed]);
  });

  it('a list reads how many it listed, as before', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', MAWS('artifact_list'), {});
    b.result('t1', json({ status: 'listed', artifacts: [{ id: MEMO_ID, handle: 'q3-memo', kind: 'document', title: 'Q3 memo', revision: 4, updatedAt: '2026-09-28T09:00:00.000Z' }] }));
    expect(cellOf(b, 't1').label).toBe('Listed 1 artifact');
  });

  it('a screenshot reads what it captured, as before, and names the artifact by its title when it fails', () => {
    const b = builder();
    b.turn('u1');
    readMemo(b);
    b.toolUse('t1', MAWS('artifact_screenshot'), { id: 'q3-memo' });
    b.result('t1', [IMAGE, ...json({ status: 'captured', id: 'q3-memo', deliverableId: MEMO_ID, title: 'Q3 memo', version: 2, width: 1280, height: 800, bytes: 9, consoleErrors: [] })]);
    b.toolUse('t2', MAWS('artifact_screenshot'), { id: 'q3-memo' });
    b.result('t2', 'artifact_screenshot: MAWS is not open; the artifact cannot be captured', { isError: true });
    b.toolUse('t3', MAWS('artifact_screenshot'), { id: 'q3-memo' });
    expect([cellOf(b, 't1').label, cellOf(b, 't2').label, cellOf(b, 't3').label]).toEqual([
      'Screenshot of Q3 memo v2 (1280 × 800)', 'Could not screenshot ‹Q3 memo›', 'Taking a screenshot of q3-memo',
    ]);
    expect(cellOf(b, 't2').error).toBe('MAWS is not open; the artifact cannot be captured');
  });

  it('a call that names nothing reads as any MCP call', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', MAWS('artifact_edit'), { edits: [] });
    b.result('t1', json({ status: 'ok' }));
    expect(cellOf(b, 't1').label).toBe('Used maws · artifact_edit');
  });
});

describe('where an artifact’s title comes from', () => {
  const edit = (b: Builder, id: string, artifact: string) => {
    b.toolUse(id, MAWS('artifact_edit'), { artifact, edits: [] });
    b.result(id, json({ status: 'ok' }));
  };

  it('an artifact no result in the loaded transcript named reads the handle or id the call gave', () => {
    const b = builder();
    b.turn('u1');
    edit(b, 't1', 'q3-memo');
    edit(b, 't2', MEMO_ID);
    expect([cellOf(b, 't1').label, cellOf(b, 't2').label]).toEqual(['Edited ‹q3-memo›', `Edited ‹${MEMO_ID}›`]);
  });

  it('a result names the artifact by its handle and by its id', () => {
    const b = builder();
    b.turn('u1');
    readMemo(b);
    edit(b, 't1', 'q3-memo');
    edit(b, 't2', MEMO_ID);
    expect([cellOf(b, 't1').label, cellOf(b, 't2').label]).toEqual(['Edited ‹Q3 memo›', 'Edited ‹Q3 memo›']);
  });

  it('a screenshot or delivery result names the artifact by the handle in its `id` and the uuid in its `deliverableId`', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('p1', MAWS('artifact_screenshot'), { id: 'q3-memo' });
    b.result('p1', [IMAGE, ...json({ status: 'captured', id: 'q3-memo', deliverableId: MEMO_ID, title: 'Q3 memo', width: 64, height: 64, bytes: 9, consoleErrors: [] })]);
    edit(b, 't1', 'q3-memo');
    edit(b, 't2', MEMO_ID);
    expect([cellOf(b, 't1').label, cellOf(b, 't2').label]).toEqual(['Edited ‹Q3 memo›', 'Edited ‹Q3 memo›']);
  });

  it('a title learned in an earlier turn names a later turn’s call', () => {
    const b = builder();
    b.turn('u1');
    readMemo(b);
    b.end(['u1']);
    b.turn('u2');
    edit(b, 't1', 'q3-memo');
    b.end(['u2']);
    expect(cellOf(b, 't1').label).toBe('Edited ‹Q3 memo›');
  });

  it('this turn’s results come before an earlier turn’s', () => {
    const b = builder();
    b.turn('u1');
    readMemo(b);
    b.end(['u1']);
    b.turn('u2');
    b.toolUse('r1', MAWS('artifact_read'), { artifact: 'q3-memo' });
    b.result('r1', json({ status: 'read', artifactId: MEMO_ID, kind: 'document', title: 'Q3 memo, revised', revision: 5, handle: 'q3-memo', versions: [] }));
    edit(b, 't1', 'q3-memo');
    b.end(['u2']);
    expect(cellOf(b, 't1').label).toBe('Edited ‹Q3 memo, revised›');
  });

  it('a creation, a list, a search and a screenshot name what they named; a failed result names nothing', () => {
    const named = (giving: (b: Builder) => void) => {
      const b = builder();
      b.turn('u1');
      giving(b);
      edit(b, 't1', 'q3-memo');
      return cellOf(b, 't1').label;
    };
    expect(named((b) => {
      b.toolUse('c1', MAWS('artifact_create'), { kind: 'document', title: 'Q3 memo', handle: 'q3-memo' });
      b.result('c1', json({ status: 'created', artifactId: MEMO_ID, kind: 'document', title: 'Q3 memo', revision: 0, handle: 'q3-memo' }));
    })).toBe('Edited ‹Q3 memo›');
    expect(named((b) => {
      b.toolUse('l1', MAWS('artifact_list'), {});
      b.result('l1', json({ status: 'listed', artifacts: [{ id: MEMO_ID, handle: 'q3-memo', kind: 'document', title: 'Q3 memo', revision: 4, updatedAt: '2026-09-28T09:00:00.000Z' }] }));
    })).toBe('Edited ‹Q3 memo›');
    expect(named((b) => {
      b.toolUse('s1', MAWS('artifact_search'), { query: 'quarter' });
      b.result('s1', json({ status: 'found', hits: [{ id: MEMO_ID, handle: 'q3-memo', kind: 'document', title: 'Q3 memo', revision: 4, updatedAt: '2026-09-28T09:00:00.000Z' }], more: false }));
    })).toBe('Edited ‹Q3 memo›');
    expect(named((b) => {
      b.toolUse('p1', MAWS('artifact_screenshot'), { id: 'q3-memo' });
      b.result('p1', [IMAGE, ...json({ status: 'captured', id: 'q3-memo', deliverableId: MEMO_ID, title: 'Q3 memo', width: 64, height: 64, bytes: 9, consoleErrors: [] })]);
    })).toBe('Edited ‹Q3 memo›');
    expect(named((b) => {
      b.toolUse('r1', MAWS('artifact_read'), { artifact: 'q3-memo' });
      b.result('r1', 'artifact_read: no artifact "q3-memo" in this session', { isError: true });
    })).toBe('Edited ‹q3-memo›');
  });
});

describe('twelve edits of one document (acceptance 10)', () => {
  const twelve = () => {
    const b = builder();
    b.turn('u1');
    readMemo(b);
    b.end(['u1']);
    b.turn('u2');
    for (let n = 1; n <= 12; n += 1) {
      b.toolUse(`e${n}`, MAWS('artifact_edit'), { artifact: 'q3-memo', edits: [] });
      if (n === 4 || n === 9) b.result(`e${n}`, `artifact_edit: no block "b${n}" in the document\n{"reason":"invalid"}`, { isError: true });
      else b.result(`e${n}`, json({ status: 'edited', revision: 4 + n }));
    }
    b.end(['u2']);
    return b;
  };

  it('are one run whose caption counts them as one part, with the failures marked', () => {
    const [run] = groupsOf(twelve());
    expect(run.cells).toHaveLength(12);
    expect(run.summary).toBe('Edited ‹Q3 memo› 12 times (2 failed)');
    expect(dividersOf(twelve()).at(-1)?.caption).toBe('Edited ‹Q3 memo› 12 times (2 failed)');
  });

  it('opened, each row names the document by its title, and a failed row carries the first line of its error', () => {
    const [run] = groupsOf(twelve());
    expect(run.cells.map((cell) => cell.label)).toEqual(Array.from({ length: 12 }, (_, i) => (i === 3 || i === 8 ? 'Could not edit ‹Q3 memo›' : 'Edited ‹Q3 memo›')));
    expect(run.cells.map((cell) => cell.error ?? null)).toEqual(Array.from({ length: 12 }, (_, i) => (i === 3 ? 'no block "b4" in the document' : i === 8 ? 'no block "b9" in the document' : null)));
    expect(run.cells[3].doneLabel).toBe('Edited ‹Q3 memo›');
    expect(run.cells[0].doneLabel).toBeUndefined();
  });
});

describe('a failed call carries the first line of its error', () => {
  const failed = (name: string, input: Record<string, unknown>, content: string) => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', name, input);
    b.result('t1', content, { isError: true, ...(name === 'Bash' && { structured: BASH_RESULT('') }) });
    b.end(['u1']);
    return cellOf(b, 't1');
  };

  it.each([
    ['a shell call', 'Bash', { command: 'make build' }, 'Exit code 2\nmake: no rule to make target', 'Exit code 2'],
    ['a read, the engine’s refusal tags stripped', 'Read', { file_path: 'src/missing.ts' }, '<tool_use_error>File does not exist.</tool_use_error>', 'File does not exist.'],
    ['an MCP call, blank lines skipped', 'mcp__docs__search', { query: 'tokens' }, '\n\n  rate limited  \ntry again later', 'rate limited'],
    ['a shell call the engine aborted, its tags stripped', 'Bash', { command: 'sleep 60' }, '<error>Command was aborted before completion</error>', 'Command was aborted before completion'],
    ['an artifact call, the host’s own tool name stripped', MAWS('artifact_export'), { artifact: 'q3-memo', format: 'pdf' }, 'artifact_export: the exporter is not available', 'the exporter is not available'],
  ])('%s', (_name, tool, input, content, error) => {
    const cell = failed(tool, input, content);
    expect([cell.status, cell.error]).toEqual(['error', error]);
  });

  it('the pane-opening call keeps its reason in its own words, and carries none beside them', () => {
    const cell = failed(MAWS('show_pane'), { pane: 'tasks' }, 'show_pane: this build of MAWS has no tasks pane');
    expect([cell.label, cell.error]).toEqual(['Could not open pane: this build of MAWS has no tasks pane', undefined]);
  });

  it('a call that did not fail carries none: done, stopped, or refused and standing alone', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Read', { file_path: 'src/app.ts' });
    b.result('t1', 'contents');
    b.toolUse('t2', 'Bash', { command: 'rm -rf build' });
    b.result('t2', 'Permission to use Bash has been denied.', { isError: true, denial: 'permission-rule' });
    b.toolUse('t3', 'Bash', { command: 'sleep 60' });
    b.end(['u1'], { isError: true, result: 'error_during_execution', terminalReason: 'aborted_tools' });
    expect(['t1', 't2', 't3'].map((id) => [cellOf(b, id).status, cellOf(b, id).error])).toEqual([['done', undefined], ['denied', undefined], ['stopped', undefined]]);
  });
});

describe('a stopped call names its short command or its artifact (decision 23, R2, from M3)', () => {
  const stopped = (calls: (b: Builder) => void, id: string) => {
    const b = builder();
    b.turn('u1');
    calls(b);
    b.end(['u1'], { isError: true, result: 'error_during_execution', terminalReason: 'aborted_tools' });
    const cell = cellOf(b, id);
    expect(cell.status).toBe('stopped');
    return cell;
  };

  it('a shell call with no description: `Stopped: ` and the short form, or `Stopped a command` where the rule refuses the line', () => {
    expect(stopped((b) => b.toolUse('t1', 'Bash', { command: 'cd /repo && git log main feature extra' }), 't1').label).toBe('Stopped: `git log main feature…`');
    expect(stopped((b) => b.toolUse('t1', 'Bash', { command: './deploy.sh production' }), 't1').label).toBe('Stopped a command');
    expect(stopped((b) => b.toolUse('t1', 'Bash', { command: './deploy.sh production', description: 'Deploy the site' }), 't1').label).toBe('Stopped: Deploy the site');
  });

  it('an artifact call that names an artifact: its title in its marks; one that names none: the tool’s shown name', () => {
    expect(stopped((b) => { readMemo(b); b.toolUse('t1', MAWS('artifact_edit'), { artifact: 'q3-memo', edits: [] }); }, 't1').label).toBe('Stopped: ‹Q3 memo›');
    expect(stopped((b) => b.toolUse('t1', MAWS('artifact_edit'), { artifact: 'q3-memo', edits: [] }), 't1').label).toBe('Stopped: ‹q3-memo›');
    expect(stopped((b) => b.toolUse('t1', MAWS('artifact_list'), {}), 't1').label).toBe('Stopped: `maws · artifact_list`');
  });

  it('a stopped artifact call’s caption words are its done form', () => {
    expect(stopped((b) => { readMemo(b); b.toolUse('t1', MAWS('artifact_edit'), { artifact: 'q3-memo', edits: [] }); }, 't1').doneLabel).toBe('Edited ‹Q3 memo›');
  });
});
