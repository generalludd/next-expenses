'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import config from '@/payload.config'
import { toCents } from '@/lib/money'
import { monthStartFromParts } from '@/lib/months'
import { skippedCategoryIdsOf } from '@/lib/monthSummary'

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
  try {
    const result = await payload.login({ collection: 'users', data: { email, password } })
    token = result.token
    exp = result.exp
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

  redirect('/')
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

  const payload = await getPayload({ config: await config })

  let succeeded = false
  try {
    await payload.resetPassword({
      collection: 'users',
      data: { token, password },
      overrideAccess: true,
    })
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
  const payload = await getPayload({ config: await config })
  const requestHeaders = await headers()
  const { user } = await payload.auth({ headers: requestHeaders })

  if (!user) {
    redirect('/login')
  }

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
  const payload = await getPayload({ config: await config })
  const requestHeaders = await headers()
  const { user } = await payload.auth({ headers: requestHeaders })

  if (!user) {
    redirect('/login')
  }

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
  const payload = await getPayload({ config: await config })
  const requestHeaders = await headers()
  const { user } = await payload.auth({ headers: requestHeaders })

  if (!user) {
    redirect('/login')
  }

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
 * recording it on the month's skippedCategories. overrideAccess: true
 * because Months' update access is adminOnly, but skipping is part of the
 * same copy workflow any logged-in user can do with copyFeeAction — and it
 * only ever touches this one field.
 */
export async function setCategorySkippedAction(
  monthId: number,
  categoryId: number,
  skipped: boolean,
): Promise<void> {
  const payload = await getPayload({ config: await config })
  const requestHeaders = await headers()
  const { user } = await payload.auth({ headers: requestHeaders })

  if (!user) {
    redirect('/login')
  }

  const month = await payload.findByID({ collection: 'months', id: monthId, depth: 0 })
  const current = skippedCategoryIdsOf(month).filter((id) => id !== categoryId)

  await payload.update({
    collection: 'months',
    id: monthId,
    data: { skippedCategories: skipped ? [...current, categoryId] : current },
    overrideAccess: true,
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
  const payload = await getPayload({ config: await config })
  const requestHeaders = await headers()
  const { user } = await payload.auth({ headers: requestHeaders })

  if (!user) {
    redirect('/login')
  }

  const { totalDocs: paidCount } = await payload.count({
    collection: 'payments',
    where: { and: [{ fee: { equals: feeId } }, { paidOn: { exists: true } }] },
  })
  if (paidCount > 0) return

  await payload.delete({ collection: 'fees', id: feeId, user, overrideAccess: false })

  revalidatePath('/')
}
