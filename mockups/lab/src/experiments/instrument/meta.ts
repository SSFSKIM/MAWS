import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'instrument',
  order: 40,
  name: 'Instrument',
  thesis:
    'Everything you read is ink on one pure ground; the only objects on screen are a few pieces of glass, and each one is a control with content passing under it.',
  notes: [
    'Glass on screen at rest: the window buttons, the tabs, the approval, the composer. Everything else is ink on the ground.',
    'Scroll the transcript and watch text and the green diff pass under the tabs and the composer. That is the whole job of the material here.',
    'Collapse the sidebar (top left). Docked it is print, because nothing lies behind it; floating, it becomes a glass rail.',
    'The one coloured control is the approval that waits for you. Press it: the platter grows out of the button.',
    'Settings: the help text waits in the margin until a row is pointed at or focused.',
    'The cost: over empty white ground, light glass is a soft shadow and little else. Dark shows it far better. Flip the composer to opaque to judge what the glass adds.',
  ],
  scenes: ['session', 'settings'],
  knobs: [
    {
      id: 'light',
      label: 'Light ground',
      options: [
        { value: 'ffffff', label: '#FFFFFF' },
        { value: 'faf9f5', label: '#FAF9F5' },
      ],
      default: 'ffffff',
    },
    {
      id: 'dark',
      label: 'Dark ground',
      options: [
        { value: '000000', label: '#000000' },
        { value: '191919', label: '#191919' },
        { value: '191c19', label: '#191C19' },
        { value: '1f1f1f', label: '#1F1F1F' },
      ],
      default: '000000',
    },
    {
      id: 'composer',
      label: 'Composer',
      options: [
        { value: 'glass', label: 'Glass' },
        { value: 'opaque', label: 'Opaque' },
      ],
      default: 'glass',
    },
    {
      id: 'sidebar',
      label: 'Sidebar',
      options: [
        { value: 'docked', label: 'Docked, print' },
        { value: 'rail', label: 'Floating, glass' },
      ],
      default: 'docked',
    },
  ],
  Component: lazy(() => import('./Instrument')),
};
