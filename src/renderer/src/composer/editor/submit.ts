// What a submitted draft does (C7 execution document, "Document model and serialisation", "History", "`!` and `#`"): a
// prompt goes through `session.send`, or into the running turn through `session.steer` with priority `next` (⌥Enter's
// Steer; the priority is always explicit because the command's default interrupts); a `!` command through
// `session.bash`; a `#` note through `session.memoryAppend`. After each that the host accepts, the display and its
// pasted bodies are appended to MAWS's history. A message over C3's content cap is refused before anything is written,
// and a send that left unavailable pasted segments out says so. Which of Send, Queue or Steer the control offers, and
// when, is the submit control's (M4); this is the dispatch every one of them ends in.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { DEFAULT_MEMORY_TARGET, type MemoryTarget } from '../../stores/composer';
import { toast } from '../../stores/notices';
import { runBash } from '../modes/bash';
import { appendMemory } from '../modes/memory';
import { sendSizeRefusal } from './attachments';
import type { Serialized } from './serialize';

const warn = (text: string) => void toast({ level: 'warning', text, actions: [], dismissible: true });

async function dispatch(client: MawsBridge, appSessionId: AppSessionId, s: Serialized, how: 'send' | 'steer', target: MemoryTarget | null): Promise<string | null> {
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
  const result =
    how === 'steer'
      ? await client.invoke('session.steer', { appSessionId, content: s.content, priority: 'next' })
      : await client.invoke('session.send', { appSessionId, content: s.content });
  return result.ok ? null : result.error.message;
}

// Whether the host accepted it (the editor then clears and the draft goes); on false the text stays where it was.
export async function submitSerialized(client: MawsBridge, appSessionId: AppSessionId, s: Serialized, how: 'send' | 'steer', target: MemoryTarget | null): Promise<boolean> {
  if (s.empty) return false;
  const tooLarge = s.mode === 'send' ? sendSizeRefusal(s.content) : null;
  if (tooLarge) {
    warn(tooLarge);
    return false;
  }
  const error = await dispatch(client, appSessionId, s, how, target);
  if (error !== null) {
    warn(error);
    return false;
  }
  if (s.omitted > 0) warn(s.omitted === 1 ? '1 pasted segment was unavailable and was left out' : `${s.omitted} pasted segments were unavailable and were left out`);
  void client.invoke('session.history.append', { appSessionId, display: s.display, pastedContents: s.pastedContents }).then((result) => {
    if (!result.ok) console.warn('[composer] session.history.append failed', result.error);
  });
  return true;
}
