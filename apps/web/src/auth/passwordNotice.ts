// Setting a password through Supabase's admin service signs the person out everywhere, so
// after choosing their own password they sign in again. This note, kept for the browser
// tab only, tells the sign-in form to say why. Storage can be blocked; then no note shows.

const KEY = 'gss.passwordChanged';

export function notePasswordChanged(): void {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    // Blocked storage: the sign-in form simply shows no note.
  }
}

/** Whether the note is there (reading leaves it, so a re-render reads the same). */
export function hasPasswordChangedNote(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Removes the note once the sign-in form has shown it. */
export function clearPasswordChangedNote(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Blocked storage: nothing was kept.
  }
}
