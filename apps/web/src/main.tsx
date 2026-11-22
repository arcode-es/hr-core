import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import './i18n';
import './index.css';
import { queryClient } from './lib/query';
import { router } from './router';
import { useMeta } from './stores/meta';
import { useSession } from './stores/session';
import './stores/theme';
import { Toaster } from './ui/Toaster';

void useMeta.getState().load();
void useSession.getState().bootstrap();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
