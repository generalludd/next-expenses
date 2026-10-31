import type { CollectionAfterChangeHook } from 'payload'

import type { Fee } from '@/payload-types'
import { findActiveUsersForMonth } from '@/lib/activeUsers'
import { splitEvenly } from '@/lib/money'

/**
 * Creating a Fee generates one Payment per user who was active for that fee's
 * month, each unpaid (`paidOn: null`). This is new behavior relative to the
 * legacy CodeIgniter app, which only ever created a payment lazily when
 * someone clicked "pay" — there, an unpaid fee simply had no payment row at
 * all, which is why `date_paid` was NOT NULL there.
 *
 * `context.skipFanOut` lets the migration script and this hook's own
 * `req.payload.create` calls avoid re-triggering this hook.
 */
export const fanOutPayments: CollectionAfterChangeHook<Fee> = async ({
  doc,
  operation,
  req,
  context,
}) => {
  if (operation !== 'create') return doc
  if (context.skipFanOut) return doc

  const monthId = typeof doc.month === 'object' ? doc.month.id : doc.month
  const month = await req.payload.findByID({
    collection: 'months',
    id: monthId,
    depth: 0,
    req,
  })

  const activeUsers = await findActiveUsersForMonth(req, month.startsOn)
  const shares = splitEvenly(doc.amountCents, activeUsers.length, doc.id)

  // Sequential, not Promise.all: Postgres transactions serialize writes on the
  // same connection anyway, and sequential keeps the rotation-indexed shares
  // array trivially matched up to activeUsers without races.
  for (const [index, user] of activeUsers.entries()) {
    await req.payload.create({
      collection: 'payments',
      data: {
        fee: doc.id,
        user: user.id,
        shareCents: shares[index],
        paidOn: null,
      },
      context: { skipFanOut: true },
      req,
    })
  }

  return doc
}
