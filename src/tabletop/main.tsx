import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './ui/theme/tokens.css';
import { registerSW } from 'virtual:pwa-register';

// A new version is fetched as soon as it is published, not only when the page is next opened: an open tab checks
// every half hour and whenever it comes back into view, and reloads into the new version once it is in.
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    setInterval(() => void reg.update(), 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update(); });
  },
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
