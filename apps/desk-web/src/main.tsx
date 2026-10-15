import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';

document.documentElement.dataset.theme = 'light'; // light first (MAWS's D-4); the desk has no theme setting yet

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
