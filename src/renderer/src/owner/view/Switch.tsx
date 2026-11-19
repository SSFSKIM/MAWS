// The to-human view's switch where MAWS draws the view (UX wave U2b; the execution document, A14, decision 16, §D and
// M2): the mod's band line (`AbovePrompt`, `to-human/hooks/mods/to-human.tsx` 1941 to 1971, read at 0.8.2), one line
// above the composer, `to-human view · full transcript ›` in the report and `to-human view · report only ›` in the full
// transcript; a press switches the tab's view (`ui.view`). It stands in the frame the mods' band draws
// (`composer/frame/PluginSites.tsx`, card 6), mounted after the band in the composer and above the holder notice where
// that stands in the composer's place (a terminal session nobody drives). Drawn only while MAWS draws a view in force,
// which is while the mirror would apply in the report (`mirrorsView` but for the tab's choice); absent, not disabled,
// everywhere else: no lane, no message yet, the mod drawing. A subagent's transcript mounts no composer, so it has none.
//
// Ruling 3 of 2026-11-15, as its items (iv) and (v) place it: no empty row stands above the line inside its frame (the
// band's `marginTop`), and the caption and the button are one text size (`.owner-view-switch` in `view.css`).
import type { AppSessionId } from '@shared/graph/ids';
import { focusedSession } from '../../composer/ComposerAppKeys';
import type { TranscriptUi } from '../../transcript/model/reduce';
import { useTranscriptStore } from '../../stores/transcript';
import { toast } from '../../stores/notices'; // M5
import { MOD_DRAWS_NOTICE, SWITCH } from './copy';
import { reportViewOf } from './mirror';
import './view.css';

// The band's frame, as `PluginBand` draws it around a mod's answer (tokens only).
const FRAME = 'flex min-w-0 flex-col rounded-lg border border-border bg-bg-raised px-3 py-2 text-ui text-fg';

/** Whether MAWS draws the session's to-human view in force: the lane on, a message held, and no mod drawing it. */
const drawsInForce = (ui: Pick<TranscriptUi, 'ownerLane' | 'noTurnFold' | 'modDraws'> | undefined): boolean =>
  ui?.ownerLane === true && ui.noTurnFold === true && ui.modDraws !== true;

export function ViewSwitch({ appSessionId }: { appSessionId: AppSessionId }) {
  const key = appSessionId; // the session transcript's store key (`ipcSource`, the plane transcript's alike)
  const shown = useTranscriptStore((s) => {
    const ui = s.entries[key]?.state?.ui;
    return drawsInForce(ui) ? (reportViewOf(ui) ? 'report' : 'transcript') : null;
  });
  if (shown === null) return null;
  return (
    <section data-view-switch="" className={FRAME}>
      <div className="owner-view-switch">
        <span>{SWITCH.caption}</span>
        <button type="button" onClick={() => useTranscriptStore.getState().setView(key, shown === 'report' ? 'transcript' : 'report')}>
          {shown === 'report' ? SWITCH.toTranscript : SWITCH.toReport}
        </button>
      </div>
    </section>
  );
}

/**
 * `transcript.toggleReport`: the focused pane's session tab between its report and its full transcript, while its lane is
 * on. In a session the mod draws (M5; decision 20, R9) it changes nothing and says why in a notice.
 */
export function toggleView(): void {
  const appSessionId = focusedSession();
  if (appSessionId === null) return;
  const ui = useTranscriptStore.getState().entries[appSessionId]?.state.ui;
  if (ui?.modDraws === true) toast({ id: 'to-human-mod-draws', level: 'info', text: MOD_DRAWS_NOTICE, actions: [], dismissible: true });
  else if (ui?.ownerLane) useTranscriptStore.getState().setView(appSessionId, reportViewOf(ui) ? 'transcript' : 'report');
}
