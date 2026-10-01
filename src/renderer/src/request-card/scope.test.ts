import { describe, expect, it } from 'vitest';
import { isDowngraded, scopeOptions } from './scope';
import { fixtureRequest, permission, syntheticRequest, type PermissionEvent } from './test-requests';

const reapply = fixtureRequest('pass2', 'grant-reapply-start', 30) as PermissionEvent;
const askRule = fixtureRequest('pass2', 'grant-askrule-start', 27) as PermissionEvent;

describe('scope options follow the downgrade rule', () => {
  it('offers once, session from the first addRules suggestion and local_settings from the localSettings suggestion (grant-reapply-start seq 30)', () => {
    const options = scopeOptions(reapply, { name: 'probe' });
    expect(options.map((o) => o.scope)).toEqual(['once', 'session', 'local_settings']);
    expect(options[0]).toMatchObject({ label: 'Allow once', detail: 'Only this invocation', updatedPermissions: null });
    expect(options[1]).toMatchObject({ label: 'Allow for this session', detail: 'Matching touch granted.txt commands' });
    // what C3's broker writes for the scope: the suggestion rewritten to the session, the localSettings one as sent
    expect(options[1].updatedPermissions).toEqual([{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'touch granted.txt' }], behavior: 'allow', destination: 'session' }]);
    expect(options[2]).toMatchObject({ label: 'Always allow touch granted.txt in probe', detail: 'Saved to .claude/settings.local.json in the project' });
    expect(options[2].updatedPermissions).toEqual([{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'touch granted.txt' }], behavior: 'allow', destination: 'localSettings' }]);
  });

  it('counts an edit by its files and names the rule it would keep (the edit-approval variant, test/fixtures/requests/edit-permission.json)', () => {
    const edit = syntheticRequest('edit-permission') as PermissionEvent;
    expect(scopeOptions(edit, { name: 'repo' }).map((o) => [o.scope, o.label, o.detail])).toEqual([
      ['once', 'Allow once', 'This 1 file'],
      ['session', 'Allow for this session', 'Until this session ends'],
      ['local_settings', 'Always allow Edit in repo', 'Saved to .claude/settings.local.json in the project'],
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

  it('describes a session grant with no suggestion as lasting the session, and offers no local rule without a localSettings suggestion', () => {
    const options = scopeOptions(permission({ toolName: 'Read', input: { file_path: '/p/a.ts' } }), null);
    expect(options.map((o) => [o.scope, o.detail])).toEqual([
      ['once', 'Only this invocation'],
      ['session', 'Until this session ends'],
    ]);
    expect(options[1].updatedPermissions).toEqual([{ type: 'addRules', rules: [{ toolName: 'Read' }], behavior: 'allow', destination: 'session' }]);
  });

  it('counts the file rows a file tool touches in the once option', () => {
    expect(scopeOptions(permission({ toolName: 'Edit', input: { file_path: '/p/a.ts', old_string: 'a', new_string: 'b' } }), null)[0].detail).toBe('This 1 file');
    expect(scopeOptions(permission({ toolName: 'NotebookEdit', input: { notebook_path: '/p/n.ipynb' } }), null)[0].detail).toBe('This 1 file');
    const multi = { file_path: '/p/a.ts', edits: [{ file_path: '/p/b.ts', old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] };
    expect(scopeOptions(permission({ toolName: 'MultiEdit', input: multi }), null)[0].detail).toBe('These 2 files');
  });
});
