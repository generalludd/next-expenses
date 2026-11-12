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

const copyCategoryName = '__test__ Frontend Copy'
const skipCategoryName = '__test__ Frontend Skip'
const addCategoryName = '__test__ Frontend Add'
const septemberStart = '2099-09-01T00:00:00.000Z'
const octoberStart = '2099-10-01T00:00:00.000Z'
const novemberStart = '2099-11-01T00:00:00.000Z'
const copyMonthStarts = [septemberStart, octoberStart, novemberStart]

async function cleanupCopyMonthFixtures() {
  const payload = await getPayload({ config: await config })
  const { docs: categories } = await payload.find({
    collection: 'categories',
    where: { name: { in: [copyCategoryName, skipCategoryName, addCategoryName] } },
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
  const { docs: months } = await payload.find({
    collection: 'months',
    where: { startsOn: { in: copyMonthStarts } },
    limit: 0,
    depth: 0,
  })
  for (const month of months) {
    await payload.delete({ collection: 'months', id: month.id })
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
      // Admin so the copy-month test can see the Create month button.
      roles: ['admin', 'member'],
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

  test('creates a month, copies, skips, and deletes fees', async ({ browser }) => {
    await cleanupCopyMonthFixtures()
    const payload = await getPayload({ config: await config })

    try {
      const october = await payload.create({
        collection: 'months',
        data: { startsOn: octoberStart },
      })
      const category = await payload.create({
        collection: 'categories',
        data: { name: copyCategoryName },
      })
      await payload.create({
        collection: 'fees',
        data: { month: october.id, category: category.id, amountCents: 12000 },
      })
      const skipCategory = await payload.create({
        collection: 'categories',
        data: { name: skipCategoryName },
      })
      await payload.create({
        collection: 'fees',
        data: { month: october.id, category: skipCategory.id, amountCents: 3000 },
      })

      const freshPage = await (await browser.newContext()).newPage()
      await freshPage.goto('http://localhost:3000/login')
      await freshPage.fill('input[name="email"]', frontendTestUser.email)
      await freshPage.fill('input[name="password"]', frontendTestUser.password)
      await freshPage.click('button[type="submit"]')
      await expect(freshPage).toHaveURL('http://localhost:3000/')

      await freshPage.goto('http://localhost:3000/?month=11&year=2099')
      await freshPage.click('button:has-text("Create November 2099")')

      const copySection = freshPage.locator('.copy-section')
      await expect(copySection.locator('h2')).toHaveText('Copy from October 2099')
      const copyRow = copySection.locator('tr').filter({ hasText: copyCategoryName })
      await expect(copyRow.locator('input[name="amount"]')).toHaveValue('120.00')

      await copyRow.locator('input[name="amount"]').fill('150.50')
      await copyRow.getByRole('button', { name: 'Add' }).click()

      const feeRow = freshPage.locator('.fees-table tr').filter({ hasText: copyCategoryName })
      await expect(feeRow).toContainText('$150.50')
      await expect(copySection.locator('tr').filter({ hasText: copyCategoryName })).toHaveCount(0)

      const userSection = freshPage
        .locator('.user-section')
        .filter({ hasText: frontendTestUser.email })
      await expect(
        userSection.locator('.data-table.unpaid tr').filter({ hasText: copyCategoryName }),
      ).toBeVisible()

      // Skip removes a category from the copy panel; Undo brings it back.
      const skipRow = () => copySection.locator('tr').filter({ hasText: skipCategoryName })
      await skipRow().getByRole('button', { name: 'Skip' }).click()
      await expect(skipRow()).toHaveCount(0)
      const skippedItem = copySection
        .locator('.skipped-list li')
        .filter({ hasText: skipCategoryName })
      await expect(skippedItem).toBeVisible()
      await skippedItem.getByRole('button', { name: 'Undo' }).click()
      await expect(skipRow()).toBeVisible()
      await expect(skippedItem).toHaveCount(0)

      // Deleting the copied fee removes it and puts it back on the copy panel.
      freshPage.once('dialog', (dialog) => dialog.accept())
      await feeRow.getByRole('button', { name: 'Delete' }).click()
      await expect(feeRow).toHaveCount(0)
      await expect(copySection.locator('tr').filter({ hasText: copyCategoryName })).toBeVisible()
    } finally {
      await cleanupCopyMonthFixtures()
    }
  })

  test('adds a fee to a new month through the dialog, then edits it', async ({ browser }) => {
    await cleanupCopyMonthFixtures()
    const payload = await getPayload({ config: await config })

    try {
      await payload.create({ collection: 'categories', data: { name: addCategoryName } })

      const freshPage = await (await browser.newContext()).newPage()
      await freshPage.goto('http://localhost:3000/login')
      await freshPage.fill('input[name="email"]', frontendTestUser.email)
      await freshPage.fill('input[name="password"]', frontendTestUser.password)
      await freshPage.click('button[type="submit"]')
      await expect(freshPage).toHaveURL('http://localhost:3000/')

      // Add from the current month, targeting September 2099, which doesn't exist yet;
      // the seeded user is an admin, so the month is created on the fly.
      await freshPage.getByRole('button', { name: '+ Add fee' }).click()
      const addDialog = freshPage.getByRole('dialog', { name: 'Add fee' })
      await addDialog.locator('select[name="month"]').selectOption({ label: 'September' })
      await addDialog.locator('input[name="year"]').fill('2099')
      await addDialog.locator('select[name="category"]').selectOption({ label: addCategoryName })
      await addDialog.locator('input[name="amount"]').fill('42.10')
      await addDialog.getByRole('button', { name: 'Save' }).click()

      await expect(freshPage).toHaveURL(/\?month=9&year=2099$/)
      const feeRow = freshPage.locator('.fees-table tbody tr').filter({ hasText: addCategoryName })
      await expect(feeRow).toContainText('$42.10')

      // Adding the same category again is refused inside the dialog.
      await freshPage.getByRole('button', { name: '+ Add fee' }).click()
      const againDialog = freshPage.getByRole('dialog', { name: 'Add fee' })
      await againDialog.locator('select[name="category"]').selectOption({ label: addCategoryName })
      await againDialog.locator('input[name="amount"]').fill('1')
      await againDialog.getByRole('button', { name: 'Save' }).click()
      await expect(againDialog.locator('.login-error')).toContainText(
        `already has a ${addCategoryName} fee`,
      )
      await againDialog.getByRole('button', { name: 'Cancel' }).click()

      // Edit the amount.
      await feeRow.getByRole('button', { name: 'Edit' }).click()
      const editDialog = freshPage.getByRole('dialog', { name: 'Edit fee' })
      await expect(editDialog.locator('input[name="amount"]')).toHaveValue('42.10')
      await editDialog.locator('input[name="amount"]').fill('55.00')
      await editDialog.getByRole('button', { name: 'Save' }).click()
      await expect(editDialog).toBeHidden()
      await expect(feeRow).toContainText('$55.00')
    } finally {
      await cleanupCopyMonthFixtures()
    }
  })

  // Kept last: it changes the seeded user's password.
  test('resets a forgotten password via the emailed link', async ({ browser }) => {
    const freshPage = await (await browser.newContext()).newPage()

    await freshPage.goto('http://localhost:3000/login')
    await freshPage.click('a:has-text("Forgot your password?")')
    await expect(freshPage).toHaveURL(/\/forgot-password$/)
    await freshPage.fill('input[name="email"]', 'nobody@example.invalid')
    await freshPage.click('button[type="submit"]')
    await expect(freshPage).toHaveURL(/\/forgot-password\?sent=1$/)
    await expect(freshPage.locator('.login-notice')).toContainText('If an account exists')

    // Grab a token directly instead of reading it out of Mailpit.
    const payload = await getPayload({ config: await config })
    const token = await payload.forgotPassword({
      collection: 'users',
      data: { email: frontendTestUser.email },
      disableEmail: true,
    })
    const newPassword = 'frontend-e2e-reset-password'

    await freshPage.goto(`http://localhost:3000/reset-password?token=${token}`)
    await freshPage.fill('input[name="password"]', newPassword)
    await freshPage.fill('input[name="confirm"]', 'something-else')
    await freshPage.click('button[type="submit"]')
    await expect(freshPage.locator('.login-error')).toHaveText('Passwords do not match.')

    await freshPage.fill('input[name="password"]', newPassword)
    await freshPage.fill('input[name="confirm"]', newPassword)
    await freshPage.click('button[type="submit"]')
    await expect(freshPage).toHaveURL(/\/login\?reset=1$/)
    await expect(freshPage.locator('.login-notice')).toContainText('Password updated')

    // The token is single-use.
    await freshPage.goto(`http://localhost:3000/reset-password?token=${token}`)
    await freshPage.fill('input[name="password"]', newPassword)
    await freshPage.fill('input[name="confirm"]', newPassword)
    await freshPage.click('button[type="submit"]')
    await expect(freshPage.locator('.login-error')).toHaveText(
      'This reset link is invalid or has expired.',
    )

    await freshPage.goto('http://localhost:3000/login')
    await freshPage.fill('input[name="email"]', frontendTestUser.email)
    await freshPage.fill('input[name="password"]', newPassword)
    await freshPage.click('button[type="submit"]')
    await expect(freshPage).toHaveURL('http://localhost:3000/')
  })
})
