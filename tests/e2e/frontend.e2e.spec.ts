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

async function seedFrontendTestUser() {
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
})
