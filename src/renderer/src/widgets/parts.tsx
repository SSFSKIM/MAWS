// The widgets' shared pieces, in the popover density of mockup 06 vignette 05 (D-20): an uppercase group label, a
// key/value list, a row with a quiet trailing note, a text button, and Reveal in Finder.
import { useState, type ReactNode } from 'react';
import type * as z from 'zod';
import { ipc } from '../ipc/client';
import { REVEAL_REFUSED } from './copy';

export const num = (n: number): string => n.toLocaleString('en-US');

// The entries of a list the wire leaves open that parse as `schema`; an entry that does not is dropped, never guessed.
export const parseEach = <T,>(schema: z.ZodType<T>, items: readonly unknown[]): T[] =>
  items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });

export function Group({ label, count, children }: { label: string; count?: number; children: ReactNode }) {
  return (
    <section aria-label={label} className="mt-3 first:mt-0">
      <h4 className="m-0 mb-1 text-ui-sm font-semibold tracking-wide text-fg-muted uppercase">
        {label}
        {count !== undefined && <span className="ml-1.5 font-normal">{count}</span>}
      </h4>
      {children}
    </section>
  );
}

export function KeyValues({ rows, label }: { rows: readonly { label: string | null; value: ReactNode }[]; label?: string }) {
  return (
    <dl aria-label={label} className="m-0 grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-ui-sm">
      {rows.map((row, i) =>
        row.label === null ? (
          <dd key={i} className="col-span-2 m-0 min-w-0 [overflow-wrap:anywhere]">
            {row.value}
          </dd>
        ) : (
          <div key={i} className="contents">
            <dt className="text-fg-muted">{row.label}</dt>
            <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{row.value}</dd>
          </div>
        ),
      )}
    </dl>
  );
}

// One line of a list: the main text, a quiet note at the right, optional detail under it, optional actions.
export function Row({ main, note, detail, actions }: { main: ReactNode; note?: ReactNode; detail?: ReactNode; actions?: ReactNode }) {
  return (
    <li className="flex flex-col gap-0.5 border-t border-border py-1 text-ui-sm first:border-t-0">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{main}</span>
        {note !== undefined && note !== null && <span className="shrink-0 text-fg-muted">{note}</span>}
        {actions}
      </div>
      {detail !== undefined && detail !== null && <div className="text-fg-muted">{detail}</div>}
    </li>
  );
}

export function Rows({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="m-0 list-none p-0">
      {children}
    </ul>
  );
}

export function TextButton({ children, onClick, disabled, title }: { children: ReactNode; onClick(): void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="shrink-0 rounded-sm px-1 text-ui-sm text-accent outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

export const Mono = ({ children }: { children: ReactNode }) => <code className="font-mono text-ui-sm">{children}</code>;

// Shows a file or folder in Finder through `settings.reveal`, which main admits only under the engine's config home and
// the session's directories (ruled 2026-09-29); a refusal is said beside the button, the path stays on screen to copy.
export function RevealButton({ path, children }: { path: string; children: ReactNode }) {
  const [refused, setRefused] = useState(false);
  const reveal = async () => {
    const result = await ipc.invoke('settings.reveal', { path });
    setRefused(!result.ok || !result.value.revealed);
  };
  return (
    <>
      {refused && <span className="text-fg-faint">{REVEAL_REFUSED}</span>}
      <TextButton onClick={() => void reveal()} title={path}>
        {children}
      </TextButton>
    </>
  );
}
