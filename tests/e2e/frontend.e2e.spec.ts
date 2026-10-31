import { test, expect, Page } from '@playwright/test'
import { getPayload } from 'payload'
import config from '../../src/payload.config'

/**
 * Deliberately not reusing tests/helpers/seedUser.ts's shared `testUser`
 * fixture here: that email is also seeded/torn down by admin.e2e.spec.ts,
 * and Playwright runs spec files across parallel workers by default, so
 * two files racing to create/delete the same row causes a duplicate-key
 * error in one and a hung login in the other. A distinct email per file
 * avoids the collision instead of serializing every e2e run to fix it.
 */
const frontendTestUser = {
  email: 'frontend-e2e-test@example.invalid',
  password: 'frontend-e2e-test-password',
}

async function cleanupFrontendToggleFixtures() {
  const payload = await getPayload({ config: await config })
  const { docs: categories } = await payload.find({
    collection: 'categories',
    where: { name: { equals: '__test__ Frontend Toggle' } },
    limit: 0,
    depth: 0,
  })

  for (const category of categories) {
    const { docs: fees } = await payload.find({
      collection: 'fees',
      where: { category: { equals: category.id } },
      limit: 0,
      depth: 0,
    })
    for (const fee of fees) {
      await payload.delete({ collection: 'fees', id: fee.id })
    }
    await payload.delete({ collection: 'categories', id: category.id })
  }
}

async function seedFrontendTestUser() {
  await cleanupFrontendToggleFixtures()
  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({
    collection: 'users',
    where: { email: { equals: frontendTestUser.email } },
    limit: 1,
    depth: 0,
  })
  if (docs[0]) {
    await payload.delete({ collection: 'users', id: docs[0].id })
  }
  await payload.create({
    collection: 'users',
    data: {
      email: frontendTestUser.email,
      password: frontendTestUser.password,
      roles: ['member'],
      startDate: '2020-01-01',
      endDate: null,
    },
  })
}

async function cleanupFrontendTestUser() {
  const payload = await getPayload({ config: await config })
  const { docs } = await payload.find({
    collection: 'users',
    where: { email: { equals: frontendTestUser.email } },
    limit: 1,
    depth: 0,
  })
  if (docs[0]) {
    await payload.delete({ collection: 'users', id: docs[0].id })
  }
}

test.describe('Frontend', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    await seedFrontendTestUser()

    const context = await browser.newContext()
    page = await context.newPage()
  })

  test.afterAll(async () => {
    await cleanupFrontendToggleFixtures()
    await cleanupFrontendTestUser()
  })

  test('redirects an unauthenticated visitor to the login page', async () => {
    await page.goto('http://localhost:3000')

    await expect(page).toHaveURL(/\/login$/)
    await expect(page).toHaveTitle(/Expenses/)

    await expect(page.locator('input[name="email"]')).toBeVisible()
    await expect(page.locator('input[name="password"]')).toBeVisible()
  })

  test('rejects an incorrect password and stays on login', async () => {
    await page.goto('http://localhost:3000/login')
    await page.fill('input[name="email"]', frontendTestUser.email)
    await page.fill('input[name="password"]', 'wrong-password')
    await page.click('button[type="submit"]')

    await expect(page).toHaveURL(/\/login\?error=1$/)
    await expect(page.locator('.login-error')).toHaveText('Incorrect email or password.')
  })

  test('logs in via the login form and sees the dashboard', async () => {
    await page.goto('http://localhost:3000/login')
    await page.fill('input[name="email"]', frontendTestUser.email)
    await page.fill('input[name="password"]', frontendTestUser.password)
    await page.click('button[type="submit"]')

    await expect(page).toHaveURL('http://localhost:3000/')
    await expect(page.locator('h1')).toHaveText('Expenses')
    await expect(page.locator('.user-info')).toContainText(frontendTestUser.email)

    // Logging out should land back on the login page.
    await page.click('button:has-text("Logout")')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('toggles a payment between unpaid and paid', async () => {
    const payload = await getPayload({ config: await config })
    const user = await payload.find({
      collection: 'users',
      where: { email: { equals: frontendTestUser.email } },
      limit: 1,
      depth: 0,
    })
    const month = await payload.create({
      collection: 'months',
      data: { startsOn: '2099-12-01' },
    })
    const category = await payload.create({
      collection: 'categories',
      data: { name: '__test__ Frontend Toggle' },
    })
    let feeId: number | undefined

    try {
      const fee = await payload.create({
        collection: 'fees',
        data: { month: month.id, category: category.id, amountCents: 5000 },
      })
      feeId = fee.id

      await page.goto('http://localhost:3000/login')
      await page.fill('input[name="email"]', frontendTestUser.email)
      await page.fill('input[name="password"]', frontendTestUser.password)
      await page.click('button[type="submit"]')
      await expect(page).toHaveURL('http://localhost:3000/')
      await page.goto('http://localhost:3000/?month=12&year=2099')

      const userSection = page.locator('.user-section').filter({ hasText: frontendTestUser.email })
      const paymentRow = userSection.locator('tr').filter({ hasText: '__test__ Frontend Toggle' })
      const payment = await payload.find({
        collection: 'payments',
        where: {
          and: [{ fee: { equals: fee.id } }, { user: { equals: user.docs[0].id } }],
        },
        limit: 1,
        depth: 0,
      })
      expect(payment.docs).toHaveLength(1)
      expect(payment.docs[0].paidOn).toBeFalsy()

      await paymentRow.getByRole('button', { name: 'Unpaid' }).click()
      await expect(paymentRow.getByRole('button', { name: 'Paid' })).toBeVisible()

      await expect
        .poll(async () => {
          const currentPayment = await payload.findByID({
            collection: 'payments',
            id: payment.docs[0].id,
            depth: 0,
          })
          return currentPayment.paidOn
        })
        .toBeTruthy()

      const paidPayment = await payload.findByID({
        collection: 'payments',
        id: payment.docs[0].id,
        depth: 0,
      })
      expect(paidPayment.paidOn).toBeTruthy()

      await paymentRow.getByRole('button', { name: 'Paid' }).click()
      await expect(paymentRow.getByRole('button', { name: 'Unpaid' })).toBeVisible()

      await expect
        .poll(async () => {
          const currentPayment = await payload.findByID({
            collection: 'payments',
            id: paidPayment.id,
            depth: 0,
          })
          return currentPayment.paidOn
        })
        .toBeFalsy()
    } finally {
      if (feeId !== undefined) {
        await payload.delete({ collection: 'fees', id: feeId })
      }
      await payload.delete({ collection: 'months', id: month.id })
      await payload.delete({ collection: 'categories', id: category.id })
    }
  })
})
