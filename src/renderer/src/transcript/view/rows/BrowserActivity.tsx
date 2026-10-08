// E13 (the in-app browser spec of 2026-10-08, "Action rows"; M3 fix wave): what an agent did in the in-app browser
// through cua_repl, one persistent row per activity in the browser action row's visual language (the browser glyph and
// one compact line): under the `js` call it happened in, or standalone. Transcript.tsx places the rows; page text (a
// label, an excerpt, an address) is rendered as plain text.
import type { BrowserActivity } from '@shared/browser/activity';
import type { AppSessionId } from '@shared/graph/ids';
import { useTranscriptStore } from '../../../stores/transcript';
import { useBrowserActivity } from '../../../tools/browser/agent/activity';
import { attachmentOf, type BrowserActivityAttachment } from '../../model/browser-activity';
import { browserActivityLine } from '../../model/copy';
import type { Row } from '../../model/rows';
import { BrowserIcon } from './icons';

// The attachment of the session's activity to the `js` calls of the transcript under `storeKey`: the same object
// while nothing in it changed (attachmentOf keeps it so), and the empty one for a session with no activity, so an event
// batch that changed nothing here re-renders nothing.
export function useBrowserActivityAttachment(storeKey: string, appSessionId: AppSessionId | null): BrowserActivityAttachment {
  const activities = useBrowserActivity(appSessionId);
  return useTranscriptStore((store) => attachmentOf(store.entries[storeKey]?.state ?? null, appSessionId, activities));
}

function ActivityLine({ activity }: { activity: BrowserActivity }) {
  return (
    <div className="transcript-browser-action-line" data-browser-activity={activity.kind}>
      <BrowserIcon />
      <span className="transcript-browser-action-heading">{browserActivityLine(activity)}</span>
    </div>
  );
}

// One activity's row: under its `js` call (`data-tool-use`), or standalone.
export function BrowserActivityRow({ row }: { row: Extract<Row, { kind: 'browser_activity' }> }) {
  return (
    <section className="transcript-browser-action" data-browser-activity-row="" data-tool-use={row.toolUseId ?? undefined}>
      <ActivityLine activity={row.activity} />
    </section>
  );
}
