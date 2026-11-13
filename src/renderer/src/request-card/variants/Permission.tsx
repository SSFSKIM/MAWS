// The permission body (C7 execution document, Request card; UX wave U1a, §D): the bounded tool preview, the engine's
// decision reason, and three buttons drawn from the scopes the request offers (`scopeOptions`): Deny (Esc, its menu
// holding "Deny and stop the turn"), the most lasting scope by name (⇧⌘↩) and Allow once (⌘↩), with "Allow for this
// session" as the one entry of a menu on Allow once when the project rule takes the third place. "Deny… with a reason"
// opens the reason box, whose own ⌘↩ sends. A key acts once the prompt has been drawn for 400 ms; each key is printed on
// its button (the row's effective chord) and a button whose key is not bound prints none. Under the quick-approval
// policy: `button_only` (`default_to_no`) binds no allow key; `none` (`requires_user_interaction`) draws no allow button.
// P5 O9 M6: each button, and each menu entry, is drawn disabled in place with its reason where the session's port can't
// carry it (a terminal session's bridge: deny-and-interrupt, a scope its request doesn't suggest), and no key answers it.
// UX wave U1a (M4, §I): a file change's preview is its diff against the file as read (`proposed`, which the card reads
// and hands here, since its first line says "Create" or "Edit" by it), or the input alone until and unless one is drawn.
import { DropdownMenu } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { effectiveChord, type ActionId } from '@shared/keymap/actions';
import { useSessions } from '../../stores/sessions';
import { useSettings } from '../../stores/settings';
import { toAnswer } from '../answers';
import { CardButton, CardTextarea, Controls, Muted } from '../controls';
import { INPUT_ALONE, type Proposed } from '../preview/proposed';
import { ProposedChange } from '../preview/ProposedChange';
import { ToolPreview } from '../preview/ToolPreview';
import { quickApproval } from '../quick-approval';
import { scopeOptions, type Scope } from '../scope';
import { toolClass } from '../tools';
import { carried, gated, type VariantProps } from './types';

const ALLOWED: Record<Scope, string> = { once: 'Allowed once', session: 'Allowed for this session', local_settings: 'Always allowed in this project' };
// A prompt's keys answer nothing until it has been drawn this long (A3): a chord meant for what held focus before it
// appeared must not answer it.
const KEY_GRACE_MS = 400;
const MENU = 'z-50 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg';
const MENU_ITEM = 'cursor-default rounded-sm px-2.5 py-1 outline-none data-[disabled]:text-fg-faint data-[highlighted]:bg-bg-hover';

export function PermissionBody({ item, request, busy, submit, bindKeys, capability = carried, proposed = INPUT_ALONE }: VariantProps<'permission.requested'> & { proposed?: Proposed }) {
  const project = useSessions((s) => {
    const record = s.records.get(item.appSessionId);
    return record?.projectId ? (s.projects.get(record.projectId) ?? null) : null;
  });
  const keymap = useSettings((s) => s.state?.settings.keymap);
  const policy = quickApproval(request);
  const options = policy === 'none' ? [] : scopeOptions(request, project);
  const session = options.find((o) => o.scope === 'session') ?? null;
  const local = options.find((o) => o.scope === 'local_settings') ?? null;
  const lasting = local ?? session; // the third button: the most lasting scope the request offers
  const entry = local !== null ? session : null; // the menu on Allow once, when the project rule takes the third place
  const [reasoning, setReasoning] = useState(false);
  const [message, setMessage] = useState('');

  // Armed once the prompt has been drawn for KEY_GRACE_MS; until then a key is taken by its binding and answers nothing.
  const armed = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => void (armed.current = true), KEY_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);

  const allowing = (chosen: Scope) => toAnswer({ kind: 'permission', decision: 'allow', scope: chosen });
  const denying = (decision: 'deny' | 'deny_and_stop', text = '') => toAnswer({ kind: 'permission', decision, message: text });
  const allow = (chosen: Scope) => capability(allowing(chosen)).available && submit(allowing(chosen), ALLOWED[chosen]);
  const deny = (decision: 'deny' | 'deny_and_stop', text = '') => capability(denying(decision, text)).available && submit(denying(decision, text), decision === 'deny' ? 'Denied' : 'Denied and stopped');
  const denyGate = gated(capability(denying('deny', message)));
  const stopGate = gated(capability(denying('deny_and_stop', message)));
  const onceGate = gated(capability(allowing('once')));
  const lastingGate = lasting === null ? null : gated(capability(allowing(lasting.scope)));
  const entryGate = entry === null ? null : gated(capability(allowing(entry.scope)));

  // A key exists where its button answers and the keymap gives its row a chord; `default to no` binds no allow key.
  const chordOf = (id: ActionId) => effectiveChord(id, keymap ?? {});
  const keyed = (id: ActionId, available: boolean, run: () => void) => (available && chordOf(id) !== null ? run : null);
  const declineKey = keyed('request.decline', !denyGate.disabled, () => deny('deny'));
  const onceKey = keyed('request.allowOnce', policy === 'full' && !onceGate.disabled, () => allow('once'));
  const lastingKey = lasting === null ? null : keyed('request.allowLasting', policy === 'full' && lastingGate?.disabled === false, () => allow(lasting.scope));
  const whenArmed = (run: (() => void) | null) => run && (() => void (armed.current && run()));

  useEffect(() => {
    bindKeys({ accept: null, decline: whenArmed(declineKey), allowOnce: whenArmed(onceKey), allowLasting: whenArmed(lastingKey), digit: null });
  });

  const tool = request.displayName ?? request.toolName;
  return (
    <div className="flex flex-col gap-3">
      {toolClass(request.toolName) === 'edit' ? <ProposedChange request={request} proposed={proposed} appSessionId={item.appSessionId} /> : <ToolPreview request={request} />}
      {/* §D: the call's own "Why" follows the preview; a command's preview draws it itself (desk web's too), so only the
          other classes draw it here */}
      {toolClass(request.toolName) !== 'command' && request.description && <Muted>Why: {request.description}</Muted>}
      {request.decisionReason && <Muted>{request.decisionReason}</Muted>}
      {policy === 'none' && (
        <p className="m-0 text-ui-sm text-warning">{tool} needs its own approval surface, which MAWS does not have · open the session in a terminal to answer it, or deny</p>
      )}
      {reasoning && (
        <div className="flex flex-col gap-1.5">
          <CardTextarea label="Reason for denying" value={message} onChange={setMessage} onSubmit={() => deny('deny', message)} autoFocus disabled={busy} />
          <Muted>⌘Enter sends the deny with this reason</Muted>
        </div>
      )}
      <Controls>
        {!reasoning && (
          <CardButton disabled={busy || denyGate.disabled} title={denyGate.title} onClick={() => setReasoning(true)} className="mr-auto border-transparent text-fg-muted">
            Deny… with a reason
          </CardButton>
        )}
        <span className="flex">
          <CardButton disabled={busy || denyGate.disabled} title={denyGate.title} chord={declineKey && chordOf('request.decline')} onClick={() => deny('deny', message)} className="rounded-r-none">
            Deny
          </CardButton>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <CardButton disabled={busy} aria-label="More deny options" className="rounded-l-none border-l-0 px-1.5">
                ▾
              </CardButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
                <DropdownMenu.Item disabled={stopGate.disabled} title={stopGate.title} onSelect={() => deny('deny_and_stop', message)} className={MENU_ITEM}>
                  Deny and stop the turn
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </span>
        {lasting !== null && lastingGate !== null && (
          <CardButton disabled={busy || lastingGate.disabled} title={lastingGate.title} chord={lastingKey && chordOf('request.allowLasting')} onClick={() => allow(lasting.scope)}>
            {lasting.label}
          </CardButton>
        )}
        {policy !== 'none' && (
          <span className="flex">
            <CardButton tone="primary" disabled={busy || onceGate.disabled} title={onceGate.title} chord={onceKey && chordOf('request.allowOnce')} onClick={() => allow('once')} className={entry === null ? '' : 'rounded-r-none'}>
              Allow once
            </CardButton>
            {entry !== null && entryGate !== null && (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <CardButton tone="primary" disabled={busy} aria-label="More allow options" className="rounded-l-none border-l-bg px-1.5">
                    ▾
                  </CardButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
                    <DropdownMenu.Item disabled={entryGate.disabled} title={entryGate.title} onSelect={() => allow(entry.scope)} className={MENU_ITEM}>
                      {entry.label}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            )}
          </span>
        )}
      </Controls>
      {/* F5 (the owner's ruling, W4): the one control that writes into the person's own files says which file */}
      {local !== null && (
        <Muted>
          Always allow adds <code className="font-mono">{local.rule}</code> to .claude/settings.local.json in the project.
        </Muted>
      )}
    </div>
  );
}
