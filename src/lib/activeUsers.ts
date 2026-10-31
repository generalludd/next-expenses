import type { PayloadRequest, Where } from 'payload'

import type { User } from '@/payload-types'
import { monthBounds } from './months'

/**
 * Who owes a share for a given month.
 *
 * Membership is a date range, not a flag: a user owes for a month if their
 * [startDate, endDate] window overlaps it at all. Someone who joined in June is
 * not billed for May; someone who left in March still owes for March.
 *
 * `isActive` is deliberately NOT part of this — it is a login gate. Deactivating
 * a departed member's login must not silently rewrite what they owed.
 */
export function activeForMonthWhere(monthStartsOn: Date | string): Where {
  const { monthStart, monthEnd } = monthBounds(monthStartsOn)

  return {
    and: [
      { startDate: { less_than_equal: monthEnd.toISOString() } },
      {
        or: [
          { endDate: { exists: false } },
          { endDate: { greater_than_equal: monthStart.toISOString() } },
        ],
      },
    ],
  }
}

/** Pure predicate form, for tests and in-memory checks. */
export function isActiveForMonth(
  user: Pick<User, 'startDate' | 'endDate'>,
  monthStartsOn: Date | string,
): boolean {
  const { monthStart, monthEnd } = monthBounds(monthStartsOn)
  if (!user.startDate) return false
  if (new Date(user.startDate) > monthEnd) return false
  if (user.endDate && new Date(user.endDate) < monthStart) return false
  return true
}

/**
 * The users who owe a share for a month, in a stable order so that
 * splitEvenly's rotation lands on the same person for the same fee every time.
 */
export async function findActiveUsersForMonth(
  req: PayloadRequest,
  monthStartsOn: Date | string,
): Promise<User[]> {
  const { docs } = await req.payload.find({
    collection: 'users',
    where: activeForMonthWhere(monthStartsOn),
    sort: 'id',
    limit: 0,
    depth: 0,
    req,
  })

  return docs as User[]
}
