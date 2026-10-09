// What a submitted draft does (C7 execution document, "Document model and serialisation", "History", "`!` and `#`"): a
// prompt goes through `session.send`, or into the running turn through `session.steer` with priority `next` (W10: Send
// while a turn runs; the priority is always explicit because the command's default interrupts); a `!` command through
// `session.bash`; a `#` note through `session.memoryAppend`. Every submission runs the same three steps, one copy each:
// the pre-check (nothing empty, nothing over C3's send bounds is written), a dispatch (the mode's own, above, chosen by
// the Composer's submit state, unless the caller supplies one: an unstarted session's start, M4), and the steps after
// the host accepted (the unavailable-segments notice and the history append).
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { DEFAULT_MEMORY_TARGET, type MemoryTarget } from '../../stores/composer';
import { toast, useNotices } from '../../stores/notices';
import { runBash } from '../modes/bash';
import { appendMemory } from '../modes/memory';
import { dispatchHumanPrompt, sendHumanPrompt } from '../submit/send-human-prompt';
import { sendSizeRefusal } from './attachments';
import type { Serialized } from './serialize';

// A dispatch answers null when the host accepted the submission, else the error to show.
export type Dispatch = () => Promise<string | null>;

export interface SubmitOptions {
  dispatch?: Dispatch; // replaces the mode's own dispatch
  project?: string | null; // an unstarted session's intended directory, for the history row (main uses it only without a record)
  retry?: () => void; // offered on the refusal's toast
}

const warn = (text: string, retry?: () => void) => {
  const id = toast({ level: 'warning', text, actions: retry ? [{ label: 'Retry', run: () => (useNotices.getState().dismiss(id), retry()) }] : [], dismissible: true });
};

// The pre-check: whether the submission may go (a refusal is shown).
export function precheck(s: Serialized): boolean {
  if (s.empty) return false;
  const tooLarge = s.mode === 'send' ? sendSizeRefusal(s.content) : null;
  if (tooLarge) warn(tooLarge);
  return tooLarge === null;
}

// The mode's own dispatch: bash, memory, or a prompt sent (or steered with priority 'next').
export async function dispatchByMode(client: MawsBridge, appSessionId: AppSessionId, s: Serialized, how: 'send' | 'steer', target: MemoryTarget | null): Promise<string | null> {
  if (s.mode === 'bash') {
    const ran = await runBash(client, appSessionId, s.text);
    return ran.ok ? null : ran.error;
  }
  if (s.mode === 'memory') {
    const saved = await appendMemory(client, appSessionId, s.text, target ?? DEFAULT_MEMORY_TARGET);
    if (!saved.ok) return saved.error;
    toast({ level: 'info', text: `Saved to ${saved.path}`, actions: [], dismissible: true });
    return null;
  }
  const result = await dispatchHumanPrompt(client, appSessionId, s.content, how);
  return result.ok ? null : result.error.message;
}

// After the host accepted: what was left out is said, and the prompt goes into MAWS's history.
export function afterAccepted(client: MawsBridge, appSessionId: AppSessionId, s: Serialized, project: string | null = null): void {
  if (s.omitted > 0) warn(s.omitted === 1 ? '1 pasted segment was unavailable and was left out' : `${s.omitted} pasted segments were unavailable and were left out`);
  const input = { appSessionId, display: s.display, pastedContents: s.pastedContents, ...(project === null ? {} : { project }) };
  void client.invoke('session.history.append', input).then((result) => {
    if (!result.ok) console.warn('[composer] session.history.append failed', result.error);
  });
}

// P2-0: the live/released composer's human prompt goes through X22, with its existing pre-check, history and Retry
// notice. State refusals keep the text quietly, as before; C10's released resume already says why it declined.
export async function submitHumanSerialized(client: MawsBridge, appSessionId: AppSessionId, s: Serialized, retry?: () => void): Promise<boolean> {
  if (!precheck(s)) return false;
  try {
    const result = await sendHumanPrompt(appSessionId, s.content, { origin: 'composer', display: s.display }, client);
    if (result.disposition === 'refused') return false;
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error), retry);
    return false;
  }
  afterAccepted(client, appSessionId, s);
  return true;
}

// Whether the host accepted it (the editor then clears and the draft goes); on false the text stays where it was.
export async function submitSerialized(client: MawsBridge, appSessionId: AppSessionId, s: Serialized, how: 'send' | 'steer', target: MemoryTarget | null, options: SubmitOptions = {}): Promise<boolean> {
  if (!precheck(s)) return false;
  const error = await (options.dispatch ?? (() => dispatchByMode(client, appSessionId, s, how, target)))();
  if (error !== null) {
    warn(error, options.retry);
    return false;
  }
  afterAccepted(client, appSessionId, s, options.project ?? null);
  return true;
}
