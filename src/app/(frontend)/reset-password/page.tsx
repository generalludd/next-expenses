import { headers as getHeaders } from 'next/headers.js'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import config from '@/payload.config'
import { resetPasswordAction } from '../actions'

const errorMessages: Record<string, string> = {
  mismatch: 'Passwords do not match.',
  short: 'Use at least 8 characters.',
  invalid: 'This reset link is invalid or has expired.',
}

export default async function ResetPasswordPage(props: {
  searchParams: Promise<{ token?: string; error?: string }>
}) {
  const { token, error } = await props.searchParams

  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })
  const headers = await getHeaders()
  const { user } = await payload.auth({ headers })

  if (user) {
    redirect('/')
  }

  if (!token) {
    return (
      <div className="login-page">
        <div className="login-form">
          <h1>Reset password</h1>
          <p className="login-error">This reset link is invalid or has expired.</p>
          <a href="/forgot-password">Request a new link</a>
        </div>
      </div>
    )
  }

  const errorMessage = error ? errorMessages[error] : undefined

  return (
    <div className="login-page">
      <form className="login-form" action={resetPasswordAction}>
        <h1>Choose a new password</h1>
        {errorMessage && <p className="login-error">{errorMessage}</p>}
        <input type="hidden" name="token" value={token} />
        <label>
          New password
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={8}
            required
            autoFocus
          />
        </label>
        <label>
          Confirm new password
          <input type="password" name="confirm" autoComplete="new-password" required />
        </label>
        <button type="submit">Set password</button>
        {error === 'invalid' && <a href="/forgot-password">Request a new link</a>}
      </form>
    </div>
  )
}
