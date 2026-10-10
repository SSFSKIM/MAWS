// P2-F W-V (L95, §2 item 6): a delivered video fits the pane by default (grown or shrunk, its aspect kept) and zooms in
// and out, to actual size and back to fit from the bar above it; audio keeps its plain player.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installResizeObserver } from '../../../test-support/resize';
import { Media } from './Media';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Media', () => {
  it('fits a small video to the pane, and zooms in, to actual size and back to fit', () => {
    const { resize } = installResizeObserver();
    render(<Media kind="video" url="maws-deliverable://a/b/1" />);
    const video = document.querySelector<HTMLVideoElement>('video[data-deliverable-media="video"]')!;
    const button = (name: string) => screen.getByRole('button', { name });
    expect(button('Zoom in')).toHaveProperty('disabled', true); // nothing to scale until the metadata says the size
    Object.defineProperties(video, { videoWidth: { value: 160 }, videoHeight: { value: 120 } });
    fireEvent.loadedMetadata(video);
    resize(document.querySelector('[data-zoom-stage]')!, { width: 800, height: 450 });
    const drawn = () => [video.style.width, video.style.height];
    expect(drawn()).toEqual(['600px', '450px']);
    fireEvent.click(button('Zoom in'));
    expect(drawn()).toEqual(['640px', '480px']);
    fireEvent.click(button('Actual size'));
    expect(drawn()).toEqual(['160px', '120px']);
    fireEvent.click(button('Fit'));
    expect(drawn()).toEqual(['600px', '450px']);
    fireEvent.click(video); // a click is the player's own (play and pause), never a zoom
    expect(drawn()).toEqual(['600px', '450px']);
  });

  it('draws audio as a plain player with no zoom', () => {
    installResizeObserver();
    render(<Media kind="audio" url="maws-deliverable://a/b/1" />);
    expect(document.querySelector('audio[data-deliverable-media="audio"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
  });
});
