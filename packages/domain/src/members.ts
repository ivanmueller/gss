import { z } from 'zod';

import { VERSION } from './directory';

// Member management (GT-013; MASTER_PROJECT_SPECIFICATION.md section 2.1). Shared by the
// API, which checks requests, and the web app's Team page.

/** The roles of app.member_role, from least to most access. */
export const MEMBER_ROLES = ['viewer', 'analyst', 'trader', 'operations', 'org_admin'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Statuses an admin can set; "invited" is not used while logins are made in Supabase. */
export const MEMBER_STATUSES = ['active', 'suspended'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  viewer: 'Viewer',
  analyst: 'Analyst',
  trader: 'Trader',
  operations: 'Operations',
  org_admin: 'Admin',
};

/** What each role may do today, in plain words (specification section 2.1). */
export const MEMBER_ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  viewer: 'Sees the counterparties and the map.',
  analyst: 'Sees everything; will build trade scenarios once they exist.',
  trader: 'Sees everything; enters, revises and withdraws bids and offers.',
  operations: 'Also adds, edits and archives counterparties and finds coordinates.',
  org_admin: 'Everything operations and traders can do, and manages the team.',
};

/** A first or last name: trimmed, 1 to 100 characters, no control characters; empty is none. */
const name = z
  .string()
  .max(1000)
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .refine((value) => value.length <= 100, 'is longer than 100 characters')
  .refine((value) => !/\p{Cc}/u.test(value), 'has characters that cannot be shown')
  .transform((value) => (value === '' ? null : value));

/**
 * POST /api/v1/members: add a person to the team. Without a login yet, one is made (names
 * then required: a first name at least) with a temporary password.
 */
export const addMemberSchema = z.object({
  organizationId: z.uuid(),
  email: z.string().trim().max(254).pipe(z.email()),
  role: z.enum(MEMBER_ROLES),
  firstName: name.nullable().optional(),
  lastName: name.nullable().optional(),
});
export type AddMemberRequest = z.infer<typeof addMemberSchema>;

/** PATCH /api/v1/members/{id}: any of role, status and names, for the version on screen. */
export const updateMemberSchema = z
  .object({
    organizationId: z.uuid(),
    version: z.string().regex(VERSION),
    role: z.enum(MEMBER_ROLES).optional(),
    status: z.enum(MEMBER_STATUSES).optional(),
    firstName: name.nullable().optional(),
    lastName: name.nullable().optional(),
  })
  .refine(
    (body) =>
      body.role !== undefined ||
      body.status !== undefined ||
      body.firstName !== undefined ||
      body.lastName !== undefined,
    'nothing to change',
  );
export type UpdateMemberRequest = z.infer<typeof updateMemberSchema>;

/** A member as the Team page shows them. */
export interface Member {
  id: string;
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: MemberRole;
  status: MemberStatus | 'invited';
  joinedAt: string | null;
  version: string;
  /** The signed-in user's own membership. */
  isYou: boolean;
}

/** Shortest password a person may choose (the temporary one is replaced at first sign-in). */
export const MIN_PASSWORD_LENGTH = 12;

/** POST /api/v1/me/password: the person's own password, replacing the temporary one. */
export const choosePasswordSchema = z.object({
  password: z.string().min(MIN_PASSWORD_LENGTH).max(72),
});
