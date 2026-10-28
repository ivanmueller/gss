import '@fontsource-variable/figtree/wght.css';
import '@fontsource-variable/ibm-plex-sans/wght.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { AuthCard } from './auth/AuthCard';
import { AuthGate } from './auth/AuthGate';
import { supabase } from './lib/supabase';
import { startThemeSync } from './lib/theme';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

startThemeSync();

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
