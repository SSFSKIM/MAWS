// A send not yet in the transcript, at the session view's tail (the owner's 1B): MAWS's user bubble (`Bubble.tsx`,
// shared with the group chat) with the send's delivery state as the bubble's foot, and the whole bubble tinted when the
// send will not arrive (`data-state`, the desk's stylesheet).
import type { FootState } from '../../../conversation/tail';
import { Bubble } from '../../conversation/Bubble';
import { DeliveryFoot } from './DeliveryFoot';

export function TailBubble({ text, at, foot }: { text: string; at: string | null; foot: { state: FootState; words: string; reason: string | null } }) {
  return <Bubble className="desk-tail-send" aria-label="Your message, not in the transcript yet" data-state={foot.state} data-testid="tail-send" text={text} at={at} foot={<DeliveryFoot {...foot} />} />;
}
