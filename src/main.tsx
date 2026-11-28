import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { CloudLoginGate } from './components/CloudLoginGate.tsx';
import { MobileApp, isMobileMode } from './components/Mobile/MobileApp.tsx';
import './index.css';

// Chrome offers installation right after loading – before login and before
// React shows the install hint. Keep the offer so the hint can use it later.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  (window as Window & { __woodmoInstallPrompt?: Event }).__woodmoInstallPrompt = event;
  window.dispatchEvent(new Event('woodmo:install-available'));
});

// Offline bookings wait in this device's browser storage (IndexedDB) until the
// cloud confirms them. Ask the browser to keep that storage even when the
// device runs low on space; installed apps are normally granted this.
void navigator.storage?.persist?.().catch(() => false);

// 27.11.: Handy-Modus (?mobil=pfand|admin) ist eine eigene Seite ohne Kassen-App und ohne Cloud-Konto.
createRoot(document.getElementById('root')!).render(isMobileMode() ? (
  <StrictMode>
    <MobileApp />
  </StrictMode>
) : (
  <StrictMode>
    <CloudLoginGate>
      {adminStartup => <App adminStartup={adminStartup} />}
    </CloudLoginGate>
  </StrictMode>
));
