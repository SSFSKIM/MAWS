// P3-HD M2: the write guard alone (./direct-wire.ts); the SDK-driven paths are in ./direct-client.test.ts.
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { DirectWire, DirectWireRefusal } from './direct-wire';

const call = (id: number): JSONRPCMessage => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'rows', arguments: {} } });
const list = (id: number): JSONRPCMessage => ({ jsonrpc: '2.0', id, method: 'tools/list' });
const cancelled = (id: number): JSONRPCMessage => ({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'x' } });
const answer = (id: number): JSONRPCMessage => ({ jsonrpc: '2.0', id, result: {} });

function wire(fence = () => true) {
  const faults: string[] = [];
  return { wire: new DirectWire(fence, (fault) => faults.push(fault)), faults };
}

describe('DirectWire', () => {
  it('fails a tools/call nobody armed closed, at send and at the write', () => {
    const { wire: guard } = wire();
    expect(() => guard.sending(call(1))).toThrow(DirectWireRefusal);
    expect(() => guard.writing(call(1))).toThrow(DirectWireRefusal);
  });

  it('binds the armed admission to the request the SDK sends and asks it once, at the write', () => {
    const { wire: guard } = wire();
    const admit = vi.fn(() => true);
    const request = guard.arm({ admit, signal: null, abort: null });
    expect(guard.sending(call(7))).toBe('write');
    expect(request.id).toBe(7);
    expect(admit).not.toHaveBeenCalled(); // not at send: only the actual write admits
    expect(guard.writing(call(7))).toBe(request);
    expect(admit).toHaveBeenCalledTimes(1);
    expect(request.admitted).toBe(true);
    expect(() => guard.writing(call(7))).toThrow(DirectWireRefusal); // never a second submission of one request
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the admission says no (or throws) at the write', () => {
    for (const admit of [() => false, () => { throw new Error('store gone'); }]) {
      const { wire: guard } = wire();
      const request = guard.arm({ admit, signal: null, abort: null });
      guard.sending(call(1));
      expect(() => guard.writing(call(1))).toThrow(DirectWireRefusal);
      expect(request).toMatchObject({ admitted: false, fault: 'refused' });
    }
  });

  it("checks the connection's fence at every write, connection traffic included", () => {
    let held = true;
    const { wire: guard, faults } = wire(() => held);
    guard.sending(list(1));
    expect(guard.writing(list(1))).toBeDefined();
    held = false;
    guard.sending(list(2));
    expect(() => guard.writing(list(2))).toThrow(DirectWireRefusal);
    expect(() => guard.writing({ jsonrpc: '2.0', method: 'notifications/initialized' })).toThrow(DirectWireRefusal);
    expect(faults).toContain('fenced');
  });

  it('writes nothing for a request whose own signal aborted before the write', () => {
    const { wire: guard } = wire();
    const controller = new AbortController();
    const admit = vi.fn(() => true);
    guard.arm({ admit, signal: controller.signal, abort: null });
    guard.sending(call(3));
    controller.abort();
    expect(() => guard.writing(call(3))).toThrow(DirectWireRefusal);
    expect(admit).not.toHaveBeenCalled();
  });

  it('forwards a cancellation only for a request written and not yet answered', () => {
    const { wire: guard } = wire();
    guard.arm({ admit: () => true, signal: null, abort: null });
    guard.sending(call(1)); // sent to the transport, never written
    expect(guard.sending(cancelled(1))).toBe('drop');
    guard.arm({ admit: () => true, signal: null, abort: null });
    guard.sending(call(2));
    guard.writing(call(2));
    expect(guard.sending(cancelled(2))).toBe('write');
    guard.received(answer(2));
    expect(guard.sending(cancelled(2))).toBe('drop'); // completed: the SDK's retained abort listener must not cancel it
    expect(guard.sending(cancelled(99))).toBe('drop');
  });

  it('refuses everything once closed', () => {
    const { wire: guard } = wire();
    guard.close();
    expect(() => guard.sending(list(1))).toThrow(DirectWireRefusal);
    expect(() => guard.writing(list(1))).toThrow(DirectWireRefusal);
  });

  it('fails an over-bound request through its own abort and reports the fault', () => {
    const { wire: guard, faults } = wire();
    const abort = vi.fn();
    const request = guard.arm({ admit: () => true, signal: null, abort });
    guard.sending(call(4));
    guard.writing(call(4));
    guard.fault(request, 'tooLarge');
    expect(request.fault).toBe('tooLarge');
    expect(abort).toHaveBeenCalledTimes(1);
    expect(faults).toEqual(['tooLarge']);
  });
});
