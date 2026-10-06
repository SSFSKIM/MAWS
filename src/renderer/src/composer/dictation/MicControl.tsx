// The composer toolbar's microphone (E9 execution document, Design §8, G1): the primary way to dictate (the owner's
// ruling, 2026-10-06). A click toggles this session's capture: idle starts one for this session (whichever pane is
// focused), a second click while asking for permission cancels and while listening stops so the final lands, and a
// click while finishing waits for that final. No press-and-hold: a hold and a click on one control fight each other, and
// a chord bound to `composer.dictate` carries the hold. Beside it, the capture's state while one of this session runs,
// and this session's notice with, for a denial, the button that opens the System Settings pane granting it. The button
// keeps focus where it is (dictation writes at the editor's caret) and sits outside the editor's key sink, so it never
// takes typing.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { VoicePrivacyPane } from '@shared/ipc/schema/voice';
import { Icon, useChordHint } from '../../app/IconButton';
import { ipc } from '../../ipc/client';
import { mountedDictation } from './controller';
import { micTitle } from './copy';
import { dismissDictationNotice, useDictationStore, type DictationNoticeKind, type DictationPhase } from './store';

const STATUS: Record<DictationPhase, string> = { requesting: 'Asking for permission…', listening: 'Listening…', finishing: 'Finishing…' };
const PANE: Partial<Record<DictationNoticeKind, VoicePrivacyPane>> = { microphone_denied: 'microphone', speech_denied: 'speech' };

const MicIcon = () => (
  <Icon>
    <rect x="6" y="2" width="4" height="7.5" rx="2" />
    <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" />
    <path d="M8 12v2" />
  </Icon>
);

export function MicControl({ appSessionId, client = ipc }: { appSessionId: AppSessionId; client?: MawsBridge }) {
  const phase = useDictationStore((s) => (s.capture?.appSessionId === appSessionId ? s.capture.phase : null));
  const chord = useChordHint('composer.dictate');

  // The phase is read from the store at the click, not from the render, so the toggle acts on the capture as it is now.
  const toggle = () => {
    const capture = useDictationStore.getState().capture;
    const own = capture?.appSessionId === appSessionId ? capture.phase : null;
    if (own === null) mountedDictation()?.press(appSessionId); // ignored by the controller while another session's capture runs
    else if (own !== 'finishing') mountedDictation()?.release('keyup');
  };
  return (
    <>
      <button
        type="button"
        aria-label="Dictate"
        aria-pressed={phase !== null}
        title={micTitle(chord)}
        className={`inline-flex size-7 shrink-0 items-center justify-center rounded-sm outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 aria-pressed:bg-bg-active ${phase ? 'text-accent' : 'text-fg-muted'}`}
        onMouseDown={(event) => event.preventDefault()} // focus stays in the editor, whose caret the words go to
        onClick={toggle}
      >
        <MicIcon />
      </button>
      {phase && (
        <span role="status" aria-label="Dictation" className="flex shrink-0 items-center gap-1 px-1 text-ui-sm text-fg-muted">
          {phase === 'listening' && <span aria-hidden className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" />}
          {STATUS[phase]}
        </span>
      )}
      <DictationNotice appSessionId={appSessionId} client={client} />
    </>
  );
}

// This session's dictation notice: in the toolbar's row, or in the composer's dock while a card covers the box (and the
// toolbar with it).
export function DictationNotice({ appSessionId, client = ipc }: { appSessionId: AppSessionId; client?: MawsBridge }) {
  const notice = useDictationStore((s) => (s.notice?.appSessionId === appSessionId ? s.notice : null));
  if (notice === null) return null;
  const pane = PANE[notice.kind];
  return (
    <p role="note" aria-label="Dictation notice" className="m-0 flex min-w-0 items-center gap-1 px-1 text-ui-sm text-fg-muted">
      <span className="min-w-0 truncate" title={notice.message}>
        {notice.message}
      </span>
      {pane && (
        <button
          type="button"
          className="shrink-0 rounded-sm px-1 text-accent outline-accent hover:bg-bg-hover focus-visible:outline-2"
          onClick={() =>
            void client.invoke('voice.openPrivacySettings', { pane }).then((result) => {
              if (!result.ok) console.warn('[dictation] voice.openPrivacySettings failed', result.error);
            })
          }
        >
          Open System Settings
        </button>
      )}
      <button type="button" aria-label="Dismiss" className="shrink-0 rounded-sm px-1 text-fg-faint outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2" onClick={() => dismissDictationNotice(appSessionId)}>
        ×
      </button>
    </p>
  );
}
