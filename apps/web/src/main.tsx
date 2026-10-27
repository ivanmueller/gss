import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { AuthCard } from './auth/AuthCard';
import { AuthGate } from './auth/AuthGate';
import './index.css';
import { supabase } from './lib/supabase';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    {supabase ? (
      <AuthGate auth={supabase.auth}>{(account) => <App account={account} />}</AuthGate>
    ) : (
      <AuthCard title="Sign-in is not configured">
        <p className="text-sm text-muted-foreground">
          This build has no VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.
        </p>
      </AuthCard>
    )}
  </StrictMode>,
);
