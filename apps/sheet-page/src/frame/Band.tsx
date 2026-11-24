// The band under the bar (frame 4; F4): the one place the page says it is not connected, calm, a small faint dot
// before its sentence, the sentence in the column. It goes when the connection returns, with no notice of its own.
export function Band({ text }: { text: string }) {
  return (
    <div role="status" data-sheet-band="" className="flex-none border-b border-border bg-bg-hover text-ui text-fg">
      <div className="thread-column flex items-start gap-2 py-2">
        <span aria-hidden="true" className="mt-[7px] size-1.5 flex-none rounded-full bg-fg-faint" />
        <span className="min-w-0">{text}</span>
      </div>
    </div>
  );
}
