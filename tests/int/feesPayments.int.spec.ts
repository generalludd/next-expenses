import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * These tests run against the real dev database (see .env / vitest.setup.ts,
 * same as the existing api.int.spec.ts) because this project has no separate
 * test database configured yet. That means the real migrated household
 * members (Chris and Emily — see src/scripts/migrateLegacy.ts) are present
 * too, and both have no `endDate`, so they are "active" for every month any
 * test creates a fee in — exactly as isActiveForMonth is supposed to behave.
 *
 * So these tests never assert an exact total payment count. Where a count
 * matters, they filter to the payments belonging to their own fixture users
 * and check those; whole-fee invariants (shares summing to the amount) are
 * asserted across every payment, which holds regardless of how many real
 * users exist alongside the fixtures.
 *
 * Every fixture is namespaced under "__test__" emails/names. Each test
 * deletes its own users in a `finally` block, not just at the end of the
 * happy path: a user left behind with no `endDate` would be "active" for
 * every later test's month too, inflating the fan-out count there as well.
 * `afterAll` is only a backstop for a run that crashes before a test's own
 * `finally` runs.
 */

let payload: Payload

const emailFor = (label: string) => `__test__${label}@example.invalid`

const idOf = (ref: number | { id: number }) => (typeof ref === 'object' ? ref.id : ref)

async function makeUser(label: string, startDate: string, endDate: string | null = null) {
  return payload.create({
    collection: 'users',
    data: {
      email: emailFor(label),
      password: 'test-password-not-real',
      name: `Test ${label}`,
      roles: ['member'],
      startDate,
      endDate,
    },
  })
}

async function cleanupTestFixtures() {
  // Delete fees first: this is also what exercises the beforeDelete cascade
  // hook, and deleting the fee is what frees its payments' (fee, user)
  // unique-index slots before we try to delete the users those payments
  // reference.
  const months = await payload.find({
    collection: 'months',
    where: { startsOn: { greater_than_equal: '2099-01-01' } },
    limit: 0,
    depth: 0,
  })
  for (const month of months.docs) {
    const { docs: fees } = await payload.find({
      collection: 'fees',
      where: { month: { equals: month.id } },
      limit: 0,
      depth: 0,
    })
    for (const fee of fees) {
      await payload.delete({ collection: 'fees', id: fee.id })
    }
    await payload.delete({ collection: 'months', id: month.id })
  }

  const categories = await payload.find({
    collection: 'categories',
    where: { name: { like: '__test__' } },
    limit: 0,
    depth: 0,
  })
  for (const category of categories.docs) {
    await payload.delete({ collection: 'categories', id: category.id })
  }

  const users = await payload.find({
    collection: 'users',
    where: { email: { like: '__test__' } },
    limit: 0,
    depth: 0,
  })
  for (const user of users.docs) {
    await payload.delete({ collection: 'users', id: user.id })
  }
}

describe('Fees + Payments', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })
    await cleanupTestFixtures() // in case a previous failed run left fixtures behind
  })

  afterAll(async () => {
    await cleanupTestFixtures()
  })

  it('fans out one unpaid payment per active user when a fee is created, with shares summing exactly', async () => {
    const month = await payload.create({
      collection: 'months',
      data: { startsOn: '2099-03-01' },
    })
    const category = await payload.create({
      collection: 'categories',
      data: { name: '__test__ Fan-out Category' },
    })
    const [a, b, c] = await Promise.all([
      makeUser('fanout-a', '2090-01-01'),
      makeUser('fanout-b', '2090-01-01'),
      makeUser('fanout-c', '2090-01-01'),
    ])
    const fixtureIds = new Set([a.id, b.id, c.id])

    try {
      const fee = await payload.create({
        collection: 'fees',
        data: { month: month.id, category: category.id, amountCents: 10000 },
      })

      const { docs: payments } = await payload.find({
        collection: 'payments',
        where: { fee: { equals: fee.id } },
        sort: 'id',
        limit: 0,
        depth: 0,
      })

      // Whole-fee invariant: holds no matter how many users were active,
      // real household members included.
      expect(payments.reduce((sum, p) => sum + p.shareCents, 0)).toBe(10000)

      const fixturePayments = payments.filter((p) => fixtureIds.has(idOf(p.user)))
      expect(fixturePayments).toHaveLength(3)
      expect(fixturePayments.every((p) => p.paidOn == null)).toBe(true)
      expect(new Set(fixturePayments.map((p) => idOf(p.user)))).toEqual(fixtureIds)

      await payload.delete({ collection: 'fees', id: fee.id })
    } finally {
      await payload.delete({ collection: 'months', id: month.id })
      await payload.delete({ collection: 'categories', id: category.id })
      await Promise.all(
        [a, b, c].map((u) => payload.delete({ collection: 'users', id: u.id })),
      )
    }
  })

  it('excludes a user whose membership does not overlap the fee month', async () => {
    const month = await payload.create({
      collection: 'months',
      data: { startsOn: '2099-04-01' },
    })
    const category = await payload.create({
      collection: 'categories',
      data: { name: '__test__ Membership Category' },
    })
    const inRange = await makeUser('member-in', '2090-01-01')
    // Left before this month started.
    const leftEarly = await makeUser('member-out', '2090-01-01', '2099-01-15')

    try {
      const fee = await payload.create({
        collection: 'fees',
        data: { month: month.id, category: category.id, amountCents: 5000 },
      })

      const { docs: payments } = await payload.find({
        collection: 'payments',
        where: { fee: { equals: fee.id } },
        limit: 0,
        depth: 0,
      })

      const payerIds = payments.map((p) => idOf(p.user))
      expect(payerIds).toContain(inRange.id)
      expect(payerIds).not.toContain(leftEarly.id)

      await payload.delete({ collection: 'fees', id: fee.id })
    } finally {
      await payload.delete({ collection: 'months', id: month.id })
      await payload.delete({ collection: 'categories', id: category.id })
      await Promise.all(
        [inRange, leftEarly].map((u) => payload.delete({ collection: 'users', id: u.id })),
      )
    }
  })

  it('blocks an amount edit once any payment is marked paid, and leaves nothing changed', async () => {
    const month = await payload.create({
      collection: 'months',
      data: { startsOn: '2099-05-01' },
    })
    const category = await payload.create({
      collection: 'categories',
      data: { name: '__test__ Guard Category' },
    })
    const a = await makeUser('guard-a', '2090-01-01')
    const b = await makeUser('guard-b', '2090-01-01')
    const fixtureIds = new Set([a.id, b.id])

    try {
      const fee = await payload.create({
        collection: 'fees',
        data: { month: month.id, category: category.id, amountCents: 8000 },
      })

      const { docs: payments } = await payload.find({
        collection: 'payments',
        where: { fee: { equals: fee.id } },
        limit: 0,
        depth: 0,
      })
      const fixturePayments = payments.filter((p) => fixtureIds.has(idOf(p.user)))
      expect(fixturePayments).toHaveLength(2)

      // Mark one of this test's own payments paid.
      await payload.update({
        collection: 'payments',
        id: fixturePayments[0].id,
        data: { paidOn: '2099-05-15' },
      })

      await expect(
        payload.update({
          collection: 'fees',
          id: fee.id,
          data: { amountCents: 9000 },
        }),
      ).rejects.toThrow()

      const unchanged = await payload.findByID({ collection: 'fees', id: fee.id, depth: 0 })
      expect(unchanged.amountCents).toBe(8000)

      const unchangedPayments = await payload.find({
        collection: 'payments',
        where: { fee: { equals: fee.id } },
        limit: 0,
        depth: 0,
      })
      expect(unchangedPayments.docs.reduce((sum, p) => sum + p.shareCents, 0)).toBe(8000)

      await payload.delete({ collection: 'fees', id: fee.id })
    } finally {
      await payload.delete({ collection: 'months', id: month.id })
      await payload.delete({ collection: 'categories', id: category.id })
      await Promise.all([a, b].map((u) => payload.delete({ collection: 'users', id: u.id })))
    }
  })

  it('re-splits shares on an amount edit when nothing is paid yet', async () => {
    const month = await payload.create({
      collection: 'months',
      data: { startsOn: '2099-06-01' },
    })
    const category = await payload.create({
      collection: 'categories',
      data: { name: '__test__ Resplit Category' },
    })
    const a = await makeUser('resplit-a', '2090-01-01')
    const b = await makeUser('resplit-b', '2090-01-01')
    const c = await makeUser('resplit-c', '2090-01-01')

    try {
      const fee = await payload.create({
        collection: 'fees',
        data: { month: month.id, category: category.id, amountCents: 9000 },
      })

      await payload.update({
        collection: 'fees',
        id: fee.id,
        data: { amountCents: 10000 },
      })

      const { docs: payments } = await payload.find({
        collection: 'payments',
        where: { fee: { equals: fee.id } },
        limit: 0,
        depth: 0,
      })
      expect(payments.reduce((sum, p) => sum + p.shareCents, 0)).toBe(10000)

      await payload.delete({ collection: 'fees', id: fee.id })
    } finally {
      await payload.delete({ collection: 'months', id: month.id })
      await payload.delete({ collection: 'categories', id: category.id })
      await Promise.all(
        [a, b, c].map((u) => payload.delete({ collection: 'users', id: u.id })),
      )
    }
  })

  it('deletes all payments when their fee is deleted', async () => {
    const month = await payload.create({
      collection: 'months',
      data: { startsOn: '2099-07-01' },
    })
    const category = await payload.create({
      collection: 'categories',
      data: { name: '__test__ Cascade Category' },
    })
    const a = await makeUser('cascade-a', '2090-01-01')

    try {
      const fee = await payload.create({
        collection: 'fees',
        data: { month: month.id, category: category.id, amountCents: 1200 },
      })

      const before = await payload.find({
        collection: 'payments',
        where: { fee: { equals: fee.id } },
        limit: 0,
        depth: 0,
      })
      expect(before.docs.length).toBeGreaterThan(0)

      await payload.delete({ collection: 'fees', id: fee.id })

      const after = await payload.find({
        collection: 'payments',
        where: { fee: { equals: fee.id } },
        limit: 0,
        depth: 0,
      })
      expect(after.docs).toHaveLength(0)
    } finally {
      await payload.delete({ collection: 'months', id: month.id })
      await payload.delete({ collection: 'categories', id: category.id })
      await payload.delete({ collection: 'users', id: a.id })
    }
  })

  it('rejects a duplicate (fee, user) payment via the unique index', async () => {
    const month = await payload.create({
      collection: 'months',
      data: { startsOn: '2099-08-01' },
    })
    const category = await payload.create({
      collection: 'categories',
      data: { name: '__test__ Unique Category' },
    })
    const user = await makeUser('unique-a', '2090-01-01')

    try {
      const fee = await payload.create({
        collection: 'fees',
        data: { month: month.id, category: category.id, amountCents: 100 },
      })

      await expect(
        payload.create({
          collection: 'payments',
          data: { fee: fee.id, user: user.id, shareCents: 100, paidOn: null },
        }),
      ).rejects.toThrow()

      await payload.delete({ collection: 'fees', id: fee.id })
    } finally {
      await payload.delete({ collection: 'months', id: month.id })
      await payload.delete({ collection: 'categories', id: category.id })
      await payload.delete({ collection: 'users', id: user.id })
    }
  })
})
