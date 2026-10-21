// P4-B3 M1 (parent §4.5; the prior art's §3.3 table and worked numbers): the divider's pixel rule and the render clamp.
import { describe, expect, it } from 'vitest';
import { A_MIN_PX, FLOAT_THRESHOLD_PX, S_MIN_PX, splitDrag, splitLeft } from './split';

const sessionLeft = { left: true, right: false };
const sessionRight = { left: false, right: true };
const none = { left: false, right: false };

describe('splitDrag: the pointer-implied width, held, armed or followed', () => {
  it('names the constants LC-3 confirmed', () => {
    expect([S_MIN_PX, A_MIN_PX, FLOAT_THRESHOLD_PX]).toEqual([320, 320, 160]);
  });

  it('runs the worked numbers (W = 1500, the session on the left)', () => {
    expect(splitDrag(1500, 400, sessionLeft)).toEqual({ left: 400, armed: null }); // followed
    expect(splitDrag(1500, 200, sessionLeft)).toEqual({ left: 320, armed: null }); // held at S_min in the dead zone
    expect(splitDrag(1500, 160, sessionLeft)).toEqual({ left: 320, armed: null }); // the threshold itself still holds
    expect(splitDrag(1500, 159, sessionLeft)).toEqual({ left: 0, armed: 'left' }); // below T: armed, S's column gone
    expect(splitDrag(1500, 161, sessionLeft)).toEqual({ left: 320, armed: null }); // back past T: disarmed, held at 320
    expect(splitDrag(1500, 150, sessionLeft)).toEqual({ left: 0, armed: 'left' }); // what a release floats
    expect(splitDrag(1500, -40, sessionLeft)).toEqual({ left: 0, armed: 'left' }); // past the region's edge
  });

  it('mirrors on the right: the session pane is W − x wide', () => {
    expect(splitDrag(1500, 1100, sessionRight)).toEqual({ left: 1100, armed: null });
    expect(splitDrag(1500, 1300, sessionRight)).toEqual({ left: 1180, armed: null }); // held at 320
    expect(splitDrag(1500, 1341, sessionRight)).toEqual({ left: 1500, armed: 'right' }); // 159 left for it
    expect(splitDrag(1500, 1339, sessionRight)).toEqual({ left: 1180, armed: null }); // 161: disarmed
  });

  it('never collapses the artifact pane: it clamps at A_min however far the drag goes', () => {
    expect(splitDrag(1500, 1400, sessionLeft)).toEqual({ left: 1500 - A_MIN_PX, armed: null });
    expect(splitDrag(1500, 1499, sessionLeft)).toEqual({ left: 1180, armed: null });
    expect(splitDrag(1500, 10, sessionRight)).toEqual({ left: 320, armed: null });
  });

  it('clamps both sides at their floors when neither pane shows a session', () => {
    expect(splitDrag(1500, 50, none)).toEqual({ left: 320, armed: null });
    expect(splitDrag(1500, 1490, none)).toEqual({ left: 1180, armed: null });
  });

  it('with two sessions, the squeezed one arms', () => {
    const both = { left: true, right: true };
    expect(splitDrag(1500, 100, both).armed).toBe('left');
    expect(splitDrag(1500, 1400, both).armed).toBe('right');
    expect(splitDrag(1500, 750, both)).toEqual({ left: 750, armed: null });
  });

  it('splits a region narrower than both floors evenly rather than overlapping', () => {
    expect(splitDrag(600, 200, none)).toEqual({ left: 300, armed: null });
    expect(splitDrag(600, 500, none)).toEqual({ left: 300, armed: null });
    expect(splitDrag(600, 200, sessionLeft)).toEqual({ left: 300, armed: null }); // held at the even floor
    expect(splitDrag(600, 100, sessionLeft)).toEqual({ left: 0, armed: 'left' }); // the threshold stays T
  });

  it('rounds a fractional pointer to whole pixels', () => {
    expect(splitDrag(1500, 400.6, sessionLeft)).toEqual({ left: 401, armed: null });
  });
});

describe('splitLeft: the stored ratio rendered within the floors at every width', () => {
  it('renders the ratio when both panes clear their floors', () => {
    expect(splitLeft(1500, 0.5, sessionLeft)).toBe(750);
    expect(splitLeft(1500, 0.4, sessionLeft)).toBe(600);
  });

  it('clamps, never floats, when the window narrows (the resize rule)', () => {
    expect(splitLeft(1000, 0.25, sessionLeft)).toBe(320); // 250 would leave the session under S_min
    expect(splitLeft(1000, 0.9, sessionLeft)).toBe(680); // the artifact pane keeps A_min
    expect(splitLeft(640, 0.3, sessionLeft)).toBe(320); // exactly both floors
    expect(splitLeft(500, 0.1, none)).toBe(250); // narrower than both floors: split evenly
  });
});
