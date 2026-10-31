import type { CollectionBeforeDeleteHook } from 'payload'

/**
 * This runs `beforeDelete`, not `afterDelete` — deliberately.
 *
 * Payload's relationship fields always generate their FK with
 * `ON DELETE SET NULL`, with no config to override it, and that action fires
 * as part of the `DELETE FROM fees ...` statement itself — before any
 * `afterDelete` hook gets a chance to run. Since `payments.fee` is
 * `required: true` (NOT NULL), that SET NULL collides with the NOT NULL
 * constraint and the delete fails at the database level:
 *
 *   null value in column "fee_id" of relation "payments"
 *   violates not-null constraint
 *
 * Deleting the payments first, in `beforeDelete`, means there are no
 * payment rows left for the FK action to touch by the time the fee's own
 * DELETE statement runs.
 */
export const cascadeDeletePayments: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const { docs: payments } = await req.payload.find({
    collection: 'payments',
    where: { fee: { equals: id } },
    limit: 0,
    depth: 0,
    req,
  })

  for (const payment of payments) {
    await req.payload.delete({
      collection: 'payments',
      id: payment.id,
      req,
    })
  }
}
