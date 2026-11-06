// The channel's composer (P5 O8 M7a, "People's words, sent"): a plain text field at the stream's foot, in the composer's
// frame. Enter sends and Shift+Enter keeps the newline. A leading `@alias` addresses that session, and untagged words go to
// everyone: main reads the tags (channel/address.ts) and signs the word, so a refusal of its own (an alias nobody answers
// to, one naming two sessions) comes straight back, said under the field, with the text kept to mend. A sent word
// clears the field only if it still holds what was sent: an edit made while the send was out is kept.
import { useState, type KeyboardEvent } from 'react';
import type { CommandResult } from '@shared/ipc/schema';
import { CHANNEL_TEXT_MAX } from '@shared/ipc/schema/org';
import { CHANNEL } from './copy';

export function Composer({ send }: { send(text: string): Promise<CommandResult<'org.channel.send'>> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const ready = !busy && text.trim() !== '';
  const submit = async () => {
    if (!ready) return;
    const submitted = text;
    setBusy(true);
    setRefusal(null);
    const result = await send(submitted);
    setBusy(false);
    if (!result.ok) return setRefusal(`${CHANNEL.sendFailed} · ${result.error.message}`);
    if (!result.value.ok) return setRefusal(CHANNEL.sendRefused(result.value));
    setText((now) => (now === submitted ? '' : now)); // what was typed while it went out stays
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  };
  return (
    <div data-channel-composer className="flex flex-col gap-1.5">
      {refusal !== null && (
        <p role="alert" className="m-0 px-1 text-ui-sm break-words text-danger">
          {refusal}
        </p>
      )}
      <div className="flex items-end gap-2 rounded-2xl bg-bg-raised px-3 py-2 shadow-composer">
        <textarea
          aria-label={CHANNEL.composer.label}
          placeholder={CHANNEL.composer.placeholder}
          rows={1}
          maxLength={CHANNEL_TEXT_MAX}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setRefusal(null);
          }}
          onKeyDown={onKeyDown}
          className="max-h-40 min-h-7 min-w-0 flex-1 resize-none bg-transparent py-1 text-prose leading-[var(--lh-prose)] text-fg outline-none field-sizing-content placeholder:text-fg-faint"
        />
        <button
          type="button"
          disabled={!ready}
          onClick={() => void submit()}
          className="h-7 shrink-0 rounded-full bg-fg px-3 text-ui-sm text-bg outline-accent hover:bg-fg-muted focus-visible:outline-2 disabled:bg-fg-faint"
        >
          {busy ? CHANNEL.composer.sending : CHANNEL.composer.send}
        </button>
      </div>
    </div>
  );
}
