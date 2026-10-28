import {
  MEMBER_ROLE_DESCRIPTIONS,
  MEMBER_ROLE_LABELS,
  MEMBER_ROLES,
  type Member,
  type MemberRole,
} from '@grain/domain';
import { Pencil, UserPlus } from 'lucide-react';
import { useId, useState, type SyntheticEvent } from 'react';

import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input, Select } from '../components/ui/input';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
} from '../components/ui/table';
import { ApiError, sendJson } from '../lib/api';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from './CounterpartiesPage';

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

function fullName(member: Member): string | null {
  const name = [member.firstName, member.lastName].filter(Boolean).join(' ');
  return name === '' ? null : name;
}

function RoleSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: MemberRole;
  onChange: (role: MemberRole) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.value as MemberRole);
      }}
    >
      {MEMBER_ROLES.map((role) => (
        <option key={role} value={role}>
          {MEMBER_ROLE_LABELS[role]}
        </option>
      ))}
    </Select>
  );
}

/** Adds a person who already has a login to the organization. */
function AddMember({ session, onAdded }: { session: DirectorySession; onAdded: () => void }) {
  const baseId = useId();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('viewer');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { kind: 'added'; email: string } | { kind: 'error'; code: string; message: string } | null
  >(null);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      await sendJson('/members', session.token, 'POST', {
        organizationId: session.organization.id,
        email,
        role,
      });
      setResult({ kind: 'added', email: email.trim() });
      setEmail('');
      onAdded();
    } catch (error) {
      setResult({
        kind: 'error',
        code: error instanceof ApiError ? error.code : '',
        message: messageOf(error),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card asChild>
      <section aria-labelledby={`${baseId}-heading`}>
        <CardHeader>
          <CardTitle id={`${baseId}-heading`}>Add a person</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-60 flex-1 flex-col gap-1.5">
              <label htmlFor={`${baseId}-email`} className="font-medium">
                Email of their login
              </label>
              <Input
                id={`${baseId}-email`}
                type="email"
                autoComplete="off"
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            </div>
            <div className="flex w-44 flex-col gap-1.5">
              <label htmlFor={`${baseId}-role`} className="font-medium">
                Role
              </label>
              <RoleSelect id={`${baseId}-role`} value={role} onChange={setRole} />
            </div>
            <Button type="submit" disabled={busy || email.trim() === ''}>
              <UserPlus aria-hidden="true" />
              {busy ? 'Adding…' : 'Add to team'}
            </Button>
          </form>
          {result?.kind === 'added' && (
            <p role="status" className="text-success">
              {result.email} is on the team. They sign in with their email and password, and set up
              their authenticator app the first time.
            </p>
          )}
          {result?.kind === 'error' && (
            <div role="alert" className="text-danger">
              <p>{result.message}</p>
              {result.code === 'NO_ACCOUNT' && (
                <ol className="mt-1 list-decimal pl-5 text-foreground">
                  <li>
                    In Supabase: Authentication → Users → Add user → Create new user. Enter their
                    email and a temporary password, tick “Auto Confirm User”, and create.
                  </li>
                  <li>Give them the password in person or by phone, not by email.</li>
                  <li>Come back here and add them.</li>
                </ol>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            People sign in with a login an admin creates in Supabase (there is no self sign-up).
            Adding them here gives them access to {session.organization.name} with the role you
            choose.
          </p>
        </CardContent>
      </section>
    </Card>
  );
}

/** Edits one member: names, and for others than yourself the role and status. */
function EditMember({
  session,
  member,
  onDone,
  onCancel,
}: {
  session: DirectorySession;
  member: Member;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const baseId = useId();
  const [firstName, setFirstName] = useState(member.firstName ?? '');
  const [lastName, setLastName] = useState(member.lastName ?? '');
  const [role, setRole] = useState<MemberRole>(member.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: SyntheticEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendJson(`/members/${member.id}`, session.token, 'PATCH', {
        organizationId: session.organization.id,
        version: member.version,
        firstName,
        lastName,
        ...(!member.isYou && role !== member.role && { role }),
      });
      onDone('Saved.');
    } catch (failure) {
      setError(messageOf(failure));
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={`Edit ${member.email}`}
      onSubmit={(event) => void save(event)}
      className="flex flex-col gap-3 text-sm"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${baseId}-first`} className="font-medium">
            First name
          </label>
          <Input
            id={`${baseId}-first`}
            value={firstName}
            maxLength={100}
            onChange={(event) => {
              setFirstName(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${baseId}-last`} className="font-medium">
            Last name
          </label>
          <Input
            id={`${baseId}-last`}
            value={lastName}
            maxLength={100}
            onChange={(event) => {
              setLastName(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${baseId}-role`} className="font-medium">
            Role
          </label>
          <RoleSelect
            id={`${baseId}-role`}
            value={role}
            onChange={setRole}
            disabled={member.isYou}
          />
          {member.isYou && (
            <p className="text-xs text-muted-foreground">Another admin changes your own role.</p>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** /team: the organization's members, for its admins (GT-013). */
export function TeamPage({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const isAdmin = organization.role === 'org_admin';
  const [list, reload] = useApiResource<{ members: Member[] }>(
    isAdmin ? `/members?organization_id=${organization.id}` : null,
    token,
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setStatus(member: Member, status: 'active' | 'suspended') {
    setBusyId(member.id);
    setNotice(null);
    try {
      await sendJson(`/members/${member.id}`, token, 'PATCH', {
        organizationId: organization.id,
        version: member.version,
        status,
      });
      setNotice({
        ok: true,
        text: `${member.email} is ${status === 'suspended' ? 'suspended' : 'active again'}.`,
      });
      reload();
    } catch (error) {
      setNotice({ ok: false, text: messageOf(error) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-labelledby="team-heading" className="flex flex-col gap-4">
      <PageHeader
        id="team-heading"
        title="Team"
        description={`Who can sign in to ${organization.name}, and what each person may do.`}
      />

      {!isAdmin && (
        <p role="alert" className="text-sm">
          Only admins of {organization.name} manage the team. You are{' '}
          {(MEMBER_ROLE_LABELS as Partial<Record<string, string>>)[organization.role] ??
            organization.role}
          ; ask an admin to change your role.
        </p>
      )}

      {isAdmin && (
        <>
          <AddMember
            session={session}
            onAdded={() => {
              reload();
            }}
          />
          {notice && (
            <p
              role={notice.ok ? 'status' : 'alert'}
              className={notice.ok ? 'text-sm' : 'text-sm text-danger'}
            >
              {notice.text}
            </p>
          )}
          {list.status === 'loading' && (
            <p className="text-sm text-muted-foreground">Loading the team…</p>
          )}
          {list.status === 'error' && (
            <p role="alert" className="text-sm text-danger">
              Could not load the team: {list.error.message}
            </p>
          )}
          {list.status === 'ok' && (
            <Card className="overflow-hidden">
              <Table className="min-w-[44rem]">
                <TableCaption>Team members</TableCaption>
                <TableHeader>
                  <tr>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {list.data.members.map((member) =>
                    editing === member.id ? (
                      <TableRow key={member.id}>
                        <TableCell colSpan={5} className="bg-muted/40">
                          <EditMember
                            session={session}
                            member={member}
                            onCancel={() => {
                              setEditing(null);
                            }}
                            onDone={(text) => {
                              setEditing(null);
                              setNotice({ ok: true, text });
                              reload();
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={member.id}>
                        <TableRowHeader>
                          {fullName(member) ?? (
                            <span className="font-normal text-muted-foreground">No name yet</span>
                          )}
                          {member.isYou && <Badge className="ml-2">You</Badge>}
                        </TableRowHeader>
                        <TableCell>{member.email}</TableCell>
                        <TableCell>{MEMBER_ROLE_LABELS[member.role]}</TableCell>
                        <TableCell>
                          {member.status === 'active' ? (
                            <Badge variant="success">Active</Badge>
                          ) : (
                            <Badge variant="caution">
                              {member.status === 'suspended' ? 'Suspended' : 'Invited'}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Edit ${member.email}`}
                            onClick={() => {
                              setNotice(null);
                              setEditing(member.id);
                            }}
                          >
                            <Pencil aria-hidden="true" />
                            Edit
                          </Button>
                          {!member.isYou && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId === member.id}
                              aria-label={`${member.status === 'active' ? 'Suspend' : 'Reactivate'} ${member.email}`}
                              onClick={() =>
                                void setStatus(
                                  member,
                                  member.status === 'active' ? 'suspended' : 'active',
                                )
                              }
                            >
                              {member.status === 'active' ? 'Suspend' : 'Reactivate'}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ),
                  )}
                </TableBody>
              </Table>
            </Card>
          )}
          <Card asChild>
            <section aria-labelledby="roles-heading">
              <CardHeader>
                <CardTitle id="roles-heading">What each role may do</CardTitle>
              </CardHeader>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-[8rem_1fr]">
                {MEMBER_ROLES.map((role) => (
                  <div key={role} className="contents">
                    <dt className="font-medium">{MEMBER_ROLE_LABELS[role]}</dt>
                    <dd className="text-muted-foreground">{MEMBER_ROLE_DESCRIPTIONS[role]}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </Card>
          <p className="text-xs text-muted-foreground">
            A suspended person can still sign in but sees nothing of {organization.name} until
            reactivated. Everything here is recorded in the audit trail.
          </p>
        </>
      )}
    </section>
  );
}
