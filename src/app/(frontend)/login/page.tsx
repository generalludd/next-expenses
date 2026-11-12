import { headers as getHeaders } from 'next/headers.js'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import config from '@/payload.config'
import { loginAction } from '../actions'

export default async function LoginPage(props: {
  searchParams: Promise<{ error?: string; reset?: string }>
}) {
  const { error, reset } = await props.searchParams

  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })
  const headers = await getHeaders()
  const { user } = await payload.auth({ headers })

  if (user) {
    redirect('/')
  }

  return (
    <div className="login-page">
      <form className="login-form" action={loginAction}>
        <h1>Expenses</h1>
        {reset && <p className="login-notice">Password updated. Log in with your new password.</p>}
        {error && <p className="login-error">Incorrect email or password.</p>}
        <label>
          Email
          <input type="email" name="email" autoComplete="email" required autoFocus />
        </label>
        <label>
          Password
          <input type="password" name="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Log in</button>
        <a href="/forgot-password">Forgot your password?</a>
      </form>
    </div>
  )
}
