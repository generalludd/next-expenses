import type { Access, FieldAccess } from 'payload'

import type { User } from '@/payload-types'

export const isAdmin = (user: unknown): boolean =>
  Boolean((user as User | null)?.roles?.includes('admin'))

/** Collection-level: admins only. */
export const adminOnly: Access = ({ req: { user } }) => isAdmin(user)

/** Field-level: admins only. Returns a boolean, never a query constraint. */
export const adminOnlyField: FieldAccess = ({ req: { user } }) => isAdmin(user)

/**
 * Collection-level: admins get every document; anyone else only the ones
 * where `field` is themselves (e.g. 'id' on users, 'user' on payments).
 */
export const adminOrOwn =
  (field: string): Access =>
  ({ req: { user } }) => {
    if (!user) return false
    if (isAdmin(user)) return true
    return { [field]: { equals: user.id } }
  }
