import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './ui/theme/tokens.css';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
