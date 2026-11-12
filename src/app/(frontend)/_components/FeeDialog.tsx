'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useRef } from 'react'

import { fromCents } from '@/lib/money'
import { saveFeeAction, type SaveFeeState } from '../actions'

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, i, 1)),
  ),
)

const initialState: SaveFeeState = { error: null, savedAt: null }

export type FeeDialogProps = {
  categories: { id: number; name: string }[]
  /** The month being viewed on the dashboard. */
  month: number
  year: number
  /** Present when editing; month and year are then fixed. */
  fee?: { id: number; categoryId: number; amountCents: number }
  triggerLabel: string
  triggerClassName: string
}

/**
 * Add/Edit fee form in a native <dialog>. Saving goes through saveFeeAction
 * via useActionState so validation errors show inside the dialog. On success
 * it closes, and if the fee went into a different month than the one being
 * viewed, navigates there so the new fee is visible.
 */
export function FeeDialog({
  categories,
  month,
  year,
  fee,
  triggerLabel,
  triggerClassName,
}: FeeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const router = useRouter()
  const [state, formAction, pending] = useActionState(saveFeeAction, initialState)

  useEffect(() => {
    if (!state.savedAt) return
    dialogRef.current?.close()
    if (!fee) formRef.current?.reset()
    if (state.month && state.year && (state.month !== month || state.year !== year)) {
      router.push(`/?month=${state.month}&year=${state.year}`)
    }
    // Only react to a new successful save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.savedAt])

  const title = fee ? 'Edit fee' : 'Add fee'

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
          {fee && <input type="hidden" name="feeId" value={fee.id} />}

          <div className="fee-form-row">
            <label>
              Month
              <select name="month" defaultValue={month} disabled={Boolean(fee)}>
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Year
              <input
                type="number"
                name="year"
                min="2000"
                max="2100"
                defaultValue={year}
                disabled={Boolean(fee)}
                required
              />
            </label>
          </div>
          {fee && (
            <p className="muted">To move a fee to another month, delete it and add it there.</p>
          )}

          <label>
            Category
            <select name="category" defaultValue={fee?.categoryId ?? ''} required>
              <option value="" disabled>
                Choose a category…
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Amount
            <input
              type="number"
              name="amount"
              step="0.01"
              min="0"
              required
              defaultValue={fee ? fromCents(fee.amountCents) : ''}
            />
          </label>

          <div className="fee-form-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
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
