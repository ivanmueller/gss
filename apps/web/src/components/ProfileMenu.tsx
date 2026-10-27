import { CircleUserRound, LogOut, Monitor, Moon, Sun } from 'lucide-react';

import { useThemePreference, type ThemePreference } from '../lib/theme';
import type { MeState } from '../lib/useMe';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export interface ProfileUser {
  /** First name and last initial from the API's /me, e.g. "Ivan M."; null when not set. */
  name: string | null;
  check: MeState['status'];
  onSignOut: () => void;
}

const THEMES: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

function isThemePreference(value: string): value is ThemePreference {
  return THEMES.some((theme) => theme.value === value);
}

/** The profile icon in the top bar, opening who is signed in, the theme and sign-out. */
export function ProfileMenu({ name, check, onSignOut }: ProfileUser) {
  const [theme, setTheme] = useThemePreference();
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
          {name ? (
            <p className="text-sm">
              <span className="block text-xs text-muted-foreground">Signed in as</span>{' '}
              <span className="block font-medium">{name}</span>
            </p>
          ) : (
            <p className="text-sm font-medium">Signed in</p>
          )}
          {problem && (
            <p className="mt-1 text-xs text-danger">
              The server could not confirm your session. Reload to try again.
            </p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (isThemePreference(value)) setTheme(value);
          }}
        >
          {THEMES.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden="true" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
