import {
  ArrowLeftRight,
  Building2,
  Calculator,
  CircleAlert,
  LayoutDashboard,
  Menu,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Link } from '../lib/router';
import type { ApiHealth } from '../lib/useApiHealth';
import { useMediaQuery } from '../lib/useMediaQuery';
import { Brand } from './Brand';
import { ConnectionStatus } from './ConnectionStatus';
import { ProfileMenu, type ProfileUser } from './ProfileMenu';
import { Button } from './ui/button';
import { Callout } from './ui/callout';
import { Sheet, SheetContent, SheetTrigger } from './ui/sheet';

export type NavSection = 'workspace' | 'counterparties' | 'quotes' | 'team';

interface NavItem {
  id: NavSection;
  href: string;
  label: string;
  Icon: LucideIcon;
}

/** The left menu. Add a page here to give it a place in the menu. */
const NAV: readonly NavItem[] = [
  { id: 'workspace', href: '/', label: 'Workspace', Icon: LayoutDashboard },
  { id: 'counterparties', href: '/counterparties', label: 'Counterparties', Icon: Building2 },
  { id: 'quotes', href: '/quotes', label: 'Bids & offers', Icon: ArrowLeftRight },
  { id: 'team', href: '/team', label: 'Team', Icon: Users },
];

/** Planned pages, shown greyed out so the menu's shape is clear; none of them exists yet. */
const PLANNED: readonly { label: string; Icon: LucideIcon }[] = [
  { label: 'Scenarios', Icon: Calculator },
];

const itemClass = 'flex h-9 items-center gap-3 rounded-control px-3 text-sm font-medium';

function SidebarContent({
  current,
  onNavigate,
}: {
  current: NavSection | null;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="flex h-topbar shrink-0 items-center border-b border-sidebar-border px-4">
        <Brand />
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-6 overflow-y-auto p-3">
        <ul className="flex flex-col gap-0.5">
          {NAV.map(({ id, href, label, Icon }) => (
            <li key={id}>
              <Link
                href={href}
                aria-current={current === id ? 'page' : undefined}
                onClick={onNavigate}
                className={`${itemClass} text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground`}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-0.5">
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">Coming next</p>
          <ul className="flex flex-col gap-0.5" aria-label="Coming next">
            {PLANNED.map(({ label, Icon }) => (
              <li key={label} className={`${itemClass} text-muted-foreground`}>
                <Icon aria-hidden="true" className="size-4 shrink-0 opacity-60" />
                <span className="opacity-60">{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </>
  );
}

/**
 * The frame around every signed-in page: the menu on the left (a slide-over panel on
 * screens narrower than 1024 px) and a top bar with the connection dot and the profile menu.
 */
export function AppShell({
  current,
  health,
  user,
  children,
}: {
  current: NavSection | null;
  health: ApiHealth;
  user?: ProfileUser;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Tailwind's `lg`: from here the menu is always shown, so the slide-over closes, and stays
  // closed if the window narrows again (state adjusted during render, as React advises).
  const wide = useMediaQuery('(min-width: 1024px)', false);
  const [wasWide, setWasWide] = useState(wide);
  if (wide !== wasWide) {
    setWasWide(wide);
    if (wide) setMenuOpen(false);
  }
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only z-(--z-popover) rounded-control bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <div className="fixed inset-y-0 left-0 z-(--z-sidebar) hidden w-sidebar flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <SidebarContent current={current} />
      </div>
      <div className="flex min-h-dvh flex-col lg:pl-sidebar">
        <header className="sticky top-0 z-(--z-topbar) flex h-topbar shrink-0 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur-sm lg:px-8">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="-ml-2 lg:hidden">
                <Menu aria-hidden="true" className="size-5!" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent title="Menu">
              <SidebarContent
                current={current}
                onNavigate={() => {
                  setMenuOpen(false);
                }}
              />
            </SheetContent>
          </Sheet>
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ConnectionStatus health={health} />
            {user && <ProfileMenu {...user} />}
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-content flex-1 flex-col gap-6 px-4 py-6 outline-none lg:px-8 lg:py-8"
        >
          {user?.check === 'error' && (
            <Callout variant="danger" icon={CircleAlert} role="alert">
              <p>
                <strong>The server could not confirm your session.</strong> Reload the page to try
                again. If this keeps happening, sign out and sign in again.
              </p>
            </Callout>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
