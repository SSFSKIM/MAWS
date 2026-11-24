// The pairing screen ("The look", frame 1; F1, F5, F7): no bar, one box in the middle of the ground. It names the
// command alone and takes the code it prints, typed: eight characters, written upper case, the dash shown by the field
// itself. "Pair" is active once eight characters stand. A refusal is one line under the field; the code stays in it.
// The address is left as the browser asked for it, so pairing lands on that place.
import { useState, type FormEvent } from 'react';
import type { PairAnswer } from '../api';
import { PAIRING } from '../copy';

const CODE_LENGTH = 8;

// What the person typed, as the field holds it: letters and digits only, upper case, at most eight
export const codeOf = (typed: string): string =>
  typed
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, CODE_LENGTH);

// The field's text: the dash after the fourth character, once there is a fifth
export const shownCode = (code: string): string => (code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

export function refusalOf(answer: Exclude<PairAnswer, { ok: true }>): string {
  switch (answer.why) {
    case 'wrong':
      return answer.left > 0 ? PAIRING.wrong(answer.left) : PAIRING.tooMany;
    case 'expired':
    case 'none': // no code is live: it was used, voided by a later one or by too many tries, or mawsd restarted
      return PAIRING.expired;
    case 'busy':
      return PAIRING.busy;
    case 'not-saved':
      return PAIRING.notSaved;
    case 'failed':
      return PAIRING.failed;
  }
}

export interface PairingScreenProps {
  notPaired: boolean; // the browser was paired and is not now: unpaired, or refused
  pair(code: string): Promise<PairAnswer>;
  onPaired(pairing: { id: string; credential: string }): void;
}

export function PairingScreen({ notPaired, pair, onPaired }: PairingScreenProps) {
  const [code, setCode] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH || pending) return;
    setPending(true);
    const answer = await pair(shownCode(code));
    setPending(false);
    if (answer.ok) return onPaired({ id: answer.id, credential: answer.credential });
    setRefusal(refusalOf(answer));
  };

  return (
    // the window is no scroller (the app's base styles), so the screen scrolls itself where the window is short
    <main className="h-full overflow-auto bg-bg text-ui text-fg">
      <div className="flex min-h-full flex-col items-center justify-center gap-3.5 p-6">
        <form onSubmit={submit} className="flex w-full max-w-[420px] flex-col gap-4 rounded-lg border border-border bg-bg-raised p-6" aria-labelledby="pair-heading">
          {notPaired && <p className="-mb-2 text-ui-sm text-fg-muted">{PAIRING.notPaired}</p>}
          <h1 id="pair-heading" className="text-[17px] leading-[1.3] font-semibold">
            {PAIRING.heading}
          </h1>
          <p className="-mt-2 text-fg-muted">{PAIRING.what}</p>
          <div className="flex flex-col gap-1.5">
            <span>{PAIRING.run}</span>
            <code className="rounded-sm border border-border bg-bg px-2.5 py-[7px] font-mono text-ui select-all">{PAIRING.command}</code>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pair-code">{PAIRING.type}</label>
            <input
              id="pair-code"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              maxLength={CODE_LENGTH + 1}
              placeholder={PAIRING.placeholder}
              aria-invalid={refusal !== null}
              aria-describedby={refusal !== null ? 'pair-refusal' : undefined}
              value={shownCode(code)}
              onChange={(event) => {
                setCode(codeOf(event.target.value));
                setRefusal(null);
              }}
              className="h-12 w-full rounded-sm border border-border-strong bg-bg px-3 font-mono text-[22px] tracking-[0.14em] text-fg outline-accent placeholder:text-fg-faint focus:outline-2 focus:-outline-offset-1"
            />
            {refusal !== null && (
              <p id="pair-refusal" role="alert" className="text-danger">
                {refusal}
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={code.length !== CODE_LENGTH || pending}
            className="flex h-8 items-center justify-center rounded-sm bg-accent font-medium text-bg outline-accent hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:bg-bg-hover disabled:text-fg-faint disabled:hover:opacity-100"
          >
            {PAIRING.pair}
          </button>
        </form>
        <p className="max-w-[420px] text-center text-ui-sm text-fg-muted">{PAIRING.note}</p>
      </div>
    </main>
  );
}
