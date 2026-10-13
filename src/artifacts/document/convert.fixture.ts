// Shared by the import and export suites (M6 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the every-kind
// fixture as an export source with two tabs and threads, and the comparison every round trip uses: the stored JSON
// with block ids aside (an import mints its own) and comment marks aside (a thread lives in the document's `threads`,
// which a file does not carry back).
import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import type { ExportSource } from './export/source';
import { everyKindJSON } from './fixtures';
import { schemaFor } from './schema';
import type { Thread } from './threads';

export const HUMAN: Actor = { kind: 'human' };
export const AGENT: Actor = { kind: 'session', appSessionId: 'app-session-1' as AppSessionId };

/** The node's JSON without block ids and comment marks, normalised through the schema (defaults filled in). */
export function comparable(node: PMNode | JSONContent): unknown {
  const json = 'toJSON' in node && typeof node.toJSON === 'function' ? (node.toJSON() as JSONContent) : (node as JSONContent);
  return schemaFor().nodeFromJSON(strip(json)).toJSON();
}
function strip(json: JSONContent): JSONContent {
  const out: JSONContent = { ...json };
  if (out.attrs && 'id' in out.attrs) {
    const attrs = { ...out.attrs };
    delete attrs.id;
    out.attrs = attrs;
  }
  if (out.marks) {
    const marks = out.marks.filter((mark) => mark.type !== 'comment');
    if (marks.length) out.marks = marks;
    else delete out.marks;
  }
  if (out.content) out.content = out.content.map(strip);
  return out;
}

const thread = (id: string, quote: string, status: Thread['status'], messages: Array<[Actor, string]>): Thread => ({
  id,
  tabId: 'tab-1',
  blockId: 'p2',
  quote,
  anchor: null,
  status,
  createdBy: messages[0][0],
  createdAt: Date.UTC(2026, 9, 12, 16, 0),
  resolvedBy: status === 'resolved' ? HUMAN : null,
  resolvedAt: status === 'resolved' ? Date.UTC(2026, 9, 12, 18, 0) : null,
  reopenedBy: null,
  reopenedAt: null,
  messages: messages.map(([by, body], i) => ({ id: `${id}:m${i}`, by, at: Date.UTC(2026, 9, 12, 16, i), body })),
});

/** The every-kind fixture as the first tab, a short Korean second tab, and the fixture's three threads. */
export function everyKindSource(): ExportSource {
  const schema = schemaFor();
  const second = schema.nodeFromJSON({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { id: 's1', level: 2 }, content: [{ type: 'text', text: '회의 메모' }] },
      { type: 'paragraph', attrs: { id: 's2' }, content: [{ type: 'text', text: '안녕하세요, 팀 여러분. The notes continue here.' }] },
    ],
  });
  return {
    title: 'Every kind',
    tabs: [
      { id: 'tab-1', title: 'Overview', body: schema.nodeFromJSON(everyKindJSON()) },
      { id: 'tab-2', title: 'Notes', body: second },
    ],
    threads: [
      thread('t1', 'ships quarterly with design review', 'open', [
        [HUMAN, 'Is quarterly right?'],
        [AGENT, 'Quarterly matches the release train.'],
      ]),
      thread('t2', 'design review notes', 'resolved', [[AGENT, 'Linked the review notes.']]),
      thread('t3', 'console.log(x)', 'open', [[HUMAN, 'Drop the log before shipping.']]),
      thread('t9', 'a passage that is gone', 'open', [[HUMAN, 'An orphaned thread.']]),
    ],
    overrides: {},
  };
}
