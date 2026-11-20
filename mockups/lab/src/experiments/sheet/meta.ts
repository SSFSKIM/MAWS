import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'sheet',
  order: 1,
  name: 'Sheet',
  thesis:
    'Field kept whole: the warm colour runs under the window, the transcript is read on one opaque sheet, and every control (both panes, the tabs, the composer) is glass standing on the colour around it.',
  notes: [
    'Field\'s pane with Quiet\'s sidebar in it; Instrument\'s tab capsule; Quiet\'s transcript and tool blocks without the serif; a glass composer below the sheet, where the colour gathers.',
    'Go to New chat: with nothing to read there is no sheet, and the colour follows the composer to the middle of the window.',
    'The right pane is a glass card as tall as the sheet, with the colour open on all four sides of it. Close it (top right) and open it again; then the left pane. Each leaves by its own edge and the sheet takes the room.',
    'Three sessions wait: the orange capsule at the top right lists them, and resting the pointer on "Fix flaky upload test" in the sidebar brings its card. Approve from either.',
    'Tool blocks stay as Quiet drew them, not glass: on the sheet a block has only the sheet behind it. Open "Edited 3 files" to see one.',
    'Settings: Quiet\'s page with Instrument\'s controls. Lists are pills, a sentence waits beside its row, and a choice (Sessions, Browser) opens as glass.',
    'Flip "Field around the sheet": how far the sheet can stand from the glass before the window reads as cards on a wallpaper.',
  ],
  scenes: ['session', 'settings', 'home'],
  knobs: [
    {
      id: 'field',
      label: 'Field strength',
      default: 'warm',
      options: [
        { value: 'whisper', label: 'Whisper' },
        { value: 'soft', label: 'Soft' },
        { value: 'warm', label: 'Warm' },
        { value: 'vivid', label: 'Vivid' },
      ],
    },
    {
      id: 'ground',
      label: 'Sheet (light · dark)',
      default: 'a',
      options: [
        { value: 'a', label: '#FFFFFF · #191919' },
        { value: 'b', label: '#faf9f5 · #191c19' },
        { value: 'c', label: '#FFFFFF · #1f1f1f' },
        { value: 'd', label: '#faf9f5 · #000000' },
      ],
    },
    {
      id: 'type',
      label: 'Typeface',
      default: 'system',
      options: [
        { value: 'figtree', label: 'Figtree (Field)' },
        { value: 'geist', label: 'Geist (Instrument)' },
        { value: 'system', label: 'System' },
      ],
    },
    {
      id: 'frame',
      label: 'Field around the sheet',
      default: 'hairline',
      options: [
        { value: 'hairline', label: 'Hairline' },
        { value: 'band', label: 'Band' },
        { value: 'frame', label: 'Frame' },
      ],
    },
  ],
  Component: lazy(() => import('./Sheet')),
};
