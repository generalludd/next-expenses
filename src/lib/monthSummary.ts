import type { Payload } from 'payload'

import type { Category, Fee, Month, Payment, User } from '@/payload-types'
import { formatMonth, monthStartFromParts } from './months'

/**
 * Data layer for the month dashboard. The equivalent of the old Svelte
 * app's src/helpers/monthData.ts, but far simpler: that version fetched
 * fees and payments through three bespoke Drupal JSON:API endpoints and
 * then did per-user math in the browser, including dividing each fee's
 * full amount by the user count on every render. Payload already freezes
 * each payment's exact share at creation time (src/collections/Fees/hooks),
 * so this just groups and sums what's already there — no split math here.
 */

/** A Fee with its relationships populated (depth: 1 on the fees query guarantees this). */
export type PopulatedFee = Fee & { category: Category; month: Month }

export type FeeLine = {
  fee: PopulatedFee
  payment: Payment
}

export type UserMonthSummary = {
  user: User
  owedCents: number
  paidCents: number
  unpaid: FeeLine[]
  paid: FeeLine[]
}

export type MonthSummary = {
  month: number
  year: number
  monthLabel: string
  /** Null when no Month document exists yet for this month/year — nothing has been billed. */
  monthDoc: Month | null
  fees: PopulatedFee[]
  totalFeeCents: number
  users: UserMonthSummary[]
}

export async function getMonthSummary(
  payload: Payload,
  month: number,
  year: number,
): Promise<MonthSummary> {
  const monthStartIso = monthStartFromParts(month, year).toISOString()
  const monthLabel = formatMonth(monthStartIso)

  const { docs: monthDocs } = await payload.find({
    collection: 'months',
    where: { startsOn: { equals: monthStartIso } },
    limit: 1,
    depth: 0,
  })
  const monthDoc = monthDocs[0] ?? null

  if (!monthDoc) {
    return { month, year, monthLabel, monthDoc: null, fees: [], totalFeeCents: 0, users: [] }
  }

  const { docs: fees } = await payload.find({
    collection: 'fees',
    where: { month: { equals: monthDoc.id } },
    sort: 'id',
    limit: 0,
    depth: 1, // populates category and month
  })
  const populatedFees = fees as PopulatedFee[]
  const totalFeeCents = populatedFees.reduce((sum, fee) => sum + fee.amountCents, 0)

  const feeIds = populatedFees.map((fee) => fee.id)
  const { docs: payments } =
    feeIds.length > 0
      ? await payload.find({
          collection: 'payments',
          where: { fee: { in: feeIds } },
          sort: 'id',
          limit: 0,
          depth: 1, // populates user
        })
      : { docs: [] }

  const feeById = new Map(populatedFees.map((fee) => [fee.id, fee]))
  const byUser = new Map<number, UserMonthSummary>()

  for (const payment of payments) {
    const user = typeof payment.user === 'object' ? payment.user : null
    const feeId = typeof payment.fee === 'object' ? payment.fee.id : payment.fee
    const fee = feeById.get(feeId)
    if (!user || !fee) continue // shouldn't happen; both relationships are required

    let entry = byUser.get(user.id)
    if (!entry) {
      entry = { user, owedCents: 0, paidCents: 0, unpaid: [], paid: [] }
      byUser.set(user.id, entry)
    }

    const line: FeeLine = { fee, payment }
    if (payment.paidOn) {
      entry.paidCents += payment.shareCents
      entry.paid.push(line)
    } else {
      entry.owedCents += payment.shareCents
      entry.unpaid.push(line)
    }
  }

  const users = Array.from(byUser.values()).sort((a, b) => a.user.id - b.user.id)

  return { month, year, monthLabel, monthDoc, fees: populatedFees, totalFeeCents, users }
}
