import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AdminApiProvider } from './api/AdminApiContext.tsx';
import './styles.css';
import './i18n.ts';

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 挂载点');

createRoot(container).render(
  <StrictMode>
    <AdminApiProvider>
      <App />
    </AdminApiProvider>
  </StrictMode>,
);
