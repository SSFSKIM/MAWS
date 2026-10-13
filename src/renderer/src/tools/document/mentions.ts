// Who and what a document can mention (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; Decision Log 22, 25):
// the editor's Insert › Mention picker searches the owner, the sessions by title, and the artifacts through L's library
// reads (`library.list` with the query, main's index of titles and text), the document itself left out. A library that
// cannot answer leaves the people and the sessions.
import type { MentionSource, MentionTarget } from '@artifacts/document/editor/MentionPicker';
import type { MawsBridge } from '@shared/ipc/schema';
import { KIND_LABELS } from '../../library/copy';

const SESSIONS_MAX = 5;
const ARTIFACTS_MAX = 8;

export interface DocumentMentionDeps {
  artifactId: string; // the document mentioning (never offered)
  ipc: Pick<MawsBridge, 'invoke'>;
  /** The sessions, most recent first, by their shown titles. */
  sessions(): Array<{ appSessionId: string; title: string }>;
  owner(): { ref: string; name: string };
  log(line: string): void;
}

export function documentMentions({ artifactId, ipc, sessions, owner, log }: DocumentMentionDeps): MentionSource {
  return {
    async search(query) {
      const q = query.trim();
      const matches = (label: string) => label.toLowerCase().includes(q.toLowerCase());
      const me = owner();
      const people: MentionTarget[] = matches(me.name) ? [{ kind: 'person', ref: me.ref, label: me.name }] : [];
      const shown: MentionTarget[] = sessions()
        .filter((session) => matches(session.title))
        .slice(0, SESSIONS_MAX)
        .map((session) => ({ kind: 'session', ref: session.appSessionId, label: session.title, detail: 'Session' }));
      let artifacts: MentionTarget[] = [];
      try {
        const result = await ipc.invoke('library.list', { filter: q ? { query: q } : {} });
        if (!result.ok) throw new Error(result.error.message);
        artifacts = result.value.rows
          .filter((row) => row.id !== artifactId)
          .slice(0, ARTIFACTS_MAX)
          .map((row) => ({ kind: 'artifact', ref: row.id, label: row.title, detail: KIND_LABELS[row.kind] }));
      } catch (error) {
        log(`mentions: the library could not be searched: ${error instanceof Error ? error.message : String(error)}`);
      }
      return [...people, ...shown, ...artifacts];
    },
  };
}
