import { z } from 'zod';

export const RoleSchema = z.enum([
  'customer',
  'associate',
  'supervisor',
  'manager',
  'admin',
]);

export type Role = z.infer<typeof RoleSchema>;
