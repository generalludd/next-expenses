import { APIError } from 'payload'
import type { CollectionBeforeChangeHook } from 'payload'

import type { Fee } from '@/payload-types'
import { splitEvenly } from '@/lib/money'

/**
 * Editing a fee's amount after some of its payments are already marked paid
 * would silently rewrite settled history — the paid amount would no longer
 * match what the payment row says was owed at the time. Rather than guess at
 * a reconciliation, block the edit outright and require unmarking the paid
 * rows first (or recording a correcting fee instead).
 *
 * When the amount changes and nothing is paid yet, shares are safe to
 * recompute, so this re-splits them using the same deterministic algorithm
 * fanOutPayments used at creation.
 *
 * A collection `beforeChange` hook, not a field-level `validate`: this needs
 * `originalDoc` to know the previous amount and `req` to look up payments,
 * neither of which a field validator reliably has.
 */
export const guardAmountEdit: CollectionBeforeChangeHook<Fee> = async ({
  data,
  operation,
  originalDoc,
  req,
  context,
}) => {
  if (operation !== 'update') return data
  if (context.skipFanOut) return data
  if (data.amountCents === undefined || data.amountCents === originalDoc?.amountCents) {
    return data
  }

  const { docs: payments } = await req.payload.find({
    collection: 'payments',
    where: { fee: { equals: originalDoc!.id } },
    limit: 0,
    depth: 0,
    req,
  })

  const paidPayments = payments.filter((payment) => Boolean(payment.paidOn))
  if (paidPayments.length > 0) {
    throw new APIError(
      `Cannot change amount: ${paidPayments.length} of ${payments.length} payment(s) for this fee are already marked paid. Unmark them first, or record a correcting fee instead.`,
      400,
    )
  }

  // Nothing is paid yet, so it's safe to re-split. Keep the same per-user
  // ordering the original split used (sorted by payment id, which is
  // creation order) so results stay deterministic.
  const ordered = [...payments].sort((a, b) => a.id - b.id)
  const shares = splitEvenly(data.amountCents, ordered.length, originalDoc!.id)

  for (const [index, payment] of ordered.entries()) {
    await req.payload.update({
      collection: 'payments',
      id: payment.id,
      data: { shareCents: shares[index] },
      context: { skipFanOut: true },
      req,
    })
  }

  return data
}
