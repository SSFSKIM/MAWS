// The touch rule (the word cut, Decision Log, "The touch rule"): a fact the cut moved into a tip (a duration, a
// reason, what an agent is doing) is drawn at rest on a screen that cannot point, the desk's phone, since there neither
// pointing nor focus opens the tip, and a tap on the owner activates it rather than revealing. Placed beside the `Tip`
// that carries the fact, wherever the fact reads best (after its owner, or as a line of its own under the row):
//
//   <Tip content={why} description={why}>…owner…</Tip>
//   <TouchFact>{why}</TouchFact>
//
// The stylesheet draws it, under `(hover: none)` alone (`styles/app.css`, outside every layer, so no utility class
// draws it where the pointer can point); nothing here reads a media query. It is hidden from assistive technology
// everywhere: the owner's description already carries the fact. Not drawn when there is no fact. A companion rather than
// an option of `Tip`: the fact's place differs by surface (a grouped agent row's details stand under the line, not
// beside one glyph), and `Tip` stays as it is (Surprises, "A tooltip is the hard part of the shared parts").
export const TOUCH_FACT = 'data-touch-fact';

export function TouchFact({ children, block = false, className = '' }: { children: string | null | undefined; block?: boolean; className?: string }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <span {...{ [TOUCH_FACT]: block ? 'block' : '' }} aria-hidden="true" className={['text-fg-muted', block && 'whitespace-pre-line', className].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
}
