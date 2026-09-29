// The Needs-you hover card (§5.1; residue *Hover card*): a Radix HoverCard on the row, opening after 300 ms of hover or
// on focus, to the right of the sidebar, rendering the `requestCard` slot in its `hover` placement with the originating
// request, fetched once per item through `attention.request` and cached in the attention store. Opening it answers
// nothing: approval is an explicit click inside the card, and the slot offers it only for read-only tools.
import { HoverCard as Radix } from 'radix-ui';
import type { ReactNode } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import { useSlot } from '../app/slots';
import { ipc } from '../ipc/client';
import { useAttention } from '../stores/attention';

export function HoverCard({ item, title, children }: { item: AttentionItem; title: string; children: ReactNode }) {
  const request = useAttention((s) => s.requests.get(item.id) ?? null);
  const Card = useSlot('requestCard');
  return (
    <Radix.Root openDelay={300} closeDelay={150} onOpenChange={(open) => open && void useAttention.getState().loadRequest(ipc, item)}>
      <Radix.Trigger asChild>{children}</Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          role="dialog"
          aria-label={title}
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className="z-50 w-[342px] rounded-md border border-border-strong bg-bg-overlay p-4"
        >
          {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
          <Card item={item} request={request} placement="hover" paneIndex={null} />
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
