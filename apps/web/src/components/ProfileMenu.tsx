import { CircleUserRound, FlaskConical, LogOut, Moon } from 'lucide-react';

import { useDemoData } from '../lib/demo';
import { useTheme } from '../lib/theme';
import type { MeState } from '../lib/useMe';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSwitchItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export interface ProfileUser {
  /** First name and last initial from the API's /me, e.g. "Ivan M."; null when not set. */
  name: string | null;
  check: MeState['status'];
  onSignOut: () => void;
}

/**
 * The profile icon in the top bar, opening who is signed in, the Demo data and Dark mode
 * switches, and sign-out.
 */
export function ProfileMenu({ name, check, onSignOut }: ProfileUser) {
  const [theme, setTheme] = useTheme();
  const [demo, setDemo] = useDemoData();
  const problem = check === 'error';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-full">
          <CircleUserRound aria-hidden="true" className="size-5!" />
          <span className="sr-only">Account{problem && ': session not confirmed'}</span>
          {problem && (
            <span
              aria-hidden="true"
              className="absolute top-1.5 right-1.5 size-2 rounded-full bg-danger ring-2 ring-background"
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2 py-1.5">
          {/* A session problem is explained in the page itself (AppShell), not only here. */}
          {name ? (
            <p className="text-sm">
              <span className="block text-xs text-muted-foreground">Signed in as</span>{' '}
              <span className="block font-medium">{name}</span>
            </p>
          ) : (
            <p className="text-sm font-medium">Signed in</p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuSwitchItem
          checked={demo}
          onSelect={() => {
            setDemo(!demo);
          }}
        >
          <FlaskConical aria-hidden="true" />
          Demo data
        </DropdownMenuSwitchItem>
        <DropdownMenuSwitchItem
          checked={theme === 'dark'}
          onSelect={() => {
            setTheme(theme === 'dark' ? 'light' : 'dark');
          }}
        >
          <Moon aria-hidden="true" />
          Dark mode
        </DropdownMenuSwitchItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
