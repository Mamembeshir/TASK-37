export type Role = 'customer' | 'associate' | 'supervisor' | 'manager' | 'admin';

export interface User {
  id: string;
  username: string;
  role: Role;
  phone?: string | null;
  createdAt?: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: Pick<User, 'id' | 'username' | 'role'>;
}

/** Roles that grant staff-level access (non-customer). */
export const STAFF_ROLES: Role[] = ['associate', 'supervisor', 'manager', 'admin'];

/** Roles that grant supervisor+ access. */
export const SUPERVISOR_ROLES: Role[] = ['supervisor', 'manager', 'admin'];

/** Human-readable role labels. */
export const ROLE_LABELS: Record<Role, string> = {
  customer:   'Customer',
  associate:  'Associate',
  supervisor: 'Supervisor',
  manager:    'Manager',
  admin:      'Admin',
};
