// The permission body (C7 execution document, Request card): the bounded tool preview, the engine's decision reason,
// the scope group, `Deny… with a reason` and `Deny and stop the turn`, under the quick-approval policy. `full`: the
// first scope is selected and Enter allows it; digits 1–3 pick a scope (the card's key handler). `button_only`
// (`default_to_no`): nothing is selected and Enter only says to use the Allow button. `none`
// (`requires_user_interaction`): no Allow, no scope, no Enter; the request is denied here or answered in a terminal.
import { DropdownMenu, RadioGroup } from 'radix-ui';
import { useEffect, useState } from 'react';
import { useSessions } from '../../stores/sessions';
import { toAnswer } from '../answers';
import { CardButton, CardTextarea, Controls, Muted } from '../controls';
import { ToolPreview } from '../preview/ToolPreview';
import { quickApproval } from '../quick-approval';
import { scopeOptions, type Scope, type ScopeOption } from '../scope';
import type { VariantProps } from './types';

const ALLOWED: Record<Scope, string> = { once: 'Allowed once', session: 'Allowed for this session', local_settings: 'Always allowed in this project' };
const HINT_MS = 2_000;

export function PermissionBody({ item, request, busy, submit, bindKeys }: VariantProps<'permission.requested'>) {
  const project = useSessions((s) => {
    const record = s.records.get(item.appSessionId);
    return record?.projectId ? (s.projects.get(record.projectId) ?? null) : null;
  });
  const policy = quickApproval(request);
  const options: ScopeOption[] = policy === 'none' ? [] : scopeOptions(request, project);
  const [scope, setScope] = useState<Scope | null>(policy === 'full' ? 'once' : null);
  const [reasoning, setReasoning] = useState(false);
  const [message, setMessage] = useState('');
  const [hint, setHint] = useState(false);

  const allow = (chosen: Scope) => submit(toAnswer({ kind: 'permission', decision: 'allow', scope: chosen }), ALLOWED[chosen]);
  const deny = (decision: 'deny' | 'deny_and_stop', text = '') => submit(toAnswer({ kind: 'permission', decision, message: text }), decision === 'deny' ? 'Denied' : 'Denied and stopped');

  useEffect(() => {
    bindKeys({
      accept: policy === 'none' ? null : () => (policy === 'full' && scope ? allow(scope) : setHint(true)),
      decline: () => deny('deny'),
      digit: policy === 'full' ? (n) => options[n - 1] && setScope(options[n - 1].scope) : null, // picks, never answers
    });
  });
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);

  const tool = request.displayName ?? request.toolName;
  return (
    <div className="flex flex-col gap-3">
      <ToolPreview request={request} />
      {request.decisionReason && <Muted>{request.decisionReason}</Muted>}
      {policy === 'none' && (
        <p className="m-0 text-ui-sm text-warning">{tool} needs its own approval surface, which MAWS does not have · open the session in a terminal to answer it, or deny</p>
      )}
      {options.length > 0 && (
        <RadioGroup.Root
          aria-label="Allow scope"
          value={scope ?? ''}
          onValueChange={(value) => setScope(value as Scope)}
          disabled={busy}
          className="flex flex-col gap-1"
        >
          {options.map((option, i) => (
            <RadioGroup.Item
              key={option.scope}
              value={option.scope}
              aria-label={option.label}
              className="flex items-start gap-2 rounded-sm border border-border px-2.5 py-1.5 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 data-[state=checked]:border-border-strong data-[state=checked]:bg-bg-active"
            >
              <span aria-hidden className="w-3 shrink-0 text-fg-muted tabular-nums">
                {i + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-fg">{option.label}</span>
                <span className="text-ui-sm text-fg-muted">{option.detail}</span>
              </span>
              <RadioGroup.Indicator aria-hidden className="ml-auto text-fg">
                ●
              </RadioGroup.Indicator>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      )}
      {hint && (
        <p role="status" className="m-0 text-ui-sm text-warning">
          Use the Allow button for this request
        </p>
      )}
      {reasoning && (
        <div className="flex flex-col gap-1.5">
          <CardTextarea label="Reason for denying" value={message} onChange={setMessage} onSubmit={() => deny('deny', message)} autoFocus disabled={busy} />
          <Muted>⌘Enter sends the deny with this reason</Muted>
        </div>
      )}
      <Controls>
        {!reasoning && (
          <CardButton disabled={busy} onClick={() => setReasoning(true)} className="mr-auto border-transparent text-fg-muted">
            Deny… with a reason
          </CardButton>
        )}
        <span className="flex">
          <CardButton disabled={busy} onClick={() => deny('deny', message)} className="rounded-r-none">
            Deny
          </CardButton>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <CardButton disabled={busy} aria-label="More deny options" className="rounded-l-none border-l-0 px-1.5">
                ▾
              </CardButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={4} className="z-50 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
                <DropdownMenu.Item onSelect={() => deny('deny_and_stop', message)} className="cursor-default rounded-sm px-2.5 py-1 outline-none data-[highlighted]:bg-bg-hover">
                  Deny and stop the turn
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </span>
        {policy !== 'none' && (
          <CardButton tone="primary" disabled={busy || scope === null} onClick={() => scope && allow(scope)}>
            Allow
          </CardButton>
        )}
      </Controls>
    </div>
  );
}
