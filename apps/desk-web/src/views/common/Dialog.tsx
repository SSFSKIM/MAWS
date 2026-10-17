// A modal panel over the desk (the key, the machines): a title, a close button, Escape to close. Built functional with
// MAWS's tokens; the controls below are the desk's few shared ones.
import { useEffect, type ReactNode } from 'react';

export const buttonPrimary = 'rounded-md bg-primary px-3 py-1.5 text-ui font-medium text-primary-foreground hover:opacity-90 disabled:cursor-default disabled:opacity-50';
export const buttonSecondary = 'rounded-md border border-border-strong bg-bg-raised px-3 py-1.5 text-ui text-fg hover:bg-bg-hover disabled:cursor-default disabled:opacity-50';
/** The button that carries out a destructive step the owner confirmed. */
export const buttonDanger = 'rounded-md border border-danger bg-bg-raised px-3 py-1.5 text-ui font-medium text-danger hover:bg-bg-hover disabled:cursor-default disabled:opacity-50';
export const buttonQuiet ='rounded-sm px-1 text-ui-sm text-fg-muted underline-offset-2 hover:text-fg hover:underline';
export const textInput = 'w-full rounded-md border border-border-strong bg-bg px-2.5 py-1.5 text-ui text-fg outline-none focus:border-accent';

export function Dialog(props: { title: string; onClose: () => void; children: ReactNode }) {
  const { title, onClose, children } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-fg/20 p-6 pt-[12vh]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-[520px] rounded-lg border border-border-strong bg-bg-overlay text-fg shadow-lg">
        <header className="flex items-center border-b border-border px-4 py-2.5">
          <h2 className="m-0 text-ui font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="ml-auto rounded-sm px-1.5 text-ui text-fg-muted hover:bg-bg-hover" aria-label="Close">
            ×
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
