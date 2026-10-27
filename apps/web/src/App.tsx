import type { ReactNode } from 'react';

import type { Account } from './auth/AuthGate';
import { AppHeader } from './components/AppHeader';
import { Link, matchRoute, usePath } from './lib/router';
import { useApiHealth } from './lib/useApiHealth';
import { useMe } from './lib/useMe';
import { CoordinatesPage } from './pages/CoordinatesPage';
import { CounterpartiesPage, type DirectorySession } from './pages/CounterpartiesPage';
import { CounterpartyPage } from './pages/CounterpartyPage';
import { ImportPage } from './pages/ImportPage';
import { MapPage } from './pages/MapPage';
import { Workspace } from './pages/Workspace';

function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm">{children}</p>;
}

export function App({ account }: { account?: Account }) {
  const health = useApiHealth();
  const me = useMe(account?.accessToken ?? null);
  const route = matchRoute(usePath());
  const organization = me.status === 'ok' ? (me.organizations[0] ?? null) : undefined;

  // Pages with the organization's records need a signed-in member of an organization.
  function directory(render: (session: DirectorySession) => ReactNode): ReactNode {
    if (!account) return <Notice>Sign in to see your organization’s counterparties.</Notice>;
    if (me.status === 'error')
      return <Notice>The server could not confirm your organization. Reload to try again.</Notice>;
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
    case 'map':
      page = directory((session) => <MapPage session={session} />);
      break;
    case 'coordinates':
      page = directory((session) => <CoordinatesPage session={session} />);
      break;
    case 'counterparties':
      page = directory((session) => <CounterpartiesPage session={session} />);
      break;
    case 'import':
      page = directory((session) => <ImportPage session={session} />);
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
          <Link href="/" className="underline underline-offset-4">
            Go to the workspace
          </Link>
          .
        </Notice>
      );
      break;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader
        health={health}
        current={
          route.page === 'workspace' || route.page === 'map'
            ? route.page
            : route.page === 'coordinates'
              ? 'map'
              : route.page === 'not-found'
                ? null
                : 'counterparties'
        }
        {...(account && {
          user: {
            name: me.status === 'ok' ? me.name : null,
            check: me.status,
            onSignOut: account.signOut,
          },
        })}
      />
      <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4">{page}</main>
    </div>
  );
}
