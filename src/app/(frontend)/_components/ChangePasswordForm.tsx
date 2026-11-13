'use client'

import Link from 'next/link'
import { useActionState, useEffect, useRef } from 'react'

import { changePasswordAction, type ChangePasswordState } from '../actions'

const initialState: ChangePasswordState = { error: null, savedAt: null }

/**
 * `forced`: an admin set a temporary password, so the current-password
 * field is left out (the action skips that check in the same case).
 */
export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction, pending] = useActionState(changePasswordAction, initialState)

  useEffect(() => {
    if (state.savedAt) formRef.current?.reset()
  }, [state.savedAt])

  return (
    <form ref={formRef} className="login-form" action={formAction}>
      <h1>Change password</h1>
      {forced && (
        <p className="login-notice">
          Your password was set by an admin. Choose a new one to continue.
        </p>
      )}
      {state.error && <p className="login-error">{state.error}</p>}
      {state.savedAt && !state.error && <p className="login-notice">Password updated.</p>}
      {!forced && (
        <label>
          Current password
          <input
            type="password"
            name="current"
            autoComplete="current-password"
            required
            autoFocus
          />
        </label>
      )}
      <label>
        New password
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          required
          autoFocus={forced}
        />
      </label>
      <label>
        Confirm new password
        <input type="password" name="confirm" autoComplete="new-password" required />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Change password'}
      </button>
      {!forced && <Link href="/">Back to expenses</Link>}
    </form>
  )
}
