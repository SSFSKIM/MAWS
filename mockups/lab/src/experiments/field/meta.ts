import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'field',
  order: 10,
  name: 'Field',
  thesis: 'The app owns a quiet warm colour field; the sidebar is one pane of real glass over it, and all reading happens on an opaque sheet.',
  notes: [
    'The field is ambience and carries no meaning. Flip its strength: at Whisper the pane is plain frost; at Vivid ask whether this is still an app or a wallpaper.',
    'Collapse the sidebar (top left of the sheet) and open it again: the pane and the sheet travel together on one curve.',
    'Click the row that waits for approval, and ⋯ on any session row: platters of the same glass, only ever over the field.',
    'On the settings page, click a setting\'s name: the explanation the app prints today unfolds there and nowhere else.',
    'Cost: the lens needs WebGPU. Without it the pane is the same frost with no bend, and at rest the two are hard to tell apart.',
  ],
  scenes: ['session', 'settings', 'home'],
  knobs: [
    { id: 'field', label: 'Field strength', default: 'warm', options: [
        { value: 'whisper', label: 'Whisper' }, { value: 'soft', label: 'Soft' }, { value: 'warm', label: 'Warm' }, { value: 'vivid', label: 'Vivid' },
      ] },
    { id: 'light', label: 'Sheet, light', default: 'white', options: [{ value: 'white', label: '#FFFFFF' }, { value: 'paper', label: '#faf9f5' }] },
    { id: 'dark', label: 'Sheet, dark', default: '191919', options: [
        { value: '191919', label: '#191919' }, { value: '191c19', label: '#191c19' }, { value: '1f1f1f', label: '#1f1f1f' }, { value: '000000', label: '#000000' },
      ] },
  ],
  Component: lazy(() => import('./Field')),
};
