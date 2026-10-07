// E11 (tracker row E10 "14 will-quit listeners"): main's will-quit steps are one ordered list behind one listener.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { shutdownSteps } from './shutdown';

describe('the shutdown list', () => {
  it('registers one will-quit listener, however many steps, and runs the steps in the order they were added', () => {
    const app = new EventEmitter();
    const ran: string[] = [];
    const steps = shutdownSteps(app);
    for (const name of ['deliverables', 'git', 'chat panels', 'layout and sessions', 'index', 'usage', 'files', 'scm', 'yield', 'side threads', 'engine configure', 'host configure', 'widgets', 'browser', 'import', 'hosts', 'voice']) {
      steps.add(name, () => void ran.push(name));
    }
    expect(app.listenerCount('will-quit')).toBe(1);
    app.emit('will-quit');
    expect(ran).toEqual(['deliverables', 'git', 'chat panels', 'layout and sessions', 'index', 'usage', 'files', 'scm', 'yield', 'side threads', 'engine configure', 'host configure', 'widgets', 'browser', 'import', 'hosts', 'voice']);
  });

  it('a step that throws is logged by name and the steps after it still run', () => {
    const app = new EventEmitter();
    const ran: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const steps = shutdownSteps(app);
      steps.add('index', () => {
        throw new Error('database is locked');
      });
      steps.add('hosts', () => void ran.push('hosts'));
      app.emit('will-quit');
      expect(ran).toEqual(['hosts']);
      expect(error).toHaveBeenCalledWith('[shutdown] index failed; going on', expect.objectContaining({ message: 'database is locked' }));
    } finally {
      error.mockRestore();
    }
  });
});
