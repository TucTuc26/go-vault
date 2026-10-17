import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './ui/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker (solo producción): funciona sin conexión y avisa de versiones nuevas
if (import.meta.env.PROD) void import('./app/pwa').then((m) => m.initPwa());
