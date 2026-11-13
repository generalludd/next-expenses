import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Category, Fee, Month, Payment, User } from '@/payload-types'

/**
 * The two roles: members can mark their own payments and edit their own
 * name/email/password; admins can do everything. These go through the Local
 * API with `user` + `overrideAccess: false`, i.e. the same path the
 * dashboard's server actions use.
 *
 * Runs against the dev database like the other int specs (see
 * feesPayments.int.spec.ts), so fixtures are "__test__"-namespaced and
 * deleted in afterAll.
 */

let payload: Payload
let admin: User
let member: User
let otherMember: User
let month: Month
let category: Category
let fee: Fee

const password = 'test-password-not-real'
const emailFor = (label: string) => `__test__access-${label}@example.invalid`

async function deleteFixtures() {
  const { docs: categories } = await payload.find({
    collection: 'categories',
    where: { name: { equals: '__test__ Access' } },
    limit: 0,
    depth: 0,
  })
  for (const c of categories) {
    const { docs: fees } = await payload.find({
      collection: 'fees',
      where: { category: { equals: c.id } },
      limit: 0,
      depth: 0,
    })
    for (const f of fees) await payload.delete({ collection: 'fees', id: f.id })
    await payload.delete({ collection: 'categories', id: c.id })
  }
  // One at a time rather than a bulk `delete where`: the bulk form runs in
  // one transaction that also clears payload_preferences, and intermittently
  // aborted when other int spec files were writing in parallel.
  const { docs: months } = await payload.find({
    collection: 'months',
    where: { startsOn: { equals: '2098-03-01T00:00:00.000Z' } },
    limit: 0,
    depth: 0,
  })
  for (const m of months) await payload.delete({ collection: 'months', id: m.id })
  const { docs: users } = await payload.find({
    collection: 'users',
    where: { email: { like: '__test__access-' } },
    limit: 0,
    depth: 0,
  })
  for (const u of users) await payload.delete({ collection: 'users', id: u.id })
}

async function makeUser(label: string, roles: ('admin' | 'member')[]) {
  return payload.create({
    collection: 'users',
    data: { email: emailFor(label), password, roles, startDate: '2020-01-01', endDate: null },
  })
}

async function paymentFor(userId: number): Promise<Payment> {
  const { docs } = await payload.find({
    collection: 'payments',
    where: { and: [{ fee: { equals: fee.id } }, { user: { equals: userId } }] },
    limit: 1,
    depth: 0,
  })
  return docs[0]
}

describe('Access rules', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await deleteFixtures()

    admin = await makeUser('admin', ['admin', 'member'])
    member = await makeUser('member', ['member'])
    otherMember = await makeUser('other', ['member'])
    month = await payload.create({
      collection: 'months',
      data: { startsOn: '2098-03-01T00:00:00.000Z' },
    })
    category = await payload.create({ collection: 'categories', data: { name: '__test__ Access' } })
    // skipFanOut + explicit payments: fanning out to every active user would
    // also pick up other int spec files' temporary users, which run in
    // parallel and may be deleted mid-insert.
    fee = await payload.create({
      collection: 'fees',
      data: { month: month.id, category: category.id, amountCents: 9000 },
      context: { skipFanOut: true },
    })
    for (const u of [admin, member, otherMember]) {
      await payload.create({
        collection: 'payments',
        data: { fee: fee.id, user: u.id, shareCents: 3000, paidOn: null },
      })
    }
  })

  afterAll(async () => {
    await deleteFixtures()
  })

  describe('payments', () => {
    it('lets a member mark their own payment paid', async () => {
      const own = await paymentFor(member.id)
      const updated = await payload.update({
        collection: 'payments',
        id: own.id,
        data: { paidOn: new Date().toISOString() },
        user: member,
        overrideAccess: false,
      })
      expect(updated.paidOn).toBeTruthy()
    })

    it("refuses a member changing someone else's payment", async () => {
      const others = await paymentFor(otherMember.id)
      await expect(
        payload.update({
          collection: 'payments',
          id: others.id,
          data: { paidOn: new Date().toISOString() },
          user: member,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
      expect((await paymentFor(otherMember.id)).paidOn).toBeFalsy()
    })

    it('ignores a member changing the share on their own payment', async () => {
      const own = await paymentFor(member.id)
      await payload.update({
        collection: 'payments',
        id: own.id,
        data: { shareCents: 1 },
        user: member,
        overrideAccess: false,
      })
      expect((await paymentFor(member.id)).shareCents).toBe(own.shareCents)
    })

    it("lets an admin change anyone's payment", async () => {
      const others = await paymentFor(otherMember.id)
      const updated = await payload.update({
        collection: 'payments',
        id: others.id,
        data: { paidOn: new Date().toISOString() },
        user: admin,
        overrideAccess: false,
      })
      expect(updated.paidOn).toBeTruthy()
    })
  })

  describe('fees and months', () => {
    it('refuses a member creating, editing or deleting fees', async () => {
      await expect(
        payload.create({
          collection: 'fees',
          data: { month: month.id, category: category.id, amountCents: 100 },
          user: member,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
      await expect(
        payload.update({
          collection: 'fees',
          id: fee.id,
          data: { amountCents: 100 },
          user: member,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
      await expect(
        payload.delete({ collection: 'fees', id: fee.id, user: member, overrideAccess: false }),
      ).rejects.toThrow()
    })

    it('refuses a member skipping a category on a month', async () => {
      await expect(
        payload.update({
          collection: 'months',
          id: month.id,
          data: { skippedCategories: [category.id] },
          user: member,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })
  })

  describe('users', () => {
    it('lets a member edit their own name but not their role or membership', async () => {
      const updated = await payload.update({
        collection: 'users',
        id: member.id,
        data: {
          name: 'Renamed',
          roles: ['admin', 'member'],
          isActive: false,
          endDate: '2021-01-01',
        },
        user: member,
        overrideAccess: false,
      })
      expect(updated.name).toBe('Renamed')
      expect(updated.roles).toEqual(['member'])
      expect(updated.isActive).toBe(true)
      expect(updated.endDate).toBeFalsy()
    })

    it('refuses a member editing or creating other users', async () => {
      await expect(
        payload.update({
          collection: 'users',
          id: otherMember.id,
          data: { name: 'Hijacked' },
          user: member,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
      await expect(
        payload.create({
          collection: 'users',
          data: { email: emailFor('new'), password, roles: ['member'], startDate: '2020-01-01' },
          user: member,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })

    it('lets an admin make a member an admin', async () => {
      const updated = await payload.update({
        collection: 'users',
        id: otherMember.id,
        data: { roles: ['admin', 'member'] },
        user: admin,
        overrideAccess: false,
      })
      expect(updated.roles).toContain('admin')
    })

    it('gives a user with a pending password change access to nothing but their own record', async () => {
      const pending = await payload.update({
        collection: 'users',
        id: member.id,
        data: { mustChangePassword: true },
      })
      const asPending = { user: pending, overrideAccess: false } as const

      try {
        await expect(payload.find({ collection: 'fees', ...asPending })).rejects.toThrow()
        await expect(payload.find({ collection: 'payments', ...asPending })).rejects.toThrow()
        await expect(payload.find({ collection: 'months', ...asPending })).rejects.toThrow()
        await expect(payload.find({ collection: 'categories', ...asPending })).rejects.toThrow()
        const own = await paymentFor(member.id)
        await expect(
          payload.update({
            collection: 'payments',
            id: own.id,
            data: { paidOn: null },
            ...asPending,
          }),
        ).rejects.toThrow()

        const { docs: visibleUsers } = await payload.find({ collection: 'users', ...asPending })
        expect(visibleUsers.map((u) => u.id)).toEqual([member.id])
        await expect(
          payload.update({ collection: 'users', id: member.id, data: { name: 'x' }, ...asPending }),
        ).rejects.toThrow()

        // An admin with a pending change is locked out the same way.
        const pendingAdmin = await payload.update({
          collection: 'users',
          id: admin.id,
          data: { mustChangePassword: true },
        })
        await expect(
          payload.find({ collection: 'users', user: pendingAdmin, overrideAccess: false }),
        ).resolves.toMatchObject({ totalDocs: 1 })
        await expect(
          payload.update({
            collection: 'users',
            id: otherMember.id,
            data: { name: 'x' },
            user: pendingAdmin,
            overrideAccess: false,
          }),
        ).rejects.toThrow()
      } finally {
        for (const id of [member.id, admin.id]) {
          await payload.update({ collection: 'users', id, data: { mustChangePassword: false } })
        }
      }
    })

    it('blocks login while isActive is off', async () => {
      await payload.update({ collection: 'users', id: member.id, data: { isActive: false } })
      await expect(
        payload.login({ collection: 'users', data: { email: member.email, password } }),
      ).rejects.toThrow('This account has been disabled.')

      // A successful login can't be asserted here: Payload's JWT signing
      // fails under this Vitest environment (jsdom's Uint8Array). The e2e
      // suite covers logging in for real.
      await payload.update({ collection: 'users', id: member.id, data: { isActive: true } })
    })
  })
})
