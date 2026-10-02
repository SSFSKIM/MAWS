// Trouble, one line each (§5.3): the engine's API retries (updated in place), a reconnect episode (updated in place,
// gone once reconnected), the session process exiting (with the approvals it lost), notices, hooks that got in the way
// (W1), and turn or task errors. The severity sets the mark and colour: transient (still trying), error, notice. A hook
// that blocked the turn's prompt offers Edit prompt: that prompt back into the composer, to change and send again. W13:
// the notice that a newer Claude Code sent what MAWS did not understand opens Settings › Engine.
import { runAction } from '../../../keymap/actions-runtime';
import { useTranscriptStore } from '../../../stores/transcript';
import { SETTINGS_SECTIONS } from '../../../gateway/actions';
import { ENGINE_NOTICE, HOOK } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useTranscriptContext } from '../context';

const MARK = { transient: '↻', error: '✕', notice: 'ⓘ' } as const;

function EditPrompt({ row }: { row: Extract<Row, { kind: 'error' }> }) {
  const { storeKey, actions } = useTranscriptContext();
  const prompt = useTranscriptStore((state) => state.entries[storeKey]?.rows.find((r): r is Extract<Row, { kind: 'user' }> => r.kind === 'user' && r.turnId === row.turnId) ?? null);
  if (prompt === null) return null;
  return (
    <button type="button" className="transcript-error-action" onClick={() => actions.editPrompt(prompt)}>
      {HOOK.editPrompt}
    </button>
  );
}

export function ErrorRow({ row }: { row: Extract<Row, { kind: 'error' }> }) {
  return (
    <div className="transcript-error" data-severity={row.severity} data-scope={row.scope}>
      <span className="transcript-error-mark" aria-hidden="true" data-mark={MARK[row.severity]} />
      <span>{row.text}</span>
      {row.action === 'edit_prompt' && <EditPrompt row={row} />}
      {row.action === 'engine_settings' && (
        <button type="button" className="transcript-error-action" onClick={() => runAction('settings.open', SETTINGS_SECTIONS.indexOf('engine'))}>
          {ENGINE_NOTICE.settings}
        </button>
      )}
    </div>
  );
}
