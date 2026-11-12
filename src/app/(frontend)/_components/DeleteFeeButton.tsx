'use client'

import { deleteFeeAction } from '../actions'

/** A client component only so it can confirm() before submitting. */
export function DeleteFeeButton({ feeId, categoryName }: { feeId: number; categoryName: string }) {
  return (
    <form
      action={deleteFeeAction.bind(null, feeId)}
      onSubmit={(event) => {
        if (!window.confirm(`Delete the ${categoryName} fee and everyone's share of it?`)) {
          event.preventDefault()
        }
      }}
    >
      <button type="submit" className="btn-danger">
        Delete
      </button>
    </form>
  )
}
