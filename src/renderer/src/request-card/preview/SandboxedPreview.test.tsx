import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SandboxedPreview, setPreviewPolicy } from './SandboxedPreview';

const root = document.documentElement;
afterEach(() => {
  cleanup();
  root.style.removeProperty('--fg');
  root.dataset.theme = 'light';
});

describe('sandboxed preview', () => {
  it('isolates the preview and follows a theme switch', async () => {
    root.dataset.theme = 'light';
    root.style.setProperty('--fg', 'light-ink');
    render(<SandboxedPreview preview="<b>Red</b>" title="Preview of Red" />);
    const frame = screen.getByTitle('Preview of Red');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('color:light-ink');
    expect(frame.getAttribute('srcdoc')).toContain('<b>Red</b>');

    await act(async () => {
      root.style.setProperty('--fg', 'dark-ink');
      root.dataset.theme = 'dark'; // what App does when the resolved theme changes
      await new Promise((resolve) => setTimeout(resolve, 0)); // the attribute observer's callback
    });
    expect(screen.getByTitle('Preview of Red').getAttribute('srcdoc')).toContain('color:dark-ink');
  });

  it('adds no policy of its own by default: the frame inherits the app’s', () => {
    render(<SandboxedPreview preview="<b>Red</b>" title="Preview" />);
    expect(screen.getByTitle('Preview').getAttribute('srcdoc')).toMatch(/^<!doctype html><meta charset="utf-8"><style>/);
  });

  it('puts a host’s policy ahead of the preview once the host sets one', () => {
    setPreviewPolicy("default-src 'none'");
    try {
      render(<SandboxedPreview preview="<b>Red</b>" title="Preview" />);
      expect(screen.getByTitle('Preview').getAttribute('srcdoc')).toMatch(/^<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><style>/);
    } finally {
      setPreviewPolicy(null);
    }
  });
});
