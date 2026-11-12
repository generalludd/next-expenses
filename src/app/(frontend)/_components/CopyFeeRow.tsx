import { formatMoney, fromCents } from '@/lib/money'
import type { PopulatedFee } from '@/lib/monthSummary'
import { copyFeeAction, setCategorySkippedAction } from '../actions'

export function CopyFeeRow({ fee, monthId }: { fee: PopulatedFee; monthId: number }) {
  return (
    <tr>
      <td>{fee.category.name}</td>
      <td className="amount">{formatMoney(fee.amountCents)}</td>
      <td>
        <form className="copy-fee-form" action={copyFeeAction.bind(null, monthId, fee.category.id)}>
          <input
            type="number"
            name="amount"
            step="0.01"
            min="0"
            required
            defaultValue={fromCents(fee.amountCents)}
            aria-label={`Amount for ${fee.category.name}`}
          />
          <button type="submit" className="btn-primary">
            Add
          </button>
          {/* formNoValidate: skipping shouldn't require a valid amount. */}
          <button
            type="submit"
            className="btn-secondary"
            formAction={setCategorySkippedAction.bind(null, monthId, fee.category.id, true)}
            formNoValidate
          >
            Skip
          </button>
        </form>
      </td>
    </tr>
  )
}
