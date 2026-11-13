import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import config from '@/payload.config'
import { passwordChangePending } from '@/access/passwordChange'

/**
 * The logged-in user for a frontend page or server action, or a redirect:
 * to /login when there's none, and to /change-password while an admin-set
 * temporary password is still in place. Only /change-password itself (and
 * its action) pass allowPendingPasswordChange.
 *
 * Collection access rules block a pending user too (passwordChange.ts), but
 * many frontend reads use the Local API's default overrideAccess: true, so
 * this check is what keeps them out of the app.
 */
export async function requireUser(options: { allowPendingPasswordChange?: boolean } = {}) {
  const payload = await getPayload({ config: await config })
  const { user } = await payload.auth({ headers: await headers() })

  if (!user) {
    redirect('/login')
  }
  if (!options.allowPendingPasswordChange && passwordChangePending(user)) {
    redirect('/change-password')
  }

  return { payload, user }
}
