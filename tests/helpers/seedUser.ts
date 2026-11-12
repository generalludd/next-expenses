import { getPayload } from 'payload'
import config from '../../src/payload.config.js'

export const testUser = {
  email: 'dev@payloadcms.com',
  password: 'test',
  roles: ['admin'] as ('admin' | 'member')[],
  // Ended long before any month the specs create fees in (2098/2099), so this
  // admin-panel-only user is never given a payment by fanOutPayments. If it
  // were, a fee created by the frontend spec running in parallel would leave
  // a payment pointing at it and the delete in cleanupTestUser would fail.
  startDate: '2024-01-01',
  endDate: '2024-01-31',
}

/**
 * Seeds a test user for e2e admin tests.
 */
export async function seedTestUser(): Promise<void> {
  const payload = await getPayload({ config })

  // Delete existing test user if any
  await deleteTestUser()

  // Create fresh test user
  await payload.create({
    collection: 'users',
    data: testUser,
  })
}

/**
 * Cleans up test user after tests
 */
export async function cleanupTestUser(): Promise<void> {
  await deleteTestUser()
}

/**
 * Find-then-delete by id rather than a bulk `delete where`: the bulk form
 * runs in one transaction that also clears payload_preferences, and
 * intermittently aborted ("current transaction is aborted") while the
 * frontend spec was writing in parallel.
 */
async function deleteTestUser(): Promise<void> {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'users',
    where: { email: { equals: testUser.email } },
    limit: 0,
    depth: 0,
  })
  for (const user of docs) {
    await payload.delete({ collection: 'users', id: user.id })
  }
}
