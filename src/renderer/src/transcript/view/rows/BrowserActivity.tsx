// E13 (the in-app browser spec of 2026-10-08, "Action rows"): what an agent did in the in-app browser through cua_repl,
// in the browser action row's visual language (the browser glyph and one compact line). Under a `js` call's line, the
// activities attached to it, live as main reports them; an activity with no call to stand under is a row of its own,
// which the transcript places at its time. Page text (a label, an excerpt, an address) is rendered as plain text.
import type { BrowserActivity } from '@shared/browser/activity';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import { useTranscriptStore } from '../../../stores/transcript';
import { useBrowserActivity } from '../../../tools/browser/agent/activity';
import { attachmentOf, type BrowserActivityAttachment, type BrowserActivityEntry } from '../../model/browser-activity';
import { browserActivityLine } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useRowSession, useTranscriptContext } from '../context';
import { BrowserIcon } from './icons';

// A part of the attachment of the session's activity to the `js` calls of the transcript under `storeKey`. The pick
// must return the same array while it is unchanged (attachmentOf keeps it so), and a session with no activity reads
// the empty attachment: an event batch that changed nothing here re-renders nothing.
function useAttachment<T>(storeKey: string, appSessionId: AppSessionId | null, pick: (attachment: BrowserActivityAttachment) => T): T {
  const activities = useBrowserActivity(appSessionId);
  return useTranscriptStore((store) => pick(attachmentOf(store.entries[storeKey]?.state ?? null, appSessionId, activities)));
}

const NONE: readonly BrowserActivityEntry[] = [];
// The session's activities with no `js` call to stand under (Transcript.tsx places them by time).
export const useStandaloneBrowserActivity = (storeKey: string, appSessionId: AppSessionId | null) => useAttachment(storeKey, appSessionId, (attachment) => attachment.standalone);

function ActivityLine({ activity }: { activity: BrowserActivity }) {
  return (
    <div className="transcript-browser-action-line" data-browser-activity={activity.kind}>
      <BrowserIcon />
      <span className="transcript-browser-action-heading">{browserActivityLine(activity)}</span>
    </div>
  );
}

// Under a cua_repl `js` call's line: what the agent did in the browser while it ran (nothing when it did nothing).
export function BrowserActivityLines({ toolUseId }: { toolUseId: ToolUseId }) {
  const { storeKey } = useTranscriptContext();
  const attached = useAttachment(storeKey, useRowSession(), (attachment) => attachment.byCall.get(toolUseId) ?? NONE);
  if (attached.length === 0) return null;
  return (
    <div className="transcript-browser-activity-lines" data-browser-activity-lines="">
      {attached.map((entry) => (
        <ActivityLine key={entry.seq} activity={entry.activity} />
      ))}
    </div>
  );
}

export function BrowserActivityRow({ row }: { row: Extract<Row, { kind: 'browser_activity' }> }) {
  return (
    <section className="transcript-browser-action" data-browser-activity-row="">
      <ActivityLine activity={row.activity} />
    </section>
  );
}
