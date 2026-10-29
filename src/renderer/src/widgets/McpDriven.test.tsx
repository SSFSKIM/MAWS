// `/mcp` for a driven session (P5 O9 M5): it loads under StrictMode, shows each server's Reconnect and Disable drawn from
// their capabilities (an unavailable one disabled in place with its reason), and runs one command at a time.
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { ControlResult } from '@shared/ipc/schema/lane-a';
import { at } from '../../../../test/support/machine';
import type { Capability, ControlKey, SessionControls } from '../session/controls/types';
import { McpDriven } from './McpDriven';

const reads = vi.hoisted(() => ({ readLaneA: vi.fn(), followOp: vi.fn() }));
vi.mock('../lane-a/watches', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lane-a/watches')>()), readLaneA: reads.readLaneA }));
vi.mock('../lane-a/outcomes', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lane-a/outcomes')>()), followOp: reads.followOp }));

const ID = at('app-mcp') as AppSessionId;
const DISABLE_GAP = 'the route table drops /mcp disable on this engine';

function controlsWith(gaps: Partial<Record<ControlKey, string>>, command: (name: string, args: string) => Promise<ControlResult>): SessionControls {
  const capability = (key: ControlKey): Capability => (gaps[key] !== undefined ? { available: false, reason: gaps[key] } : { available: true });
  return { capability, command } as unknown as SessionControls;
}

beforeEach(() => {
  reads.readLaneA.mockResolvedValue({ ok: true, result: { exact: false, servers: [{ name: 'probe', status: 'connected', tools: 1 }] } });
  reads.followOp.mockReset();
});
afterEach(() => cleanup());

describe('McpDriven', () => {
  it('finishes loading under StrictMode', async () => {
    render(
      <StrictMode>
        <McpDriven appSessionId={ID} controls={controlsWith({}, vi.fn())} close={() => {}} />
      </StrictMode>,
    );
    await waitFor(() => expect(document.querySelector('[data-mcp-server="probe"]')).not.toBeNull());
  });

  it('shows Disable disabled in place with its reason when the bridge cannot disable, and runs it when it can', async () => {
    const command = vi.fn(async (): Promise<ControlResult> => ({ state: 'done', result: { id: 'run-1' } }));
    render(<McpDriven appSessionId={ID} controls={controlsWith({ 'mcp.disable': DISABLE_GAP }, command)} close={() => {}} />);
    const disable = await screen.findByRole('button', { name: 'Disable' });
    expect((disable as HTMLButtonElement).disabled).toBe(true);
    expect(disable.getAttribute('title')).toBe(DISABLE_GAP);
    cleanup();

    render(<McpDriven appSessionId={ID} controls={controlsWith({}, command)} close={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith('mcp', 'disable probe'));
  });

  it('sends one enable while one runs, Enter included', async () => {
    let finish: (result: ControlResult) => void = () => {};
    const command = vi.fn(() => new Promise<ControlResult>((resolve) => (finish = resolve)));
    render(<McpDriven appSessionId={ID} controls={controlsWith({}, command)} close={() => {}} />);
    const field = await screen.findByRole('textbox', { name: 'Server to enable' });
    fireEvent.change(field, { target: { value: 'github' } });
    fireEvent.submit(field.closest('form')!);
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    await act(async () => finish({ state: 'refused', code: 'x', message: 'no' }));
    expect(command).toHaveBeenCalledTimes(1);
  });
});
