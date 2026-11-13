import type { Access, CollectionConfig } from 'payload'

import type { User } from '@/payload-types'

/** True when an admin has set a temporary password this user hasn't replaced yet. */
export const passwordChangePending = (user: unknown): boolean =>
  Boolean((user as User | null)?.mustChangePassword)

// Payload's default when a collection doesn't set an operation's access.
const loggedIn: Access = ({ req: { user } }) => Boolean(user)

/**
 * Wraps every access function on a collection so that a user with
 * mustChangePassword gets nothing until they change it: no REST, GraphQL,
 * /admin or Local API (overrideAccess: false) access to anything.
 *
 * The one exception is reading their own users document. Payload's `me`
 * operation loads the logged-in user with access applied
 * (auth/operations/me.js), and the frontend's change-password page needs
 * that to work. Changing the password itself goes through
 * changePasswordAction, which uses overrideAccess.
 *
 * Applied to all collections in payload.config.ts. Frontend pages and server
 * actions also check this via requireUser (src/lib/requireUser.ts), because
 * many of their reads use the Local API's default overrideAccess: true.
 */
export function blockWhilePasswordChangePending(collection: CollectionConfig): CollectionConfig {
  const access = { ...collection.access }
  const isUsers = Boolean(collection.auth)

  for (const operation of ['create', 'read', 'update', 'delete'] as const) {
    const original: Access = access[operation] ?? loggedIn
    access[operation] = (args) => {
      if (passwordChangePending(args.req.user)) {
        if (isUsers && operation === 'read') {
          return { id: { equals: args.req.user!.id } }
        }
        return false
      }
      return original(args)
    }
  }

  for (const operation of ['readVersions', 'unlock'] as const) {
    const original = access[operation]
    if (!original) continue
    access[operation] = (args) => (passwordChangePending(args.req.user) ? false : original(args))
  }

  if (access.admin) {
    const original = access.admin
    access.admin = (args) => (passwordChangePending(args.req.user) ? false : original(args))
  }

  return { ...collection, access }
}
