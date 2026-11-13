import { describe, expect, it } from 'vitest';
import { quickApproval } from './quick-approval';
import { fixtureRequest, permission, syntheticRequest, type PermissionEvent } from './test-requests';

const flaggedRead = syntheticRequest('flagged-read') as PermissionEvent;
const unflaggedRead = syntheticRequest('flagged-read', (r) => delete r.requires_user_interaction) as PermissionEvent;
const reapply = fixtureRequest('pass2', 'grant-reapply-start', 30) as PermissionEvent;

// The hover card's answers are UX wave U1a §H's rule (`@shared/attention/outside-answers`), tested there and on the card.
describe('quick approval follows requires_user_interaction and default_to_no', () => {
  it('none for a flagged request, button_only for default_to_no, full otherwise', () => {
    expect(quickApproval(flaggedRead)).toBe('none');
    expect(quickApproval(permission({ defaultToNo: true }))).toBe('button_only');
    expect(quickApproval(permission({ defaultToNo: true, requiresUserInteraction: true }))).toBe('none');
    expect(quickApproval(reapply)).toBe('full');
    expect(quickApproval(unflaggedRead)).toBe('full');
  });
});
