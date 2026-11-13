'use client'

import { useActionState, useEffect, useRef } from 'react'

import { saveUserAction, type SaveUserState } from '../actions'

const initialState: SaveUserState = { error: null, savedAt: null }

export type UserDialogProps = {
  /** Present when editing. Dates are "YYYY-MM-DD" for the date inputs. */
  user?: {
    id: number
    name: string
    email: string
    admin: boolean
    isActive: boolean
    startDate: string
    endDate: string
  }
  /** Editing yourself: the admin and login checkboxes are locked on. */
  isSelf?: boolean
  triggerLabel: string
  triggerClassName: string
}

/**
 * Add/Edit user form in a native <dialog>, same pattern as FeeDialog. Closes
 * on a clean save; stays open to show a notice if the user was added but the
 * welcome email couldn't be sent.
 */
export function UserDialog({
  user,
  isSelf = false,
  triggerLabel,
  triggerClassName,
}: UserDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction, pending] = useActionState(saveUserAction, initialState)

  useEffect(() => {
    if (!state.savedAt || state.notice) return
    dialogRef.current?.close()
    if (!user) formRef.current?.reset()
    // Only react to a new successful save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.savedAt])

  const title = user ? 'Edit user' : 'Add user'

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => dialogRef.current?.showModal()}
      >
        {triggerLabel}
      </button>
      <dialog ref={dialogRef} className="fee-dialog" aria-label={title}>
        <form ref={formRef} action={formAction} className="fee-form">
          <h2>{title}</h2>
          {state.error && <p className="login-error">{state.error}</p>}
          {state.notice && <p className="login-notice">{state.notice}</p>}
          {user && <input type="hidden" name="userId" value={user.id} />}

          <label>
            Name
            <input type="text" name="name" defaultValue={user?.name ?? ''} autoComplete="off" />
          </label>
          <label>
            Email
            <input
              type="email"
              name="email"
              defaultValue={user?.email ?? ''}
              autoComplete="off"
              required
            />
          </label>

          <div className="fee-form-row">
            <label>
              Joined household
              <input type="date" name="startDate" defaultValue={user?.startDate ?? ''} required />
            </label>
            <label>
              Left household
              <input type="date" name="endDate" defaultValue={user?.endDate ?? ''} />
            </label>
          </div>
          <p className="muted">
            Dates decide who shares fees for a month. They apply to fees added from now on; existing
            fees keep their current split.
          </p>

          <label className="checkbox-label">
            {/* Disabled inputs aren't submitted, so a locked checkbox posts via the hidden copy. */}
            <input
              type="checkbox"
              name="admin"
              defaultChecked={user?.admin ?? false}
              disabled={isSelf}
            />
            Admin (can manage fees, months and users)
          </label>
          {isSelf && <input type="hidden" name="admin" value="on" />}

          {user && (
            <>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={user.isActive}
                  disabled={isSelf}
                />
                Can log in
              </label>
              {isSelf && <input type="hidden" name="isActive" value="on" />}
            </>
          )}

          {user && !isSelf && (
            <fieldset className="password-fieldset">
              <legend>Set a new password (optional)</legend>
              <div className="fee-form-row">
                <label>
                  New password
                  <input
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    minLength={8}
                  />
                </label>
                <label>
                  Confirm
                  <input type="password" name="confirm" autoComplete="new-password" />
                </label>
              </div>
              <label className="checkbox-label">
                <input type="checkbox" name="mustChangePassword" defaultChecked />
                Ask them to choose their own password when they next log in
              </label>
              <p className="muted">
                Leave blank to keep their current password. Setting one logs them out.
              </p>
            </fieldset>
          )}

          {!user && (
            <p className="muted">They’ll get an email with a link to choose their password.</p>
          )}

          <div className="fee-form-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => dialogRef.current?.close()}
            >
              {state.notice ? 'Close' : 'Cancel'}
            </button>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
