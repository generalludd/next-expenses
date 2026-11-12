import { headers as getHeaders } from 'next/headers.js'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import config from '@/payload.config'
import { forgotPasswordAction } from '../actions'

export default async function ForgotPasswordPage(props: {
  searchParams: Promise<{ sent?: string }>
}) {
  const { sent } = await props.searchParams

  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })
  const headers = await getHeaders()
  const { user } = await payload.auth({ headers })

  if (user) {
    redirect('/')
  }

  if (sent) {
    return (
      <div className="login-page">
        <div className="login-form">
          <h1>Check your email</h1>
          <p className="login-notice">
            If an account exists for that address, we&apos;ve sent a link to reset your password.
            It expires in 1 hour.
          </p>
          <a href="/login">Back to log in</a>
        </div>
      </div>
    )
  }

  return (
    <div className="login-page">
      <form className="login-form" action={forgotPasswordAction}>
        <h1>Reset password</h1>
        <label>
          Email
          <input type="email" name="email" autoComplete="email" required autoFocus />
        </label>
        <button type="submit">Send reset link</button>
        <a href="/login">Back to log in</a>
      </form>
    </div>
  )
}
