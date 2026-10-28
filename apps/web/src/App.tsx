import { useEffect, type ReactNode } from 'react';

import type { Account } from './auth/AuthGate';
import { AppShell, type NavSection } from './components/AppShell';
import { Link, matchRoute, redirect, usePath, type Route } from './lib/router';
import { useApiHealth } from './lib/useApiHealth';
import { useMe } from './lib/useMe';
import { CoordinatesPage } from './pages/CoordinatesPage';
import { CounterpartiesPage, type DirectorySession } from './pages/CounterpartiesPage';
import { CounterpartyPage } from './pages/CounterpartyPage';
import { ImportPage } from './pages/ImportPage';
import { NewCounterpartyPage } from './pages/NewCounterpartyPage';
import { Workspace } from './pages/Workspace';

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-card border bg-card px-4 py-10 text-center text-sm text-muted-foreground shadow-xs">
      {children}
    </p>
  );
}

/** The menu entry a page belongs to. */
function section(route: Route): NavSection | null {
  switch (route.page) {
    case 'workspace':
      return 'workspace';
    case 'counterparties':
    case 'new-counterparty':
    case 'import':
    case 'coordinates':
    case 'counterparty':
      return 'counterparties';
    case 'redirect':
    case 'not-found':
      return null;
  }
}

export function App({ account }: { account?: Account }) {
  const health = useApiHealth();
  const me = useMe(account?.accessToken ?? null);
  const route = matchRoute(usePath());
  const organization = me.status === 'ok' ? (me.organizations[0] ?? null) : undefined;
  const redirectTo = route.page === 'redirect' ? route.to : null;

  // Old addresses (the map page before it moved into Counterparties) keep working.
  useEffect(() => {
    if (redirectTo !== null) redirect(redirectTo);
  }, [redirectTo]);

  // Pages with the organization's records need a signed-in member of an organization.
  function directory(render: (session: DirectorySession) => ReactNode): ReactNode {
    if (!account) return <Notice>Sign in to see your organization’s counterparties.</Notice>;
    if (me.status === 'error')
      return (
        <Notice>Your organization’s records appear once the server confirms your session.</Notice>
      );
    if (organization === undefined) return <Notice>Loading…</Notice>;
    if (organization === null) {
      return (
        <Notice>
          You are not a member of an organization yet. Ask an administrator to add you.
        </Notice>
      );
    }
    return render({ token: account.accessToken, organization });
  }

  let page: ReactNode;
  switch (route.page) {
    case 'workspace':
      page = <Workspace />;
      break;
    case 'coordinates':
      page = directory((session) => <CoordinatesPage session={session} />);
      break;
    case 'counterparties':
      page = directory((session) => <CounterpartiesPage session={session} />);
      break;
    case 'new-counterparty':
      page = directory((session) => <NewCounterpartyPage session={session} />);
      break;
    case 'import':
      page = directory((session) => <ImportPage session={session} />);
      break;
    case 'redirect':
      page = null;
      break;
    case 'counterparty':
      page = directory((session) => (
        <CounterpartyPage key={route.id} session={session} id={route.id} />
      ));
      break;
    case 'not-found':
      page = (
        <Notice>
          This page does not exist.{' '}
          <Link href="/" className="font-medium text-foreground underline underline-offset-4">
            Go to the workspace
          </Link>
          .
        </Notice>
      );
      break;
  }

  return (
    <AppShell
      current={section(route)}
      health={health}
      {...(account && {
        user: {
          name: me.status === 'ok' ? me.name : null,
          check: me.status,
          onSignOut: account.signOut,
        },
      })}
    >
      {page}
    </AppShell>
  );
}
