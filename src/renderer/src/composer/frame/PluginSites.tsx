// The composer's plugin sites (R2; the waves plan's R2 rulings, charter D-9 as amended 2026-10-01): what a plugin draws
// through the engine's remote surface around the composer, present only while a plugin hooks the site and nothing in
// its place otherwise (MAWS draws none of these itself). AbovePrompt: a band in the column above the composer frame,
// the tree scrolling past twelve rows (the props Claude Desktop sends, c95e4d2cf-BLkI1oZK.js:9934-9941). SessionMode: a
// chip after the permission mode in the toolbar, the tree on one line, or the mode labels a hook added. PromptHint: a dim
// line under the frame, the tree or the hint a hook wrote.
import { useRef } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { SurfaceSite } from '../../engine-surface';
import { useCells } from '../../engine-surface/cells';
import type { SiteAnswer } from '../../engine-surface';

export const PLUGIN_SITES = { band: 'From plugins', mode: 'Plugin modes', hint: 'Plugin hint' };
const BAND_ROWS = 12;
const NO_MODES: readonly string[] = [];

export function PluginBand({ appSessionId, working }: { appSessionId: AppSessionId; working: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { columns } = useCells(ref, { columns: 100, rows: BAND_ROWS });
  const props = { hasSurvey: false, isWorking: working, maxRows: BAND_ROWS, bodyColumns: columns, scroll: { offset: 0, bodyRows: BAND_ROWS }, view: {} };
  return (
    <div ref={ref} className="min-w-0">
      <SurfaceSite
        appSessionId={appSessionId}
        component="AbovePrompt"
        instanceId="above-prompt"
        props={props}
        frame={(tree) => (
          <section aria-label={PLUGIN_SITES.band} data-plugin-band="" className="flex max-h-[calc(12lh+1rem)] min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-bg-raised px-3 py-2 text-ui text-fg">
            {tree}
          </section>
        )}
      />
    </div>
  );
}

// A hook that drew nothing of its own but rewrote the props: the words it gave MAWS's own drawing of the site (which is
// otherwise nothing: MAWS shows no mode labels or hint of its own here).
export const rewrittenModes = (answer: SiteAnswer): string => (answer.rewritten && Array.isArray(answer.props.modes) ? answer.props.modes.filter((m): m is string => typeof m === 'string').join(' & ') : '');
export const rewrittenHint = (answer: SiteAnswer): string => (answer.rewritten && typeof answer.props.hint === 'string' ? answer.props.hint : '');

export function PluginModeSlot({ appSessionId }: { appSessionId: AppSessionId }) {
  return (
    <SurfaceSite
      appSessionId={appSessionId}
      component="SessionMode"
      instanceId="session-mode"
      props={{ modes: NO_MODES }}
      frame={(tree) => (
        <span aria-label={PLUGIN_SITES.mode} data-plugin-mode="" className="inline-flex h-6 max-w-64 min-w-0 shrink items-center overflow-hidden px-1.5 text-ui-sm whitespace-nowrap text-fg-muted">
          {tree}
        </span>
      )}
      engine={(answer) => {
        const words = answer?.hooked ? rewrittenModes(answer) : '';
        return words ? (
          <span aria-label={PLUGIN_SITES.mode} data-plugin-mode="" className="inline-flex h-6 items-center px-1.5 text-ui-sm whitespace-nowrap text-fg-muted">
            {words}
          </span>
        ) : null;
      }}
    />
  );
}

export function PluginHint({ appSessionId, isDraft, isWorking }: { appSessionId: AppSessionId; isDraft: boolean; isWorking: boolean }) {
  return (
    <SurfaceSite
      appSessionId={appSessionId}
      component="PromptHint"
      instanceId="prompt-hint"
      props={{ isDraft, isWorking, hint: '' }}
      frame={(tree) => (
        <p aria-label={PLUGIN_SITES.hint} data-plugin-hint="" className="m-0 min-w-0 truncate px-3 text-ui-sm text-fg-faint">
          {tree}
        </p>
      )}
      engine={(answer) => {
        const words = answer?.hooked ? rewrittenHint(answer) : '';
        return words ? (
          <p aria-label={PLUGIN_SITES.hint} data-plugin-hint="" className="m-0 min-w-0 truncate px-3 text-ui-sm text-fg-faint">
            {words}
          </p>
        ) : null;
      }}
    />
  );
}
