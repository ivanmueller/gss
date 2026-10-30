import { useEffect, useState, type ReactNode } from 'react';

import type { Account } from './auth/AuthGate';
import { ChoosePassword, YourName } from './auth/FirstSignIn';
import { notePasswordChanged } from './auth/passwordNotice';
import { AppShell, type NavSection } from './components/AppShell';
import { Link, matchRoute, redirect, usePath, type Route } from './lib/router';
import { useApiHealth } from './lib/useApiHealth';
import { useFollowUpCount } from './lib/useFollowUpCount';
import { useMe } from './lib/useMe';
import { CounterpartiesPage, type DirectorySession } from './pages/CounterpartiesPage';
import { CounterpartyPage } from './pages/CounterpartyPage';
import { FollowUpsPage } from './pages/FollowUpsPage';
import { FreightPage } from './pages/FreightPage';
import { FreightRatePage } from './pages/FreightRatePage';
import { NewFreightPage } from './pages/NewFreightPage';
import { NewQuotePage } from './pages/NewQuotePage';
import { QuotePage } from './pages/QuotePage';
import { QuotesPage } from './pages/QuotesPage';
import { TeamPage } from './pages/TeamPage';
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
    case 'counterparty':
      return 'counterparties';
    case 'team':
      return 'team';
    case 'follow-ups':
      return 'follow-ups';
    case 'quotes':
    case 'new-quote':
    case 'quote':
      return 'quotes';
    case 'freight':
    case 'new-freight':
    case 'freight-rate':
      return 'freight';
    case 'redirect':
    case 'not-found':
      return null;
  }
}

export function App({ account }: { account?: Account }) {
  const health = useApiHealth();
  const [meVersion, setMeVersion] = useState(0);
  const me = useMe(account?.accessToken ?? null, meVersion);
  const route = matchRoute(usePath());
  const organization = me.status === 'ok' ? (me.organizations[0] ?? null) : undefined;
  const redirectTo = route.page === 'redirect' ? route.to : null;
  const userId = me.status === 'ok' ? (me.id ?? undefined) : undefined;
  const dueCount = useFollowUpCount(
    account && organization
      ? { token: account.accessToken, organizationId: organization.id }
      : null,
  );

  // Old addresses (the map page before it moved into Counterparties) keep working.
  useEffect(() => {
    if (redirectTo !== null) redirect(redirectTo);
  }, [redirectTo]);

  // Pages with GSS's records need a signed-in, active member.
  function directory(render: (session: DirectorySession) => ReactNode): ReactNode {
    if (!account) return <Notice>Sign in to see the counterparties.</Notice>;
    if (me.status === 'error')
      return <Notice>The records appear once the server confirms your session.</Notice>;
    if (organization === undefined) return <Notice>Loading…</Notice>;
    if (organization === null) {
      return <Notice>You don’t have access yet. Ask an admin to add you on the Team page.</Notice>;
    }
    return render({
      token: account.accessToken,
      organization,
      ...(userId !== undefined && { userId }),
    });
  }

  let page: ReactNode;
  switch (route.page) {
    case 'workspace':
      // Real bids and offers need an active member; until then it waits (or shows demo data).
      page = (
        <Workspace
          session={account && organization ? { token: account.accessToken, organization } : null}
        />
      );
      break;
    case 'counterparties':
      page = directory((session) => <CounterpartiesPage session={session} />);
      break;
    case 'team':
      page = directory((session) => <TeamPage session={session} />);
      break;
    case 'follow-ups':
      page = directory((session) => <FollowUpsPage session={session} />);
      break;
    case 'quotes':
      page = directory((session) => <QuotesPage session={session} />);
      break;
    case 'new-quote':
      page = directory((session) => <NewQuotePage session={session} />);
      break;
    case 'quote':
      page = directory((session) => <QuotePage key={route.id} session={session} id={route.id} />);
      break;
    case 'freight':
      page = directory((session) => <FreightPage session={session} />);
      break;
    case 'new-freight':
      page = directory((session) => <NewFreightPage session={session} />);
      break;
    case 'freight-rate':
      page = directory((session) => (
        <FreightRatePage key={route.id} session={session} id={route.id} />
      ));
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

  // After a first sign-in: the person's own password, then their name, before the app.
  if (account && me.status === 'ok' && me.mustChangePassword) {
    return (
      <ChoosePassword
        token={account.accessToken}
        // Supabase signs the person out when the password is set; they sign in again with it.
        onDone={() => {
          notePasswordChanged();
          account.signOut();
        }}
        onSignOut={account.signOut}
      />
    );
  }
  if (account?.saveName && me.status === 'ok' && me.nameMissing) {
    return (
      <YourName
        saveName={account.saveName}
        onDone={() => {
          setMeVersion((current) => current + 1);
        }}
        onSignOut={account.signOut}
      />
    );
  }

  return (
    <AppShell
      current={section(route)}
      health={health}
      counts={{ 'follow-ups': dueCount }}
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
