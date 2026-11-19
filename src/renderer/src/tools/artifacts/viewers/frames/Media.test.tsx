// P2-F W-V (L95, §2 item 6): a delivered video fits the pane by default (grown or shrunk, its aspect kept) and zooms in
// and out, to actual size and back to fit from the bar above it; audio keeps its plain player.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installResizeObserver } from '../../../../test-support/resize';
import { Media } from './Media';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Media', () => {
  it('fits a small video to the pane, and zooms in, to actual size and back to fit', () => {
    const { resize } = installResizeObserver();
    render(<Media kind="video" url="maws-artifact://00000000-0000-4000-8000-000000000001/1/clip.webm" />);
    const video = document.querySelector<HTMLVideoElement>('video[data-artifact-media="video"]')!;
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
    render(<Media kind="audio" url="maws-artifact://00000000-0000-4000-8000-000000000001/1/clip.webm" />);
    expect(document.querySelector('audio[data-artifact-media="audio"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
  });

  // UX wave U6b-2 (M5, decision 6): a file's video or sound keeps its position across a move and a hide, and tells the
  // viewer an error the element reports.
  it.each(['video', 'audio'] as const)('sets the start time once the metadata has loaded and reports the time as it plays (%s)', (kind) => {
    installResizeObserver();
    const play = vi.spyOn(window.HTMLMediaElement.prototype, 'play');
    const onTime = vi.fn();
    render(<Media kind={kind} url="maws-artifact://00000000-0000-4000-8000-000000000001/1/clip.webm" startAt={42.5} onTime={onTime} />);
    const element = document.querySelector<HTMLMediaElement>(`[data-artifact-media="${kind}"]`)!;
    Object.defineProperty(element, 'currentTime', { value: 0, writable: true, configurable: true });
    expect(element.currentTime).toBe(0); // nothing set before the metadata
    fireEvent.loadedMetadata(element);
    expect(element.currentTime).toBe(42.5);
    element.currentTime = 43.25;
    fireEvent.timeUpdate(element);
    expect(onTime).toHaveBeenLastCalledWith(43.25);
    fireEvent.loadedMetadata(element); // set once: a second metadata event moves nothing
    expect(element.currentTime).toBe(43.25);
    expect(play).not.toHaveBeenCalled();
  });

  it('tells its owner the element’s error', () => {
    installResizeObserver();
    const onError = vi.fn();
    render(<Media kind="audio" url="maws-artifact://00000000-0000-4000-8000-000000000001/1/clip.webm" onError={onError} />);
    fireEvent.error(document.querySelector('audio')!);
    expect(onError).toHaveBeenCalledOnce();
  });
});
