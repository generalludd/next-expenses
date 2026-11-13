'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { randomBytes } from 'crypto'
import { getPayload } from 'payload'

import config from '@/payload.config'
import { toCents } from '@/lib/money'
import { isAdmin } from '@/access/adminOnly'
import { monthStartFromParts } from '@/lib/months'
import { skippedCategoryIdsOf } from '@/lib/monthSummary'
import { requireUser } from '@/lib/requireUser'

/**
 * Logs in via the Local API and sets Payload's own session cookie by hand.
 *
 * Payload's cookie-building helpers (generatePayloadCookie, in
 * payload/dist/auth/cookies.js) aren't exported from any public subpath —
 * only `./internal`, which is explicitly not meant for app code — so this
 * replicates the small amount of logic directly rather than reach into
 * dist/ internals. The values below match Users' *actual* sanitized auth
 * config: cookiePrefix defaults to 'payload' (buildConfig default), and
 * since Users.ts never sets `auth.cookies`, Payload's own
 * addDefaultsToAuthConfig fills in sameSite: 'Lax', secure: false.
 * useSessions defaults to true, and payload.login() already appends the
 * new session to the user's `sessions` field (src/auth/sessions.js) — all
 * this needs to do is hand the resulting token to the browser.
 */
export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const payload = await getPayload({ config: await config })

  let token: string | undefined
  let exp: number | undefined
  let mustChangePassword = false
  try {
    const result = await payload.login({ collection: 'users', data: { email, password } })
    token = result.token
    exp = result.exp
    mustChangePassword = Boolean(result.user?.mustChangePassword)
  } catch {
    // Invalid credentials. Fall through to the redirect below — `redirect()`
    // throws internally, and calling it from inside this catch would catch
    // that throw right back instead of letting Next.js handle it.
  }

  if (!token) {
    redirect('/login?error=1')
  }

  const cookieStore = await cookies()
  cookieStore.set({
    name: `${payload.config.cookiePrefix}-token`,
    value: token,
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: false, // matches Users' sanitized auth.cookies.secure default; set true behind HTTPS in production
    expires: exp ? new Date(exp * 1000) : undefined,
  })

  redirect(mustChangePassword ? '/change-password' : '/')
}

const MIN_PASSWORD_LENGTH = 8

/** Error text for an unacceptable new password, or null if it's fine. */
function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (password !== confirm) return 'Passwords do not match.'
  return null
}

export type ChangePasswordState = {
  error: string | null
  /** Set on success; a timestamp so repeat changes still re-render the notice. */
  savedAt: number | null
}

/**
 * Backs /change-password for any logged-in user.
 *
 * The current password is checked with payload.login (which also counts
 * failed attempts toward the usual lockout). It's skipped when an admin has
 * set a temporary password with mustChangePassword: the user typed it at
 * login moments ago.
 *
 * The update passes the logged-in `user`, whose session id Payload keeps
 * when the password changes (collections/operations/utilities/update.js),
 * so this browser stays logged in while every other session — including the
 * one payload.login just made to check the password — is dropped.
 * overrideAccess because mustChangePassword is admin-only at field level;
 * the id is always the caller's own.
 */
export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const { payload, user } = await requireUser({ allowPendingPasswordChange: true })

  const current = String(formData.get('current') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')
  const forced = Boolean(user.mustChangePassword)

  const problem = newPasswordProblem(password, confirm)
  if (problem) return { error: problem, savedAt: null }

  if (!forced) {
    let currentIsCorrect = false
    try {
      await payload.login({ collection: 'users', data: { email: user.email, password: current } })
      currentIsCorrect = true
    } catch {
      // Wrong password, or locked out after too many tries.
    }
    if (!currentIsCorrect) {
      return { error: 'Your current password is incorrect.', savedAt: null }
    }
  }

  await payload.update({
    collection: 'users',
    id: user.id,
    data: { password, mustChangePassword: false },
    user,
    overrideAccess: true,
  })

  revalidatePath('/', 'layout')

  // A forced change was standing between them and the app; send them on.
  if (forced) {
    redirect('/')
  }
  return { error: null, savedAt: Date.now() }
}

/**
 * Always lands on the same "check your email" screen, whether or not the
 * address belongs to a user, so the form can't be used to probe which
 * emails are registered. Payload's forgotPassword already returns quietly
 * for unknown emails; the catch covers anything else (e.g. SMTP down).
 */
export async function forgotPasswordAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')

  const payload = await getPayload({ config: await config })

  try {
    await payload.forgotPassword({ collection: 'users', data: { email } })
  } catch (error) {
    payload.logger.error({ err: error, msg: 'forgotPassword failed' })
  }

  redirect('/forgot-password?sent=1')
}

/**
 * Doesn't log the user in afterwards — they're sent back to /login with a
 * success notice, which keeps the cookie handling in loginAction only.
 */
export async function resetPasswordAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')
  const tokenParam = encodeURIComponent(token)

  if (password !== confirm) {
    redirect(`/reset-password?token=${tokenParam}&error=mismatch`)
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    redirect(`/reset-password?token=${tokenParam}&error=short`)
  }

  const payload = await getPayload({ config: await config })

  let succeeded = false
  try {
    const result = await payload.resetPassword({
      collection: 'users',
      data: { token, password },
      overrideAccess: true,
    })
    // They chose this password themselves, so any admin-set
    // "must change password" is satisfied.
    const userId = result.user?.id as number | undefined
    if (userId) {
      await payload.update({
        collection: 'users',
        id: userId,
        data: { mustChangePassword: false },
        overrideAccess: true,
      })
    }
    succeeded = true
  } catch {
    // Invalid or expired token. Redirect outside the catch, as in loginAction.
  }

  if (!succeeded) {
    redirect(`/reset-password?token=${tokenParam}&error=invalid`)
  }

  redirect('/login?reset=1')
}

/**
 * Clears the cookie so the browser stops presenting the token. Doesn't also
 * revoke the session server-side (logoutOperation wants a fully-built
 * PayloadRequest with req.user populated, which isn't worth constructing
 * for a sign-out button) — the session row still exists until it naturally
 * expires with tokenExpiration (2 hours). Fine for this app's scale; worth
 * revisiting if that ever matters.
 */
export async function logoutAction(): Promise<void> {
  const payload = await getPayload({ config: await config })
  const cookieStore = await cookies()
  cookieStore.delete(`${payload.config.cookiePrefix}-token`)
  redirect('/login')
}

export async function togglePaymentStatusAction(paymentId: number): Promise<void> {
  const { payload, user } = await requireUser()

  const payment = await payload.findByID({
    collection: 'payments',
    id: paymentId,
    depth: 0,
    user,
    overrideAccess: false,
  })

  await payload.update({
    collection: 'payments',
    id: paymentId,
    data: { paidOn: payment.paidOn ? null : new Date().toISOString() },
    user,
    overrideAccess: false,
  })

  revalidatePath('/')
}

/**
 * Months' create access is adminOnly, and overrideAccess: false keeps that
 * enforced here even though the button is only rendered for admins.
 */
export async function createMonthAction(month: number, year: number): Promise<void> {
  const { payload, user } = await requireUser()

  try {
    await payload.create({
      collection: 'months',
      data: { startsOn: monthStartFromParts(month, year).toISOString() },
      user,
      overrideAccess: false,
    })
  } catch (error) {
    // A double click trips the unique index on startsOn; the month exists
    // either way, so only re-throw if it's genuinely missing.
    const { totalDocs } = await payload.count({
      collection: 'months',
      where: { startsOn: { equals: monthStartFromParts(month, year).toISOString() } },
    })
    if (totalDocs === 0) throw error
  }

  revalidatePath('/')
}

/**
 * Adds one fee to `monthId` for `categoryId`, using the (possibly edited)
 * amount from the copy panel. Creating the fee fires fanOutPayments, which
 * creates every active user's payment, so the re-render picks those up.
 */
export async function copyFeeAction(
  monthId: number,
  categoryId: number,
  formData: FormData,
): Promise<void> {
  const { payload, user } = await requireUser()

  let amountCents: number
  try {
    amountCents = toCents(String(formData.get('amount') ?? ''))
  } catch {
    return
  }
  if (amountCents < 0) return

  // There's no unique constraint on (month, category), so guard against a
  // double submit creating the same fee twice.
  const { totalDocs } = await payload.count({
    collection: 'fees',
    where: { and: [{ month: { equals: monthId } }, { category: { equals: categoryId } }] },
  })
  if (totalDocs === 0) {
    await payload.create({
      collection: 'fees',
      data: { month: monthId, category: categoryId, amountCents },
      user,
      overrideAccess: false,
    })
  }

  revalidatePath('/')
}

/**
 * Skips (or un-skips) a previous-month category on the copy panel by
 * recording it on the month's skippedCategories. Admin-only, like the rest
 * of the copy panel — enforced by Months' update access.
 */
export async function setCategorySkippedAction(
  monthId: number,
  categoryId: number,
  skipped: boolean,
): Promise<void> {
  const { payload, user } = await requireUser()

  const month = await payload.findByID({ collection: 'months', id: monthId, depth: 0 })
  const current = skippedCategoryIdsOf(month).filter((id) => id !== categoryId)

  await payload.update({
    collection: 'months',
    id: monthId,
    data: { skippedCategories: skipped ? [...current, categoryId] : current },
    user,
    overrideAccess: false,
  })

  revalidatePath('/')
}

/**
 * Deletes a fee entered by mistake. cascadeDeletePayments removes its
 * payments too, so — matching guardAmountEdit — refuse if any are already
 * marked paid, rather than silently erase settled history. The dashboard
 * hides the button in that case; this is the server-side backstop.
 */
export async function deleteFeeAction(feeId: number): Promise<void> {
  const { payload, user } = await requireUser()

  const { totalDocs: paidCount } = await payload.count({
    collection: 'payments',
    where: { and: [{ fee: { equals: feeId } }, { paidOn: { exists: true } }] },
  })
  if (paidCount > 0) return

  await payload.delete({ collection: 'fees', id: feeId, user, overrideAccess: false })

  revalidatePath('/')
}

export type SaveFeeState = {
  error: string | null
  /** Set on success so the dialog knows to close; a timestamp so repeat saves still change it. */
  savedAt: number | null
}

/**
 * Backs the Add/Edit fee dialog (useActionState, hence the prevState arg).
 * Problems come back as `error` for the dialog to show rather than throwing,
 * including guardAmountEdit's "already marked paid" refusal.
 *
 * Admin-only (Fees' access rules enforce it; the early check just gives a
 * readable message). Adding: the target month can be any month/year, and
 * its Month row is created on the fly if it doesn't exist yet.
 *
 * Editing: only category and amount change. Moving a fee to another month
 * would leave its payments split across the old month's members, since
 * fanOutPayments only runs on create — delete and re-add instead.
 */
export async function saveFeeAction(
  _prev: SaveFeeState,
  formData: FormData,
): Promise<SaveFeeState> {
  const { payload, user } = await requireUser()

  if (!isAdmin(user)) {
    return { error: 'Only admins can add or edit fees.', savedAt: null }
  }

  const feeId = Number(formData.get('feeId')) || null
  const categoryId = Number(formData.get('category'))
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return { error: 'Choose a category.', savedAt: null }
  }

  let amountCents: number
  try {
    amountCents = toCents(String(formData.get('amount') ?? ''))
  } catch {
    return { error: 'Enter an amount.', savedAt: null }
  }
  if (amountCents < 0) {
    return { error: 'Amount can’t be negative.', savedAt: null }
  }

  let monthId: number
  let month: number
  let year: number

  if (feeId) {
    const fee = await payload.findByID({ collection: 'fees', id: feeId, depth: 1 })
    if (typeof fee.month !== 'object') throw new Error('fee month not populated')
    monthId = fee.month.id
    const start = new Date(fee.month.startsOn)
    month = start.getUTCMonth() + 1
    year = start.getUTCFullYear()
  } else {
    month = Number(formData.get('month'))
    year = Number(formData.get('year'))
    if (
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      !Number.isInteger(year) ||
      year < 2000 ||
      year > 2100
    ) {
      return { error: 'Choose a valid month and year.', savedAt: null }
    }
    const startsOn = monthStartFromParts(month, year).toISOString()
    const { docs } = await payload.find({
      collection: 'months',
      where: { startsOn: { equals: startsOn } },
      limit: 1,
      depth: 0,
    })
    if (docs[0]) {
      monthId = docs[0].id
    } else {
      const created = await payload.create({
        collection: 'months',
        data: { startsOn },
        user,
        overrideAccess: false,
      })
      monthId = created.id
    }
  }

  // One fee per category per month — the dashboard and copy panel both assume it.
  const { docs: clashes } = await payload.find({
    collection: 'fees',
    where: { and: [{ month: { equals: monthId } }, { category: { equals: categoryId } }] },
    limit: 1,
    depth: 1,
  })
  const clash = clashes.find((fee) => fee.id !== feeId)
  if (clash) {
    const name = typeof clash.category === 'object' ? clash.category.name : 'that category'
    return { error: `This month already has a ${name} fee. Edit that one instead.`, savedAt: null }
  }

  try {
    if (feeId) {
      await payload.update({
        collection: 'fees',
        id: feeId,
        data: { category: categoryId, amountCents },
        user,
        overrideAccess: false,
      })
    } else {
      await payload.create({
        collection: 'fees',
        data: { month: monthId, category: categoryId, amountCents },
        user,
        overrideAccess: false,
      })
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not save the fee.',
      savedAt: null,
    }
  }

  revalidatePath('/')

  // Show the fee where it landed. Outside any try/catch: redirect() throws.
  const viewedMonth = Number(formData.get('viewedMonth'))
  const viewedYear = Number(formData.get('viewedYear'))
  if (!feeId && (month !== viewedMonth || year !== viewedYear)) {
    redirect(`/?month=${month}&year=${year}`)
  }

  return { error: null, savedAt: Date.now() }
}

export type SaveUserState = {
  error: string | null
  /** Set on success so the dialog knows to close; a timestamp so repeat saves still change it. */
  savedAt: number | null
  /** Saved, but something worth telling the admin (e.g. the welcome email failed). */
  notice?: string
}

const WELCOME_LINK_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000

/** "2026-11-12" from a date input -> ISO at UTC midnight; blank -> null. */
function dateInputToIso(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const date = new Date(`${text}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Backs the Add/Edit user dialog on /users (useActionState, hence prevState).
 * Admin-only — Users' access rules enforce it too.
 *
 * Adding: the account gets a random password nobody knows, then a welcome
 * email with a set-password link (the same reset-password page and token
 * mechanism as "Forgot your password?", but valid for a week). If sending
 * fails the user still exists; the notice tells the admin to have them use
 * "Forgot your password?" once email works.
 *
 * Editing: an admin can't remove their own admin role or disable their own
 * login, so there's always at least one admin who can get back in. An
 * optional new password replaces theirs and logs them out everywhere
 * (Payload drops another user's sessions when their password changes);
 * with "mustChangePassword" they're sent to /change-password at next login.
 * Admins change their own password on /change-password instead.
 */
export async function saveUserAction(
  _prev: SaveUserState,
  formData: FormData,
): Promise<SaveUserState> {
  const { payload, user } = await requireUser()
  if (!isAdmin(user)) {
    return { error: 'Only admins can manage users.', savedAt: null }
  }

  const userId = Number(formData.get('userId')) || null
  const name = String(formData.get('name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const makeAdmin = formData.get('admin') === 'on'
  // New users can always log in; the checkbox only appears when editing.
  const isActive = userId ? formData.get('isActive') === 'on' : true
  const startDate = dateInputToIso(formData.get('startDate'))
  const endDate = dateInputToIso(formData.get('endDate'))
  const newPassword = userId && userId !== user.id ? String(formData.get('password') ?? '') : ''
  const mustChangePassword = formData.get('mustChangePassword') === 'on'

  if (!email) return { error: 'Enter an email address.', savedAt: null }
  if (!startDate) return { error: 'Enter the date they joined the household.', savedAt: null }
  if (endDate && endDate < startDate) {
    return { error: 'The end date can’t be before the start date.', savedAt: null }
  }
  if (userId === user.id && (!makeAdmin || !isActive)) {
    return {
      error: 'You can’t remove your own admin access or disable your own login.',
      savedAt: null,
    }
  }

  if (newPassword) {
    const problem = newPasswordProblem(newPassword, String(formData.get('confirm') ?? ''))
    if (problem) return { error: problem, savedAt: null }
  }

  const data = {
    name,
    email,
    roles: (makeAdmin ? ['admin', 'member'] : ['member']) as ('admin' | 'member')[],
    isActive,
    startDate,
    endDate,
    ...(newPassword ? { password: newPassword, mustChangePassword } : {}),
  }

  try {
    if (userId) {
      await payload.update({ collection: 'users', id: userId, data, user, overrideAccess: false })
    } else {
      await payload.create({
        collection: 'users',
        data: { ...data, password: randomBytes(24).toString('hex') },
        user,
        overrideAccess: false,
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save the user.'
    return {
      error: /email/i.test(message) ? 'That email address is already in use.' : message,
      savedAt: null,
    }
  }

  revalidatePath('/users')
  revalidatePath('/')

  if (userId) {
    return { error: null, savedAt: Date.now() }
  }

  try {
    const token = await payload.forgotPassword({
      collection: 'users',
      data: { email },
      disableEmail: true,
      expiration: WELCOME_LINK_EXPIRATION_MS,
    })
    const url = `${process.env.NEXT_PUBLIC_SERVER_URL || ''}/reset-password?token=${token}`
    await payload.sendEmail({
      to: email,
      subject: 'You’ve been added to Expenses',
      html: `<p>${user.name || user.email} added you to Expenses.</p>
<p>Choose a password to log in: <a href="${url}">${url}</a></p>
<p>This link expires in 7 days. After that, use “Forgot your password?” on the login page.</p>`,
    })
  } catch (error) {
    payload.logger.error({ err: error, msg: 'welcome email failed' })
    return {
      error: null,
      savedAt: Date.now(),
      notice: `${email} was added, but the welcome email couldn’t be sent. Once email is working, they can use “Forgot your password?” on the login page.`,
    }
  }

  return { error: null, savedAt: Date.now() }
}
