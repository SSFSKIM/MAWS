// P3-H Send to live run's approval predicate (e2e/support/send-to-approval.ts): the owner allows only the connector's
// upload of, or a Read of, the exact export the Send wrote under the scratch store, by canonical path; and the card
// answered is the one showing that request.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { approvesExport, requestCardSelector } from '../../e2e/support/send-to-approval';

const TOOL = 'mcp__google-drive__send_document';
let scratch: string;
let store: string;
let exported: string;
let other: string;
let cache: string;
let sibling: string;
let outside: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maws-send-to-approval-')));
  store = join(scratch, 'user-data', 'artifacts');
  mkdirSync(join(store, 'a1', 'exports'), { recursive: true });
  // the Send's export is a file of its own (P3 Decision Log 91): its revision, format and the id main minted
  exported = join(store, 'a1', 'exports', '3-pdf-0b0e0c3a-8f3e-4c1d-9b7a-2f6d5e4c3b2a.pdf');
  other = join(store, 'a1', 'exports', '2-pdf.pdf');
  cache = join(store, 'a1', 'exports', '3-pdf.pdf'); // the same revision and format's cache, another export's
  sibling = join(store, 'a1', 'exports', '3-pdf-1c1f1d4b-9a4f-4d2e-8c8b-3a7e6f5d4c3b.pdf'); // another Send's own file
  outside = join(scratch, 'secret.pdf');
  for (const file of [exported, other, cache, sibling, outside]) writeFileSync(file, '%PDF-');
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe('the Send to run’s approvals', () => {
  const approves = (toolName: string, input: unknown, over: { exported?: string; store?: string } = {}) => approvesExport({ toolName, input }, { tool: TOOL, exported, store, ...over });

  it('allows the connector’s upload and a Read of exactly the export, by its canonical path', () => {
    expect(approves(TOOL, { local_path: exported })).toBe(true);
    expect(approves('Read', { file_path: exported })).toBe(true);
    expect(approves('Read', { file_path: join(store, 'a1', 'exports', '..', 'exports', '3-pdf-0b0e0c3a-8f3e-4c1d-9b7a-2f6d5e4c3b2a.pdf') }), 'a non-canonical spelling of the same file').toBe(true);
  });

  it('denies another file, a file outside the store, a symlink to elsewhere, a relative or missing path', () => {
    symlinkSync(outside, join(store, 'a1', 'exports', 'link.pdf'));
    expect(approves(TOOL, { local_path: other })).toBe(false);
    expect(approves(TOOL, { local_path: cache }), 'the same revision and format’s cache file').toBe(false);
    expect(approves('Read', { file_path: sibling }), 'another export’s own file of the same revision and format').toBe(false);
    expect(approves(TOOL, { local_path: outside })).toBe(false);
    expect(approves('Read', { file_path: join(store, 'a1', 'exports', 'link.pdf') })).toBe(false);
    expect(approves(TOOL, { local_path: 'user-data/artifacts/a1/exports/3-pdf.pdf' })).toBe(false);
    expect(approves(TOOL, { local_path: join(store, 'gone.pdf') })).toBe(false);
    expect(approves(TOOL, {})).toBe(false);
    expect(approves(TOOL, null)).toBe(false);
  });

  it('denies the path under the wrong field, and every other tool', () => {
    expect(approves(TOOL, { file_path: exported })).toBe(false);
    expect(approves('Read', { local_path: exported })).toBe(false);
    for (const toolName of ['Bash', 'Write', 'Edit', 'mcp__notion__send_document', 'mcp__google-drive__delete_document']) expect(approves(toolName, { local_path: exported, file_path: exported, command: `cat ${exported}` }), toolName).toBe(false);
  });

  it('denies an export that is not under the store it was told', () => {
    expect(approves(TOOL, { local_path: outside }, { exported: outside })).toBe(false);
  });

  it('names the card of exactly the request it answers', () => {
    expect(requestCardSelector('app-1', 'req-7')).toBe('[data-request-card="app-1:req-7"]');
  });
});
