// E2 (M6): a deliverable's `artifact-element` anchor (Design §10), on the comment bridge's messages and builder, which
// P3-L (M5b) moved beside the artifact store's HTML viewer (`../../artifacts/viewers/pick.ts`) for both to use.
import type { Anchor } from '@shared/anchor/anchor';
import { deliverableUrl, type DeliverableRecord } from '@shared/maws/deliverable';
import { pageElementAnchor, type PickedMessage } from '../../artifacts/viewers/pick';
import { titleOf } from '../model';

export { locateMessage, parseLocatedMessage, parsePickMessage, pickMessage, type LocatedMessage, type PickedMessage, type PickMessage } from '../../artifacts/viewers/pick';

// `<title> v<n> › <element> “<text>”` on the record's version page.
export const artifactElementAnchor = (record: DeliverableRecord, version: number, picked: PickedMessage): Anchor =>
  pageElementAnchor({ title: titleOf(record), version, url: deliverableUrl(record.appSessionId, record.id, version) }, picked);
