'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'

import config from '@/payload.config'

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
