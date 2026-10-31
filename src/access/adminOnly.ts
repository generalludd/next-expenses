import type { Access, FieldAccess } from 'payload'

import type { User } from '@/payload-types'

export const isAdmin = (user: unknown): boolean =>
  Boolean((user as User | null)?.roles?.includes('admin'))

/** Collection-level: admins only. */
export const adminOnly: Access = ({ req: { user } }) => isAdmin(user)

/** Field-level: admins only. Returns a boolean, never a query constraint. */
export const adminOnlyField: FieldAccess = ({ req: { user } }) => isAdmin(user)
