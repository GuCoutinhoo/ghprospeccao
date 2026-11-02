import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import TemporaryProspectingView from './components/temporary/TemporaryProspectingView.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {(window.location.pathname.replace(/\/$/, '') === '/f/test' || window.location.pathname === '/temporario') ? <TemporaryProspectingView /> : <App />}
  </StrictMode>,
);
