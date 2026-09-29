import { describe, expect, it } from 'vitest';
import { hoverApproval, quickApproval } from './quick-approval';
import { fixtureRequest, itemFor, permission, syntheticRequest, type PermissionEvent } from './test-requests';

const flaggedRead = syntheticRequest('flagged-read') as PermissionEvent;
const unflaggedRead = syntheticRequest('flagged-read', (r) => delete r.requires_user_interaction) as PermissionEvent;
const reapply = fixtureRequest('pass2', 'grant-reapply-start', 30) as PermissionEvent;

describe('quick approval follows requires_user_interaction and default_to_no', () => {
  it('none for a flagged request, button_only for default_to_no, full otherwise', () => {
    expect(quickApproval(flaggedRead)).toBe('none');
    expect(quickApproval(permission({ defaultToNo: true }))).toBe('button_only');
    expect(quickApproval(permission({ defaultToNo: true, requiresUserInteraction: true }))).toBe('none');
    expect(quickApproval(reapply)).toBe('full');
    expect(quickApproval(unflaggedRead)).toBe('full');
  });

  it('the hover approves only an open, unflagged request for a read-only tool', () => {
    expect(hoverApproval(itemFor(unflaggedRead), unflaggedRead)).toBe(true);
    expect(hoverApproval(itemFor(flaggedRead), flaggedRead)).toBe(false); // flagged: Open session only, even for Read
    expect(hoverApproval(itemFor(reapply), reapply)).toBe(false); // Bash is not read-only
    expect(hoverApproval(itemFor(unflaggedRead, 'app-test', { state: 'delivered' }), unflaggedRead)).toBe(false);
    expect(hoverApproval(itemFor(unflaggedRead), permission({ toolName: 'Read', defaultToNo: true }))).toBe(false);
    const question = fixtureRequest('pass1', 'question-roundtrip', 137);
    expect(hoverApproval(itemFor(question), question)).toBe(false);
    expect(hoverApproval(itemFor(unflaggedRead), null)).toBe(false);
  });
});
