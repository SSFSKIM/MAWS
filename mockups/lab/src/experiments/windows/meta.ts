import { lazy } from 'react';
import type { Experiment } from '../../lab/types';

export const experiment: Experiment = {
  id: 'windows',
  order: 20,
  name: 'Windows',
  thesis:
    'Everything is glass: three windows over one painted environment, the tab strip and the composer hung outside the session window as ornaments, and the transcript read on the glass itself.',
  notes: [
    'Read a paragraph of the transcript, then flip Reading from Glass to Veil to Sheet: that difference is what the idea costs or buys.',
    'Room between windows: Derived is what the glass library asks for (65 px); Tight is what an eye would draw, and breaks its rule.',
    'Collapse the sidebar (its top right), open the orange Approval capsule, the model menu in the composer, a folded tool run, the rings at the bottom left.',
    'Dark is a second print of each scene at ember levels: the dark glass cannot carry text over a bright one. DESIGN.md has the measurements.',
  ],
  scenes: ['session', 'settings', 'home'],
  knobs: [
    {
      id: 'env',
      label: 'Environment',
      options: [
        { value: 'sun', label: 'Sun' },
        { value: 'dunes', label: 'Dunes' },
        { value: 'orbit', label: 'Orbit' },
      ],
      default: 'sun',
    },
    {
      id: 'ground',
      label: 'Ground (dark · light)',
      options: [
        { value: 'a', label: '#191919 · #faf9f5' },
        { value: 'b', label: '#191c19 · #faf9f5' },
        { value: 'c', label: '#000000 · #FFFFFF' },
        { value: 'd', label: '#1f1f1f · #FFFFFF' },
      ],
      default: 'a',
    },
    {
      id: 'reading',
      label: 'Reading',
      options: [
        { value: 'glass', label: 'Glass' },
        { value: 'veil', label: 'Veil' },
        { value: 'sheet', label: 'Sheet' },
      ],
      default: 'glass',
    },
    {
      id: 'gaps',
      label: 'Room between windows',
      options: [
        { value: 'derived', label: 'Derived' },
        { value: 'tight', label: 'Tight' },
      ],
      default: 'derived',
    },
  ],
  Component: lazy(() => import('./Windows')),
};
