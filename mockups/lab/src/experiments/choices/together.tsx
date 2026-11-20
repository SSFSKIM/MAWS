// Together: the session's own transcript, in its own order, and its composer, with each part drawn the way a set
// of letters says: the owner's picks so far (A where nothing is picked yet), Layers today (all A), or the builder's
// suggestion. It is laid out as the session is, by Layers' own scroll rule: the column travels over the field, the
// composer stands at the foot of the window, and content thins out before it reaches either bar. Read from its end.
import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { useKick } from '../layers/glass';
import { ClipCtx } from './board';
import { Composer, optsFor } from './composer';
import { LETTERS } from './parts';
import { Agents, answers, Command, Diff, Message, MESSAGE, Run, runs, Thought, users } from './transcript';

export function Together({ letters, which }: { letters: Record<string, string>; which: string }) {
  const kick = useKick();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [band, setBand] = useState<HTMLDivElement | null>(null);
  const [foot, setFoot] = useState<HTMLDivElement | null>(null);
  const [inset, setInset] = useState(150);
  // Content clears the composer by the composer's measured height, as it does under a bar in Layers.
  useLayoutEffect(() => {
    if (!foot) return;
    const read = () => setInset(Math.round(foot.getBoundingClientRect().height) + 16);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(foot);
    return () => ro.disconnect();
  }, [foot]);
  // A live session is read from its end; a new set of letters is a new length.
  useEffect(() => {
    if (!scroller) return;
    const toEnd = () => {
      scroller.scrollTop = scroller.scrollHeight;
      kick(400);
    };
    toEnd();
    const t = [window.setTimeout(toEnd, 80), window.setTimeout(toEnd, 420)];
    void document.fonts?.ready.then(toEnd);
    return () => t.forEach((x) => window.clearTimeout(x));
  }, [scroller, which, inset, kick]);

  const at = (id: string) => Math.max(0, LETTERS.indexOf(letters[id] ?? 'A'));
  const message = MESSAGE[at('message')] ?? 'glass';
  return (
    <>
      <div className="xl-scroll xc-app-scroll" ref={setScroller} tabIndex={-1} onScroll={() => kick(160)} style={{ '--vitrea-bar-inset-bottom': `${inset}px` } as CSSProperties}>
        <ClipCtx.Provider value={band}>
          <div className="xl-column">
            <div className="xl-items" key={which}>
              <Message kind={message} text={users[0]!.text} />
              <Thought n={at('thought')} follow={false} />
              <div className="xl-prose">
                {answers[0]!.paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
              <Diff n={at('diff')} follow={false} />
              <Run run={runs[1]!} />
              <Message kind={message} text={users[1]!.text} />
              <Agents n={at('agents')} follow={false} />
              <div className="xl-prose">
                <p>{answers[1]!.paragraphs[0]}</p>
              </div>
              <Command n={at('command')} follow={false} />
            </div>
          </div>
        </ClipCtx.Provider>
      </div>
      {/* The band in which content is at full strength: a block's glass is cut to it, since the scroller's mask
          reaches the words and not the glass, which is drawn in the window's plane. */}
      <div className="xc-app-band" ref={setBand} style={{ bottom: inset + 20 }} aria-hidden />
      <div className="xc-app-foot" ref={setFoot} key={which}>
        <Composer o={optsFor(letters)} follow={false} />
      </div>
    </>
  );
}
