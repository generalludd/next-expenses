import type { Payload } from 'payload'

import type { Category, Fee, Month, Payment, User } from '@/payload-types'
import { formatMonth, monthStartFromParts, previousMonth } from './months'

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

export type CopyCandidates = {
  prevLabel: string
  /** The previous month's fees whose category isn't billed or skipped in this month yet. */
  fees: PopulatedFee[]
  /** The previous month's fees whose category was skipped for this month. */
  skipped: PopulatedFee[]
}

/**
 * What the "Copy from previous month" panel offers: last month's fees, minus
 * any category already present this month. Copying is per category, not per
 * fee, so once a category has been added here it drops out of the list.
 * Categories in the month's `skippedCategories` are split out so the panel
 * can offer to undo the skip.
 */
export async function getCopyCandidates(
  payload: Payload,
  monthDoc: Month,
  month: number,
  year: number,
  currentFees: PopulatedFee[],
): Promise<CopyCandidates> {
  const prev = previousMonth(month, year)
  const prevStartIso = monthStartFromParts(prev.month, prev.year).toISOString()
  const prevLabel = formatMonth(prevStartIso)

  const { docs: prevMonthDocs } = await payload.find({
    collection: 'months',
    where: { startsOn: { equals: prevStartIso } },
    limit: 1,
    depth: 0,
  })
  const prevMonthDoc = prevMonthDocs[0]
  if (!prevMonthDoc) return { prevLabel, fees: [], skipped: [] }

  const { docs: prevFees } = await payload.find({
    collection: 'fees',
    where: { month: { equals: prevMonthDoc.id } },
    sort: 'id',
    limit: 0,
    depth: 1, // populates category and month
  })

  const billedCategoryIds = new Set(currentFees.map((fee) => fee.category.id))
  const skippedCategoryIds = new Set(skippedCategoryIdsOf(monthDoc))
  const unbilled = (prevFees as PopulatedFee[]).filter(
    (fee) => !billedCategoryIds.has(fee.category.id),
  )

  return {
    prevLabel,
    fees: unbilled.filter((fee) => !skippedCategoryIds.has(fee.category.id)),
    skipped: unbilled.filter((fee) => skippedCategoryIds.has(fee.category.id)),
  }
}

/** A month's skippedCategories as ids, whatever depth it was fetched at. */
export function skippedCategoryIdsOf(monthDoc: Month): number[] {
  return (monthDoc.skippedCategories ?? []).map((category) =>
    typeof category === 'object' ? category.id : category,
  )
}
