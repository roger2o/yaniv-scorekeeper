import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

// Theme layer: tokens first (CSS variables), then the floor (which consumes
// them), then shared app primitives. Order matters — tokens must load before
// any rule that references them.
import './theme/tokens.css';
import './theme/floor.css';
import './theme/app.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
