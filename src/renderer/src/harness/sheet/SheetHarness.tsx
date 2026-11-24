// The question sheet's harness page (`#sheet`; the C3 plan's M3): the sheet's components over the pinned set, as a
// consumer draws them, over a host that records what it is sent. `?fixture=<case>&side=before|after` draws that side of
// a fixture directory as a session's sheet in the side column's 380 px, its captured files served from the pin; below
// it, each card state of frame 2 from the pin and a memory, the sheet at the column's narrowest and in place in an
// Overview card, the notes, and the overview of every record. Nothing here reaches a machine: a Send is recorded, and
// the model stays as the fixture left it.
import { useState, type ReactNode } from 'react';
import 'streamdown/styles.css';
import '../../transcript/view/transcript.css';
import type { SheetModel } from '@shared/sheet/model';
import { summaryOf } from '@shared/sheet/read';
import { EMPTY_MEMORY, SessionSheet, SheetOverview, SHEET_WORDS, type SheetMemory } from '../../sheet';
import { fixtureHost, queuedResult } from '../../sheet/test-support/fixture-host';
import { PIN_CASES, pinBody, pinModel, type PinSide } from '../../sheet/test-support/pin';

const params = new URLSearchParams(location.search);
const FIXTURE = params.get('fixture') ?? 'references';
const SIDE: PinSide = params.get('side') === 'after' ? 'after' : 'before';

type Recorded = { act: string; detail: unknown };

function Sheet({ name, side, width = 380, memory: initial = EMPTY_MEMORY, density = 'full', unavailable = null, onRecord }: { name: string; side: PinSide; width?: number; memory?: SheetMemory; density?: 'full' | 'compact'; unavailable?: string | null; onRecord?: (record: Recorded) => void }) {
  const [host] = useState(() => {
    const made = fixtureHost({
      body: (_session, of) => pinBody(name, side, of),
      send: (_session, lines) => {
        onRecord?.({ act: 'send', detail: lines });
        return Promise.resolve(queuedResult(lines));
      },
      saveImage: true,
      openFile: true,
    });
    const { openLink, openFile } = made;
    made.openLink = (url) => {
      openLink(url);
      onRecord?.({ act: 'openLink', detail: url });
    };
    made.openFile = (abs, line) => {
      openFile?.(abs, line);
      onRecord?.({ act: 'openFile', detail: { abs, line } });
    };
    return made;
  });
  const [memory, setMemory] = useState(initial);
  const model = pinModel(name, side);
  if (model === null) return <p className="m-0 text-fg-muted">{`${name} has no record on its ${side} side.`}</p>;
  return (
    <div style={{ width }} className={density === 'full' ? 'flex max-h-[720px] flex-col overflow-hidden rounded-md border border-border bg-bg' : ''}>
      <SessionSheet model={model} memory={memory} onMemory={setMemory} host={host} density={density} unavailable={unavailable} />
    </div>
  );
}

function Frame({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="m-0 text-ui font-semibold text-fg">{title}</h2>
      {caption && <p className="m-0 max-w-[380px] text-ui-sm text-fg-muted">{caption}</p>}
      {children}
    </section>
  );
}

const draft = (revision: number, text: string, picks: string[] = []) => ({ revision, picks, text, images: [] });

export function SheetHarness() {
  const [recorded, setRecorded] = useState<Recorded[]>([]);
  const records = (side: PinSide) =>
    PIN_CASES.flatMap((entry) => (entry[side] === null ? [] : [summaryOf(entry[side] as SheetModel, { appSessionId: null, title: entry.name, live: entry.name !== 'stopped-queue' })]));
  return (
    <div className="h-full overflow-auto bg-bg p-5 text-ui text-fg" data-sheet-harness="">
      <header className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="m-0 text-prose font-semibold">Question sheet</h1>
        <form className="flex items-center gap-2 text-ui-sm">
          <select name="fixture" defaultValue={FIXTURE} className="rounded-sm border border-border-strong bg-bg px-1 py-0.5">
            {PIN_CASES.map((entry) => (
              <option key={entry.name}>{entry.name}</option>
            ))}
          </select>
          <select name="side" defaultValue={SIDE} className="rounded-sm border border-border-strong bg-bg px-1 py-0.5">
            <option>before</option>
            <option>after</option>
          </select>
          <button type="submit" className="rounded-sm border border-border-strong px-2 py-0.5">
            Show
          </button>
        </form>
      </header>
      <div className="flex flex-wrap items-start gap-8">
        <Frame title={`${FIXTURE}, ${SIDE}`} caption="The side column's usual 380 px. A Send is recorded below.">
          <Sheet key={`${FIXTURE}/${SIDE}`} name={FIXTURE} side={SIDE} onRecord={(record) => setRecorded((was) => [...was, record])} />
          <pre className="m-0 max-w-[380px] overflow-auto text-ui-sm whitespace-pre-wrap text-fg-muted" data-sheet-recorded="">
            {recorded.map((record) => `${record.act} ${JSON.stringify(record.detail)}`).join('\n')}
          </pre>
        </Frame>
        <Frame title="Frame 2 · One card in each state" caption="Open; updated since seen, its draft carried; queued; accepted; refused as stale, its draft back.">
          <div className="flex flex-wrap items-start gap-4">
            <Sheet name="answer-applied" side="before" />
            <Sheet name="answer-stale" side="after" memory={{ ...EMPTY_MEMORY, seen: new Map([['q1', 1]]), drafts: new Map([['q1', draft(1, 'The provider’s flow is enough.', ['OAuth'])]]) }} />
            <Sheet name="stopped-queue" side="before" />
            <Sheet name="answer-applied" side="after" />
            <Sheet name="answer-stale" side="after" memory={{ ...EMPTY_MEMORY, seen: new Map([['q1', 2]]), acts: [{ key: 'page-0301a001', kind: 'answer', id: 'q1', draft: draft(1, 'The provider’s flow is enough.', ['OAuth']), sentAt: 0, state: 'sending', note: null }] }} />
          </div>
        </Frame>
        <Frame title="Frame 5 · The narrowest column, and an Overview card" caption="280 px; and compact, in place in a card.">
          <div className="flex flex-wrap items-start gap-4">
            <Sheet name="references" side="before" width={280} />
            <div className="w-[300px] rounded-md border border-border bg-bg-raised p-3">
              <div className="mt-1 rounded-sm border border-border bg-bg p-2.5">
                <Sheet name="batch" side="before" width={256} density="compact" />
              </div>
            </div>
          </div>
        </Frame>
        <Frame title="Frame 6 · The notes" caption="An answer that came second; Send unavailable.">
          <div className="flex flex-wrap items-start gap-4">
            <Sheet name="two-surfaces" side="after" memory={{ ...EMPTY_MEMORY, acts: [{ key: 'cli-0401b002', kind: 'answer', id: 'q1', draft: null, sentAt: 0, state: 'sending', note: null }] }} />
            <Sheet name="answer-applied" side="before" unavailable={SHEET_WORDS.unavailable} />
            <Sheet name="empty" side="after" />
          </div>
        </Frame>
        <Frame title="The overview" caption="Every record of the pin's after side; stopped-queue drawn as a stopped session.">
          <div className="w-[480px] rounded-md border border-border p-2">
            <SheetOverview sessions={records('after')} onOpen={(session) => setRecorded((was) => [...was, { act: 'open', detail: session }])} hrefOf={(session) => `#sheet/${session}`} />
          </div>
        </Frame>
      </div>
    </div>
  );
}
