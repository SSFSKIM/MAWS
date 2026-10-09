// `/hooks` (C11 execution document, the widget table): `get_hooks_listing` as the terminal lists it: the events that
// have hooks with their counts, each hook with its event, matcher, source label and display text, and the policy line.
// MAWS's own callback hooks are not in the engine's listing.
import * as z from 'zod';
import type { AppSessionId } from '@shared/graph/ids';
import type { GetHooksListingResponse } from '@shared/wire/control';
import { HOOKS, WIDGET_TITLE } from './copy';
import { Group, Mono, parseEach, Row, Rows } from './parts';
import { useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

const EventSchema = z.looseObject({ name: z.string(), summary: z.string().optional(), hookCount: z.number().optional() });
const HookSchema = z.looseObject({
  event: z.string(),
  matcher: z.string().nullable().optional(),
  source: z.string().optional(),
  sourceLabel: z.string().optional(),
  type: z.string().optional(),
  displayText: z.string().optional(),
  commandText: z.string().optional(),
});
const PolicySchema = z.looseObject({ disabledByPolicy: z.boolean().optional(), managedOnly: z.boolean().optional(), pluginOnly: z.boolean().optional(), allDisabled: z.boolean().optional() });

export interface HooksView {
  events: { name: string; summary: string; count: number }[];
  hooks: { event: string; matcher: string | null; source: string; text: string; type: string | null }[];
  policy: string | null;
}

function policyLine(raw: unknown): string | null {
  const p = PolicySchema.safeParse(raw);
  if (!p.success) return null;
  if (p.data.disabledByPolicy || p.data.allDisabled) return HOOKS.disabled;
  if (p.data.managedOnly) return HOOKS.managedOnly;
  if (p.data.pluginOnly) return HOOKS.pluginOnly;
  return null;
}

export function present(listing: GetHooksListingResponse): HooksView {
  return {
    events: parseEach(EventSchema, listing.events).map((e) => ({ name: e.name, summary: e.summary ?? '', count: e.hookCount ?? 0 })),
    hooks: parseEach(HookSchema, listing.hooks).map((h) => ({
      event: h.event,
      matcher: h.matcher || null,
      source: h.sourceLabel ?? h.source ?? '',
      text: h.displayText ?? h.commandText ?? '',
      type: h.type ?? null,
    })),
    policy: policyLine(listing.policy),
  };
}

export function HooksBody({ view }: { view: HooksView }) {
  return (
    <div className="flex flex-col">
      {view.policy && <p className="m-0 mb-2 text-ui-sm text-warning">{view.policy}</p>}
      {view.hooks.length === 0 && <p className="m-0 text-ui-sm text-fg-muted">{HOOKS.none}</p>}
      {view.events.map((event) => {
        const hooks = view.hooks.filter((h) => h.event === event.name);
        return (
          <Group key={event.name} label={event.name} count={event.count}>
            {event.summary && <p className="m-0 mb-1 text-ui-sm text-fg-muted">{event.summary}</p>}
            <Rows label={HOOKS.list(event.name)}>
              {hooks.map((h, i) => (
                <Row key={i} main={<Mono>{h.text}</Mono>} note={h.source} detail={h.matcher ? HOOKS.matcher(h.matcher) : null} />
              ))}
            </Rows>
          </Group>
        );
      })}
    </div>
  );
}

export function HooksWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.getHooksListing', { appSessionId });
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.hooks} command="hooks" state={read.state} error={read.error} close={close}>
      {read.data && <HooksBody view={present(read.data)} />}
    </WidgetFrame>
  );
}
