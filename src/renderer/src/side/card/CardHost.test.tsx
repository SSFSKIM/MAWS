// P2-E1 (M3): the host re-pins its card (P2-E1 document, D8; the Decision Log's resize entry) and claims a re-docked
// card only once the Side pane has stopped drawing its thread (the Decision Log's "re-dock must survive the card's own
// close rule"). The host asks its frame where the card's element is (`CardFrame.locate`, by the anchor's locator) when
// it shows a card, when the frame is replaced (`CardFrame.key`) and when its box resizes; a rect re-pins the card, null
// keeps where it is (the top-right corner for a card with no rect).
import { act, cleanup, render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { deliverableUrl } from '@shared/maws/deliverable';
import { useSessions } from '../../stores/sessions';
import { resetPanelStores } from '../../test-support/panel';
import type { CardRect } from '../../tools/code/anchor/anchor';
import { hideSideChild, showSideChild, useSidePane } from '../store';
import { CommentCardHost, type CardFrame } from './CardHost';
import { CLAIM_DEADLINE_MS, openCard, useCommentCard } from './store';

const PARENT = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const CHILD = 'c5555555-5555-4555-8555-000000000001' as AppSessionId;
const RECORD = '00000000-0000-4000-8000-000000000001';
const ANCHOR: Anchor = { kind: 'artifact-element', locator: '#hero', label: 'Dashboard v1 › h1#hero “Sales overview”', pageUrl: deliverableUrl(PARENT, RECORD, 1) };
const HERO: CardRect = { x: 24, y: 0, width: 300, height: 90 }; // the card goes 4 px under it: top 94
const MOVED: CardRect = { x: 40, y: 200, width: 300, height: 50 }; // top 254
const HOST_BOX = { width: 600, height: 800 };

// jsdom lays nothing out: the host measures this box, and a resize is the observer's callback
const clientSize = { width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!, height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')! };
let resized: (() => void) | null = null;
const realObserver = globalThis.ResizeObserver;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => HOST_BOX.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => HOST_BOX.height });
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
      resized = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientSize.width);
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientSize.height);
  globalThis.ResizeObserver = realObserver;
});

beforeEach(() => {
  resetPanelStores();
  useSidePane.setState({ panes: new Map() });
  HOST_BOX.width = 600;
  HOST_BOX.height = 800;
});
afterEach(() => {
  cleanup();
  useCommentCard.setState({ open: null, shownThread: null });
  vi.useRealTimers();
});

const card = () => document.querySelector<HTMLElement>('[data-comment-card]');
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const frameOf = (key: string, locate?: CardFrame['locate']): CardFrame => ({ scale: 1, offset: { x: 0, y: 0 }, key, ...(locate && { locate }) });

function Host({ frame }: { frame: CardFrame }) {
  return (
    <div className="relative">
      <CommentCardHost hostId="h1" host="deliverable" mode="panel" layout="anchored" accepts={() => true} frame={frame} visible />
    </div>
  );
}

// the re-dock: a card with no host and no rect, for a panel viewer of its record to claim
const redock = (phase: 'composing' | 'thread' = 'composing') =>
  act(() => openCard(ANCHOR, { appSessionId: PARENT, claimMode: 'panel', ...(phase === 'thread' && { phase: { kind: 'thread', child: CHILD, echo: null } }) }));
const pick = (rect: CardRect = HERO) => act(() => openCard(ANCHOR, { appSessionId: PARENT, placement: { kind: 'card', host: 'deliverable', hostId: 'h1', rect } }));

describe('re-pin', () => {
  it('a claimed card with no rect is pinned where locate finds its element, by the anchor’s locator', async () => {
    const locate = vi.fn(async () => HERO);
    render(<Host frame={frameOf('k1', locate)} />);
    redock();
    await settle();
    expect(locate).toHaveBeenCalledWith('#hero');
    expect(card()!.dataset.placement).toBe('below');
    expect(card()!.style).toMatchObject({ left: '24px', top: '94px' });
  });

  it('an element the page no longer has docks the card at the top-right corner', async () => {
    render(<Host frame={frameOf('k1', async () => null)} />);
    redock();
    await settle();
    expect(card()!.style).toMatchObject({ left: `${600 - 300 - 8}px`, top: '8px' });
  });

  it('a new frame (a version switch, a Reload) locates again and re-pins the card, which stays open', async () => {
    const locate = vi.fn(async () => HERO);
    const view = render(<Host frame={frameOf('v1#0', locate)} />);
    redock();
    await settle();
    const serial = useCommentCard.getState().open!.serial;
    locate.mockResolvedValue(MOVED);
    view.rerender(<Host frame={frameOf('v2#0', locate)} />);
    await settle();
    expect(locate).toHaveBeenCalledTimes(2);
    expect(card()!.style).toMatchObject({ left: '40px', top: '254px' });
    expect(useCommentCard.getState().open?.serial).toBe(serial);
  });

  it('a null answer in the new frame keeps the card where it was', async () => {
    const locate = vi.fn(async (): Promise<CardRect | null> => HERO);
    const view = render(<Host frame={frameOf('v1#0', locate)} />);
    redock();
    await settle();
    locate.mockResolvedValue(null);
    view.rerender(<Host frame={frameOf('v1#1', locate)} />);
    await settle();
    expect(locate).toHaveBeenCalledTimes(2);
    expect(card()!.style).toMatchObject({ left: '24px', top: '94px' });
  });

  it('a picked card shows at the pick’s rect at once, then where locate finds the element; a resize of the host locates again', async () => {
    let answer: (rect: CardRect | null) => void = () => {};
    const locate = vi.fn(() => new Promise<CardRect | null>((resolve) => (answer = resolve)));
    render(<Host frame={frameOf('k1', locate)} />);
    pick(HERO);
    expect(card()!.style).toMatchObject({ left: '24px', top: '94px' });
    await act(async () => answer(HERO));
    expect(card()!.style).toMatchObject({ left: '24px', top: '94px' });

    HOST_BOX.width = 500; // an element fixed to the frame's viewport moves with it: the stored rect is stale
    act(() => resized!());
    expect(locate).toHaveBeenCalledTimes(2);
    await act(async () => answer(MOVED));
    expect(card()!.style).toMatchObject({ left: '40px', top: '254px' });
  });

  it('an answer that arrives after a newer frame asked is dropped', async () => {
    const answers: ((rect: CardRect | null) => void)[] = [];
    const locate = vi.fn(() => new Promise<CardRect | null>((resolve) => void answers.push(resolve)));
    const view = render(<Host frame={frameOf('v1#0', locate)} />);
    redock();
    await settle();
    view.rerender(<Host frame={frameOf('v2#0', locate)} />);
    await settle();
    await act(async () => answers[1]!(HERO));
    await act(async () => answers[0]!(MOVED)); // the old frame's, late
    expect(card()!.style).toMatchObject({ left: '24px', top: '94px' });
  });

  it('a frame that mounts after the card was claimed (the viewer still reading its record) locates once it is there', async () => {
    const view = render(<Host frame={frameOf('v2#0')} />);
    redock();
    await settle();
    expect(card()!.style).toMatchObject({ left: `${600 - 300 - 8}px`, top: '8px' });
    view.rerender(<Host frame={frameOf('v2#0', async () => HERO)} />);
    await settle();
    expect(card()!.style).toMatchObject({ left: '24px', top: '94px' });
  });

  it('without a locate (no HTML frame) the card stays at its stored rect', async () => {
    render(<Host frame={frameOf('k1')} />);
    pick(HERO);
    await settle();
    expect(card()!.style).toMatchObject({ left: '24px', top: '94px' });
  });
});

// "Show in deliverable" starts from a Side pane drawing the thread; the card closes while the Side pane draws its thread
// (one place draws a session with an input). The host claims a re-docked thread card only once the pane has stopped
// drawing it, so the card's close rule never sees the pane it came from.
describe('the re-dock and the card’s close rule', () => {
  // the Side pane's thread view, publishing the thread while drawn (ThreadView's effect)
  function SidePaneThread() {
    useEffect(() => {
      showSideChild(PARENT, CHILD);
      return () => hideSideChild(PARENT, CHILD);
    }, []);
    return null;
  }
  // the parent's panel: one tool's body mounted at a time
  let show: (tool: 'side' | 'deliverables') => void = () => {};
  function Panel() {
    const [tool, setTool] = useState<'side' | 'deliverables'>('side');
    useEffect(() => {
      show = setTool;
    }, []);
    return tool === 'side' ? <SidePaneThread /> : <Host frame={frameOf('k1', async () => HERO)} />;
  }

  beforeEach(() => {
    useSessions.setState({ records: new Map() });
  });

  it('the panel turning from the Side pane to the viewer in the same update as the re-dock: the card is claimed in thread phase and stays open', async () => {
    render(<Panel />);
    expect(useSidePane.getState().panes.get(PARENT)?.shownChild).toBe(CHILD);
    act(() => {
      show('deliverables');
      redock('thread');
    });
    await settle();
    expect(card()!.dataset.cardPhase).toBe('thread');
    expect(useCommentCard.getState().open).toMatchObject({ hostId: 'h1', phase: { kind: 'thread', child: CHILD } });
    expect(card()!.style).toMatchObject({ left: '24px', top: '94px' });
  });

  it('a viewer already on screen while the Side pane still draws the thread does not claim it; it does once the pane stops', async () => {
    const view = render(
      <>
        <SidePaneThread />
        <Host frame={frameOf('k1', async () => HERO)} />
      </>,
    );
    redock('thread');
    await settle();
    expect(useCommentCard.getState().open).toMatchObject({ hostId: null });
    expect(card()).toBeNull();
    view.rerender(<Host frame={frameOf('k1', async () => HERO)} />);
    await settle();
    expect(useCommentCard.getState().open).toMatchObject({ hostId: 'h1' });
    expect(card()!.dataset.cardPhase).toBe('thread');
  });

  it('a re-docked thread the Side pane keeps drawing is never claimed and closes at the deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    render(
      <>
        <SidePaneThread />
        <Host frame={frameOf('k1', async () => HERO)} />
      </>,
    );
    redock('thread');
    await act(() => vi.advanceTimersByTimeAsync(CLAIM_DEADLINE_MS));
    expect(useCommentCard.getState().open).toBeNull();
  });
});
