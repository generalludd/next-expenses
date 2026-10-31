/**
 * Post-migration assertions. Run after migrateLegacy.ts.
 * Usage: npx tsx src/scripts/verifyMigration.ts
 * Exits non-zero on any failed assertion.
 */

import 'dotenv/config'
import { getPayload } from 'payload'

import config from '../payload.config'

let failures = 0

function check(label: string, pass: boolean, detail?: string) {
  if (pass) {
    console.log(`  ok  ${label}`)
  } else {
    failures++
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main() {
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })

  const [months, categories, fees, payments] = await Promise.all([
    payload.count({ collection: 'months' }),
    payload.count({ collection: 'categories' }),
    payload.count({ collection: 'fees' }),
    payload.count({ collection: 'payments' }),
  ])

  console.log('Row counts:')
  check('101 months', months.totalDocs === 101, `got ${months.totalDocs}`)
  check('20 categories', categories.totalDocs === 20, `got ${categories.totalDocs}`)
  check('429 fees', fees.totalDocs === 429, `got ${fees.totalDocs}`)
  check('858 payments', payments.totalDocs === 858, `got ${payments.totalDocs}`)

  const { totalDocs: paidCount } = await payload.count({
    collection: 'payments',
    where: { paidOn: { exists: true } },
  })
  const { totalDocs: unpaidCount } = await payload.count({
    collection: 'payments',
    where: { paidOn: { exists: false } },
  })
  console.log('\nPayment status:')
  check('719 paid', paidCount === 719, `got ${paidCount}`)
  check('139 unpaid', unpaidCount === 139, `got ${unpaidCount}`)
  check('paid + unpaid = total', paidCount + unpaidCount === payments.totalDocs)

  console.log('\nPer-fee share integrity (every fee, no tolerance):')
  const { docs: allFees } = await payload.find({
    collection: 'fees',
    limit: 0,
    depth: 0,
  })
  const { docs: allPayments } = await payload.find({
    collection: 'payments',
    limit: 0,
    depth: 0,
  })

  const paymentsByFee = new Map<number, typeof allPayments>()
  for (const payment of allPayments) {
    const feeId = typeof payment.fee === 'object' ? payment.fee.id : payment.fee
    const list = paymentsByFee.get(feeId) ?? []
    list.push(payment)
    paymentsByFee.set(feeId, list)
  }

  let mismatchedFees = 0
  for (const fee of allFees) {
    const feePayments = paymentsByFee.get(fee.id) ?? []
    const sum = feePayments.reduce((total, p) => total + p.shareCents, 0)
    if (sum !== fee.amountCents) {
      mismatchedFees++
      console.error(
        `FAIL  fee ${fee.id}: shares sum to ${sum}, amount is ${fee.amountCents} (${feePayments.length} payments)`,
      )
    }
  }
  check(`all ${allFees.length} fees: sum(shares) === amount`, mismatchedFees === 0)

  console.log('\nReferential integrity:')
  const feeIds = new Set(allFees.map((f) => f.id))
  const userIds = new Set(
    (await payload.find({ collection: 'users', limit: 0, depth: 0 })).docs.map((u) => u.id),
  )
  let danglingRefs = 0
  const seenPairs = new Set<string>()
  let duplicatePairs = 0
  for (const payment of allPayments) {
    const feeId = typeof payment.fee === 'object' ? payment.fee.id : payment.fee
    const userId = typeof payment.user === 'object' ? payment.user.id : payment.user
    if (!feeIds.has(feeId) || !userIds.has(userId)) danglingRefs++
    const key = `${feeId}-${userId}`
    if (seenPairs.has(key)) duplicatePairs++
    seenPairs.add(key)
  }
  check('no dangling fee/user references in payments', danglingRefs === 0, `${danglingRefs} found`)
  check('no duplicate (fee, user) pairs', duplicatePairs === 0, `${duplicatePairs} found`)

  console.log('\nSpot check against the dump (fee id 566, Groceries, $260.00, April 2018):')
  const { docs: spotFees } = await payload.find({
    collection: 'fees',
    where: {
      and: [{ amountCents: { equals: 26000 } }],
    },
    limit: 0,
    depth: 1,
  })
  const spotFee = spotFees.find(
    (f) =>
      typeof f.category === 'object' &&
      f.category.name === 'Groceries' &&
      typeof f.month === 'object' &&
      f.month.startsOn.startsWith('2018-04'),
  )
  check('fee 566 equivalent exists with correct category/month/amount', Boolean(spotFee))

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
  await payload.db.destroy?.()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('Verification script crashed:', err)
  process.exit(1)
})
