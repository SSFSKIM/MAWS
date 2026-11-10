// The repair window's entry (P5 O15 M2, Interfaces §B): its own renderer input (electron.vite.config.ts,
// src/renderer/repair.html), with the app's tokens and nothing else of the app.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { RepairBridge } from '@shared/repair';
import { RepairPage } from './RepairPage';
import '../styles/app.css';

const bridge = (window as unknown as { repair: RepairBridge }).repair;
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RepairPage bridge={bridge} />
  </StrictMode>,
);
