import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { NetworkProvider } from './context/NetworkContext';
import { ErrorBoundary } from './components/ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <NetworkProvider>
        <App />
      </NetworkProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
