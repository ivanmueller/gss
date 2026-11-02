import { CircleUserRound, FlaskConical, LogOut, Moon, Smartphone } from 'lucide-react';
import { useState } from 'react';

import { useDemoData } from '../lib/demo';
import { useTheme } from '../lib/theme';
import type { MeState } from '../lib/useMe';
import { CellPhoneDialog } from './Calling';
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
  /** The signed-in person's token, for their own settings (their cell phone). */
  token?: string;
}

/**
 * The profile icon in the top bar, opening who is signed in, their cell phone for calls, the
 * Demo data and Dark mode switches, and sign-out.
 */
export function ProfileMenu({ name, check, onSignOut, token }: ProfileUser) {
  const [theme, setTheme] = useTheme();
  const [demo, setDemo] = useDemoData();
  const [cellOpen, setCellOpen] = useState(false);
  const problem = check === 'error';
  return (
    <>
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
          {token !== undefined && (
            <DropdownMenuItem
              onSelect={() => {
                setCellOpen(true);
              }}
            >
              <Smartphone aria-hidden="true" />
              Your cell phone
            </DropdownMenuItem>
          )}
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
      {token !== undefined && (
        <CellPhoneDialog token={token} open={cellOpen} onOpenChange={setCellOpen} />
      )}
    </>
  );
}
