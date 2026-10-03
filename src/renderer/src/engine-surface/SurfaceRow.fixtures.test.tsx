// The seven real 2.1.287 ui_render sites, replayed through the same wrapper the transcript mounts.
// Scenario names come from the probe, not the renderer's classifier: changing a renderer outcome must fail here.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptProps, TranscriptSite } from '@shared/engine/surface-rows';
import type { RenderAnswer } from '@shared/engine/surface';
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../test/support/builders';
import { loadJournal } from '../../../../test/support/fixtures';
import { fakeClient } from '../../../../test/support/fake-client';
import { useSessions } from '../stores/sessions';
import { resetSurfaceRegistry } from './registry';
import { SurfaceRow } from './SurfaceRow';

interface Request {
  subtype: 'ui_render';
  component: TranscriptSite;
  instance_id: string;
  props: TranscriptProps[TranscriptSite];
}
interface Case { request: Request; answer: RenderAnswer; scenario: string }
function cases(name: string): Case[] {
  const asked = new Map<string, Request>();
  const result: Case[] = [];
  for (const row of loadJournal('pass3', `mods-surface-transcript-${name}`)) {
    const frame = row.frame as { type: string; request_id?: string; request?: Request; response?: { request_id: string; response?: RenderAnswer } };
    if (row.direction === 'out' && frame.type === 'control_request' && frame.request?.subtype === 'ui_render') asked.set(frame.request_id!, frame.request);
    if (row.direction !== 'in' || frame.type !== 'control_response' || !frame.response?.response) continue;
    const request = asked.get(frame.response.request_id);
    if (request) result.push({ request, answer: frame.response.response, scenario: request.instance_id.split(':').at(-1)! });
  }
  return result;
}
const ID = 'r3-fixtures' as AppSessionId;
beforeEach(() => {
  resetSurfaceRegistry();
  useSessions.setState({ engine: new Map([[ID, { ...status(ID), uiSurface: { clientId: 'maws-main' } }]]) });
});
afterEach(cleanup);

const names = ['user-message', 'assistant-message', 'command-output', 'tool-use', 'tool-result', 'tool-group', 'ask-user-question'];
for (const name of names) {
  describe(`recorded ${name}`, () => {
    const recorded = cases(name);
    it('covers all six recorded outcomes', () => {
      expect(recorded.map((row) => row.scenario)).toEqual(['engine-slot-rewrite', 'replacement', 'rewrite-alone', 'inkless', 'invalid-rewrite', 'passthrough']);
    });
    for (const { request, answer, scenario } of recorded) {
      it(scenario, async () => {
        const fake = fakeClient();
        render(<SurfaceRow appSessionId={ID} component={request.component} instanceId={request.instance_id} props={request.props} client={fake.client}>{(props) => <button data-testid="native">{JSON.stringify(props)}</button>}</SurfaceRow>);
        expect(fake.invoked('session.ui.render')).toEqual([{ appSessionId: ID, component: request.component, instanceId: request.instance_id, props: request.props }]);
        await act(() => fake.reply('session.ui.render', answer));
        const isQuestion = request.component === 'AskUserQuestion';
        const hidden = !isQuestion && (scenario === 'inkless' || scenario === 'replacement');
        if (hidden) {
          expect(screen.queryByRole('button')).toBeNull();
          expect(screen.getByTestId('native').closest('[inert]')).not.toBeNull();
          if (scenario === 'replacement') expect(screen.getByText(`R3 replacement ${request.component}`)).toBeTruthy();
          else expect(document.querySelector('[data-surface="text"]')).toBeNull();
        } else {
          const native = screen.getByRole('button');
          const actual = JSON.parse(native.textContent!) as Record<string, unknown>;
          if (scenario === 'engine-slot-rewrite' || scenario === 'rewrite-alone') {
            switch (request.component) {
              case 'UserMessage': case 'AssistantMessage': case 'CommandOutput': expect(actual.text).toBe('R3 rewritten text'); break;
              case 'ToolUse': expect(actual.input).toEqual({ command: 'printf rewritten' }); break;
              case 'ToolResult': expect(actual.output).toEqual({ stdout: 'R3 rewritten output', stderr: '', interrupted: false }); break;
              case 'ToolGroup': expect(actual.isExpanded).toBe(true); break;
              case 'AskUserQuestion': expect(actual.questions).toMatchObject([{ question: 'R3 rewritten question' }]); break;
            }
            if (scenario === 'engine-slot-rewrite') expect(native.closest('[data-surface="box"]')?.textContent).toContain('R3 slot');
          } else {
            // The engine has already refused invalid rewrites. AskUserQuestion also refuses replacement/inkless
            // drawings before sending them to the client, returning its bare native reference unchanged.
            expect(actual).toEqual(request.props);
            expect(document.querySelector('[data-plugin-drawn]')).toBeNull();
          }
        }
      });
    }
  });
}

it('the recorded owner mod puts its single rewritten native body at the first of three refs only', async () => {
  const row = cases('to-human').find(({ request }) => request.instance_id === 'owner-multi')!;
  const fake = fakeClient();
  render(<SurfaceRow appSessionId={ID} component="AssistantMessage" instanceId={row.request.instance_id} props={row.request.props as TranscriptProps['AssistantMessage']} client={fake.client}>{(props) => <span data-testid="owner-native">{props.text}</span>}</SurfaceRow>);
  await act(() => fake.reply('session.ui.render', row.answer));
  expect(screen.getAllByTestId('owner-native')).toHaveLength(1);
  expect(screen.getByTestId('owner-native').textContent).toBe('First **span**.');
  expect(screen.getByTestId('owner-native').closest('[data-surface="box"]')?.parentElement?.textContent).toContain('to human');
  expect(screen.getByText('essential')).toBeTruthy();
  expect(screen.getByText('need input')).toBeTruthy();
  expect(screen.queryByText('Second span.')).toBeNull();
  expect(screen.getByRole('button', { name: 'working record' })).toBeTruthy();
});

describe('recorded unhooked sites', () => {
  for (const { request, answer } of cases('unhooked')) {
    it(request.component, async () => {
      const fake = fakeClient();
      const make = (instanceId: string) => <SurfaceRow appSessionId={ID} component={request.component} instanceId={instanceId} props={request.props} client={fake.client}>{() => <button>native</button>}</SurfaceRow>;
      const view = render(make(request.instance_id));
      await act(() => fake.reply('session.ui.render', answer));
      expect(screen.getByRole('button', { name: 'native' })).toBeTruthy();
      view.rerender(make(`${request.instance_id}:later`));
      expect(screen.getByRole('button', { name: 'native' })).toBeTruthy();
      expect(fake.invoked('session.ui.render')).toHaveLength(1);
    });
  }
});

it('recorded ToolResult replacement is ignored under onlyRewrites; recorded group rewrite expands beside its drawing', async () => {
  const result = cases('tool-result').find((row) => row.scenario === 'replacement')!;
  const group = cases('tool-group').find((row) => row.scenario === 'engine-slot-rewrite')!;
  const fake = fakeClient();
  const onRewrite = vi.fn();
  const view = render(<SurfaceRow appSessionId={ID} component="ToolResult" instanceId={result.request.instance_id} props={result.request.props as TranscriptProps['ToolResult']} onlyRewrites frameInkOnly client={fake.client}>{() => <button>result native</button>}</SurfaceRow>);
  await act(() => fake.reply('session.ui.render', result.answer));
  expect(screen.getByRole('button', { name: 'result native' })).toBeTruthy();
  expect(screen.queryByText('R3 replacement ToolResult')).toBeNull();
  view.unmount();
  render(<SurfaceRow appSessionId={ID} component="ToolGroup" instanceId={group.request.instance_id} props={group.request.props as TranscriptProps['ToolGroup']} drawingOnly onRewrite={onRewrite} client={fake.client}>{() => <button>duplicated group</button>}</SurfaceRow>);
  await act(() => fake.reply('session.ui.render', group.answer));
  expect(onRewrite).toHaveBeenCalledWith(expect.objectContaining({ isExpanded: true }));
  expect(screen.getByText('R3 slot')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});
