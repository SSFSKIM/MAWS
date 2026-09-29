// `/resume` (C11 execution document, the widget table and M3 decisions): the other sessions of this session's project
// from C5's sessions store (the project's, or, for a session in no project, its directory's), not archived, the twenty
// most recently updated, each with C5's status glyph, its title as the record has it and its age. Open shows it in its
// tab; Resume starts a session without a process through C10 (there is no resume control on the wire: a resume is a
// launch), and is disabled for a foreign-live session with its holder as the reason.
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { runSessionAction, useSessionActionEnabled } from '../app/session-actions';
import { useNow } from '../app/use-now';
import { GlyphMark } from '../attention/GlyphMark';
import { glyphFor } from '../attention/glyph';
import { sessionAge } from '../sidebar/derive';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { useSessions, type SessionsState } from '../stores/sessions';
import { RESUME, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { Row, Rows, TextButton } from './parts';
import { WidgetFrame } from './WidgetFrame';

const LIMIT = 20;
const foreign = (record: SessionRecord) => record.holder.kind === 'terminal' || record.holder.kind === 'background_job';

// The sessions the widget lists for `self`, newest first.
export function projectSessions(state: Pick<SessionsState, 'records'>, self: AppSessionId): SessionRecord[] {
  const own = state.records.get(self);
  if (!own) return [];
  return [...state.records.values()]
    .filter((r) => r.appId !== self && !r.archived && (own.projectId !== null ? r.projectId === own.projectId : r.directory === own.directory))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, LIMIT);
}

function ResumeRow({ record, close }: { record: SessionRecord; close(): void }) {
  const digest = useSessions((s) => s.digests.get(record.appId) ?? null);
  const live = useSessions((s) => {
    const process = s.engine.get(record.appId)?.process;
    return process !== undefined && process !== 'exited';
  });
  const pending = useAttention((s) => selectPendingOf(s, record.appId));
  const now = useNow();
  const glyph = glyphFor(record, digest, pending);
  const held = foreign(record);
  const resumable = useSessionActionEnabled('resume'); // C10's resume (`session.start { message: null }`)
  return (
    <Row
      main={
        <span className="flex items-baseline gap-2">
          <GlyphMark glyph={glyph} />
          <span data-title className="min-w-0 truncate">
            {record.title.text}
          </span>
        </span>
      }
      note={sessionAge(record, digest, now)}
      actions={
        <>
          <TextButton
            onClick={() => {
              close();
              useLayout.getState().openSession(record.appId);
            }}
          >
            {RESUME.open}
          </TextButton>
          {(held || !live) && (
            <TextButton
              disabled={held || !resumable}
              title={held ? glyph.label : undefined}
              onClick={() => {
                close();
                runSessionAction('resume', record.appId);
              }}
            >
              {RESUME.resume}
            </TextButton>
          )}
        </>
      }
    />
  );
}

export function ResumeWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const records = useSessions((s) => s.records);
  const sessions = projectSessions({ records }, appSessionId);
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.resume} command="resume" foot={WIDGET_FOOT.resume} state="ready" error={null} close={close}>
      {sessions.length === 0 ? (
        <p className="m-0 text-ui-sm text-fg-muted">{RESUME.none}</p>
      ) : (
        <Rows label={RESUME.list}>
          {sessions.map((record) => (
            <ResumeRow key={record.appId} record={record} close={close} />
          ))}
        </Rows>
      )}
    </WidgetFrame>
  );
}
