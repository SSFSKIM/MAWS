import { describe, expect, it } from 'vitest';
import { isDowngraded, scopeOptions } from './scope';
import { fixtureRequest, permission, syntheticRequest, type PermissionEvent } from './test-requests';

const reapply = fixtureRequest('pass2', 'grant-reapply-start', 30) as PermissionEvent;
const askRule = fixtureRequest('pass2', 'grant-askrule-start', 27) as PermissionEvent;

// UX wave U1a (§D): the card's buttons are drawn from these; each scope is named as its button reads, and the project
// rule carries the rule's text for the line under the buttons.
describe('scope options follow the downgrade rule', () => {
  it('offers once, session from the first addRules suggestion and local_settings from the localSettings suggestion (grant-reapply-start seq 30)', () => {
    const options = scopeOptions(reapply, { name: 'probe' });
    expect(options.map((o) => o.scope)).toEqual(['once', 'session', 'local_settings']);
    expect(options[0]).toMatchObject({ label: 'Allow once', rule: null, updatedPermissions: null });
    expect(options[1]).toMatchObject({ label: 'Allow for this session', rule: null });
    // what C3's broker writes for the scope: the suggestion rewritten to the session, the localSettings one as sent
    expect(options[1].updatedPermissions).toEqual([{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'touch granted.txt' }], behavior: 'allow', destination: 'session' }]);
    expect(options[2]).toMatchObject({ label: 'Always allow in probe', rule: 'touch granted.txt' });
    expect(options[2].updatedPermissions).toEqual([{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'touch granted.txt' }], behavior: 'allow', destination: 'localSettings' }]);
  });

  it('names the project rule "in this project" without a project, and names a rule with no content by its tool (the edit-approval variant, test/fixtures/requests/edit-permission.json)', () => {
    const edit = syntheticRequest('edit-permission') as PermissionEvent;
    expect(scopeOptions(edit, null).map((o) => [o.scope, o.label, o.rule])).toEqual([
      ['once', 'Allow once', null],
      ['session', 'Allow for this session', null],
      ['local_settings', 'Always allow in this project', 'Edit'],
    ]);
  });

  it('offers once only for an ask-rule prompt (grant-askrule-start seq 27: decisionReasonType rule, no matchedAskRule)', () => {
    expect(askRule.decisionReasonType).toBe('rule');
    expect(askRule.matchedAskRule).toBeUndefined();
    expect(isDowngraded(askRule)).toBe(true);
    expect(scopeOptions(askRule, null).map((o) => o.scope)).toEqual(['once']);
  });

  it('offers once only when always-allow is suppressed or an ask rule matched', () => {
    expect(scopeOptions({ ...reapply, suppressAlwaysAllow: true }, null).map((o) => o.scope)).toEqual(['once']);
    expect(scopeOptions({ ...reapply, matchedAskRule: { source: 'userSettings', toolName: 'Bash', ruleContent: 'touch:*' } }, null).map((o) => o.scope)).toEqual(['once']);
    expect(isDowngraded({ ...reapply, matchedAskRule: null, suppressAlwaysAllow: false })).toBe(false);
  });

  it('writes a session grant with no suggestion as the request\'s own rule, and offers no local rule without a localSettings suggestion', () => {
    const options = scopeOptions(permission({ toolName: 'Read', input: { file_path: '/p/a.ts' } }), null);
    expect(options.map((o) => o.scope)).toEqual(['once', 'session']);
    expect(options[1].updatedPermissions).toEqual([{ type: 'addRules', rules: [{ toolName: 'Read' }], behavior: 'allow', destination: 'session' }]);
  });
});
